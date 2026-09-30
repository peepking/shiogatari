import { WANTED_FACTIONS } from "./playerWanted.js";
import { absDay, SEASONS_PER_YEAR } from "./calendar.js";
import { BOUNTY_CONFIG } from "./bountyConfig.js";

/** 港外で受けられる恩赦依頼の初期調整値。 */
export const AMNESTY_CONFIG = Object.freeze({ food: 50, reduction: 1000, days: 60 });

/** @param {object} state 状態。 @param {string} id 勢力。 @returns {number} 期限内の賞金。 */
function currentBounty(state, id) {
  const row = state.wanted?.byFaction?.[id];
  return row?.amount > 0 && absDay(state) - row.lastCrimeAbs < BOUNTY_CONFIG.lifetime ? row.amount : 0;
}

/** 施設制限・名誉家臣とは独立し、同時1件・勢力ごと季節1回で受注する。
 * @param {object} state 状態。 @param {object} settlement 発注拠点。 @returns {string} 不可理由。
 */
export function amnestyReason(state, settlement) {
  if (!settlement?.id || !WANTED_FACTIONS.includes(settlement.factionId) || !currentBounty(state, settlement.factionId)) return "この勢力からの手配はありません。";
  if (state.pendingEncounter?.active || state.wanted?.detention || state.eventQueue?.length) return "進行中の出来事を解決してください。";
  if (state.quests?.active?.some(q => q.type === "amnesty")) return "恩赦依頼をすでに受注しています。";
  if (state.wanted?.amnestySeasons?.[settlement.factionId] === state.year * SEASONS_PER_YEAR + state.season) return "この勢力の恩赦依頼は今季受注済みです。";
  return "";
}

/** 受注時に期限・対象・減額額を固定し、物資は報告時に消費する。
 * @param {object} state 状態。 @param {object} settlement 拠点。 @returns {object|null} 新規依頼。
 */
export function acceptAmnesty(state, settlement) {
  if (amnestyReason(state, settlement) || !state.quests) return null;
  const now = absDay(state);
  const q = { id: state.quests.nextId++, type: "amnesty", title: `恩赦：${settlement.name}への食料納入`, originId: settlement.id, amnestyFactionId: settlement.factionId, itemId: "food", qty: AMNESTY_CONFIG.food, reduction: AMNESTY_CONFIG.reduction, acceptedAbs: now, deadlineAbs: now + AMNESTY_CONFIG.days, reward: 0, desc: "港外で報告できます。賞金だけを減らし、犯罪履歴・好感度・利用禁止期間は変更しません。" };
  state.quests.active.push(q);
  state.wanted.amnestySeasons ||= {};
  state.wanted.amnestySeasons[settlement.factionId] = state.year * SEASONS_PER_YEAR + state.season;
  return q;
}

/** @param {object} state 状態。 @param {object} q 依頼。 @param {object} here 現地。 @returns {boolean} 元の報告先で期限内に納品できるか。 */
export function canCompleteAmnesty(state, q, here) {
  return q?.type === "amnesty" && q.originId === here?.id && absDay(state) <= q.deadlineAbs && currentBounty(state, q.amnestyFactionId) > 0 && (state.supplies?.[q.itemId] || 0) >= q.qty && !state.pendingEncounter?.active && !state.wanted?.detention;
}

/** 報告を一度だけ反映する。別勢力の賞金と履歴は変更しない。
 * @param {object} state 状態。 @param {object} q 依頼。 @param {object} here 現地。 @returns {number} 実際の減額。
 */
export function completeAmnesty(state, q, here) {
  if (!state.quests.active.includes(q) || !canCompleteAmnesty(state, q, here)) return 0;
  const row = state.wanted.byFaction[q.amnestyFactionId];
  const reduction = Math.min(row.amount, q.reduction);
  state.supplies[q.itemId] -= q.qty;
  row.amount -= reduction;
  if (!row.amount) row.lastCrimeAbs = null;
  state.quests.active = state.quests.active.filter(item => item !== q);
  return reduction;
}
