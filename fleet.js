import { SHIP_TYPES, SHIP_REWARD_WEIGHT_EXPONENT } from "./shipConfig.js";

/** @param {unknown} value 数量。 @returns {number} 非負の安全な整数。 */
export function shipCount(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }

/** @param {object|number} value 船団または旧隻数。 @returns {object} 正規化した独立の船団状態。 */
export function normalizeFleet(value) {
  return { version: 1, counts: Object.fromEntries(Object.keys(SHIP_TYPES).map(id =>
    [id, shipCount(typeof value === "number" ? (id === "cog" ? value : 0) : value?.counts?.[id])])) };
}

/** @param {object} state 状態。 @returns {void} 旧従船を一度だけコグへ移行する。 */
export function migrateFleet(state) {
  state.fleet = normalizeFleet(state.fleet ?? state.ships);
  delete state.ships;
}

/** @param {object|number} fleet 船団。 @returns {number} 従船合計。 */
export function totalShips(fleet) { return Object.values(normalizeFleet(fleet).counts).reduce((sum, n) => sum + n, 0); }

/** @param {object|number} fleet 船団。 @returns {object} 全容量と上限付き固有効果。 */
export function fleetEffects(fleet) {
  const result = { supplies: 0, troops: 0, upkeepReduction: 0, supplyCap: 0, troopCap: 0, atk: 0, def: 0, supportPower: 0, cannonReduction: 0 };
  for (const [id, count] of Object.entries(normalizeFleet(fleet).counts)) {
    const ship = SHIP_TYPES[id];
    result.supplies += ship.supplies * count;
    result.troops += ship.troops * count;
    for (const [key, amount] of Object.entries(ship.effects)) result[key] += amount * Math.min(count, ship.limit);
  }
  return result;
}

/**
 * 船種を価格の逆数に比例して1隻ずつ独立抽選する。同種重複を許す。
 * @param {number} count 獲得隻数。 @param {Function} random 乱数。 @returns {object} 船種別隻数。
 */
export function rollShips(count, random = Math.random) {
  const pool = Object.entries(SHIP_TYPES).map(([id, ship]) => ({ id, weight: ship.price ** -SHIP_REWARD_WEIGHT_EXPONENT }));
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  const counts = {};
  for (let i = 0; i < shipCount(count); i++) {
    let roll = random() * total;
    const selected = pool.find(entry => (roll -= entry.weight) < 0) || pool[pool.length - 1];
    counts[selected.id] = (counts[selected.id] || 0) + 1;
  }
  return counts;
}

/** @param {object} reward 報酬。 @param {Function} random 乱数。 @returns {object} 保存可能な確定船種。 */
export function prepareShipReward(reward, random = Math.random) {
  if (!reward.shipTypes) reward.shipTypes = rollShips(reward.ships || 0, random);
  return reward.shipTypes;
}

/** @param {object} state 状態。 @param {object} counts 船種別隻数。 @returns {void} 指定船を加算する。 */
export function addShips(state, counts) {
  const fleet = normalizeFleet(state.fleet ?? state.ships);
  for (const [id, count] of Object.entries(normalizeFleet({ counts }).counts)) {
    const next = fleet.counts[id] + count;
    if (!Number.isSafeInteger(next)) throw new Error("船の所持数が大きすぎます。");
    fleet.counts[id] = next;
  }
  state.fleet = fleet;
}

/** @param {object} counts 船種別隻数。 @returns {string} 獲得・喪失船の説明。 */
export function shipListText(counts) {
  return Object.entries(normalizeFleet({ counts }).counts).filter(([, n]) => n > 0)
    .map(([id, n]) => `${SHIP_TYPES[id].name} ${n}隻`).join(" / ");
}

/** @param {object} state 状態。 @param {number} count 隻数。 @returns {string} 抽選して加算した船の説明。 */
export function awardShips(state, count = 1) {
  const counts = rollShips(count);
  addShips(state, counts);
  return shipListText(counts);
}

/**
 * 最安船から順に喪失させる。同額は定義順、所持を超える要求は残存数までとする。
 * @param {object} state 状態。 @param {number} count 喪失隻数。 @returns {object} 喪失した船種別隻数。
 */
export function loseShips(state, count) {
  const fleet = normalizeFleet(state.fleet);
  const lost = {};
  let remaining = shipCount(count);
  for (const id of Object.keys(SHIP_TYPES).sort((a, b) => SHIP_TYPES[a].price - SHIP_TYPES[b].price)) {
    const take = Math.min(remaining, fleet.counts[id]);
    if (take) { fleet.counts[id] -= take; lost[id] = take; remaining -= take; }
  }
  state.fleet = fleet;
  return lost;
}
