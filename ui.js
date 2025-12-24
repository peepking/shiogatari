import { state, resetState } from "./state.js";
import { MODE_LABEL, BATTLE_RESULT, BATTLE_RESULT_LABEL, PLACE, NONE_LABEL } from "./constants.js";
import { nowStr, formatGameTime, clamp } from "./util.js";
import { elements, setOutput, pushLog, pushToast } from "./dom.js";
import { renderMap, wireMapHover, getLocationStatus, getTerrainAt, ensureNobleHomes, settlements, resetSettlementSupport } from "./map.js";
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
import { SUPPLY_ITEMS, SUPPLY_TYPES } from "./supplies.js";
import {
  moveToSelected,
  attemptEnter,
  attemptExit,
  waitOneDay,
  getCurrentSettlement,
  resetEncounterMeter,
} from "./actions.js";
import { wireMarketModals, openEventTrade } from "./marketUI.js";
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
import { addWarScore, getPlayerFactionId, adjustNobleFavor, adjustSupport } from "./faction.js";
import { absDay, manhattan } from "./questUtils.js";
import {
  wireBattleUI,
  setEnemyFormation,
  setBattleEndHandler,
  openBattle,
  setBattleTerrain,
  setBattleEnemyFaction,
} from "./battle.js";
import { loadGameFromStorage } from "./storage.js";
import { initEventQueueUI } from "./events.js";
import { ensureFactionState } from "./faction.js";

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

let autoMoveTimer = null;
let autoMoveTarget = null;

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
  addWarScore(getPlayerFactionId(), "pirates", 0, absDay(state), 0, consume);
  clearActionMessage();
  if (elements.ctxEl) elements.ctxEl.value = "move";
  syncUI();
  return true;
}

const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const battlePrepActive = () => state.modeLabel === MODE_LABEL.PREP;

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
    enemyFactionId: null,
  };
  if (resetMode) state.modeLabel = MODE_LABEL.NORMAL;
  resetEncounterMeter();
  setEnemyFormation(null);
  setBattleEnemyFaction(null);
  setBattleTerrain("plain");
}

function stopAutoMove() {
  if (autoMoveTimer) {
    clearTimeout(autoMoveTimer);
    autoMoveTimer = null;
  }
  autoMoveTarget = null;
}

function stepAutoMove() {
  if (!autoMoveTarget) {
    stopAutoMove();
    return;
  }
  if (state.pendingEncounter?.active || state.modeLabel === MODE_LABEL.BATTLE || state.modeLabel === MODE_LABEL.PREP) {
    stopAutoMove();
    return;
  }
  const { x: tx, y: ty } = autoMoveTarget;
  const { x: cx, y: cy } = state.position;
  if (cx === tx && cy === ty) {
    stopAutoMove();
    return;
  }
  const dx = tx - cx;
  const dy = ty - cy;
  const next = {
    x: cx + Math.sign(dx || 0),
    y: cy + (dx === 0 ? Math.sign(dy || 0) : 0),
  };
  state.selectedPosition = { ...next };
  const moved = moveToSelected(showActionMessage, syncUI);
  if (!moved) {
    stopAutoMove();
    return;
  }
  if (state.pendingEncounter?.active || state.modeLabel === MODE_LABEL.BATTLE || state.modeLabel === MODE_LABEL.PREP) {
    stopAutoMove();
    return;
  }
  if (state.position.x === tx && state.position.y === ty) {
    stopAutoMove();
    return;
  }
  autoMoveTimer = setTimeout(stepAutoMove, 500);
}

function startAutoMove(target) {
  stopAutoMove();
  if (!target) return;
  autoMoveTarget = { ...target };
  stepAutoMove();
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
      if (Math.random() < 0.05) got += 1;
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
 * @param {"win"|"lose"|"draw"} resultCode
 * @param {object} meta
 */
function processBattleOutcome(resultCode, meta) {
  const pending = state.pendingEncounter || {};
  const enemyTotal = pending.enemyTotal || enemyTotalEstimate(meta);
  const fameDelta = Math.floor(enemyTotal / 4);
  const isStrong = meta?.enemyFormation?.some((e) => (e.level || 1) > 1) || pending.strength === "elite";
  const enemyFactionId = meta?.enemyFactionId || pending.enemyFactionId || "pirates";
  const playerFactionId = getPlayerFactionId();
  const eventTag = meta?.eventTag || pending.eventTag || null;
  const eventContext = meta?.eventContext || pending.eventContext || null;
  const resultLabel = BATTLE_RESULT_LABEL[resultCode] || resultCode;
  const isWin = resultCode === BATTLE_RESULT.WIN;
  const questId = pending.questId;
  const questType = pending.questType;
  const summary = [];
  /**
   * 行商人関連の追加戦利品を付与する。
   * @param {number} scale 元となる敵規模
   * @param {boolean} elite 強編成かどうか
   * @param {"raid"|"help"} kind 襲撃/救助の別
   * @returns {string[]} 付与内容の表示テキスト
   */
  const grantMerchantBonusLoot = (scale, elite, kind) => {
    const texts = [];
    state.supplies ||= {};
    const variance = 0.9 + Math.random() * 0.2;
    const fundsGain = Math.max(5, Math.round(scale * (kind === "help" ? 15 : 20) * variance * (elite ? 1.2 : 1)));
    state.funds = (state.funds || 0) + fundsGain;
    texts.push(`資金 +${fundsGain}`);
    if (kind === "help") return texts;
    const rawPool = SUPPLY_ITEMS.filter((i) => i.type === SUPPLY_TYPES.raw);
    const procPool = SUPPLY_ITEMS.filter((i) => i.type === SUPPLY_TYPES.processed);
    const rawQty = Math.max(1, Math.round(scale / 25));
    const procQty = Math.max(1, Math.round(scale / 40));
    const rawPicks = [];
    const procPicks = [];
    for (let i = 0; i < 3 && rawPool.length; i++) {
      const pick = rawPool[Math.floor(Math.random() * rawPool.length)];
      rawPicks.push(pick);
      state.supplies[pick.id] = (state.supplies[pick.id] ?? 0) + rawQty;
    }
    for (let i = 0; i < 2 && procPool.length; i++) {
      const pick = procPool[Math.floor(Math.random() * procPool.length)];
      procPicks.push(pick);
      state.supplies[pick.id] = (state.supplies[pick.id] ?? 0) + procQty;
    }
    if (rawPicks.length) {
      texts.push(
        `原料: ${rawPicks
          .map((p) => `${p.name} +${rawQty}`)
          .join(" / ")}`
      );
    }
    if (procPicks.length) {
      texts.push(
        `加工品: ${procPicks
          .map((p) => `${p.name} +${procQty}`)
          .join(" / ")}`
      );
    }
    return texts;
  };
  try {
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
      .join(" / ") || NONE_LABEL;
    summary.push(`損耗:${lossText === NONE_LABEL ? lossText : " " + lossText}`);

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
    const capText = capEntries.length ? capEntries.join(" / ") : NONE_LABEL;
    summary.push(`拿捕:${capText === NONE_LABEL ? capText : " " + capText}`);

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
    if (eventTag === "merchant_attack") {
      const fid = eventContext?.enemyFactionId || enemyFactionId;
      const setId = eventContext?.settlementId;
      const nobId = eventContext?.nobleId;
      if (isWin) {
        addWarScore(playerFactionId, fid, -4, absDay(state), 0, 0);
        summary.push("行商人襲撃: 戦況悪化");
        const extras = grantMerchantBonusLoot(enemyTotal, isStrong, "raid");
        if (extras.length) summary.push(`追加戦利品: ${extras.join(" / ")}`);
      } else {
        addWarScore(playerFactionId, fid, 3, absDay(state), 0, 0);
        summary.push("行商人襲撃失敗: 戦況悪化");
      }
      if (setId && fid) adjustSupport(setId, fid, -1);
      if (nobId) adjustNobleFavor(nobId, -1);
    } else if (eventTag === "merchant_rescue_help") {
      const fid = eventContext?.enemyFactionId || enemyFactionId;
      const setId = eventContext?.settlementId;
      const nobId = eventContext?.nobleId;
      if (isWin) {
        addWarScore(playerFactionId, fid, 6, absDay(state), 0, 0);
        if (setId && fid) adjustSupport(setId, fid, 3);
        if (nobId) adjustNobleFavor(nobId, 4);
        summary.push("救助成功: 支持/好感度が上昇");
        const extras = grantMerchantBonusLoot(enemyTotal, isStrong, "help");
        if (extras.length) summary.push(`追加報酬: ${extras.join(" / ")}`);
      } else {
        addWarScore(playerFactionId, fid, -4, absDay(state), 0, 0);
        if (setId && fid) adjustSupport(setId, fid, -1);
        summary.push("救助失敗: 支持が低下");
      }
    } else if (eventTag === "merchant_rescue_raid") {
      const fid = eventContext?.enemyFactionId || enemyFactionId;
      const setId = eventContext?.settlementId;
      const nobId = eventContext?.nobleId;
      if (isWin) {
        addWarScore(playerFactionId, fid, -6, absDay(state), 0, 0);
        summary.push("難民襲撃: 戦況悪化");
        const extras = grantMerchantBonusLoot(enemyTotal, isStrong, "raid");
        if (extras.length) summary.push(`追加戦利品: ${extras.join(" / ")}`);
      } else {
        addWarScore(playerFactionId, fid, 4, absDay(state), 0, 0);
        summary.push("難民襲撃失敗: 戦況悪化");
      }
      if (setId && fid) adjustSupport(setId, fid, -2);
      if (nobId) adjustNobleFavor(nobId, -2);
    } else if (eventTag === "smuggle_raid") {
      addWarScore(playerFactionId, enemyFactionId, -3, absDay(state), 0, 0);
      summary.push("密輸襲撃: 戦況悪化");
    } else if (eventTag === "refugee_raid") {
      addWarScore(playerFactionId, enemyFactionId, -4, absDay(state), 0, 0);
      summary.push("難民襲撃: 戦況悪化");
    } else if (eventTag === "checkpoint_force") {
      addWarScore(playerFactionId, enemyFactionId, -2, absDay(state), 0, 0);
      summary.push("検問突破: 戦況に影響");
    } else if (eventTag === "omen_attack") {
      addWarScore(playerFactionId, enemyFactionId, -1, absDay(state), 0, 0);
      summary.push("災いの襲撃を退けました");
    } else if (eventTag === "wreck_attack") {
      addWarScore(playerFactionId, enemyFactionId, -1, absDay(state), 0, 0);
      summary.push("廃船の罠: 戦況に影響");
    }
    // 依頼以外の海賊遭遇に勝利したら、近傍拠点の貴族好感度をわずかに上げる
    if (!questId && enemyFactionId === "pirates" && isWin) {
      const nearest = settlements
        .map((s) => ({ s, d: manhattan(s.coords, state.position) }))
        .filter((o) => o.d != null)
        .sort((a, b) => a.d - b.d);
      if (nearest.length) {
        const topDist = nearest[0].d;
        const tied = nearest.filter((o) => o.d === topDist).map((o) => o.s);
        const pick = tied[Math.floor(Math.random() * tied.length)];
        if (pick?.nobleId) adjustNobleFavor(pick.nobleId, 2);
      }
    }
    // 戦況スコア反映（敵勢力ID必須化）
    const delta = isWin ? 8 : resultCode === BATTLE_RESULT.LOSE ? -6 : 0;
    if (delta !== 0) {
      addWarScore(playerFactionId, enemyFactionId, delta, absDay(state), 0, 0);
    }

    const body = summary.join("\n");
    setOutput("戦後処理", body, [
      { text: resultLabel, kind: isWin ? "good" : "warn" },
      { text: `敵推定${enemyTotal}人`, kind: "" },
    ]);
    pushLog("戦闘結果", body, "-");
    pushToast("戦闘結果", resultLabel, isWin ? "good" : "warn");
    showBattleResultModal(summary, resultLabel);
    syncUI();
  } finally {
    clearBattlePrep(true);
  }
}

/**
 * pendingEncounterから戦闘を開始する（準備モード→戦闘画面）。
 * @returns {void}
 */
function startPrepBattle() {
  if (!state.pendingEncounter?.active) return;
  setEnemyFormation(state.pendingEncounter.enemyFormation || []);
  const enemyFactionId = state.pendingEncounter?.enemyFactionId || "pirates";
  setBattleEnemyFaction(enemyFactionId);
  setBattleEndHandler((res, meta) => {
    const extendedMeta = {
      ...meta,
      eventTag: state.pendingEncounter?.eventTag || meta?.eventTag || null,
      eventContext: state.pendingEncounter?.eventContext || meta?.eventContext || null,
    };
    processBattleOutcome(res, extendedMeta);
  });
  setBattleTerrain(state.pendingEncounter.terrain || getTerrainAt(state.position.x, state.position.y));
  state.modeLabel = MODE_LABEL.BATTLE;
  openBattle();
  syncUI();
}

/**
 * 討伐系（依頼/神託）から戦闘を開始する。
 * @returns {void}
 */
function startOracleBattle() {
  if (state.pendingEncounter?.active || state.modeLabel === MODE_LABEL.BATTLE) return;
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
    enemyFactionId: quest.enemyFactionId || "pirates",
  };
  state.modeLabel = MODE_LABEL.PREP;
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
  const inBattle = state.modeLabel === MODE_LABEL.BATTLE;
  const battleVisible = Boolean(elements.battleBlock && elements.battleBlock.hidden === false);
  const lockActions = prep || inBattle || battleVisible;
  const prepActive = prep && !!state.pendingEncounter?.active;
  const oracleBattle = getOracleBattleAt(state.position);
  const visible = state.modeLabel === MODE_LABEL.IN_TOWN || state.modeLabel === MODE_LABEL.IN_VILLAGE;
  if (elements.tradeBtn) elements.tradeBtn.hidden = !visible;
  if (elements.shipTradeBtn)
    elements.shipTradeBtn.hidden = state.modeLabel !== MODE_LABEL.IN_TOWN;
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
    elements.enterVillageBtn.hidden = !(loc?.place === PLACE.VILLAGE && state.modeLabel !== MODE_LABEL.IN_VILLAGE);
  if (elements.enterTownBtn)
    elements.enterTownBtn.hidden = !(loc?.place === PLACE.TOWN && state.modeLabel !== MODE_LABEL.IN_TOWN);
  if (elements.exitVillageBtn)
    elements.exitVillageBtn.hidden = state.modeLabel !== MODE_LABEL.IN_VILLAGE;
  if (elements.exitTownBtn)
    elements.exitTownBtn.hidden = state.modeLabel !== MODE_LABEL.IN_TOWN;
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
    if (vOpt) vOpt.disabled = loc?.place !== PLACE.VILLAGE;
    if (tOpt) tOpt.disabled = loc?.place !== PLACE.TOWN;
    if (vExit) vExit.disabled = state.modeLabel !== MODE_LABEL.IN_VILLAGE;
    if (tExit) tExit.disabled = state.modeLabel !== MODE_LABEL.IN_TOWN;
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
    state.modeLabel = MODE_LABEL.ALERT;
    syncUI();
  });
  document.getElementById("modeBattle")?.addEventListener("click", () => {
    state.modeLabel = MODE_LABEL.BATTLE;
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
  document.addEventListener("map-auto-move-request", (e) => {
    const tgt = e.detail?.target;
    if (tgt) startAutoMove(tgt);
  });
  document.addEventListener("auto-move-stop", () => {
    stopAutoMove();
  });
  document.addEventListener("quests-updated", () => {
    renderQuestUI(syncUI);
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
    resetSettlementSupport();
    ensureNobleHomes();
    seedInitialQuests();
    ensureSeasonalQuests(getCurrentSettlement());
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
  document.addEventListener("event-trade-open", () => openEventTrade(openModal));
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
  const restored = loadGameFromStorage();
  ensureFactionState();
  seedInitialQuests();
  ensureSeasonalQuests(getCurrentSettlement());
  ensureNobleHomes();
  if (!restored) {
    resetEncounterMeter();
  }
  wireButtons();
  wireBattleUI();
  wireTroopDismiss(elements.troopsDetail, syncUI);
  wireSupplyDiscard(elements.suppliesDetail, syncUI);
  wireMapHover();
  initEventQueueUI();
  syncUI();
  openEventTrade(openModal);
  setOutput("次の操作", "状況を選んで、1D6を振ってください", [
    { text: "-", kind: "" },
    { text: "-", kind: "" },
  ]);
  pushLog("起動", "潮語り航海録を開始。");
}
