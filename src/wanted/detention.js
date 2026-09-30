import { WANTED_FACTIONS } from "./playerWanted.js";
import { BOUNTY_CONFIG } from "../bounty/bountyConfig.js";
import { absDay, DAY_PER_SEASON, DAY_PER_YEAR } from "../core/calendar.js";

/** 投獄の初期調整値。 */
export const DETENTION_CONFIG = Object.freeze({ baseDays: 30, stepBounty: 3000, stepDays: 30, maxDays: 120 });

/** @param {object} state 状態。 @param {string} factionId 対象。 @returns {object|null} 期間と支払い回数。 */
export function quoteDetention(state, factionId) {
  const amount = state.wanted?.byFaction?.[factionId]?.amount || 0;
  if (!WANTED_FACTIONS.includes(factionId) || !amount || absDay(state) - state.wanted.byFaction[factionId].lastCrimeAbs >= BOUNTY_CONFIG.lifetime) return null;
  const days = Math.min(DETENTION_CONFIG.maxDays, DETENTION_CONFIG.baseDays + Math.floor(amount / DETENTION_CONFIG.stepBounty) * DETENTION_CONFIG.stepDays);
  const end = absDay(state) + days;
  return { amount, days, end, year: Math.floor((end - 1) / DAY_PER_YEAR), season: Math.floor((end - 1) % DAY_PER_YEAR / DAY_PER_SEASON), day: (end - 1) % DAY_PER_SEASON + 1, upkeepCount: Math.floor((state.day - 1 + days) / DAY_PER_SEASON) };
}

/** 全日を同期処理し、確定保存に失敗したら開始時の状態と世界へ戻す。開始状態の保存から再開でき、没収は再実行しない。
 * @param {object} state 状態。 @param {object} services 時間・世界・保存操作。 @returns {boolean} 釈放を保存できたか。
 */
export function finishDetention(state, { advance, snapshotWorld, restoreWorld, save }) {
  if (!state.wanted?.detention) return true;
  const previous = structuredClone(state), world = structuredClone(snapshotWorld());
  try {
    while (state.wanted.detention.remaining > 0) {
      advance(1);
      state.wanted.detention.remaining--;
    }
    const factionId = state.wanted.detention.factionId;
    state.wanted.byFaction[factionId] = { amount: 0, lastCrimeAbs: null };
    state.wanted.detention = null;
    if (save()) return true;
  } catch (error) {
    console.error("投獄処理を取り消しました", error);
  }
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, previous);
  restoreWorld(world);
  return false;
}
