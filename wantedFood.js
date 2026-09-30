import { WANTED_POLICY } from "./wantedPolicy.js";

/** 通常在庫とは独立した季節枠。占領で勢力が変わっても拠点の使用数は引き継ぐ。
 * @param {object} state 状態。 @param {object} settlement 拠点。 @param {number} price 通常単価。 @param {number} space 空き容量。 @returns {object} 見積もり。
 */
export function quoteEmergencyFood(state, settlement, price, space) {
  const season = state.year * 4 + state.season;
  const row = state.wanted?.emergencyFood?.[settlement?.id];
  const used = row?.season === season ? row.used : 0;
  const remaining = Math.max(0, WANTED_POLICY.emergencyFoodLimit - used);
  const unitPrice = Math.ceil(price * WANTED_POLICY.emergencyFoodRate);
  const max = Number.isSafeInteger(unitPrice) && unitPrice > 0 ? Math.max(0, Math.min(remaining, Math.floor(state.funds / unitPrice), Math.floor(space))) : 0;
  return { season, remaining, unitPrice, max, used };
}

/** 数量・価格・余力を再確認し、季節枠と資産を一緒に更新する。
 * @param {object} state 状態。 @param {object} settlement 拠点。 @param {number} price 単価。 @param {number} space 空き。 @param {number} qty 数量。 @param {number} expected 確認済み単価。 @returns {boolean} 購入できたか。
 */
export function buyEmergencyFood(state, settlement, price, space, qty, expected) {
  const quote = quoteEmergencyFood(state, settlement, price, space);
  if (!settlement?.id || !state.wanted || !Number.isSafeInteger(qty) || qty <= 0 || qty > quote.max || quote.unitPrice !== expected) return false;
  state.funds -= qty * quote.unitPrice;
  state.supplies ||= {};
  state.supplies.food = (state.supplies.food || 0) + qty;
  state.wanted.emergencyFood ||= {};
  state.wanted.emergencyFood[settlement.id] = { season: quote.season, used: quote.used + qty };
  return true;
}
