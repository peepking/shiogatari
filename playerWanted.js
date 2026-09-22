import { CRIME_REWARDS, CRIME_HISTORY_LIMIT, BOUNTY_CONFIG } from "./bountyConfig.js";

/** 旧セーブの好感度・取引記録から犯罪を推定しない。 @param {object} value 保存値。 @returns {object} 手配状態。 */
export function normalizeWanted(value) {
  const valid = Number.isSafeInteger(value?.amount) && value.amount > 0 && Number.isSafeInteger(value?.lastCrimeAbs);
  const history = (Array.isArray(value?.history) ? value.history : [])
    .filter(row => row && Object.hasOwn(CRIME_REWARDS, row.kind) && Number.isSafeInteger(row.day) && row.day >= 1)
    .map(row => ({ kind: row.kind, day: row.day }))
    .sort((a, b) => b.day - a.day).slice(0, CRIME_HISTORY_LIMIT);
  return { amount: valid ? value.amount : 0, lastCrimeAbs: valid ? value.lastCrimeAbs : null, history };
}

/** 成立済みの行動オブジェクトに適用印を残す。戦闘の勝敗では加算しない。 @param {object} state 状態。 @param {string} kind 犯罪種別。 @param {object} action 成立行動。 @param {number} now 絶対日。 @returns {number} 加算額。 */
export function recordCrime(state, kind, action, now) {
  const amount = CRIME_REWARDS[kind];
  if (!amount || !action || action.crimeRecorded) return 0;
  state.wanted ||= normalizeWanted();
  expireWanted(state.wanted, now);
  action.crimeRecorded = true;
  state.wanted.amount = Math.min(Number.MAX_SAFE_INTEGER, state.wanted.amount + amount);
  state.wanted.lastCrimeAbs = now;
  state.wanted.history = [{ kind, day: now }, ...(state.wanted.history || [])].slice(0, CRIME_HISTORY_LIMIT);
  return amount;
}

/** 最後の犯罪から600日経過したら掲載と手配を解除する。 @param {object} wanted 手配状態。 @param {number} now 絶対日。 @returns {boolean} 解除したか。 */
export function expireWanted(wanted, now) {
  if (!wanted?.amount || now - wanted.lastCrimeAbs < BOUNTY_CONFIG.lifetime) return false;
  wanted.amount = 0; wanted.lastCrimeAbs = null; return true;
}
