import { absDay } from "./calendar.js";
import { BOUNTY_CONFIG } from "./bountyConfig.js";
import { CONTRABAND, PIRATE_CONFIG } from "./pirateConfig.js";
import { recordCrime } from "./playerWanted.js";

/** 司法取引の調整値。海賊の賞金加算はCRIME_REWARDS.judicial_dealで管理する。 */
export const JUDICIAL_CONFIG = { quantity: 10, reduction: 3000, favorLoss: 20, cooldownDays: 30 };

/** @param {object} state 状態。 @param {object} place 現地。 @param {string} itemId 引渡品。 @returns {object} 取引条件。 */
export function quoteJudicialDeal(state, place, itemId) {
  if (place?.pirateHaven || !["north", "archipelago", "citadel"].includes(place?.factionId)) return { error: "通常勢力の街・村で利用できます。" };
  if (state.honorFactions?.length) return { error: "海賊の賞金が増えるため、名誉家臣を辞してから利用してください。" };
  if (state.pendingEncounter?.active || state.wanted?.detention || state.eventQueue?.length) return { error: "進行中の出来事を解決してください。" };
  const now = absDay(state), wait = Math.max(0, (state.wanted?.judicialUntil || 0) - now);
  if (wait) return { error: `司法取引はあと${wait}日後に利用できます。` };
  const record = state.wanted?.byFaction?.[place.factionId];
  if (!record?.amount || now - record.lastCrimeAbs >= BOUNTY_CONFIG.lifetime) return { error: "この勢力からの手配はありません。" };
  if (!CONTRABAND.some(item => item.id === itemId)) return { error: "引き渡す禁制品を選んでください。" };
  if ((state.supplies?.[itemId] || 0) < JUDICIAL_CONFIG.quantity) return { error: `同じ種類の禁制品が${JUDICIAL_CONFIG.quantity}個必要です。` };
  return { amount: record.amount, remaining: Math.max(0, record.amount - JUDICIAL_CONFIG.reduction) };
}

/** 引渡し・減額・海賊の手配と好感度を一括更新する。待機期間は全勢力で共有し連続実行を防ぐ。
 * @param {object} state 状態。 @param {object} place 現地。 @param {string} itemId 引渡品。 @param {number} expected 確認額。 @returns {boolean} 成立したか。
 */
export function applyJudicialDeal(state, place, itemId, expected) {
  const quote = quoteJudicialDeal(state, place, itemId);
  if (quote.error || quote.amount !== expected) return false;
  if (!recordCrime(state, "judicial_deal", {}, absDay(state), "pirates")) return false;
  state.supplies[itemId] -= JUDICIAL_CONFIG.quantity;
  const target = state.wanted.byFaction[place.factionId];
  target.amount = quote.remaining;
  if (!target.amount) target.lastCrimeAbs = null;
  state.nobleFavor ||= {};
  state.nobleFavor[PIRATE_CONFIG.nobleId] = Math.max(-100, (Number(state.nobleFavor[PIRATE_CONFIG.nobleId]) || 0) - JUDICIAL_CONFIG.favorLoss);
  state.wanted.judicialUntil = absDay(state) + JUDICIAL_CONFIG.cooldownDays;
  return true;
}
