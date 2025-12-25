import { state } from "./state.js";
import { calcSupplyPrice, SUPPLY_ITEMS, SUPPLY_TYPES } from "./supplies.js";
import { settlements, getSettlementAtPosition, getSettlementById } from "./map.js";
import { pushLog, pushToast } from "./dom.js";
import { enqueueEvent } from "./events.js";
import {
  addWarScore,
  addFrontScore,
  adjustSupport,
  getWarEntry,
  getWarScoreLabel,
  getPlayerFactionId,
  adjustNobleFavor,
} from "./faction.js";
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
import { FACTIONS } from "./lore.js";


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
  REFUGEE_ESCORT: "refugee_escort",
  NOBLE_SUPPLY: "noble_supply",
  NOBLE_SCOUT: "noble_scout",
  NOBLE_SECURITY: "noble_security",
  NOBLE_REFUGEE: "noble_refugee",
  NOBLE_LOGISTICS: "noble_logistics",
  NOBLE_HUNT: "noble_hunt",
  WAR_DEFEND_RAID: "war_defend_raid",
  WAR_ATTACK_RAID: "war_attack_raid",
  WAR_SKIRMISH: "war_skirmish",
  WAR_SUPPLY: "war_supply",
  WAR_ESCORT: "war_escort",
  WAR_BLOCKADE: "war_blockade",
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
  if (!state.nobleQuests) {
    state.nobleQuests = { availableByNoble: {}, nextId: 1, lastSeasonByNoble: {} };
  } else {
    state.nobleQuests.availableByNoble ||= {};
    state.nobleQuests.nextId ||= 1;
    state.nobleQuests.lastSeasonByNoble ||= {};
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
 * 貴族依頼用のIDを採番する。
 * @returns {number}
 */
function nextNobleId() {
  ensureState();
  state.nobleQuests.nextId = state.nobleQuests.nextId || 1;
  return state.nobleQuests.nextId++;
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
    const price = calcSupplyPrice(itemPick.id, demand[itemPick.id] ?? 10, {
      factionId: settlement.factionId,
      settlementId: settlement.id,
    }) ?? 0;
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
 * 座標の重複を避けるため、現在使用中のターゲット一覧を返す。
 * @returns {Array<{x:number,y:number}>}
 */
function usedTargets() {
  ensureState();
  const coords = [];
  const collect = (q) => {
    if (q?.target && typeof q.target.x === "number" && typeof q.target.y === "number") coords.push(q.target);
    if (Array.isArray(q?.fights)) {
      q.fights.forEach((f) => {
        if (f?.target) coords.push(f.target);
      });
    }
  };
  (state.quests.active || []).forEach(collect);
  Object.values(state.quests.availableBySettlement || {}).flat().forEach(collect);
  Object.values(state.nobleQuests?.availableByNoble || {}).flat().forEach(collect);
  return coords;
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
  const titleTarget = `${target.name}(${target.coords.x + 1}, ${target.coords.y + 1})`;
  return {
    id: nextId(),
    type: QUEST_TYPES.DELIVERY,
    title: `配達依頼: ${item.name}を${titleTarget}へ`,
    itemId: item.id,
    qty,
    reward,
    rewardFame,
    originId: settlement.id,
    targetId: target.id,
    acceptedAbs: null,
    deadlineAbs: null,
    desc: `${titleTarget}へ${item.name}を届ける。報酬: ${reward}資金`,
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
  const warLabel = getWarScoreLabel(getWarEntry(getPlayerFactionId(), settlement.factionId)?.score || 0);
  if (warLabel === "disadvantage" || warLabel === "losing") {
    candidates.push(genPirateHuntQuest(settlement));
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
 * 貴族ごとの受注可能依頼を取得する。
 * @param {string} nobleId
 * @returns {Array}
 */
export function getAvailableNobleQuests(nobleId) {
  ensureState();
  if (!nobleId) return [];
  return state.nobleQuests.availableByNoble[nobleId] || [];
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
 * 貴族専用依頼を生成する。
 * @param {object} noble
 * @param {object} settlement
 */
function generateNobleQuestsForNoble(noble, settlement) {
  ensureState();
  if (!noble || !settlement) return;
  const pool = [
    genNobleSupplyQuest(settlement, noble),
    genNobleScoutQuest(settlement, noble),
    genNobleSecurityQuest(settlement, noble),
    genNobleRefugeeQuest(settlement, noble),
    genNobleLogisticsQuest(settlement, noble),
    genNobleHuntQuest(settlement, noble),
  ].filter(Boolean);
  const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, 3);
  state.nobleQuests.availableByNoble[noble.id] = shuffled;
  state.nobleQuests.lastSeasonByNoble[noble.id] = { year: state.year, season: state.season };
}

/**
 * 貴族専用依頼を季節ごとに生成する（謁見で表示する前に呼ぶ）。
 * @param {object} noble
 * @param {object} settlement
 */
export function ensureNobleQuests(noble, settlement) {
  ensureState();
  if (!noble || !settlement) return;
  const last = state.nobleQuests.lastSeasonByNoble[noble.id];
  if (!last || last.year !== state.year || last.season !== state.season) {
    generateNobleQuestsForNoble(noble, settlement);
  }
}

/**
 * 難民護送依頼を追加する（移動イベント専用）。
 * @param {object} targetSet 拠点
 * @returns {object|null}
 */
export function addRefugeeEscortQuest(targetSet) {
  ensureState();
  if (!targetSet) return null;
  const titleTarget = `${targetSet.name}(${targetSet.coords.x + 1}, ${targetSet.coords.y + 1})`;
  const q = {
    id: nextId(),
    type: QUEST_TYPES.REFUGEE_ESCORT,
    title: `護送: (${targetSet.coords.x + 1}, ${targetSet.coords.y + 1})`,
    targetId: targetSet.id,
    acceptedAbs: absDay(state),
    deadlineAbs: absDay(state) + 30,
    desc: `${titleTarget}へ難民旅団を護送せよ。`,
  };
  state.quests.active.push(q);
  pushLog("依頼受注", q.title, "-");
  pushToast("依頼受注", q.title, "warn");
  enqueueEvent({ title: "護送依頼", body: `${q.title} を受注しました。期限30日。` });
  return q;
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
    const price = calcSupplyPrice(q.itemId, demand[q.itemId] ?? 10, {
      factionId: settlement.factionId,
      settlementId: settlement.id,
    }) ?? 0;
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
 * 貴族依頼を受注する（謁見専用）。
 * @param {number} id
 * @param {object} noble
 * @param {object} settlement
 * @returns {object|null}
 */
export function acceptNobleQuest(id, noble, settlement) {
  ensureState();
  if (!noble || !settlement) return null;
  const list = state.nobleQuests.availableByNoble[noble.id] || [];
  const idx = list.findIndex((q) => q.id === id);
  if (idx === -1) return null;
  const q = list.splice(idx, 1)[0];
  const now = absDay(state);
  q.acceptedAbs = now;
  q.deadlineAbs = now + (q.type === QUEST_TYPES.NOBLE_SUPPLY || q.type === QUEST_TYPES.NOBLE_SCOUT ? 30 : 60);
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
    enemyFactionId: "pirates",
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
    enemyFactionId: "pirates",
    rewardFaith,
    reward: 0,
    acceptedAbs: absDay(state),
    deadlineAbs: absDay(state) + 90,
    desc: `指定座標(${target.x + 1}, ${target.y + 1})で強編成を討伐し勝利せよ。報酬: 信仰+${rewardFaith}`,
  };
}

/**
 * 推定的総数を返す
 * @param {String} forceStrength 
 * @returns {number}
 */
function predictEnemyTotal(forceStrength) {
  const fame = Math.max(0, state.fame || 0);
  const useStrong = forceStrength === "elite";
  const range = useStrong ? pickAnchorRange(fame, STRONG_ANCHORS) : pickAnchorRange(fame, NORMAL_ANCHORS);
  return randInt(range.min, range.max);
}

/**
 * 海賊討伐依頼を生成
 * @param {object} settlement 
 * @returns {object}
 */
function genPirateHuntQuest(settlement) {
  const origin = settlement?.coords || state.position;
  const avoid = (state.quests?.active || [])
    .filter((q) => q.target)
    .map((q) => q.target);
  const target = randomHuntTarget(origin, 2, 5, avoid);
  const estimatedTotal = predictEnemyTotal("normal");
  const reward = estimatedTotal * 50 + 100;
  const rewardFame = Math.floor(estimatedTotal / 2) + 5;
  const targetLabel = `(${target.x + 1}, ${target.y + 1})`;
  return {
    id: nextId(),
    type: QUEST_TYPES.PIRATE_HUNT,
    title: "海賊討伐",
    target,
    enemyFactionId: "pirates",
    estimatedTotal,
    reward,
    rewardFame,
    strength: "normal",
    acceptedAbs: null,
    deadlineAbs: null,
    desc: `(${target.x + 1}, ${target.y + 1})で海賊を討伐（推定${estimatedTotal}人程度）`,
  };
}

/**
 * 賞金首討伐依頼を生成
 * @param {object} settlement 
 * @returns {object}
 */
function genBountyHuntQuest(settlement) {
  const origin = settlement?.coords || state.position;
  const avoid = (state.quests?.active || [])
    .filter((q) => q.target)
    .map((q) => q.target);
  const target = randomHuntTarget(origin, 2, 5, avoid);
  const estimatedTotal = predictEnemyTotal("elite");
  const reward = estimatedTotal * 100 + 100;
  const rewardFame = Math.floor(estimatedTotal / 2) + 5;
  const targetLabel = `(${target.x + 1}, ${target.y + 1})`;
  return {
    id: nextId(),
    type: QUEST_TYPES.BOUNTY_HUNT,
    title: "賞金首討伐",
    target,
    enemyFactionId: "pirates",
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
 * 勢力に対して戦争中の相手一覧を返す。
 * @param {string} factionId
 * @returns {Array<string>}
 */
function warOpponents(factionId) {
  const rivals = [];
  (FACTIONS || []).forEach((f) => {
    if (f.id === factionId) return;
    const entry = getWarEntry(factionId, f.id);
    if (entry && entry.score != null) rivals.push(f.id);
  });
  return rivals;
}

/**
 * 貴族依頼: 加工品調達。
 * @param {object} settlement
 * @param {object} noble
 * @returns {object}
 */
function genNobleSupplyQuest(settlement, noble) {
  const items = pickRandomProcessed(2).map((it) => ({
    id: it.id,
    name: it.name,
    qty: Math.max(2, rollDice(2, 2)),
  }));
  const demand = settlement.demand || {};
  const totalPrice = items.reduce((sum, it) => {
    const p =
      calcSupplyPrice(it.id, demand[it.id] ?? 10, {
        factionId: settlement.factionId,
        settlementId: settlement.id,
      }) ?? 0;
    return sum + p * it.qty;
  }, 0);
  const rewardFame = rollDice(10, 2);
  return {
    id: nextNobleId(),
    type: QUEST_TYPES.NOBLE_SUPPLY,
    title: `加工品調達`,
    items,
    reward: totalPrice * 2 + 100,
    rewardFame,
    nobleId: noble.id,
    factionId: settlement.factionId,
    originId: settlement.id,
    deadlineAbs: null,
    acceptedAbs: null,
    desc: `加工品を2種納品せよ（各${items.map((i) => `${i.name}x${i.qty}`).join(" / ")}）。報酬: 資金${totalPrice * 2 + 100}`,
  };
}

/**
 * 貴族依頼: 地点偵察。
 * @param {object} settlement
 * @param {object} noble
 * @returns {object|null}
 */
function genNobleScoutQuest(settlement, noble) {
  const avoid = usedTargets();
  const target = randomHuntTarget(settlement.coords, 5, 10, avoid);
  if (!target) return null;
  const dist = manhattan(settlement.coords, target);
  const rewardFame = rollDice(10, 2);
  return {
    id: nextNobleId(),
    type: QUEST_TYPES.NOBLE_SCOUT,
    title: `指定地点偵察`,
    target,
    reward: dist * 100,
    rewardFame,
    nobleId: noble.id,
    factionId: settlement.factionId,
    originId: settlement.id,
    deadlineAbs: null,
    acceptedAbs: null,
    desc: `指定座標 (${target.x + 1}, ${target.y + 1}) まで移動し偵察せよ。報酬: 資金${dist * 100}`,
  };
}

/**
 * 貴族依頼: 治安回復（2戦）。
 * @param {object} settlement
 * @param {object} noble
 * @returns {object|null}
 */
function genNobleSecurityQuest(settlement, noble) {
  const avoid = usedTargets();
  const first = randomHuntTarget(settlement.coords, 2, 5, avoid);
  avoid.push(first);
  const second = randomHuntTarget(settlement.coords, 2, 5, avoid);
  if (!first || !second) return null;
  const firstEstimate = predictEnemyTotal("normal");
  const secondEstimate = predictEnemyTotal("elite");
  const totalEstimate = firstEstimate + secondEstimate;
  const estimatedReward = totalEstimate * 150;
  const estimatedFame = Math.floor(totalEstimate / 2);
  return {
    id: nextNobleId(),
    type: QUEST_TYPES.NOBLE_SECURITY,
    title: `治安回復`,
    fights: [
      { target: first, strength: "normal", done: false, estimatedTotal: firstEstimate },
      { target: second, strength: "elite", done: false, estimatedTotal: secondEstimate },
    ],
    enemyFactionId: "pirates",
    fightTotals: [],
    estimatedTotal: totalEstimate,
    reward: estimatedReward,
    rewardFame: estimatedFame,
    nobleId: noble.id,
    factionId: settlement.factionId,
    originId: settlement.id,
    deadlineAbs: null,
    acceptedAbs: null,
    desc: `指定2地点で敵を撃破せよ（通常/強編成 各）。推定${firstEstimate}人 / ${secondEstimate}人程度`,
  };
}

/**
 * 貴族依頼: 難民受け入れ（護送）。
 * @param {object} settlement
 * @param {object} noble
 * @returns {object|null}
 */
function genNobleRefugeeQuest(settlement, noble) {
  const avoid = usedTargets();
  const target = randomHuntTarget(settlement.coords, 3, 7, avoid);
  if (!target) return null;
  const dist = manhattan(settlement.coords, target);
  const rewardFame = rollDice(15, 2);
  return {
    id: nextNobleId(),
    type: QUEST_TYPES.NOBLE_REFUGEE,
    title: `難民受け入れ`,
    target,
    reward: dist * 200,
    rewardFame,
    nobleId: noble.id,
    factionId: settlement.factionId,
    originId: settlement.id,
    picked: false,
    deadlineAbs: null,
    acceptedAbs: null,
    desc: `難民を収容し、${settlement.name}まで護送せよ。`,
  };
}

/**
 * 貴族依頼: 兵站調達（戦時のみ）。
 * @param {object} settlement
 * @param {object} noble
 * @returns {object|null}
 */
function genNobleLogisticsQuest(settlement, noble) {
  const enemies = warOpponents(settlement.factionId).filter((fid) => fid !== "pirates");
  if (!enemies.length) return null;
  const opponent = enemies[randInt(0, enemies.length - 1)];
  const demand = settlement.demand || {};
  const pick = pickMaxDemand(demand, SUPPLY_TYPES.raw) || pickMaxDemand(demand, SUPPLY_TYPES.processed);
  if (!pick) return null;
  const pickName = SUPPLY_ITEMS.find((i) => i.id === pick.id)?.name || pick.id;
  const qty = Math.max(3, rollDice(4, 1));
  const foodQty = rollDice(5, 4);
  const price =
    calcSupplyPrice(pick.id, demand[pick.id] ?? 10, { factionId: settlement.factionId, settlementId: settlement.id }) ??
    0;
  const totalPrice = price * qty;
  const rewardFame = rollDice(10, 2);
  return {
    id: nextNobleId(),
    type: QUEST_TYPES.NOBLE_LOGISTICS,
    title: `兵站調達`,
    items: [
      { id: "food", qty: foodQty },
      { id: pick.id, qty },
    ],
    reward: totalPrice * 2 + 500,
    rewardFame,
    nobleId: noble.id,
    factionId: settlement.factionId,
    targetFactionId: opponent,
    originId: settlement.id,
    deadlineAbs: null,
    acceptedAbs: null,
    desc: `食料${foodQty}と物資${pickName}x${qty}を納品せよ。報酬: 資金${totalPrice * 2 + 500}`,
  };
}

/**
 * 貴族依頼: 敵軍討伐（戦時のみ）。
 * @param {object} settlement
 * @param {object} noble
 * @returns {object|null}
 */
function genNobleHuntQuest(settlement, noble) {
  const enemies = warOpponents(settlement.factionId).filter((fid) => fid !== "pirates");
  if (!enemies.length) return null;
  const opponent = enemies[randInt(0, enemies.length - 1)];
  const avoid = usedTargets();
  const target = randomHuntTarget(settlement.coords, 3, 7, avoid);
  if (!target) return null;
  const estimatedTotal = predictEnemyTotal("elite");
  const estimatedReward = estimatedTotal * 200;
  const estimatedFame = estimatedTotal;
  return {
    id: nextNobleId(),
    type: QUEST_TYPES.NOBLE_HUNT,
    title: `敵軍討伐`,
    target,
    enemyFactionId: opponent,
    estimatedTotal,
    reward: estimatedReward,
    rewardFame: estimatedFame,
    nobleId: noble.id,
    factionId: settlement.factionId,
    originId: settlement.id,
    deadlineAbs: null,
    acceptedAbs: null,
    desc: `指定座標 (${target.x + 1}, ${target.y + 1}) で敵軍を討伐せよ（推定${estimatedTotal}人程度）。`,
  };
}

/**
 * フロント行動用の依頼を生成する。
 * @param {object} settlement
 * @param {object} front
 * @param {"defend"|"attack"} role
 * @param {"defendRaid"|"attackRaid"|"skirmish"|"supplyFood"|"escort"|"blockade"} kind
 * @returns {object|null}
 */
export function genWarFrontQuest(settlement, front, role, kind) {
  if (!settlement || !front) return null;
  const enemyFactionId = role === "defend" ? front.attacker : front.defender;
  const playerFactionId = role === "defend" ? front.defender : front.attacker;
  const now = absDay(state);
  const deadlineAbs = Math.min(front.endAbs || now + 90, now + 90);
  const common = {
    id: nextNobleId(),
    frontSettlementId: settlement.id,
    frontRole: role,
    factionId: playerFactionId,
    enemyFactionId,
    acceptedAbs: now,
    deadlineAbs,
  };
  if (kind === "defendRaid" || kind === "attackRaid") {
    const estimatedTotal = predictEnemyTotal("elite");
    const target = randomHuntTarget(settlement.coords, 2, 5, usedTargets());
    if (!target) return null;
    return {
      ...common,
      type: kind === "defendRaid" ? QUEST_TYPES.WAR_DEFEND_RAID : QUEST_TYPES.WAR_ATTACK_RAID,
      title: kind === "defendRaid" ? "補給路迎撃" : "補給路襲撃",
      target,
      strength: "elite",
      estimatedTotal,
      desc: `${settlement.name} 周辺で敵の補給路を断つ。`,
    };
  }
  if (kind === "skirmish") {
    const estimatedTotal = predictEnemyTotal("elite");
    return {
      ...common,
      type: QUEST_TYPES.WAR_SKIRMISH,
      title: "小規模戦闘",
      target: { ...settlement.coords },
      strength: "elite",
      estimatedTotal,
      desc: `${settlement.name} 外縁で敵前衛を叩く。`,
    };
  }
  if (kind === "supplyFood") {
    const foodQty = rollDice(5, 8); // 8D5 相当
    const items = [{ id: "food", qty: foodQty }];
    return {
      ...common,
      type: QUEST_TYPES.WAR_SUPPLY,
      title: "食糧搬入",
      originId: settlement.id,
      items,
      desc: `${settlement.name} に食糧を搬入する。`,
      foodNeed: foodQty,
    };
  }
  if (kind === "escort") {
    const target = randomHuntTarget(settlement.coords, 3, 7, usedTargets());
    if (!target) return null;
    return {
      ...common,
      type: QUEST_TYPES.WAR_ESCORT,
      title: "輸送護衛",
      originId: settlement.id,
      target,
      picked: false,
      desc: `${settlement.name} へ輸送隊を護衛する。`,
    };
  }
  if (kind === "blockade") {
    const avoid = usedTargets();
    let first = randomHuntTarget(settlement.coords, 2, 5, avoid);
    let second = randomHuntTarget(settlement.coords, 2, 5, avoid.concat(first ? [first] : []));
    // 近傍に空きがない場合は回避なしで再抽選して必ず座標を取る
    if (!first || !second) {
      first = randomHuntTarget(settlement.coords, 2, 5, []);
      second = randomHuntTarget(settlement.coords, 2, 5, first ? [first] : []);
    }
    if (!first || !second) return null;
    const estNormal = predictEnemyTotal("normal");
    return {
      ...common,
      type: QUEST_TYPES.WAR_BLOCKADE,
      title: "補給封鎖",
      fights: [
        { target: first, strength: "normal", done: false, estimatedTotal: estNormal },
        { target: second, strength: "normal", done: false, estimatedTotal: estNormal },
      ],
      desc: `${settlement.name} への補給線を二箇所で断つ。`,
    };
  }
  return null;
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
 * フロント行動依頼を追加する（重複を避ける）
 * @param {object} settlement
 * @param {object} front
 * @param {"defend"|"attack"} role
 * @param {"defendRaid"|"attackRaid"|"skirmish"|"supplyFood"|"escort"|"blockade"} kind
 * @returns {object|null}
 */
export function addWarFrontQuest(settlement, front, role, kind) {
  ensureState();
  if (!settlement || !front) return null;
  const typeMap = {
    defendRaid: QUEST_TYPES.WAR_DEFEND_RAID,
    attackRaid: QUEST_TYPES.WAR_ATTACK_RAID,
    skirmish: QUEST_TYPES.WAR_SKIRMISH,
    supplyFood: QUEST_TYPES.WAR_SUPPLY,
    escort: QUEST_TYPES.WAR_ESCORT,
    blockade: QUEST_TYPES.WAR_BLOCKADE,
  };
  const tgtType = typeMap[kind];
  if (!tgtType) return null;
  if (Array.isArray(front.usedKinds) && front.usedKinds.includes(kind)) return null;
  const dup = state.quests.active.some((q) => q.frontSettlementId === settlement.id && q.type === tgtType);
  if (dup) return null;
  const q = genWarFrontQuest(settlement, front, role, kind);
  if (!q) return null;
  if (!Array.isArray(front.usedKinds)) front.usedKinds = [];
  front.usedKinds.push(kind);
  state.quests.active.push(q);
  pushLog("依頼受注", q.title, "-");
  return q;
}

function applyWarFrontScore(q, success) {
  if (!q?.frontSettlementId || !q?.enemyFactionId) return;
  const pf = getPlayerFactionId();
  const deltaMap = {
    [QUEST_TYPES.WAR_DEFEND_RAID]: 12,
    [QUEST_TYPES.WAR_ATTACK_RAID]: 12,
    [QUEST_TYPES.WAR_SKIRMISH]: 8,
    [QUEST_TYPES.WAR_SUPPLY]: 5,
    [QUEST_TYPES.WAR_ESCORT]: 8,
    [QUEST_TYPES.WAR_BLOCKADE]: 18,
  };
  const base = deltaMap[q.type] || 0;
  const delta = success ? base : base ? -Math.round(base * 2 / 3) : 0;
  if (delta) addFrontScore(pf, q.enemyFactionId, q.frontSettlementId, delta, absDay(state), 0, 0);
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
    adjustSupport(q.originId, here.factionId, 3);
    addWarScore(getPlayerFactionId(), "pirates", 0, absDay(state), 3, 0);
    const set = getSettlementById(q.originId);
    if (set?.nobleId) adjustNobleFavor(set.nobleId, 3);
    state.supplies[q.itemId] -= q.qty;
    fameReward = rollDice(5, 2);
    state.fame += fameReward;
  }
  if (q.type === QUEST_TYPES.DELIVERY) {
    if (!here || here.id !== q.targetId) return false;
    if ((state.supplies?.[q.itemId] ?? 0) < q.qty) return false;
    adjustSupport(q.targetId, here.factionId, 3);
    addWarScore(getPlayerFactionId(), "pirates", 0, absDay(state), 3, 0);
    const set = getSettlementById(q.targetId);
    if (set?.nobleId) adjustNobleFavor(set.nobleId, 3);
    state.supplies[q.itemId] -= q.qty;
    fameReward = rollDice(5, 2);
    state.fame += fameReward;
  }
  if (q.type === QUEST_TYPES.WAR_SUPPLY) {
    if (!here || here.id !== q.originId) return false;
    const ok = (q.items || []).every((it) => (state.supplies?.[it.id] ?? 0) >= it.qty);
    if (!ok) return false;
    (q.items || []).forEach((it) => {
      state.supplies[it.id] = Math.max(0, (state.supplies[it.id] ?? 0) - it.qty);
    });
    applyWarFrontScore(q, true);
  }
  if (q.type === QUEST_TYPES.WAR_ESCORT) {
    if (!here) return false;
    if (!q.picked) return false;
    if (here.id !== q.originId) return false;
    applyWarFrontScore(q, true);
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
  if (q.type === QUEST_TYPES.NOBLE_SUPPLY) {
    if (!here || here.id !== q.originId) return false;
    const ok = (q.items || []).every((it) => (state.supplies?.[it.id] ?? 0) >= it.qty);
    if (!ok) return false;
    q.items.forEach((it) => {
      state.supplies[it.id] = Math.max(0, (state.supplies[it.id] ?? 0) - it.qty);
    });
    fameReward = q.rewardFame || 0;
    state.fame += fameReward;
    if (q.nobleId) adjustNobleFavor(q.nobleId, 4);
  }
  if (q.type === QUEST_TYPES.NOBLE_LOGISTICS) {
    if (!here || here.id !== q.originId) return false;
    const ok = (q.items || []).every((it) => (state.supplies?.[it.id] ?? 0) >= it.qty);
    if (!ok) return false;
    q.items.forEach((it) => {
      state.supplies[it.id] = Math.max(0, (state.supplies[it.id] ?? 0) - it.qty);
    });
    fameReward = q.rewardFame || 0;
    state.fame += fameReward;
    if (q.nobleId) adjustNobleFavor(q.nobleId, 4);
  }
  if (q.type === QUEST_TYPES.NOBLE_SCOUT) {
    const herePos = state.position;
    if (!q.target || herePos.x !== q.target.x || herePos.y !== q.target.y) return false;
    fameReward = q.rewardFame || 0;
    state.fame += fameReward;
    if (q.nobleId) adjustNobleFavor(q.nobleId, 4);
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
  enqueueEvent({ title: "依頼完了", body: `${q.title} / ${rewardText}` });
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
  if (q.type === QUEST_TYPES.REFUGEE_ESCORT) {
    return false;
  }
  if (q.type === QUEST_TYPES.NOBLE_SUPPLY) {
    if (!here || here.id !== q.originId) return false;
    return (q.items || []).every((it) => (state.supplies?.[it.id] ?? 0) >= it.qty);
  }
  if (q.type === QUEST_TYPES.NOBLE_LOGISTICS) {
    if (!here || here.id !== q.originId) return false;
    return (q.items || []).every((it) => (state.supplies?.[it.id] ?? 0) >= it.qty);
  }
  if (q.type === QUEST_TYPES.WAR_SUPPLY) {
    if (!here || here.id !== q.originId) return false;
    return (q.items || []).every((it) => (state.supplies?.[it.id] ?? 0) >= it.qty);
  }
  if (q.type === QUEST_TYPES.WAR_ESCORT) {
    if (!q.picked) return false;
    if (!here || here.id !== q.originId) return false;
    return true;
  }
  if (q.type === QUEST_TYPES.NOBLE_SCOUT) {
    const herePos = state.position;
    return q.target && herePos.x === q.target.x && herePos.y === q.target.y;
  }
  if (q.type === QUEST_TYPES.NOBLE_REFUGEE) {
    return false;
  }
  if (q.type === QUEST_TYPES.NOBLE_SECURITY || q.type === QUEST_TYPES.NOBLE_HUNT) {
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
  enqueueEvent({ title: "神託達成", body: `${q.title} / ${rewardText}` });
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
  enqueueEvent({ title: "神託失敗", body: `${q.title}${note}` });
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
    const fid = q.enemyFactionId || "pirates";
    addWarScore(getPlayerFactionId(), fid, 8, absDay(state));
    enqueueEvent({ title: "討伐達成", body: `${q.title} / ${rewardText}` });
  } else {
    state.quests.active.splice(idx, 1);
    const note = reason ? ` / ${reason}` : "";
    pushLog("討伐失敗", `${q.title}${note}`, "-");
    pushToast("討伐失敗", `${q.title}${note}`, "bad");
    const fid = q.enemyFactionId || "pirates";
    addWarScore(getPlayerFactionId(), fid, -6, absDay(state));
    enqueueEvent({ title: "討伐失敗", body: `${q.title}${note}` });
  }
  return true;
}

/**
 * 貴族依頼の戦闘を処理する（治安回復/敵軍討伐）。
 * @param {number} id
 * @param {boolean} success
 * @param {number} enemyTotal
 * @param {number|null} fightIdx
 */
export function completeNobleBattleQuest(id, success, enemyTotal, fightIdx = null) {
  ensureState();
  const idx = state.quests.active.findIndex(
    (q) => q.id === id && (q.type === QUEST_TYPES.NOBLE_SECURITY || q.type === QUEST_TYPES.NOBLE_HUNT)
  );
  if (idx === -1) return false;
  const q = state.quests.active[idx];
  if (q.type === QUEST_TYPES.NOBLE_SECURITY) {
    if (!success) {
      const fameLoss = Math.floor(Math.max(1, (enemyTotal || 0) / 2) * 0.8);
      if (fameLoss > 0) state.fame = Math.max(0, state.fame - fameLoss);
      if (q.nobleId) adjustNobleFavor(q.nobleId, -4);
      state.quests.active.splice(idx, 1);
      pushLog("依頼失敗", `${q.title} / 戦闘に敗北`, "-");
      pushToast("依頼失敗", `${q.title} / 戦闘に敗北`, "bad");
      return true;
    }
    if (!Array.isArray(q.fights)) q.fights = [];
    if (!Array.isArray(q.fightTotals)) q.fightTotals = [];
    if (fightIdx != null && q.fights[fightIdx]) q.fights[fightIdx].done = true;
    q.fightTotals.push(enemyTotal || 0);
    const remaining = (q.fights || []).some((f) => !f.done);
    if (remaining) {
      pushLog("依頼進行", `${q.title} / 残り${q.fights.filter((f) => !f.done).length}戦`, "-");
      pushToast("依頼進行", `${q.title} / 残り戦闘あり`, "info");
      return true;
    }
    const totalSize = Math.max(0, q.fightTotals.reduce((a, b) => a + (b || 0), 0));
    const reward = totalSize * 150;
    const fameReward = Math.floor(totalSize / 2);
    state.funds += reward;
    state.fame += fameReward;
    if (q.nobleId) adjustNobleFavor(q.nobleId, 4);
    state.quests.active.splice(idx, 1);
    const rewardText = `資金+${reward} / 名声+${fameReward}`;
    pushLog("依頼達成", `${q.title} / ${rewardText}`, "-");
    pushToast("依頼達成", `${q.title} / ${rewardText}`, "good");
    enqueueEvent({ title: "依頼達成", body: `${q.title} / ${rewardText}` });
    return true;
  }
  if (q.type === QUEST_TYPES.NOBLE_HUNT) {
    if (!success) {
      const fameLoss = Math.floor(Math.max(1, enemyTotal || 0) * 0.8);
      state.fame = Math.max(0, state.fame - fameLoss);
      if (q.nobleId) adjustNobleFavor(q.nobleId, -4);
      state.quests.active.splice(idx, 1);
      pushLog("依頼失敗", `${q.title} / 戦闘に敗北`, "-");
      pushToast("依頼失敗", `${q.title} / 戦闘に敗北`, "bad");
      return true;
    }
    const reward = (enemyTotal || 0) * 200;
    const fameReward = enemyTotal || 0;
    state.funds += reward;
    state.fame += fameReward;
    if (q.nobleId) adjustNobleFavor(q.nobleId, 4);
    state.quests.active.splice(idx, 1);
    const rewardText = `資金+${reward} / 名声+${fameReward}`;
    pushLog("依頼達成", `${q.title} / ${rewardText}`, "-");
    pushToast("依頼達成", `${q.title} / ${rewardText}`, "good");
    enqueueEvent({ title: "依頼達成", body: `${q.title} / ${rewardText}` });
  }
  return true;
}

/**
 * フロント行動（戦闘系）の完了処理。
 * @param {number} id
 * @param {boolean} success
 * @param {number} enemyTotal
 * @param {number|null} fightIdx
 * @returns {boolean}
 */
export function completeWarBattleQuest(id, success, enemyTotal, fightIdx = null) {
  ensureState();
  const idx = state.quests.active.findIndex(
    (q) =>
      q.id === id &&
      (q.type === QUEST_TYPES.WAR_DEFEND_RAID ||
        q.type === QUEST_TYPES.WAR_ATTACK_RAID ||
        q.type === QUEST_TYPES.WAR_SKIRMISH ||
        q.type === QUEST_TYPES.WAR_BLOCKADE)
  );
  if (idx === -1) return false;
  const q = state.quests.active[idx];
  if (q.type === QUEST_TYPES.WAR_BLOCKADE && Array.isArray(q.fights)) {
    if (!success) {
      applyWarFrontScore(q, false);
      state.quests.active.splice(idx, 1);
      pushLog("行動失敗", `${q.title} / 戦闘に敗北`, "-");
      pushToast("行動失敗", `${q.title} / 戦闘に敗北`, "bad");
      return true;
    }
    if (fightIdx != null && q.fights[fightIdx]) q.fights[fightIdx].done = true;
    const remaining = (q.fights || []).some((f) => !f.done);
    if (remaining) {
      pushLog("行動進行", `${q.title} / 残り${q.fights.filter((f) => !f.done).length}箇所`, "-");
      pushToast("行動進行", `${q.title} / まだ遮断箇所が残っています`, "info");
      return true;
    }
    applyWarFrontScore(q, true);
    state.quests.active.splice(idx, 1);
    pushLog("行動達成", `${q.title} / 補給線を遮断`, "-");
    pushToast("行動達成", `${q.title} を完了しました`, "good");
    return true;
  }
  if (success) {
    applyWarFrontScore(q, true);
    pushLog("行動達成", `${q.title} / 戦闘勝利`, "-");
    pushToast("行動達成", `${q.title} を完了しました`, "good");
  } else {
    applyWarFrontScore(q, false);
    pushLog("行動失敗", `${q.title} / 戦闘に敗北`, "-");
    pushToast("行動失敗", `${q.title} / 戦闘に敗北`, "bad");
  }
  state.quests.active.splice(idx, 1);
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
 * 戦闘が必要な依頼/神託を現在位置から取得する。
 * @param {{x:number,y:number}} pos
 * @returns {{quest:object,strength:string,enemyFactionId:string,fightIdx:number|null}|null}
 */
export function getBattleQuestAt(pos) {
  ensureState();
  if (!pos) return null;
  const list = state.quests.active || [];
  for (const q of list) {
    if (
      (q.type === QUEST_TYPES.ORACLE_HUNT ||
        q.type === QUEST_TYPES.ORACLE_ELITE ||
        q.type === QUEST_TYPES.PIRATE_HUNT ||
        q.type === QUEST_TYPES.BOUNTY_HUNT) &&
      q.target &&
      q.target.x === pos.x &&
      q.target.y === pos.y
    ) {
      return {
        quest: q,
        strength: q.strength || (q.type === QUEST_TYPES.BOUNTY_HUNT || q.type === QUEST_TYPES.ORACLE_ELITE ? "elite" : "normal"),
        enemyFactionId: q.enemyFactionId || "pirates",
        fightIdx: null,
      };
    }
    if (q.type === QUEST_TYPES.NOBLE_SECURITY && Array.isArray(q.fights)) {
      const idx = q.fights.findIndex((f) => f?.target && !f.done && f.target.x === pos.x && f.target.y === pos.y);
      if (idx !== -1) {
        return {
          quest: q,
          strength: q.fights[idx].strength || "normal",
          enemyFactionId: "pirates",
          fightIdx: idx,
        };
      }
    }
    if (q.type === QUEST_TYPES.NOBLE_HUNT && q.target && q.target.x === pos.x && q.target.y === pos.y) {
      return {
        quest: q,
        strength: "elite",
        enemyFactionId: q.enemyFactionId || "pirates",
        fightIdx: null,
      };
    }
    if (
      (q.type === QUEST_TYPES.WAR_DEFEND_RAID || q.type === QUEST_TYPES.WAR_ATTACK_RAID || q.type === QUEST_TYPES.WAR_SKIRMISH) &&
      q.target &&
      q.target.x === pos.x &&
      q.target.y === pos.y
    ) {
      return {
        quest: q,
        strength: q.strength || "elite",
        enemyFactionId: q.enemyFactionId || "pirates",
        fightIdx: null,
      };
    }
    if (q.type === QUEST_TYPES.WAR_BLOCKADE && Array.isArray(q.fights)) {
      const idx = q.fights.findIndex((f) => f?.target && !f.done && f.target.x === pos.x && f.target.y === pos.y);
      if (idx !== -1) {
        return {
          quest: q,
          strength: q.fights[idx].strength || "normal",
          enemyFactionId: q.enemyFactionId || "pirates",
          fightIdx: idx,
        };
      }
    }
  }
  return null;
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
      expired.forEach((q) => {
        pushLog("依頼失敗", `${q.title} の期限切れ`, "-");
        enqueueEvent({ title: "依頼失敗", body: `${q.title} の期限切れ` });
        if (q.type === QUEST_TYPES.SUPPLY && q.originId) {
          const s = getSettlementById(q.originId);
          if (s?.factionId) adjustSupport(q.originId, s.factionId, -2);
          if (s?.nobleId) adjustNobleFavor(s.nobleId, -3);
        }
        if (q.type === QUEST_TYPES.DELIVERY && q.targetId) {
          const s = getSettlementById(q.targetId);
          if (s?.factionId) adjustSupport(q.targetId, s.factionId, -2);
          if (s?.nobleId) adjustNobleFavor(s.nobleId, -3);
        }
        if (q.type === QUEST_TYPES.REFUGEE_ESCORT && q.targetId) {
          const s = getSettlementById(q.targetId);
          if (s?.factionId) adjustSupport(q.targetId, s.factionId, -2);
          if (s?.nobleId) adjustNobleFavor(s.nobleId, -3);
          // 護送フラグを解除
          state.refugeeEscort = { active: false, targetId: null, factionId: null, nobleId: null };
        }
        if (
          q.type === QUEST_TYPES.NOBLE_SUPPLY ||
          q.type === QUEST_TYPES.NOBLE_SCOUT ||
          q.type === QUEST_TYPES.NOBLE_SECURITY ||
          q.type === QUEST_TYPES.NOBLE_REFUGEE ||
          q.type === QUEST_TYPES.NOBLE_LOGISTICS ||
          q.type === QUEST_TYPES.NOBLE_HUNT
        ) {
          const fameLoss = q.rewardFame ? Math.floor(q.rewardFame * 0.8) : 0;
          if (fameLoss > 0) state.fame = Math.max(0, state.fame - fameLoss);
          if (q.nobleId) adjustNobleFavor(q.nobleId, -4);
          if (q.type === QUEST_TYPES.NOBLE_REFUGEE) {
            state.refugeeEscort = { active: false, targetId: null, factionId: null, nobleId: null, questId: null };
          }
        }
        if (
          q.type === QUEST_TYPES.WAR_DEFEND_RAID ||
          q.type === QUEST_TYPES.WAR_ATTACK_RAID ||
          q.type === QUEST_TYPES.WAR_SKIRMISH ||
          q.type === QUEST_TYPES.WAR_SUPPLY ||
          q.type === QUEST_TYPES.WAR_ESCORT ||
          q.type === QUEST_TYPES.WAR_BLOCKADE
        ) {
          applyWarFrontScore(q, false);
        }
      });
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
    state.nobleQuests = state.nobleQuests || { availableByNoble: {}, nextId: 1, lastSeasonByNoble: {} };
    state.nobleQuests.availableByNoble = {};
    state.nobleQuests.lastSeasonByNoble = {};
  }
}
}

export { QUEST_TYPES };

/**
 * 護送依頼を目的地で完了する。
 * @param {object|null} settlement
 * @returns {boolean}
 */
export function completeRefugeeEscortAt(settlement) {
  ensureState();
  if (!settlement) return false;
  const idx = state.quests.active.findIndex(
    (q) => q.type === QUEST_TYPES.REFUGEE_ESCORT && q.targetId === settlement.id
  );
  if (idx === -1) return false;
  const q = state.quests.active[idx];
  const factionId = settlement.factionId || "pirates";
  state.fame += 4;
  adjustSupport(settlement.id, factionId, 3);
  addWarScore(getPlayerFactionId(), factionId, 4, absDay(state), 0, 0);
  if (settlement.nobleId) adjustNobleFavor(settlement.nobleId, 3);
  state.quests.active.splice(idx, 1);
  state.refugeeEscort = { active: false, targetId: null, factionId: null, nobleId: null };
  const rewardText = "名声+4 / 支持が上昇";
  pushLog("護送完了", `${q.title} / ${rewardText}`, "-");
  pushToast("護送完了", `${q.title} / ${rewardText}`, "good");
  enqueueEvent({ title: "護送完了", body: `${q.title} / ${rewardText}` });
  return true;
}

/**
 * 難民受け入れ（貴族依頼）を受け取る地点に到達した際の処理。
 * @param {{x:number,y:number}} pos
 */
export function markNobleRefugeePickup(pos) {
  ensureState();
  if (state.refugeeEscort?.active) return;
  const q = state.quests.active.find(
    (qq) => qq.type === QUEST_TYPES.NOBLE_REFUGEE && !qq.picked && qq.target && qq.target.x === pos.x && qq.target.y === pos.y
  );
  if (!q) return;
  q.picked = true;
  state.refugeeEscort = {
    active: true,
    targetId: q.originId,
    factionId: q.factionId || null,
    nobleId: q.nobleId || null,
    questId: q.id,
  };
  pushLog("難民受け入れ", `${q.title} / 難民を収容しました。拠点へ戻ります。`, "-");
  pushToast("難民受け入れ", "難民を収容しました。拠点へ戻ります（エンカウント率上昇）", "warn");
}

/**
 * 戦争用輸送護衛のピックアップ地点に到達した際の処理。
 * @param {{x:number,y:number}} pos
 */
export function markWarEscortPickup(pos) {
  ensureState();
  const q = state.quests.active.find(
    (qq) => qq.type === QUEST_TYPES.WAR_ESCORT && !qq.picked && qq.target && qq.target.x === pos.x && qq.target.y === pos.y
  );
  if (!q) return;
  q.picked = true;
  pushLog("輸送護衛", `${q.title} / 輸送隊を合流させました。拠点へ護衛してください。`, "-");
  pushToast("輸送護衛", "輸送隊と合流しました。拠点へ戻って完了してください。", "info");
}

/**
 * 貴族依頼の護送を完了する。
 * @param {object|null} settlement
 * @returns {boolean}
 */
export function completeNobleRefugeeAt(settlement) {
  ensureState();
  if (!settlement) return false;
  const idx = state.quests.active.findIndex(
    (q) =>
      q.type === QUEST_TYPES.NOBLE_REFUGEE &&
      q.picked &&
      q.originId === settlement.id
  );
  if (idx === -1) return false;
  const q = state.quests.active[idx];
  state.quests.active.splice(idx, 1);
  const fameReward = q.rewardFame || 0;
  state.funds += q.reward || 0;
  state.fame += fameReward;
  if (q.nobleId) adjustNobleFavor(q.nobleId, 4);
  state.refugeeEscort = { active: false, targetId: null, factionId: null, nobleId: null, questId: null };
  const rewardText = `資金+${q.reward || 0} / 名声+${fameReward}`;
  pushLog("護送完了", `${q.title} / ${rewardText}`, "-");
  pushToast("護送完了", `${q.title} / ${rewardText}`, "good");
  enqueueEvent({ title: "護送完了", body: `${q.title} / ${rewardText}` });
  return true;
}

/**
 * 戦争用輸送護衛を完了する。
 * @param {object|null} settlement
 */
export function completeWarEscortAt(settlement) {
  ensureState();
  if (!settlement) return;
  const idx = state.quests.active.findIndex(
    (q) => q.type === QUEST_TYPES.WAR_ESCORT && q.picked && q.originId === settlement.id
  );
  if (idx === -1) return;
  const q = state.quests.active[idx];
  applyWarFrontScore(q, true);
  state.quests.active.splice(idx, 1);
  pushLog("護送完了", `${q.title} / ${settlement.name} に護送完了`, "-");
  pushToast("護送完了", `${q.title} を完了しました`, "good");
}
