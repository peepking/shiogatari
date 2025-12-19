import { state, resetState } from "./state.js";
import { nowStr, formatGameTime, clamp } from "./util.js";
import { elements, setOutput, pushLog, pushToast } from "./dom.js";
import { renderMap, wireMapHover, getLocationStatus, getTerrainAt } from "./map.js";
import {
  formatTroopDisplay,
  renderTroopModal,
  wireTroopDismiss,
  applyTroopLosses,
  addTroops,
  levelUpTroopsRandom,
  TROOP_STATS,
} from "./troops.js";
import {
  formatSupplyDisplay,
  syncSuppliesUI,
  wireSupplyModal,
  wireSupplyDiscard,
} from "./supplies.js";
import { SUPPLY_ITEMS } from "./supplies.js";
import {
  moveToSelected,
  attemptEnter,
  attemptExit,
  waitOneDay,
  getCurrentSettlement,
  resetEncounterMeter,
} from "./actions.js";
import { wireMarketModals } from "./marketUI.js";
import { wireHireModal } from "./hireUI.js";
import { renderAssets, renderFactions, wireFactionPanel, wireMapToggle } from "./panelUI.js";
import { renderQuestUI, renderQuestModal } from "./questUI.js";
import {
  ensureSeasonalQuests,
  seedInitialQuests,
  receiveOracle,
  canReceiveOracle,
  getOracleBattleAt,
  completeOracleBattleQuest,
  failOracleBattleQuest,
  completeHuntBattleQuest,
  QUEST_TYPES,
} from "./quests.js";
import { buildEnemyFormation } from "./actions.js";
import { wireBattleUI, setEnemyFormation, setBattleEndHandler, openBattle, setBattleTerrain } from "./battle.js";

/**
 * モード表示用のラベルを組み立てる。
 * @returns {string}
 */
const formatModeLabel = () => {
  const base = state.modeLabel;
  const loc = getLocationStatus();
  const parts = [base];
  if (loc?.place) parts.push(loc.place);
  if (loc?.faction) parts.push(loc.faction);
  return parts.join("/");
};









/**
 * 行動メッセージをトーストで表示する。
 * @param {string} msg
 * @param {"error"|"warn"|"info"} kind
 */
function showActionMessage(msg, kind = "error") {
  if (!msg) {
    clearActionMessage();
    return;
  }
  const toastKind = kind === "error" ? "bad" : kind === "warn" ? "warn" : "info";
  const title = kind === "error" ? "移動不可" : kind === "warn" ? "注意" : "情報";
  pushToast(title, msg, toastKind);
  clearActionMessage();
}
/**
 * 行動メッセージ表示をクリアする。
 */
function clearActionMessage() {
  const el = elements.actionMsg;
  if (!el) return;
  el.textContent = "";
  el.className = "msg";
  el.hidden = true;
}

/**
 * インラインメッセージ表示を更新する。
 * @param {HTMLElement|null} el
 * @param {string} msg
 */
function setInlineMessage(el, msg) {
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.textContent = msg;
  el.hidden = false;
}

/**
 * 物資取引のエラーメッセージを更新する。
 * @param {string} msg
 */
function setTradeError(msg) {
  setInlineMessage(elements.tradeError, msg);
}

/**
 * 指定面数でダイスを振る。
 * @param {number} sides
 * @param {number} count
 * @returns {number}
 */
const rollDice = (sides, count) =>
  Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1).reduce((a, b) => a + b, 0);

/**
 * 海に祈る行動が可能か判定する。
 * @returns {boolean}
 */
function canPray() {
  if (state.faith < 10) return false;
  const last = state.lastPrayerSeason;
  if (last && last.year === state.year && last.season === state.season) return false;
  return Math.floor(state.faith * 0.1) > 0;
}

/**
 * 海に祈る処理を実行する。
 * @returns {boolean}
 */
function performPrayer() {
  if (state.faith < 10) {
    setOutput("祈れません", "信仰が不足しています（10以上必要）。", [
      { text: "祈り", kind: "warn" },
      { text: "信仰10+", kind: "warn" },
    ]);
    return false;
  }
  const last = state.lastPrayerSeason;
  if (last && last.year === state.year && last.season === state.season) {
    setOutput("祈れません", "この季節はすでに祈りました。", [
      { text: "祈り", kind: "warn" },
      { text: "季節ごと1回", kind: "warn" },
    ]);
    return false;
  }
  const consume = Math.floor(state.faith * 0.1);
  if (consume <= 0) {
    setOutput("祈れません", "消費できる信仰がありません。", [
      { text: "祈り", kind: "warn" },
      { text: "信仰10+", kind: "warn" },
    ]);
    return false;
  }
  state.faith = Math.max(0, state.faith - consume);
  const fundsGain = consume * rollDice(50, 10);
  const foodGain = consume * 2;
  state.funds += fundsGain;
  state.supplies.food = (state.supplies.food ?? 0) + foodGain;
  state.lastPrayerSeason = { year: state.year, season: state.season };
  const text = `信仰を${consume}捧げ、資金+${fundsGain} / 食料+${foodGain}を得ました。`;
  setOutput("祈り", text, [
    { text: "祈り", kind: "" },
  ]);
  pushLog("祈り", text, state.lastRoll ?? "-");
  pushToast("祈りの結果", text, "good");
  clearActionMessage();
  if (elements.ctxEl) elements.ctxEl.value = "move";
  syncUI();
  return true;
}

const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const battlePrepActive = () => state.modeLabel === "戦闘準備";

function totalTypeCount(type) {
  const levels = state.troops?.[type];
  if (!levels) return 0;
  if (typeof levels === "number") return levels;
  return Object.values(levels).reduce((s, v) => s + Number(v || 0), 0);
}

function enemyTotalEstimate(meta) {
  if (state.pendingEncounter?.enemyTotal) return state.pendingEncounter.enemyTotal;
  const fromMeta =
    meta?.enemyFormation?.reduce((s, e) => s + Number(e?.count || 0), 0) ||
    (meta?.units || [])
      .filter((u) => u.side === "enemy")
      .reduce((s, u) => s + Number(u.count || 0), 0);
  return fromMeta || 0;
}

function escapeSuccessRate() {
  const scouts = Math.min(10, totalTypeCount("scout"));
  const bonus = 70 * (1 - Math.pow(0.6, scouts)); // 初手が大きく、漸減しつつ10人でほぼ+70%
  return clamp(30 + bonus, 0, 100);
}

function clearBattlePrep(resetMode = true) {
  state.pendingEncounter = {
    active: false,
    enemyFormation: [],
    enemyTotal: 0,
    strength: "normal",
    terrain: "plain",
    questId: null,
    questType: null,
  };
  if (resetMode) state.modeLabel = "通常";
  resetEncounterMeter();
  setEnemyFormation(null);
  setBattleTerrain("plain");
}

function escapeBattleSuccess(reason) {
  const text = reason || "敵との接触を回避しました。";
  clearBattlePrep();
  setOutput("戦闘回避", text, [
    { text: "戦闘回避", kind: "good" },
  ]);
  pushLog("戦闘回避", text, "-");
  pushToast("逃走成功", text, "good");
  syncUI();
}

function calcLosses(meta) {
  const units = meta?.units || [];
  const allies = units.filter((u) => u.side === "ally");
  const medics = allies
    .filter((u) => u.type === "medic")
    .reduce((s, u) => s + Number(u.count || 0), 0);
  const lossProb = Math.max(0, 0.5 * (1 - Math.min(10, medics) / 10));
  const losses = {};
  allies
    .filter((u) => u.hp <= 0)
    .forEach((u) => {
      const lost = Math.round((u.count || 0) * lossProb);
      if (lost > 0) losses[u.type] = (losses[u.type] || 0) + lost;
    });
  return { losses, lossProb };
}

function calcCaptures(meta) {
  const units = meta?.units || [];
  const enemies = units.filter((u) => u.side === "enemy" && u.hp <= 0);
  const captured = {};
  enemies.forEach((u) => {
    const cnt = Math.max(0, Math.round(u.count || 0));
    let got = 0;
    for (let i = 0; i < cnt; i++) {
      if (Math.random() < 0.1) got += 1;
    }
    if (got > 0) {
      const lvl = Math.max(1, Math.round(u.level || 1));
      captured[`${u.type}|${lvl}`] = (captured[`${u.type}|${lvl}`] || 0) + got;
    }
  });
  return captured;
}

function killedEnemyCount(meta) {
  const units = meta?.units || [];
  return units
    .filter((u) => u.side === "enemy" && u.hp <= 0)
    .reduce((s, u) => s + Math.max(0, Math.round(u.count || 0)), 0);
}

/**
 * 戦闘結果を処理し、報酬/損耗/依頼・神託の完了/失敗を反映する。
 * @param {"勝利"|"敗北"|"引き分け"} result
 * @param {object} meta
 */
function processBattleOutcome(result, meta) {
  const enemyTotal = enemyTotalEstimate(meta);
  const fameDelta = Math.floor(enemyTotal / 2);
  const isStrong = meta?.enemyFormation?.some((e) => (e.level || 1) > 1) || state.pendingEncounter?.strength === "elite";
  const isWin = result === "勝利";
  const questId = state.pendingEncounter?.questId;
  const questType = state.pendingEncounter?.questType;
  const summary = [];
  if (isWin) {
    state.fame += fameDelta;
    const fundsGainBase = enemyTotal * 20;
    const fundsGain = Math.round(fundsGainBase * (0.9 + Math.random() * 0.2) * (isStrong ? 2 : 1));
    const foodGainBase = enemyTotal * 0.5;
    const foodGain = Math.max(0, Math.round(foodGainBase * (0.9 + Math.random() * 0.2) * (isStrong ? 2 : 1)));
    const materialSlots = Math.max(1, isStrong ? 2 : 1);
    const materialPool = SUPPLY_ITEMS.filter((i) => i.id !== "food").map((i) => i.id);
    const pickedMap = {};
    for (let i = 0; i < materialSlots; i++) {
      const key =
        materialPool.length > 0
          ? materialPool[Math.floor(Math.random() * materialPool.length)]
          : "food";
      pickedMap[key] = (pickedMap[key] || 0) + 1;
      state.supplies[key] = (state.supplies[key] ?? 0) + 1;
    }
    state.funds += fundsGain;
    state.supplies.food = (state.supplies.food ?? 0) + foodGain;
    summary.push(`名声 +${fameDelta}`);
    summary.push(`資金 +${fundsGain}`);
    summary.push(`食料 +${foodGain}`);
    const matText =
      Object.entries(pickedMap)
        .map(([k, v]) => {
          const name = SUPPLY_ITEMS.find((i) => i.id === k)?.name || k;
          return `${name} +${v}`;
        })
        .join(" / ") || "なし";
    summary.push(`物資: ${matText}`);
  } else {
    state.fame = Math.max(0, state.fame - fameDelta);
    const lossRate = 0.45 + Math.random() * 0.1; // 45-55%
    const fundsLost = Math.round(state.funds * lossRate);
    state.funds = Math.max(0, state.funds - fundsLost);
    summary.push(`名声 -${fameDelta}`);
    summary.push(`資金 -${fundsLost}`);
    const supplyLoss = {};
    Object.keys(state.supplies || {}).forEach((k) => {
      const cur = Number(state.supplies[k] || 0);
      const lost = Math.round(cur * lossRate);
      state.supplies[k] = Math.max(0, cur - lost);
      supplyLoss[k] = lost;
    });
    const foodLost = supplyLoss.food ?? 0;
    if (foodLost) summary.push(`食料 -${foodLost}`);
  }

  const { losses, lossProb } = calcLosses(meta);
  applyTroopLosses(losses);
  const lossEntries = Object.entries(losses || {}).map(([t, n]) => `${t} -${n}`);
  const lossText = lossEntries
    .map((txt) => {
      const [type, rest] = txt.split(" ");
      const name = TROOP_STATS[type]?.name || type;
      return `${name} ${rest || ""}`.trim();
    })
    .join(" / ") || "なし";
  summary.push(`損耗:${lossText === "なし" ? lossText : " " + lossText}`);

  const captured = calcCaptures(meta);
  Object.entries(captured).forEach(([key, qty]) => {
    const [type, lvlStr] = key.split("|");
    addTroops(type, Number(lvlStr) || 1, qty);
  });
  const capEntries =
    Object.entries(captured || {}).map(([key, n]) => {
      const [type, lvl] = key.split("|");
      const name = TROOP_STATS[type]?.name || type;
      return `${name} Lv${lvl} +${n}`;
    }) || [];
  const capText = capEntries.length ? capEntries.join(" / ") : "なし";
  summary.push(`拿捕:${capText === "なし" ? capText : " " + capText}`);

  const killed = killedEnemyCount(meta);
  const leveled = levelUpTroopsRandom(killed);
  if (leveled > 0) {
    summary.push(`練度上昇: ${leveled}人がLv+1`);
  }
  if (questId) {
    if (questType === QUEST_TYPES.ORACLE_HUNT || questType === QUEST_TYPES.ORACLE_ELITE) {
      if (isWin) {
        const ok = completeOracleBattleQuest(questId);
        if (ok) {
          const label = questType === QUEST_TYPES.ORACLE_ELITE ? "越えよ" : "奪え";
          summary.push(`神託達成: ${label}`);
        }
      } else {
        const label = questType === QUEST_TYPES.ORACLE_ELITE ? "越えよ" : "奪え";
        failOracleBattleQuest(questId, "戦闘に敗北しました");
        summary.push(`神託失敗: ${label}`);
      }
    } else if (questType === QUEST_TYPES.PIRATE_HUNT || questType === QUEST_TYPES.BOUNTY_HUNT) {
      if (isWin) {
        completeHuntBattleQuest(questId, true);
        summary.push(`討伐達成: ${questType === QUEST_TYPES.BOUNTY_HUNT ? "賞金首" : "海賊"}`);
      } else {
        completeHuntBattleQuest(questId, false, "戦闘に敗北しました");
        summary.push(`討伐失敗: ${questType === QUEST_TYPES.BOUNTY_HUNT ? "賞金首" : "海賊"}`);
      }
    }
  }

  clearBattlePrep(false);
  const body = summary.join("\n");
  setOutput("戦後処理", body, [
    { text: result, kind: isWin ? "good" : "warn" },
    { text: `敵推定${enemyTotal}人`, kind: "" },
  ]);
  pushLog("戦闘結果", body, "-");
  pushToast("戦闘結果", result, isWin ? "good" : "warn");
  const resultLabel = isWin ? "勝利" : "敗北";
  showBattleResultModal(summary, resultLabel);
  syncUI();
}

/**
 * pendingEncounterから戦闘を開始する（準備モード→戦闘画面）。
 * @returns {void}
 */
function startPrepBattle() {
  if (!state.pendingEncounter?.active) return;
  setEnemyFormation(state.pendingEncounter.enemyFormation || []);
  setBattleEndHandler((res, meta) => {
    processBattleOutcome(res, meta);
  });
  setBattleTerrain(state.pendingEncounter.terrain || getTerrainAt(state.position.x, state.position.y));
  state.modeLabel = "戦闘中";
  openBattle();
  syncUI();
}

/**
 * 討伐系（依頼/神託）から戦闘を開始する。
 * @returns {void}
 */
function startOracleBattle() {
  if (state.pendingEncounter?.active || state.modeLabel === "戦闘中") return;
  const quest = getOracleBattleAt(state.position);
  if (!quest) return;
  const force =
    quest.type === QUEST_TYPES.ORACLE_ELITE || quest.type === QUEST_TYPES.BOUNTY_HUNT ? "elite" : "normal";
  const { formation, total, strength } = buildEnemyFormation(force);
  const terrain = getTerrainAt(state.position.x, state.position.y) || "plain";
  state.pendingEncounter = {
    active: true,
    enemyFormation: formation,
    enemyTotal: total,
    strength,
    terrain,
    questId: quest.id,
    questType: quest.type,
  };
  state.modeLabel = "戦闘準備";
  resetEncounterMeter();
  setOutput(
    "討伐開始",
    `${quest.title} の討伐を開始します（推定${total}人 / ${strength === "elite" ? "強編成" : "通常編成"}）。`,
    [
      { text: "討伐", kind: "warn" },
      { text: strength === "elite" ? "強編成" : "通常編成", kind: "" },
    ]
  );
  pushLog("討伐開始", `${quest.title} / 敵推定${total}人`, "-");
  startPrepBattle();
}

function tryRunFromEncounter() {
  if (!state.pendingEncounter?.active) return;
  const rate = escapeSuccessRate();
  const roll = Math.random() * 100;
  if (roll < rate) {
    escapeBattleSuccess(`逃走成功 (${Math.round(rate)}%)`);
    return;
  }
  setOutput("逃走失敗", "逃走に失敗しました。戦闘に突入します。", [
    { text: "逃走失敗", kind: "warn" },
  ]);
  pushToast("逃走失敗", "戦闘に突入します。", "warn");
  startPrepBattle();
}

function tryPrayEscape() {
  const ok = performPrayer();
  if (!ok) return;
  escapeBattleSuccess("海に祈り、敵を退けました。");
}

function surrenderBattle() {
  if (!state.pendingEncounter?.active) return;
  processBattleOutcome("敗北", { enemyFormation: state.pendingEncounter.enemyFormation });
}

// 移動/待機/入退場の処理は actions.js に集約。

/**
 * モードカードのボタン表示を更新する。
 * @param {object|null} loc
 */
function updateModeControls(loc) {
  const prep = battlePrepActive();
  const inBattle = state.modeLabel === "戦闘中";
  const battleVisible = Boolean(elements.battleBlock && elements.battleBlock.hidden === false);
  const lockActions = prep || inBattle || battleVisible;
  const prepActive = prep && !!state.pendingEncounter?.active;
  const oracleBattle = getOracleBattleAt(state.position);
  const visible = state.modeLabel === "街の中" || state.modeLabel === "村の中";
  if (elements.tradeBtn) elements.tradeBtn.hidden = !visible;
  if (elements.shipTradeBtn)
    elements.shipTradeBtn.hidden = state.modeLabel !== "街の中";
  if (elements.questOpenBtn) elements.questOpenBtn.hidden = !visible;
  if (elements.hireBtn) elements.hireBtn.hidden = !visible;
  if (elements.oracleBtn) {
    elements.oracleBtn.hidden = lockActions;
    elements.oracleBtn.disabled = lockActions || !canReceiveOracle();
  }
  if (elements.modePrayBtn) {
    elements.modePrayBtn.hidden = lockActions;
    elements.modePrayBtn.disabled = lockActions || !canPray();
  }
  if (elements.enterVillageBtn)
    elements.enterVillageBtn.hidden = !(loc?.place === "村" && state.modeLabel !== "村の中");
  if (elements.enterTownBtn)
    elements.enterTownBtn.hidden = !(loc?.place === "街" && state.modeLabel !== "街の中");
  if (elements.exitVillageBtn)
    elements.exitVillageBtn.hidden = state.modeLabel !== "村の中";
  if (elements.exitTownBtn)
    elements.exitTownBtn.hidden = state.modeLabel !== "街の中";
  if (elements.modeWaitBtn) {
    elements.modeWaitBtn.hidden = lockActions;
    elements.modeWaitBtn.disabled = lockActions;
  }
  if (elements.oracleBattleBtn) {
    const show = !lockActions && !!oracleBattle;
    elements.oracleBattleBtn.hidden = !show;
    elements.oracleBattleBtn.disabled = !show;
    elements.oracleBattleBtn.title = show
      ? `${oracleBattle.title}（${oracleBattle.type === QUEST_TYPES.ORACLE_ELITE ? "強編成" : "通常編成"}）`
      : "";
  }
  if (elements.battlePrepRow) {
    const showPrepRow = prepActive && !inBattle && !battleVisible;
    elements.battlePrepRow.hidden = !showPrepRow;
    if (!showPrepRow) {
      elements.battlePrepFightBtn && (elements.battlePrepFightBtn.hidden = true);
      elements.battlePrepRunBtn && (elements.battlePrepRunBtn.hidden = true);
      elements.battlePrepPrayBtn && (elements.battlePrepPrayBtn.hidden = true);
      elements.battlePrepSurrenderBtn && (elements.battlePrepSurrenderBtn.hidden = true);
    } else {
      elements.battlePrepFightBtn && (elements.battlePrepFightBtn.hidden = false);
      elements.battlePrepRunBtn && (elements.battlePrepRunBtn.hidden = false);
      elements.battlePrepPrayBtn && (elements.battlePrepPrayBtn.hidden = false);
      elements.battlePrepSurrenderBtn && (elements.battlePrepSurrenderBtn.hidden = false);
      if (elements.battlePrepRunBtn) {
        const rate = Math.round(escapeSuccessRate());
        elements.battlePrepRunBtn.title = `逃走成功率: ${rate}%`;
      }
    }
    if (!showPrepRow && elements.battlePrepRunBtn) {
      elements.battlePrepRunBtn.title = "";
    }
  }
  if (elements.tradeBtn) elements.tradeBtn.disabled = lockActions;
  if (elements.shipTradeBtn) elements.shipTradeBtn.disabled = lockActions;
  if (elements.questOpenBtn) elements.questOpenBtn.disabled = lockActions;
  if (elements.hireBtn) elements.hireBtn.disabled = lockActions;
  if (elements.battlePrepPrayBtn) elements.battlePrepPrayBtn.disabled = !prepActive || !canPray();
  if (elements.battlePrepInfo) {
    const showInfo = prepActive && !inBattle && !battleVisible;
    if (!showInfo) {
      elements.battlePrepInfo.hidden = true;
    } else {
      const total = state.pendingEncounter.enemyTotal || "-";
      const strong = state.pendingEncounter.strength === "elite";
      elements.battlePrepInfo.hidden = false;
      elements.battlePrepInfo.textContent = `敵推定: ${total}人${strong ? "（強編成）" : ""}`;
    }
  }
}

/**
 * 画面全体の状態表示を同期する。
 */
function syncUI() {
  const {
    shipsEl,
    troopsEl,
    faithEl,
    suppliesEl,
    fundsEl,
    fameEl,
    modeLabelEl,
    locationLabelEl,
    gameTimeEl,
    shipsIn,
    troopsIn,
    faithIn,
    suppliesIn,
    fundsIn,
    fameIn,
  } = elements;

  const loc = getLocationStatus();
  const troopDisplay = formatTroopDisplay();
  syncSuppliesUI(elements);

  if (shipsEl) shipsEl.textContent = String(state.ships);
  if (troopsEl) troopsEl.innerHTML = troopDisplay.html;
  if (faithEl) faithEl.textContent = String(state.faith);
  if (fundsEl) fundsEl.textContent = String(state.funds);
  if (fameEl) fameEl.textContent = String(state.fame);
  if (modeLabelEl) modeLabelEl.textContent = formatModeLabel();
  if (locationLabelEl) {
    const here = loc?.place || "フィールド";
    const settlement = getCurrentSettlement();
    const name = settlement?.name;
    locationLabelEl.textContent = name ? `${here} / ${name}` : here;
  }
  if (gameTimeEl) gameTimeEl.textContent = formatGameTime(state);

  if (shipsIn) shipsIn.value = String(state.ships);
  if (troopsIn) troopsIn.value = String(troopDisplay.total);
  if (faithIn) faithIn.value = String(state.faith);
  if (fundsIn) fundsIn.value = String(state.funds);
  if (fameIn) fameIn.value = String(state.fame);

  renderAssets();
  renderFactions();
  renderMap();
  renderTroopModal(elements.troopsDetail);
  updateModeControls(loc);
  renderQuestUI(syncUI);

  // 行動選択の有効/無効切替
  if (elements.ctxEl) {
    const vOpt = elements.ctxEl.querySelector('option[value="enterVillage"]');
    const tOpt = elements.ctxEl.querySelector('option[value="enterTown"]');
    const vExit = elements.ctxEl.querySelector('option[value="exitVillage"]');
    const tExit = elements.ctxEl.querySelector('option[value="exitTown"]');
    if (vOpt) vOpt.disabled = loc?.place !== "村";
    if (tOpt) tOpt.disabled = loc?.place !== "街";
    if (vExit) vExit.disabled = state.modeLabel !== "村の中";
    if (tExit) tExit.disabled = state.modeLabel !== "街の中";
    if (elements.ctxEl.value === "enterVillage" && vOpt?.disabled) {
      elements.ctxEl.value = "move";
    }
    if (elements.ctxEl.value === "enterTown" && tOpt?.disabled) {
      elements.ctxEl.value = "move";
    }
    if (elements.ctxEl.value === "exitVillage" && vExit?.disabled) {
      elements.ctxEl.value = "move";
    }
    if (elements.ctxEl.value === "exitTown" && tExit?.disabled) {
      elements.ctxEl.value = "move";
    }
  }
}

/**
 * モーダルを開く。
 * @param {HTMLElement|null} el
 */
function openModal(el) {
  if (el) el.hidden = false;
}

/**
 * モーダルを閉じる。
 * @param {HTMLElement|null} el
 */
function closeModal(el) {
  if (el) el.hidden = true;
}

function showBattleResultModal(lines, resultLabel = "") {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const list =
    Array.isArray(lines) && lines.length ? lines : String(lines ?? "").split(/\n\s*\n/);
  if (elements.battleResultBody) {
    const items =
      list && list.length
        ? list
            .map((l) => `<li>${esc(l).replace(/\n/g, "<br>")}</li>`)
            .join("")
        : "<li>結果なし</li>";
    const resultText = resultLabel ? `${esc(resultLabel)}` : "結果";
    elements.battleResultBody.innerHTML = `
      <div class="battle-result-head">${resultText}</div>
      <ul class="battle-result-list">
        ${items}
      </ul>
    `;
  }
  openModal(elements.battleResultModal);
}

/**
 * モーダルの閉じる挙動を紐づける。
 * @param {HTMLElement|null} modal
 * @param {HTMLElement|null} closeBtn
 */
function bindModal(modal, closeBtn) {
  if (!modal) return;
  if (modal.dataset.bound === "true") return;
  if (closeBtn) {
    closeBtn.addEventListener("click", () => closeModal(modal));
  }
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal(modal);
  });
  if (closeBtn) modal.dataset.bound = "true";
}

/**
 * UIボタンのイベントを設定する。
 */
function wireButtons() {
  const openManualModal = () => openModal(elements.manualModal);
  elements.manualModalBtn?.addEventListener("click", openManualModal);
  bindModal(elements.manualModal, elements.manualModalClose);

  const openHelpModal = () => openModal(elements.helpModal);
  const openLoreModal = () => openModal(elements.loreModal);
  const openEndingsModal = () => openModal(elements.endingsModal);
  bindModal(elements.helpModal, elements.helpModalClose);
  bindModal(elements.loreModal, elements.loreModalClose);
  bindModal(elements.endingsModal, elements.endingsModalClose);
  bindModal(elements.battleResultModal, elements.battleResultClose);

  document.getElementById("modeBattleAlert")?.addEventListener("click", () => {
    state.modeLabel = "戦闘警戒";
    syncUI();
  });
  document.getElementById("modeBattle")?.addEventListener("click", () => {
    state.modeLabel = "戦闘中";
    syncUI();
  });
  elements.modeWaitBtn?.addEventListener("click", () => {
    waitOneDay(elements, clearActionMessage, syncUI);
  });
  elements.modePrayBtn?.addEventListener("click", () => {
    performPrayer();
  });
  elements.enterVillageBtn?.addEventListener("click", () => {
    attemptEnter("village", clearActionMessage, syncUI);
  });
  elements.enterTownBtn?.addEventListener("click", () => {
    attemptEnter("town", clearActionMessage, syncUI);
  });
  elements.exitVillageBtn?.addEventListener("click", () => {
    attemptExit("village", elements, clearActionMessage, setTradeError, syncUI);
  });
  elements.exitTownBtn?.addEventListener("click", () => {
    attemptExit("town", elements, clearActionMessage, setTradeError, syncUI);
  });
  document.addEventListener("map-move-request", () => {
    moveToSelected(showActionMessage, syncUI);
  });
  document.addEventListener("map-wait-request", () => {
    waitOneDay(elements, clearActionMessage, syncUI);
  });
  document.addEventListener("map-move-invalid", () => {
    showActionMessage("移動できるのは上下左右1マス以内です。", "error");
  });

  document.getElementById("syncBtn")?.addEventListener("click", () => {
    state.ships = Math.max(0, Number(elements.shipsIn?.value) || 0);
    state.faith = Math.max(0, Number(elements.faithIn?.value) || 0);
    state.funds = Math.max(0, Number(elements.fundsIn?.value) || 0);
    state.fame = Math.max(0, Number(elements.fameIn?.value) || 0);
    syncUI();
    const troopDisplay = formatTroopDisplay();
    const supplyDisplay = formatSupplyDisplay();
    pushLog(
      "手動更新",
      `従船=${state.ships} / 部隊=${troopDisplay.total}/${troopDisplay.cap} / 信仰=${state.faith} / 物資=${supplyDisplay.total}/${supplyDisplay.cap} / 資金=${state.funds} / 名声=${state.fame}`,
      state.lastRoll ?? "-"
    );
  });

  document.getElementById("helpBtn")?.addEventListener("click", () => {
    openHelpModal();
  });
  document.getElementById("loreBtn")?.addEventListener("click", () => {
    openLoreModal();
  });
  document.getElementById("endingsBtn")?.addEventListener("click", () => {
    openEndingsModal();
  });

  document.getElementById("clearLog")?.addEventListener("click", () => {
    if (!confirm("ログを消去しますか？")) return;
    if (elements.logEl) elements.logEl.innerHTML = "";
  });

  document.getElementById("resetBtn")?.addEventListener("click", () => {
    if (!confirm("状態とログをリセットしますか？")) return;
    resetState();
    resetEncounterMeter();
    if (elements.logEl) elements.logEl.innerHTML = "";
    setOutput("次の操作", "状況を選んで、1D6を振ってください", [
      { text: "-", kind: "" },
      { text: "-", kind: "" },
    ]);
    syncUI();
    pushLog("起動", "潮語り航海録を開始。");
  });

  document.getElementById("logMark")?.addEventListener("click", () => {
    if (elements.memoBox) elements.memoBox.hidden = false;
    elements.memo?.focus();
  });
  document.getElementById("cancelMemo")?.addEventListener("click", () => {
    if (elements.memoBox) elements.memoBox.hidden = true;
    if (elements.memo) elements.memo.value = "";
  });
  document.getElementById("saveMemo")?.addEventListener("click", () => {
    if (!elements.memo) return;
    const t = elements.memo.value.trim();
    if (!t) {
      alert("メモが空です。");
      return;
    }
    pushLog("航海日誌メモ", t, state.lastRoll ?? "-");
    elements.memo.value = "";
    if (elements.memoBox) elements.memoBox.hidden = true;
  });

  document.getElementById("journalBtn")?.addEventListener("click", () => {
    const ctxText = elements.ctxEl?.selectedOptions?.[0]?.textContent ?? "";
    const rollText = state.lastRoll == null ? "-" : String(state.lastRoll);
    const troopDisplay = formatTroopDisplay();
    const supplyDisplay = formatSupplyDisplay();
    const base = [
      "【航海日誌】",
      `日時：${nowStr()}`,
      `状況：${ctxText}`,
      `直近の出目：${rollText}`,
      `状態：従船=${state.ships} / 部隊=${troopDisplay.total}/${troopDisplay.cap} / 信仰=${state.faith} / 物資=${supplyDisplay.total}/${supplyDisplay.cap} / 資金=${state.funds} / 名声=${state.fame} / 沈黙=${state.silence}日`,
      "",
      "所感：",
      "",
      "次の方針：",
      "",
    ].join("\n");
    if (elements.memoBox) elements.memoBox.hidden = false;
    if (elements.memo) {
      elements.memo.value = base;
      elements.memo.focus();
    }
  });

  document.getElementById("exportBtn")?.addEventListener("click", () => {
    const txt = [...(elements.logEl?.querySelectorAll(".logitem") ?? [])]
      .reverse()
      .map((li) => {
        const what = li.querySelector(".what")?.textContent ?? "";
        const when = li.querySelector(".when")?.textContent ?? "";
        const body = li.querySelector(".txt")?.textContent ?? "";
        return `# ${what}\n${when}\n${body}\n`;
      })
      .join("\n");

    const blob = new Blob([txt || "(log empty)"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "shiogatari-log.txt";
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("copyBtn")?.addEventListener("click", async () => {
    const text =
      state.lastResultText ||
      `${elements.outTitle?.textContent ?? ""}\n${elements.outText?.textContent ?? ""}`;
    try {
      await navigator.clipboard.writeText(text);
      pushLog("コピー", "直近の結果をクリップボードにコピーしました", state.lastRoll ?? "-");
    } catch {
      alert("コピーに失敗しました。ブラウザの許可設定をご確認ください。");
    }
  });

  elements.battlePrepFightBtn?.addEventListener("click", startPrepBattle);
  elements.battlePrepRunBtn?.addEventListener("click", tryRunFromEncounter);
  elements.battlePrepPrayBtn?.addEventListener("click", tryPrayEscape);
  elements.battlePrepSurrenderBtn?.addEventListener("click", surrenderBattle);
  elements.battleResultBack?.addEventListener("click", () => {
    closeModal(elements.battleResultModal);
    elements.battleBackBtn?.click();
  });
  elements.battleBackBtn?.addEventListener("click", () => {
    setTimeout(() => syncUI(), 0);
  });

  wireFactionPanel();
  wireMapToggle(renderMap);

  wireMarketModals({ openModal, closeModal, bindModal, syncUI, clearActionMessage });
  wireHireModal({ openModal, bindModal, syncUI });

  const troopCard = document.getElementById("asset-companions") || document.getElementById("asset-troops");
  troopCard?.addEventListener("click", () => {
    renderTroopModal(elements.troopsDetail);
    openModal(elements.troopsModal);
  });
  wireSupplyModal(elements, openModal, closeModal);
  bindModal(elements.questModal, elements.questModalClose);
  elements.troopsModalClose?.addEventListener("click", () => closeModal(elements.troopsModal));
  elements.troopsModal?.addEventListener("click", (e) => {
    if (e.target === elements.troopsModal) closeModal(elements.troopsModal);
  });
  const openQuestModal = () => {
    const settlement = getCurrentSettlement();
    if (!settlement) {
      setOutput("依頼受注不可", "街・村の中でのみ受注できます。", [
        { text: "依頼", kind: "warn" },
        { text: "入場時に利用可", kind: "warn" },
      ]);
      return;
    }
    ensureSeasonalQuests(settlement);
    renderQuestModal(settlement, syncUI);
    bindModal(elements.questModal, elements.questModalClose);
    openModal(elements.questModal);
  };
  elements.questOpenBtn?.addEventListener("click", openQuestModal);
  elements.oracleBtn?.addEventListener("click", () => {
    const res = receiveOracle();
    if (!res) {
      setOutput("神託を授かれません", "この季節はすでに神託を受けています。", [
        { text: "神託", kind: "warn" },
        { text: "季節ごと1回", kind: "warn" },
      ]);
      return;
    }
    renderQuestUI(syncUI);
    syncUI();
  });
  elements.oracleBattleBtn?.addEventListener("click", startOracleBattle);
}

/**
 * UIの初期化処理。
 */
export function initUI() {
  seedInitialQuests();
  ensureSeasonalQuests(getCurrentSettlement());
  resetEncounterMeter();
  wireButtons();
  wireBattleUI();
  wireTroopDismiss(elements.troopsDetail, syncUI);
  wireSupplyDiscard(elements.suppliesDetail, syncUI);
  wireMapHover();
  syncUI();
  setOutput("次の操作", "状況を選んで、1D6を振ってください", [
    { text: "-", kind: "" },
    { text: "-", kind: "" },
  ]);
  pushLog("起動", "潮語り航海録を開始。");
}
