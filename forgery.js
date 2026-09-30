import { absDay } from "./calendar.js";
import { BOUNTY_CONFIG } from "./bountyConfig.js";
import { PIRATE_CONFIG, pirateRelation } from "./pirateConfig.js";

/** 身分偽造の初期調整値。待機期間は全勢力・全港で共有する。 */
export const FORGERY_CONFIG = { remainingRate: 0.5, costRate: 1, cooldownDays: 30, fees: { hostile: 1.2, wary: 1.1, neutral: 1, welcomed: 0.8 } };

/** @param {object} state 状態。 @param {object} port 現地。 @param {string} factionId 対象。 @returns {object} 決済前の見積もり。 */
export function quoteForgery(state, port, factionId) {
  const now = absDay(state);
  if (!port?.pirateHaven) return { error: "身分偽造は無法港の窓口で利用できます。" };
  if (!["north", "archipelago", "citadel"].includes(factionId)) return { error: "通常勢力を選んでください。" };
  if (state.pendingEncounter?.active || state.wanted?.detention || state.eventQueue?.length) return { error: "進行中の出来事を終えてください。" };
  const wait = Math.max(0, (state.wanted?.forgeryUntil || 0) - now);
  if (wait) return { error: `身分偽造はあと${wait}日後に利用できます。` };
  const record = state.wanted?.byFaction?.[factionId];
  if (!record?.amount || now - record.lastCrimeAbs >= BOUNTY_CONFIG.lifetime) return { error: "この勢力からは手配されていません。" };
  const remaining = Math.floor(record.amount * FORGERY_CONFIG.remainingRate);
  const feeRate = FORGERY_CONFIG.fees[pirateRelation(state.nobleFavor?.[PIRATE_CONFIG.nobleId] || 0)];
  const cost = Math.ceil((record.amount - remaining) * FORGERY_CONFIG.costRate * feeRate);
  return { amount: record.amount, remaining, cost, affordable: state.funds >= cost };
}

/** 見積もりを再検証して支払いと減額を一度に行う。犯罪日・履歴・好感度は変更しない。
 * @param {object} state 状態。 @param {object} port 現地。 @param {string} factionId 対象。 @param {number} expected 確認した賞金。 @param {number} expectedCost 確認した費用。 @returns {boolean} 成立したか。
 */
export function applyForgery(state, port, factionId, expected, expectedCost) {
  const quote = quoteForgery(state, port, factionId);
  if (quote.error || !quote.affordable || quote.amount !== expected || quote.cost !== expectedCost) return false;
  state.funds -= quote.cost;
  const record = state.wanted.byFaction[factionId];
  record.amount = quote.remaining;
  if (!record.amount) record.lastCrimeAbs = null;
  state.wanted.forgeryUntil = absDay(state) + FORGERY_CONFIG.cooldownDays;
  return true;
}
