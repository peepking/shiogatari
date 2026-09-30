/** 手配追跡が終了してから次に抽選できるまでの日数。 */
export const PURSUIT_COOLDOWN_DAYS = 3;

/** 通常の戦争遭遇とは独立した追跡抽選の可否。
 * @param {object} state 状態。 @param {number} now 絶対日。 @returns {boolean} 抽選可能か。
 */
export function canRollPursuit(state, now) {
  return !state.pendingEncounter?.active && !state.wanted?.detention && !state.eventQueue?.length && now >= (state.wanted?.pursuitUntil || 0);
}

/** 結果に関係なく追跡の終了時に猶予を与える。二度処理しても期限は延長しない。
 * @param {object} state 状態。 @param {object} encounter 遭遇。 @param {number} now 絶対日。 @returns {boolean} 更新したか。
 */
export function finishPursuit(state, encounter, now) {
  if (!["regular", "hunter"].includes(encounter?.pursuitKind) || encounter.pursuitResolved || !state.wanted) return false;
  state.wanted.pursuitUntil = Math.max(state.wanted.pursuitUntil || 0, now + PURSUIT_COOLDOWN_DAYS);
  encounter.pursuitResolved = true;
  return true;
}
import { WANTED_FACTIONS } from "./playerWanted.js";
import { BOUNTY_CONFIG } from "./bountyConfig.js";

/** 遭遇成立時の追加抽選率と兵数。名声には比例させず、最高段階で頭打ちにする。 */
export const HUNTER_TIERS = Object.freeze([
  Object.freeze({ bounty: 1, chance: 0.05, min: 20, max: 40 }),
  Object.freeze({ bounty: 3000, chance: 0.10, min: 40, max: 70 }),
  Object.freeze({ bounty: 6000, chance: 0.15, min: 70, max: 110 }),
  Object.freeze({ bounty: 10000, chance: 0.20, min: 110, max: 160 }),
]);

/** 期限内の4勢力の合計から最も高い段階を選ぶ。期限切れの手配は状態を変更せず除外する。
 * @param {object} state 状態。 @param {number} now 絶対日。 @returns {object|null} 段階。
 */
export function hunterTier(state, now) {
  const amount = WANTED_FACTIONS.reduce((sum, id) => {
    const row = state.wanted?.byFaction?.[id];
    return sum + (row?.amount > 0 && Number.isSafeInteger(row.lastCrimeAbs) && now - row.lastCrimeAbs < BOUNTY_CONFIG.lifetime ? row.amount : 0);
  }, 0);
  return [...HUNTER_TIERS].reverse().find(tier => amount >= tier.bounty) || null;
}
