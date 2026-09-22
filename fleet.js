import { SHIP_TYPES, SHIP_REWARD_WEIGHT_EXPONENT } from "./shipConfig.js";
import { VARIANT_SHIPS, normalizeVariants } from "./variantShips.js";

/** @param {unknown} value 数量。 @returns {number} 非負の安全な整数。 */
export function shipCount(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }

/** @param {object|number} value 船団または旧隻数。 @returns {object} 正規化した独立の船団状態。 */
export function normalizeFleet(value) {
  const variants = normalizeVariants(value?.variants);
  return { version: 2, variants, nextVariantId: Math.max(1, shipCount(value?.nextVariantId), ...variants.map(v => v.id + 1)), counts: Object.fromEntries(Object.keys(SHIP_TYPES).map(id =>
    [id, shipCount(typeof value === "number" ? (id === "cog" ? value : 0) : value?.counts?.[id])])) };
}

/** @param {object} state 状態。 @returns {void} 旧従船を一度だけコグへ移行する。 */
export function migrateFleet(state) {
  state.fleet = normalizeFleet(state.fleet ?? state.ships);
  delete state.ships;
}

/** @param {object|number} fleet 船団。 @returns {number} 従船合計。 */
export function totalShips(fleet) { return Object.values(fleetCounts(fleet)).reduce((sum, n) => sum + n, 0); }

/** 通常船と固有船は同じ船種のバフ上限を共有する。 @param {object} value 船団。 @returns {object} 合算隻数。 */
export function fleetCounts(value) {
  const fleet = normalizeFleet(value), counts = { ...fleet.counts };
  for (const v of fleet.variants) counts[VARIANT_SHIPS[v.variantId].base]++;
  return counts;
}

/** 同種の固有船も別個体として来歴を保存する。 @param {object} state 状態。 @param {string} variantId 固有船種。 @param {string} sourceName 元の船長。 @param {number} acquiredAbs 獲得日。 @returns {object} 獲得個体。 */
export function addVariantShip(state, variantId, sourceName, acquiredAbs) {
  if (!Object.hasOwn(VARIANT_SHIPS, variantId)) throw new Error("不明な固有船です。");
  const fleet = normalizeFleet(state.fleet);
  if (!Number.isSafeInteger(fleet.nextVariantId + 1)) throw new Error("船の記録が上限に達しました。");
  const record = { id: fleet.nextVariantId++, variantId, sourceName, acquiredAbs };
  fleet.variants.push(record); state.fleet = fleet;
  return record;
}

/** @param {object|number} fleet 船団。 @returns {object} 全容量と上限付き固有効果。 */
export function fleetEffects(fleet) {
  const result = { supplies: 0, troops: 0, upkeepReduction: 0, shipUpkeepReduction: 0, supplyCap: 0, troopCap: 0, atk: 0, def: 0, supportPower: 0 };
  for (const [id, count] of Object.entries(fleetCounts(fleet))) {
    const ship = SHIP_TYPES[id];
    result.supplies += ship.supplies * count;
    result.troops += ship.troops * count;
    for (const [key, amount] of Object.entries(ship.effects)) result[key] += amount * Math.min(count, ship.limit);
  }
  for (const v of normalizeFleet(fleet).variants) {
    result.supplies += VARIANT_SHIPS[v.variantId].supplies;
    result.troops += VARIANT_SHIPS[v.variantId].troops;
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
    .map(([id, n]) => `${SHIP_TYPES[id].name} ${n}隻`).concat((counts.variants || []).map(v => `${VARIANT_SHIPS[v.variantId].name} 1隻`)).join(" / ");
}

/** @param {object} state 状態。 @param {number} count 隻数。 @returns {string} 抽選して加算した船の説明。 */
export function awardShips(state, count = 1) {
  const counts = rollShips(count);
  addShips(state, counts);
  return shipListText(counts);
}

/**
 * 通常船を優先し、その後に固有船を失う。各区分内は最安船から、同額は保存順とする。
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
  const victims = [...fleet.variants].sort((a, b) => SHIP_TYPES[VARIANT_SHIPS[a.variantId].base].price - SHIP_TYPES[VARIANT_SHIPS[b.variantId].base].price).slice(0, remaining);
  if (victims.length) lost.variants = victims;
  const ids = new Set(victims.map(v => v.id));
  fleet.variants = fleet.variants.filter(v => !ids.has(v.id));
  state.fleet = fleet;
  return lost;
}
