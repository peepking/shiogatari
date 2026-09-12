import { state } from "./state.js";
import { MODE_LABEL } from "./constants.js";
import { mapData, snapshotWorld, restoreWorld } from "./map.js";
import { absDay } from "./questUtils.js";
import { advanceDayWithEvents } from "./time.js";
import { buildEnemyFormation } from "./actions.js";
import { saveGameToStorage } from "./storage.js";
import { confirmAction, pushLog, pushToast } from "./dom.js";
import { enqueueEvent } from "./events.js";
import { SUPPLY_ITEMS, SUPPLY_TYPES } from "./supplies.js";
import { addTroops, TROOP_STATS } from "./troops.js";
import { awardExplorationFragment } from "./chartWorld.js";
import { initializeExploration, tickExploration, describeDanger, rollExplorationReward, consumeExploration, EXPLORATION_NAMES } from "./exploration.js";

/**
 * 他の依頼・海図の予約位置を自然探索の候補から除外する。
 * @returns {Set<string>} 予約座標。
 */
function blockedPositions() {
  const result = new Set();
  const quests = [...(state.quests?.active || []), ...Object.values(state.quests?.availableBySettlement || {}).flat(), ...Object.values(state.nobleQuests?.availableByNoble || {}).flat()];
  for (const quest of quests) {
    for (const pos of [quest.target, ...(quest.fights || []).map(f => f.target)]) {
      if (pos) result.add(`${pos.x},${pos.y}`);
    }
  }
  for (const chart of state.expansion.charts.active) {
    if (chart.destination) result.add(`${chart.destination.x},${chart.destination.y}`);
    if (chart.rumor) result.add(`${chart.rumor.x},${chart.rumor.y}`);
  }
  return result;
}

/**
 * 地図準備後の初回生成、または日次更新を行う。
 * @param {boolean} [daily] 日次更新か。
 * @returns {void}
 */
export function updateExplorationWorld(daily = false) {
  const data = state.expansion?.exploration;
  if (!data) return;
  const update = daily ? tickExploration : initializeExploration;
  update(data, mapData, absDay(state), blockedPositions());
}

/**
 * 指定位置の自然探索地点を取得する。
 * @param {object} position 座標。
 * @returns {object|undefined} 地点。
 */
export function getExplorationAt(position) {
  return state.expansion?.exploration.sites.find(s => s.position.x === position.x && s.position.y === position.y);
}

/**
 * 固定した探索報酬を付与し、報告用の資源を返す。船を先に加算する。
 * @param {boolean} success 探索成功か。
 * @returns {Array} 表示資源。
 */
export function finishExploration(success) {
  const reward = consumeExploration(state.expansion.exploration, success);
  if (!reward) return [];
  if (reward.fragment === true) awardExplorationFragment();
  addShips(state, prepareShipReward(reward));
  state.funds += reward.funds;
  const resources = [{ id: "funds", label: "探索資金", value: `+${reward.funds}` }];
  if (reward.ships) resources.push({ id: "ships", label: "発見した船", value: shipListText(reward.shipTypes) });
  for (const [id, qty] of Object.entries(reward.supplies)) {
    if (!SUPPLY_ITEMS.some(item => item.id === id)) continue;
    state.supplies[id] = (state.supplies[id] || 0) + qty;
    resources.push({ id, label: SUPPLY_ITEMS.find(item => item.id === id)?.name || id, value: `+${qty}` });
  }
  for (const [id, qty] of Object.entries(reward.troops)) {
    if (!Object.hasOwn(TROOP_STATS, id)) continue;
    addTroops(id, 1, qty);
    resources.push({ id, label: `救助: ${TROOP_STATS[id].name} Lv1`, value: `+${qty}人` });
  }
  pushLog("探索報酬", resources.map(r => `${r.label} ${r.value}`).join(" / "), "-");
  return resources;
}

/**
 * 保存済みの探索を再開する。日数適用前後を保存し、保存失敗なら適用前へ戻す。
 * 戦闘の編成と探索報酬は初回確定値を使い、再抽選しない。
 * @param {Function} syncUI 表示同期。
 * @returns {void}
 */
export function resumeExploration(syncUI) {
  let pending = state.expansion.exploration.pending;
  if (!pending) return;
  if (pending.reward) {
    prepareShipReward(pending.reward);
    if (!saveGameToStorage()) {
      state.modeLabel = MODE_LABEL.PREP;
      pushToast("保存できません", "探索を再開して再試行してください。", "warn"); syncUI(); return;
    }
  }
  if (!pending.dayApplied) {
    const before = structuredClone(state);
    const world = structuredClone(snapshotWorld());
    state.modeLabel = MODE_LABEL.NORMAL;
    advanceDayWithEvents(1);
    pending.dayApplied = true;
    if (!saveGameToStorage()) {
      Object.assign(state, before);
      restoreWorld(world);
      state.modeLabel = MODE_LABEL.PREP;
      pushToast("保存できません", "探索を中断しました。保存容量などを確認し、探索を再開してください。", "warn");
      syncUI();
      return;
    }
  }
  pending = state.expansion.exploration.pending;
  if (pending.encounter) {
    state.pendingEncounter = structuredClone(pending.encounter);
    state.modeLabel = MODE_LABEL.PREP;
    pushToast("探索中の敵襲", "戦うか、逃走するかを選んでください。", "warn");
  } else {
    const resources = finishExploration(true);
    state.modeLabel = MODE_LABEL.NORMAL;
    enqueueEvent({ title: "探索完了", body: "探索で資金と物資を回収しました。上限を超えた場合は物資の破棄・兵員の解雇で整理してください。", resources });
    saveGameToStorage();
  }
  syncUI();
}

/**
 * 現在地点の探索を確認し、固定結果を保存してから1日進める。
 * 確認中に地点やモードが変わっていれば実行しない。
 * @param {Function} syncUI 表示同期。
 * @returns {void}
 */
function beginExploration(syncUI) {
  if (state.expansion.exploration.pending) { resumeExploration(syncUI); return; }
  const site = getExplorationAt(state.position);
  if (!site || state.modeLabel !== MODE_LABEL.NORMAL || state.pendingEncounter?.active || state.expansion.charts.pending) return;
  confirmAction({ title: `${EXPLORATION_NAMES[site.kind]}を探索`,
    body: `探索に1日かかります。消滅まであと${site.expiresAbs - absDay(state)}日。\n${describeDanger(site.danger)}\n敵は賞金首相当です。敗北・逃走・引き分けでは探索報酬を得られず、この地点は消えます。`,
    confirmText: "1日使って探索",
    onConfirm: () => {
      if (getExplorationAt(state.position)?.id !== site.id || state.modeLabel !== MODE_LABEL.NORMAL || state.expansion.exploration.pending || state.pendingEncounter?.active) return;
      const reward = rollExplorationReward(site.kind, SUPPLY_ITEMS.filter(item => item.type === SUPPLY_TYPES.processed).map(item => item.id), Object.keys(TROOP_STATS));
      const fight = site.danger === 1 || (site.danger > 0 && Math.random() < site.danger);
      let encounter = null;
      if (fight) {
        const enemy = buildEnemyFormation("elite", "pirates");
        encounter = { active: true, enemyFormation: enemy.formation, enemyTotal: enemy.total, strength: enemy.strength,
          enemyFactionId: "pirates", terrain: mapData[site.position.y][site.position.x].terrain, explorationId: site.id, eventTag: "natural_exploration" };
      }
      state.expansion.exploration.pending = { siteId: site.id, dayApplied: false, reward, encounter };
      if (!saveGameToStorage()) {
        state.expansion.exploration.pending = null;
        pushToast("保存できません", "探索は開始していません。保存容量などを確認してください。", "warn");
        return;
      }
      document.dispatchEvent(new CustomEvent("auto-move-stop"));
      resumeExploration(syncUI);
    },
  });
}

/**
 * 現在地の探索ボタンと説明を更新する。未完了処理は再開のみを許す。
 * @param {Function} syncUI 表示同期。
 * @returns {void}
 */
export function renderExplorationControl(syncUI) {
  const button = document.getElementById("exploreBtn");
  const info = document.getElementById("exploreInfo");
  if (!button) return;
  const site = getExplorationAt(state.position);
  const pending = state.expansion.exploration.pending;
  const resume = pending && !state.pendingEncounter?.active && state.modeLabel !== MODE_LABEL.BATTLE;
  const available = site && state.modeLabel === MODE_LABEL.NORMAL && !state.pendingEncounter?.active;
  button.hidden = !(resume || available);
  button.textContent = resume ? "探索を再開" : `${EXPLORATION_NAMES[site?.kind] || "地点"}を探索`;
  button.onclick = () => beginExploration(syncUI);
  info.hidden = button.hidden;
  info.textContent = site ? `${describeDanger(site.danger)} / 探索1日` : "";
}
import { addShips, prepareShipReward, shipListText } from "./fleet.js";
