import { receiveFunds } from "../core/voyageStats.js";
import { state } from "../core/state.js";
import { MODE_LABEL } from "../core/constants.js";
import { mapData, snapshotWorld, restoreWorld } from "../world/map.js";
import { absDay } from "../quests/questUtils.js";
import { advanceDayWithEvents } from "../app/time.js";
import { buildEnemyFormation, buildDangerousEnemyFormation } from "../app/actions.js";
import { saveGameToStorage } from "../core/storage.js";
import { confirmAction, pushLog, pushToast } from "../ui/dom.js";
import { enqueueEvent } from "../app/events.js";
import { SUPPLY_ITEMS, SUPPLY_TYPES } from "../resources/supplies.js";
import { addTroops, TROOP_STATS } from "../resources/troops.js";
import { awardExplorationFragment } from "./chartWorld.js";
import { initializeExploration, tickExploration, describeDanger, rollExplorationReward, consumeExploration, EXPLORATION_NAMES } from "./exploration.js";
import { getDangerousSeaPositions } from "../dangerousSeas/dangerousSeaWorld.js";
import { rollDangerousExplorationReward, consumeDangerousExploration } from "../dangerousSeas/dangerousSeaExploration.js";
import { beginDangerousSeaAction, finishDangerousSeaAction, dangerousSeaActionBlocked } from "../dangerousSeas/dangerousSeaHazards.js";
import { dangerousSeaReservedPositions } from "../dangerousSeas/dangerousSeaReservations.js";
import { snapshotOutfitting } from "../fleet/outfitting.js";
import { createDangerousWreckPending, dangerousWreckPending, settleDangerousWreckStage } from "../dangerousSeas/dangerousWreck.js";
import { resumeDangerousWreck, pauseDangerousWreckForHazard, renderDangerousWreckChoice, chooseDangerousWreckBranch as chooseWreck } from "../dangerousSeas/dangerousWreckUI.js";

/**
 * 他の依頼・海図の予約位置を自然探索の候補から除外する。
 * @returns {Set<string>} 予約座標。
 */
function blockedPositions() {
  const result = new Set();
  const story = state.pirateKingStory?.active;
  if (story) result.add(`${story.position.x},${story.position.y}`);
  for (const site of state.bounties?.active || []) result.add(`${site.position.x},${site.position.y}`);
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
  for (const regionId of ["sw", "se"]) {
    for (const position of getDangerousSeaPositions(regionId)) result.add(`${position.x},${position.y}`);
  }
  for (const position of dangerousSeaReservedPositions(state)) result.add(`${position.x},${position.y}`);
  return result;
}

/** @returns {object|null} 通常または専用枠の途中探索。 */
function currentExplorationPending() { return state.expansion.exploration.pending || state.dangerousSeas?.explorationPending || null; }

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
  const normal = state.expansion?.exploration.sites.find(s => s.position.x === position.x && s.position.y === position.y);
  if (normal) return normal;
  for (const region of Object.values(state.dangerousSeas?.regions || {})) {
    const site = region.sites.find(candidate => candidate.position.x === position.x && candidate.position.y === position.y);
    if (site) return site;
  }
  return undefined;
}

/**
 * 固定した探索報酬を付与し、報告用の資源を返す。船を先に加算する。
 * @param {boolean} success 探索成功か。
 * @returns {Array} 表示資源。
 */
export function finishExploration(success) {
  if (!currentExplorationPending()) return [];
  const staged = dangerousWreckPending(state.dangerousSeas), result = staged ? settleDangerousWreckStage(state.dangerousSeas, success) : null;
  const reward = staged ? result?.reward : state.expansion.exploration.pending ? consumeExploration(state.expansion.exploration, success) : consumeDangerousExploration(state.dangerousSeas, success);
  if (!reward) { finishDangerousSeaAction("exploration"); return []; }
  if (reward.fragment === true) awardExplorationFragment();
  addShips(state, prepareShipReward(reward));
  receiveFunds(state, reward.funds);
  const resources = [{ id: "funds", label: "探索資金", value: `+${reward.funds}` }];
  for (const [id, quantity] of Object.entries(result?.losses || {})) {
    const lost = Math.min(quantity, Math.max(0, state.supplies[id] || 0)); state.supplies[id] = Math.max(0, (state.supplies[id] || 0) - lost);
    if (lost) resources.push({ id, label: SUPPLY_ITEMS.find(item => item.id === id)?.name || id, value: `-${lost}` });
  }
  if (result?.accident === "flood") resources.push({ id: "funds", label: "船倉の浸水", value: "追加の積荷を一部失いました" });
  if (reward.ships) resources.push({ id: "ships", label: "発見した船", value: shipListText(reward.shipTypes) });
  for (const [id, qty] of Object.entries(reward.supplies)) {
    if (!SUPPLY_ITEMS.some(item => item.id === id)) continue;
    state.supplies[id] = (state.supplies[id] || 0) + qty;
    resources.push({ id, label: SUPPLY_ITEMS.find(item => item.id === id)?.name || id, value: `+${qty}` });
  }
  for (const [id, qty] of Object.entries(reward.troops)) {
    if (!Object.hasOwn(TROOP_STATS, id)) continue;
    const level = reward.troopLevel || 1;
    addTroops(id, level, qty);
    resources.push({ id, label: `救助: ${TROOP_STATS[id].name} Lv${level}`, value: `+${qty}人` });
  }
  pushLog("探索報酬", resources.map(r => `${r.label} ${r.value}`).join(" / "), "-");
  finishDangerousSeaAction("exploration");
  const remaining = dangerousWreckPending(state.dangerousSeas);
  if (remaining) pauseDangerousWreckForHazard(remaining, false);
  return resources;
}

/** @param {string} choice 引き上げ・積荷・救助。 @param {Function} syncUI 表示同期。 @returns {boolean} 段階選択を確定できたか。 */
export function chooseDangerousWreckBranch(choice, syncUI) { return chooseWreck(choice, syncUI, finishExploration); }

/**
 * 保存済みの探索を再開する。日数適用前後を保存し、保存失敗なら適用前へ戻す。
 * 戦闘の編成と探索報酬は初回確定値を使い、再抽選しない。
 * @param {Function} syncUI 表示同期。
 * @returns {void}
 */
export function resumeExploration(syncUI) {
  if (dangerousWreckPending(state.dangerousSeas)) { resumeDangerousWreck(syncUI, finishExploration); return; }
  let pending = currentExplorationPending();
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
    if (!state.dangerousSeas?.action && !beginDangerousSeaAction("exploration")) { syncUI?.(); return; }
    state.modeLabel = MODE_LABEL.NORMAL;
    if (advanceDayWithEvents(1) !== 1) { Object.assign(state, before); restoreWorld(world); syncUI?.(); return; }
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
  pending = currentExplorationPending();
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
  if (currentExplorationPending()) { resumeExploration(syncUI); return; }
  const site = getExplorationAt(state.position);
  if (!site || state.modeLabel !== MODE_LABEL.NORMAL || state.pendingEncounter?.active || state.expansion.charts.pending || dangerousSeaActionBlocked()) return;
  const staged = site.regionId && site.kind === "wreck";
  confirmAction({ title: `${EXPLORATION_NAMES[site.kind]}を探索`,
    body: `${staged ? "甲板の探索に1日かかります。回収後は引き上げるか、追加1日で積荷または生存者を探せます。" : "探索に1日かかります。"}消滅まであと${site.expiresAbs - absDay(state)}日。\n${describeDanger(site.danger)}\n敵は賞金首相当です。敗北・逃走・引き分けでは現在の段階の報酬を得られず、この地点は消えます。`,
    confirmText: "1日使って探索",
    onConfirm: () => {
      const currentSite = getExplorationAt(state.position);
      if (currentSite !== site || state.modeLabel !== MODE_LABEL.NORMAL || currentExplorationPending() || state.pendingEncounter?.active || dangerousSeaActionBlocked()) return;
      const before = structuredClone(state), goods = SUPPLY_ITEMS.filter(item => item.type === SUPPLY_TYPES.processed).map(item => item.id);
      const reward = site.regionId ? rollDangerousExplorationReward(site, goods, Object.keys(TROOP_STATS)) : rollExplorationReward(site.kind, goods, Object.keys(TROOP_STATS));
      const fight = site.danger === 1 || (site.danger > 0 && Math.random() < site.danger);
      let encounter = null;
      if (fight) {
        const enemy = site.regionId ? buildDangerousEnemyFormation(site.position, site.level) : buildEnemyFormation("elite", "pirates");
        encounter = { active: true, enemyFormation: enemy.formation, enemyTotal: enemy.total, strength: enemy.strength,
          enemyFactionId: "pirates", terrain: mapData[site.position.y][site.position.x].terrain, eventTag: site.regionId ? "dangerous_exploration" : "natural_exploration",
          ...(site.regionId ? { dangerousExplorationId: site.id, dangerousRegionId: site.regionId } : { explorationId: site.id }) };
      }
      const pending = { siteId: site.id, dayApplied: false, reward, encounter };
      if (site.regionId && site.kind === "wreck") {
        /** @returns {object} 新しい枝の敵を開始時に固定する。 */
        const createWreckEnemy = () => {
          const enemy = buildDangerousEnemyFormation(site.position, site.level);
          return { active: true, enemyFormation: enemy.formation, enemyTotal: enemy.total, strength: enemy.strength,
            enemyFactionId: "pirates", terrain: "sea", eventTag: "dangerous_exploration", dangerousExplorationId: site.id, dangerousRegionId: site.regionId };
        };
        state.dangerousSeas.explorationPending = createDangerousWreckPending(site, reward, encounter, snapshotOutfitting(state).scouts, createWreckEnemy);
      } else if (site.regionId) state.dangerousSeas.explorationPending = { ...pending, regionId: site.regionId };
      else state.expansion.exploration.pending = pending;
      if (!beginDangerousSeaAction("exploration")) { Object.assign(state, before); return; }
      if (!saveGameToStorage()) {
        Object.assign(state, before);
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
  const pending = currentExplorationPending();
  const wreck = dangerousWreckPending(state.dangerousSeas);
  const resume = pending && !state.pendingEncounter?.active && state.modeLabel !== MODE_LABEL.BATTLE
    && !(wreck?.wreck.stage === "choice" && !wreck.pausedForHazard) && (!state.dangerousSeas?.pendingHazard || state.dangerousSeas.pendingHazard.stage === "watch");
  const available = site && state.modeLabel === MODE_LABEL.NORMAL && !state.pendingEncounter?.active && !dangerousSeaActionBlocked();
  button.hidden = !(resume || available);
  button.textContent = resume ? "探索を再開" : `${EXPLORATION_NAMES[site?.kind] || "地点"}を探索`;
  button.onclick = () => beginExploration(syncUI);
  info.hidden = button.hidden;
  info.textContent = site ? `${site.regionId ? `危険海域・${site.level === "core" ? "核心" : "外縁"} / ` : ""}${describeDanger(site.danger)} / ${site.regionId && site.kind === "wreck" ? "甲板1日・船倉は積荷か救助の追加1日" : "探索1日"}` : "";
  if (wreck?.pausedForHazard) info.textContent = "難破船の探索を保留しています。危険を解決した後、同じ段階から再開できます。";
  renderDangerousWreckChoice(button, syncUI, finishExploration);
}
import { addShips, prepareShipReward, shipListText } from "../fleet/fleet.js";
