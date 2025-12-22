import { state } from "./state.js";
import { calcSupplyPrice, SUPPLY_ITEMS, SUPPLY_TYPES } from "./supplies.js";
import { settlements, getSettlementAtPosition } from "./map.js";
import { pushLog, pushToast } from "./dom.js";
import { TROOP_STATS } from "./troops.js";
import {
  randInt,
  absDay,
  rollDice,
  manhattan,
  pickRandomProcessed,
  randomSeaTarget,
  randomHuntTarget,
  NORMAL_ANCHORS,
  STRONG_ANCHORS,
  pickAnchorRange,
} from "./questUtils.js";


/** @enum {string} 依頼種別 */
const QUEST_TYPES = {
  SUPPLY: "supply",
  DELIVERY: "delivery",
  ORACLE_SUPPLY: "oracle_supply",
  ORACLE_MOVE: "oracle_move",
  ORACLE_TROOP: "oracle_troop",
  ORACLE_HUNT: "oracle_hunt",
  ORACLE_ELITE: "oracle_elite",
  PIRATE_HUNT: "pirate_hunt",
  BOUNTY_HUNT: "bounty_hunt",
};

/**
 * 依頼用の状態を初期化/補完する。
 */
function ensureState() {
  if (!state.quests) {
    state.quests = {
      availableBySettlement: {},
      active: [],
      collapsed: false,
      nextId: 1,
      lastSeasonBySettlement: {},
      seeded: false,
      lastOracleSeason: null,
    };
  } else {
    state.quests.availableBySettlement ||= {};
    state.quests.active ||= [];
    state.quests.collapsed = Boolean(state.quests.collapsed);
    state.quests.nextId ||= 1;
    state.quests.lastSeasonBySettlement ||= {};
    if (state.quests.seeded == null) state.quests.seeded = false;
    if (!("lastOracleSeason" in state.quests)) state.quests.lastOracleSeason = null;
  }
}

/**
 * 依頼IDを採番する。
 * @returns {number}
 */
function nextId() {
  ensureState();
  return state.quests.nextId++;
}

/**
 * 需要が最も高い物資を返す。
 * @param {object} demand
 * @param {string} type
 * @returns {{id:string,demand:number}|null}
 */
function pickMaxDemand(demand, type) {
  let best = null;
  SUPPLY_ITEMS.forEach((i) => {
    if (type && i.type !== type) return;
    const d = demand[i.id] ?? 1;
    if (!best || d > best.demand) best = { id: i.id, demand: d };
  });
  return best;
}

/**
 * 調達依頼を生成する。
 * @param {object} settlement
 * @returns {object}
 */
function genSupplyQuest(settlement) {
  const demand = settlement.demand || {};
  const bestRaw = pickMaxDemand(demand, SUPPLY_TYPES.raw);
  const bestProcessed = pickMaxDemand(demand, SUPPLY_TYPES.processed);
  const choice = !bestProcessed || (bestRaw && bestRaw.demand >= bestProcessed.demand) ? "raw" : "processed";
  const itemPick = choice === "raw" ? bestRaw : bestProcessed;
  const qty = choice === "raw" ? Math.max(3, rollDice(3, 1)) : Math.max(2, rollDice(2, 1));
  const price = calcSupplyPrice(itemPick.id, demand[itemPick.id] ?? 10) ?? 0;
  const reward = price * qty * 2;
  const rewardFame = Math.max(1, Math.round(qty / 2));
  const itemName = SUPPLY_ITEMS.find((i) => i.id === itemPick.id)?.name || itemPick.id;
  return {
    id: nextId(),
    type: QUEST_TYPES.SUPPLY,
    title: `調達依頼: ${itemName} x${qty}`,
    itemId: itemPick.id,
    qty,
    reward,
    rewardFame,
    originId: settlement.id,
    targetId: settlement.id,
    acceptedAbs: null,
    deadlineAbs: null,
    desc: `${itemName}を${qty}個用意し、受注した拠点で納品。報酬: ${reward}資金`,
  };
}

/**
 * 配達依頼を生成する。
 * @param {object} settlement
 * @returns {object}
 */
function genDeliveryQuest(settlement) {
  const item = SUPPLY_ITEMS[randInt(0, SUPPLY_ITEMS.length - 1)];
  const current = settlement.coords;
  const candidates = settlements
    .filter((s) => s.id !== settlement.id)
    .map((s) => ({ s, dist: manhattan(s.coords, current) }))
    .filter((o) => o.dist <= 25)
    .sort((a, b) => a.dist - b.dist);
  const pick =
    candidates.length
      ? candidates[randInt(0, candidates.length - 1)]
      : settlements
        .filter((s) => s.id !== settlement.id)
        .map((s) => ({ s, dist: manhattan(s.coords, current) }))
        .sort((a, b) => a.dist - b.dist)[0];
  const target = pick?.s || settlement;
  const dist = pick?.dist ?? 1;
  const qty = 1;
  const reward = dist * 50;
  const rewardFame = Math.max(1, Math.round(dist / 2));
  return {
    id: nextId(),
    type: QUEST_TYPES.DELIVERY,
    title: `配達依頼: ${item.name}を${target.name}へ`,
    itemId: item.id,
    qty,
    reward,
    rewardFame,
    originId: settlement.id,
    targetId: target.id,
    acceptedAbs: null,
    deadlineAbs: null,
    desc: `${target.name}へ${item.name}を届ける。報酬: ${reward}資金`,
  };
}

/**
 * 拠点ごとの季節依頼を生成する。
 * @param {object} settlement
 */
function generateSeasonQuestsForSettlement(settlement) {
  ensureState();
  if (!settlement) return;
  const candidates = [];
  candidates.push(genSupplyQuest(settlement));
  candidates.push(genDeliveryQuest(settlement));
  candidates.push(Math.random() > 0.5 ? genSupplyQuest(settlement) : genDeliveryQuest(settlement));
  candidates.push(genPirateHuntQuest(settlement));
  if ((state.fame || 0) >= 100) {
    candidates.push(genBountyHuntQuest(settlement));
  }
  // 3枠に収める
  const pool = candidates
    .slice()
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);
  state.quests.availableBySettlement[settlement.id] = pool;
  state.quests.lastSeasonBySettlement[settlement.id] = { year: state.year, season: state.season };
}

/**
 * 依頼の状態を取得する（未初期化なら作成）。
 * @returns {object}
 */
export function getQuests() {
  ensureState();
  return state.quests;
}

/**
 * 拠点ごとの受注可能依頼を取得する。
 * @param {string} settlementId
 * @returns {Array}
 */
export function getAvailableQuestsForSettlement(settlementId) {
  ensureState();
  return state.quests.availableBySettlement[settlementId] || [];
}

/**
 * 季節依頼が未生成なら初日に生成する。
 * @param {object} settlement
 */
export function ensureSeasonalQuests(settlement) {
  ensureState();
  if (!settlement) return;
  const last = state.quests.lastSeasonBySettlement[settlement.id];
  if (state.day === 1 && (!last || last.year !== state.year || last.season !== state.season)) {
    generateSeasonQuestsForSettlement(settlement);
  }
}

/**
 * 全拠点の初期依頼を作成する（一度だけ）。
 */
export function seedInitialQuests() {
  ensureState();
  if (state.quests.seeded) return;
  settlements.forEach((s) => generateSeasonQuestsForSettlement(s));
  state.quests.seeded = true;
}

/**
 * 依頼を受注し、報酬を受注拠点の条件で確定する。
 * @param {number} id
 * @param {object} settlement
 * @returns {object|null}
 */
export function acceptQuest(id, settlement) {
  ensureState();
  if (!settlement) return null;
  const list = state.quests.availableBySettlement[settlement.id] || [];
  const idx = list.findIndex((q) => q.id === id);
  if (idx === -1) return null;
  const q = list.splice(idx, 1)[0];
  const now = absDay(state);
  q.acceptedAbs = now;
  q.deadlineAbs = now + 30;
  // 受注拠点基準で報酬を確定
  if (q.type === QUEST_TYPES.SUPPLY) {
    const demand = settlement.demand || {};
    const price = calcSupplyPrice(q.itemId, demand[q.itemId] ?? 10) ?? 0;
    q.reward = price * q.qty * 2;
  }
  if (q.type === QUEST_TYPES.DELIVERY) {
    const target = settlements.find((s) => s.id === q.targetId);
    const dist = target ? manhattan(target.coords, settlement.coords) : 1;
    q.reward = dist * 50;
  }
  if (q.type === QUEST_TYPES.DELIVERY) {
    // 配達依頼は受注時に対象物資を受け取る。
    state.supplies[q.itemId] = (state.supplies[q.itemId] ?? 0) + q.qty;
  }
  if (q.type === QUEST_TYPES.PIRATE_HUNT || q.type === QUEST_TYPES.BOUNTY_HUNT) {
    q.deadlineAbs = now + 45;
  }
  state.quests.active.push(q);
  pushLog("依頼受注", q.title, "-");
  return q;
}

/**
 * 神託（糧を捧げよ）を生成する。
 * @returns {object}
 */
function genOracleSupply() {
  const items = pickRandomProcessed(2).map((it) => ({
    id: it.id,
    name: it.name,
    qty: rollDice(2, 2),
  }));
  const rewardFaith = rollDice(5, 4);
  return {
    id: nextId(),
    type: QUEST_TYPES.ORACLE_SUPPLY,
    title: "神託: 糧を捧げよ",
    items,
    rewardFaith,
    reward: 0,
    acceptedAbs: absDay(state),
    deadlineAbs: absDay(state) + 90,
    desc: `加工品を捧げよ（各${items.map((i) => `${i.name}x${i.qty}`).join(" / ")}）。報酬: 信仰+${rewardFaith}`,
  };
}

/**
 * 神託（動け）を生成する。
 * @returns {object}
 */
function genOracleMove() {
  const target = randomSeaTarget(state.position);
  const rewardFaith = rollDice(5, 4);
  return {
    id: nextId(),
    type: QUEST_TYPES.ORACLE_MOVE,
    title: "神託: 動け",
    target,
    rewardFaith,
    reward: 0,
    acceptedAbs: absDay(state),
    deadlineAbs: absDay(state) + 90,
    desc: `指定座標(${target.x + 1}, ${target.y + 1})へ至れ。報酬: 信仰+${rewardFaith}`,
  };
}

/**
 * 神託（人身を捧げよ）を生成する。
 * @returns {object}
 */
function genOracleTroop() {
  const troopTypes = Object.keys(TROOP_STATS);
  const pick = troopTypes[randInt(0, troopTypes.length - 1)];
  const name = TROOP_STATS[pick]?.name || pick;
  const rewardFaith = rollDice(5, 4);
  return {
    id: nextId(),
    type: QUEST_TYPES.ORACLE_TROOP,
    title: "神託: 人身を捧げよ",
    troopType: pick,
    rewardFaith,
    reward: 0,
    acceptedAbs: absDay(state),
    deadlineAbs: absDay(state) + 90,
    desc: `${name}を1人捧げよ。報酬: 信仰+${rewardFaith}`,
  };
}

/**
 * 神託（奪え）を生成する。
 * @returns {object}
 */
function genOracleHunt() {
  const avoid = (state.quests?.active || [])
    .filter((q) => q.target)
    .map((q) => q.target);
  const target = randomHuntTarget(state.position, 2, 5, avoid);
  const rewardFaith = rollDice(5, 4);
  return {
    id: nextId(),
    type: QUEST_TYPES.ORACLE_HUNT,
    title: "神託: 奪え",
    target,
    rewardFaith,
    reward: 0,
    acceptedAbs: absDay(state),
    deadlineAbs: absDay(state) + 90,
    desc: `指定座標(${target.x + 1}, ${target.y + 1})で討伐し勝利せよ。報酬: 信仰+${rewardFaith}`,
  };
}

/**
 * 神託（越えよ）を生成する。
 * @returns {object}
 */
function genOracleElite() {
  const avoid = (state.quests?.active || [])
    .filter((q) => q.target)
    .map((q) => q.target);
  const target = randomHuntTarget(state.position, 2, 5, avoid);
  const rewardFaith = rollDice(5, 5);
  return {
    id: nextId(),
    type: QUEST_TYPES.ORACLE_ELITE,
    title: "神託: 越えよ",
    target,
    rewardFaith,
    reward: 0,
    acceptedAbs: absDay(state),
    deadlineAbs: absDay(state) + 90,
    desc: `指定座標(${target.x + 1}, ${target.y + 1})で強編成を討伐し勝利せよ。報酬: 信仰+${rewardFaith}`,
  };
}

function predictEnemyTotal(forceStrength) {
  const fame = Math.max(0, state.fame || 0);
  const useStrong = forceStrength === "elite";
  const range = useStrong ? pickAnchorRange(fame, STRONG_ANCHORS) : pickAnchorRange(fame, NORMAL_ANCHORS);
  return randInt(range.min, range.max);
}

function genPirateHuntQuest(settlement) {
  const origin = settlement?.coords || state.position;
  const avoid = (state.quests?.active || [])
    .filter((q) => q.target)
    .map((q) => q.target);
  const target = randomHuntTarget(origin, 2, 5, avoid);
  const estimatedTotal = predictEnemyTotal("normal");
  const reward = estimatedTotal * 50 + 100;
  const rewardFame = Math.floor(estimatedTotal / 2) + 5;
  return {
    id: nextId(),
    type: QUEST_TYPES.PIRATE_HUNT,
    title: "海賊討伐",
    target,
    estimatedTotal,
    reward,
    rewardFame,
    strength: "normal",
    acceptedAbs: null,
    deadlineAbs: null,
    desc: `(${target.x + 1}, ${target.y + 1})で海賊を討伐（推定${estimatedTotal}人程度）`,
  };
}

function genBountyHuntQuest(settlement) {
  const origin = settlement?.coords || state.position;
  const avoid = (state.quests?.active || [])
    .filter((q) => q.target)
    .map((q) => q.target);
  const target = randomHuntTarget(origin, 2, 5, avoid);
  const estimatedTotal = predictEnemyTotal("elite");
  const reward = estimatedTotal * 100 + 100;
  const rewardFame = Math.floor(estimatedTotal / 2) + 5;
  return {
    id: nextId(),
    type: QUEST_TYPES.BOUNTY_HUNT,
    title: "賞金首討伐",
    target,
    estimatedTotal,
    reward,
    rewardFame,
    strength: "elite",
    acceptedAbs: null,
    deadlineAbs: null,
    desc: `(${target.x + 1}, ${target.y + 1})で賞金首を討伐（推定${estimatedTotal}人 / 強編成）`,
  };
}

/**
 * 神託が受注中かどうかを判定する。
 * @returns {boolean}
 */
function hasActiveOracle() {
  ensureState();
  return state.quests.active.some(
    (q) =>
      q.type === QUEST_TYPES.ORACLE_SUPPLY ||
      q.type === QUEST_TYPES.ORACLE_MOVE ||
      q.type === QUEST_TYPES.ORACLE_TROOP ||
      q.type === QUEST_TYPES.ORACLE_HUNT ||
      q.type === QUEST_TYPES.ORACLE_ELITE
  );
}

/**
 * 神託を受け取れるか判定する。
 * @returns {boolean}
 */
export function canReceiveOracle() {
  ensureState();
  // 神託は季節に一度だけ、既存の神託が残っている場合は受け取れない。
  if (hasActiveOracle()) return false;
  const last = state.quests.lastOracleSeason;
  if (!last) return true;
  return last.year !== state.year || last.season !== state.season;
}

/**
 * 神託を1件受注する（ランダム）。
 * @returns {object|null}
 */
export function receiveOracle() {
  ensureState();
  if (!canReceiveOracle()) return null;
  const pool = [genOracleSupply, genOracleMove, genOracleTroop, genOracleHunt];
  if ((state.faith || 0) >= 100) pool.push(genOracleElite);
  const pick = pool[randInt(0, pool.length - 1)]();
  state.quests.active.push(pick);
  state.quests.lastOracleSeason = { year: state.year, season: state.season };
  pushLog("神託を受領", pick.title, "-");
  pushToast("神託を受領", pick.title, "warn");
  return pick;
}

/**
 * 条件を満たした依頼を完了し、報酬/消費を反映する。
 * @param {number} id
 * @returns {boolean}
 */
export function completeQuest(id) {
  ensureState();
  const idx = state.quests.active.findIndex((q) => q.id === id);
  if (idx === -1) return false;
  const q = state.quests.active[idx];
  const here = getSettlementAtPosition(state.position.x, state.position.y);
  let fameReward = 0;
  if (q.type === QUEST_TYPES.SUPPLY) {
    if (!here || here.id !== q.originId) return false;
    if ((state.supplies?.[q.itemId] ?? 0) < q.qty) return false;
    state.supplies[q.itemId] -= q.qty;
    fameReward = rollDice(5, 2);
    state.fame += fameReward;
  }
  if (q.type === QUEST_TYPES.DELIVERY) {
    if (!here || here.id !== q.targetId) return false;
    if ((state.supplies?.[q.itemId] ?? 0) < q.qty) return false;
    state.supplies[q.itemId] -= q.qty;
    fameReward = rollDice(5, 2);
    state.fame += fameReward;
  }
  if (q.type === QUEST_TYPES.ORACLE_SUPPLY) {
    const ok = (q.items || []).every((it) => (state.supplies?.[it.id] ?? 0) >= it.qty);
    if (!ok) return false;
    q.items.forEach((it) => {
      state.supplies[it.id] = Math.max(0, (state.supplies[it.id] ?? 0) - it.qty);
    });
    state.faith += q.rewardFaith ?? 0;
  }
  if (q.type === QUEST_TYPES.ORACLE_MOVE) {
    const herePos = state.position;
    if (!q.target || herePos.x !== q.target.x || herePos.y !== q.target.y) return false;
    state.faith += q.rewardFaith ?? 0;
  }
  if (q.type === QUEST_TYPES.ORACLE_TROOP) {
    const levels = state.troops?.[q.troopType];
    if (!levels) return false;
    const levelNums = Object.keys(levels)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n) && levels[n] > 0)
      .sort((a, b) => a - b);
    if (!levelNums.length) return false;
    const lowest = levelNums[0];
    const next = Math.max(0, Number(levels[lowest] || 0) - 1);
    if (next === 0) delete levels[lowest];
    else levels[lowest] = next;
    if (Object.keys(levels).length === 0) delete state.troops[q.troopType];
    state.faith += q.rewardFaith ?? 0;
  }
  if (q.type === QUEST_TYPES.ORACLE_HUNT || q.type === QUEST_TYPES.ORACLE_ELITE) {
    // 討伐系の神託は戦闘勝利時に別途完了させる。
    return false;
  }
  if (q.type === QUEST_TYPES.PIRATE_HUNT || q.type === QUEST_TYPES.BOUNTY_HUNT) {
    return false;
  }
  if (q.reward) state.funds += q.reward;
  state.quests.active.splice(idx, 1);
  const rewards = [];
  if (q.reward && q.reward > 0) rewards.push(`資金+${q.reward}`);
  if (q.rewardFaith && q.rewardFaith > 0) rewards.push(`信仰+${q.rewardFaith}`);
  if (fameReward > 0) rewards.push(`名声+${fameReward}`);
  const rewardText = rewards.length ? rewards.join(" / ") : "報酬なし";
  pushLog("依頼完了", `${q.title} / ${rewardText}`, "-");
  pushToast("依頼完了", `${q.title} / ${rewardText}`, "good");
  return true;
}

/**
 * 現在の状態で依頼が完了できるか判定する。
 * @param {object} q
 * @returns {boolean}
 */
export function canCompleteQuest(q) {
  const here = getSettlementAtPosition(state.position.x, state.position.y);
  if (q.type === QUEST_TYPES.SUPPLY) {
    if (!here || here.id !== q.originId) return false;
    if ((state.supplies?.[q.itemId] ?? 0) < q.qty) return false;
    return true;
  }
  if (q.type === QUEST_TYPES.DELIVERY) {
    if (!here || here.id !== q.targetId) return false;
    if ((state.supplies?.[q.itemId] ?? 0) < q.qty) return false;
    return true;
  }
  if (q.type === QUEST_TYPES.ORACLE_SUPPLY) {
    return (q.items || []).every((it) => (state.supplies?.[it.id] ?? 0) >= it.qty);
  }
  if (q.type === QUEST_TYPES.ORACLE_MOVE) {
    const herePos = state.position;
    return q.target && herePos.x === q.target.x && herePos.y === q.target.y;
  }
  if (q.type === QUEST_TYPES.ORACLE_TROOP) {
    const levels = state.troops?.[q.troopType];
    if (!levels) return false;
    return Object.values(levels).some((qty) => qty > 0);
  }
  if (q.type === QUEST_TYPES.ORACLE_HUNT || q.type === QUEST_TYPES.ORACLE_ELITE) {
    return false;
  }
  if (q.type === QUEST_TYPES.PIRATE_HUNT || q.type === QUEST_TYPES.BOUNTY_HUNT) {
    return false;
  }
  return false;
}

/**
 * 討伐系の神託を戦闘勝利時に完了させる。
 * @param {number} id
 * @returns {boolean}
 */
export function completeOracleBattleQuest(id) {
  ensureState();
  const idx = state.quests.active.findIndex(
    (q) => q.id === id && (q.type === QUEST_TYPES.ORACLE_HUNT || q.type === QUEST_TYPES.ORACLE_ELITE)
  );
  if (idx === -1) return false;
  const q = state.quests.active[idx];
  const rewardFaith = q.rewardFaith ?? 0;
  state.faith += rewardFaith;
  state.quests.active.splice(idx, 1);
  const rewardText = rewardFaith > 0 ? `信仰+${rewardFaith}` : "報酬なし";
  pushLog("神託達成", `${q.title} / ${rewardText}`, "-");
  pushToast("神託達成", `${q.title} / ${rewardText}`, "good");
  return true;
}

/**
 * 討伐系の神託を失敗で消化する。
 * @param {number} id
 * @param {string} [reason]
 * @returns {boolean}
 */
export function failOracleBattleQuest(id, reason = "") {
  ensureState();
  const idx = state.quests.active.findIndex(
    (q) => q.id === id && (q.type === QUEST_TYPES.ORACLE_HUNT || q.type === QUEST_TYPES.ORACLE_ELITE)
  );
  if (idx === -1) return false;
  const q = state.quests.active[idx];
  state.quests.active.splice(idx, 1);
  const note = reason ? ` / ${reason}` : "";
  pushLog("神託失敗", `${q.title}${note}`, "-");
  pushToast("神託失敗", `${q.title}${note}`, "bad");
  return true;
}

/**
 * 討伐依頼（海賊/賞金首）の達成/失敗を処理する。
 * @param {number} id
 * @param {boolean} success
 * @param {string} [reason]
 * @returns {boolean}
 */
export function completeHuntBattleQuest(id, success, reason = "") {
  ensureState();
  const idx = state.quests.active.findIndex(
    (q) => q.id === id && (q.type === QUEST_TYPES.PIRATE_HUNT || q.type === QUEST_TYPES.BOUNTY_HUNT)
  );
  if (idx === -1) return false;
  const q = state.quests.active[idx];
  if (success) {
    if (q.reward) state.funds += q.reward;
    if (q.rewardFame) state.fame += q.rewardFame;
    state.quests.active.splice(idx, 1);
    const rewards = [];
    if (q.reward) rewards.push(`資金+${q.reward}`);
    if (q.rewardFame) rewards.push(`名声+${q.rewardFame}`);
    const rewardText = rewards.length ? rewards.join(" / ") : "報酬なし";
    pushLog("討伐達成", `${q.title} / ${rewardText}`, "-");
    pushToast("討伐達成", `${q.title} / ${rewardText}`, "good");
  } else {
    state.quests.active.splice(idx, 1);
    const note = reason ? ` / ${reason}` : "";
    pushLog("討伐失敗", `${q.title}${note}`, "-");
    pushToast("討伐失敗", `${q.title}${note}`, "bad");
  }
  return true;
}

/**
 * 現在位置で討伐系の神託が発動可能か取得する。
 * @param {{x:number,y:number}} pos
 * @returns {object|null}
 */
export function getOracleBattleAt(pos) {
  ensureState();
  if (!pos) return null;
  return (
    state.quests.active.find(
      (q) =>
        (q.type === QUEST_TYPES.ORACLE_HUNT ||
          q.type === QUEST_TYPES.ORACLE_ELITE ||
          q.type === QUEST_TYPES.PIRATE_HUNT ||
          q.type === QUEST_TYPES.BOUNTY_HUNT) &&
        q.target &&
        q.target.x === pos.x &&
        q.target.y === pos.y
    ) || null
  );
}

/**
 * 依頼の期限・季節更新を進行させる。
 * @param {number} [days=1]
 */
export function questTickDay(days = 1) {
  ensureState();
  for (let i = 0; i < days; i++) {
    const now = absDay(state);
    // 期限切れ
    const expired = state.quests.active.filter((q) => q.deadlineAbs != null && now > q.deadlineAbs);
    if (expired.length) {
      expired.forEach((q) => pushLog("依頼失敗", `${q.title} の期限切れ`, "-"));
      state.quests.active = state.quests.active.filter(
        (q) => !(q.deadlineAbs != null && now > q.deadlineAbs)
      );
      expired.forEach((q) => pushToast("依頼失敗", `${q.title} の期限切れ`, "bad"));
    }
    // 依頼は毎季節の1日で全拠点ぶん一括更新する。
    if (state.day === 1) {
      state.quests.availableBySettlement = {};
      state.quests.lastSeasonBySettlement = {};
      settlements.forEach((s) => generateSeasonQuestsForSettlement(s));
      pushToast("季節が変わりました", `新しい依頼が各拠点に追加されました`, "warn");
      // 神託の受領リセットは lastOracleSeason で管理する。
    }
  }
}

export { QUEST_TYPES };
