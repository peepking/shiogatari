import { CRIME_REWARDS, CRIME_HISTORY_LIMIT, BOUNTY_CONFIG } from "../bounty/bountyConfig.js";
import { recordVoyage } from "../core/voyageStats.js";

/** 手配の対象勢力。未知IDへ犯罪を振り替えない。 */
export const WANTED_FACTIONS = Object.freeze(["north", "archipelago", "citadel", "pirates"]);

/** @param {object} wanted 手配状態。 @returns {number} 表示用の合計賞金。 */
export function totalWanted(wanted) {
  return WANTED_FACTIONS.reduce((sum, id) => Math.min(Number.MAX_SAFE_INTEGER, sum + (wanted?.byFaction?.[id]?.amount || 0)), 0);
}

/** 旧セーブの好感度・取引記録から犯罪を推定しない。 @param {object} value 保存値。 @returns {object} 手配状態。 */
export function normalizeWanted(value) {
  const byFaction = Object.fromEntries(WANTED_FACTIONS.map(id => {
    const saved = value?.version === 2 ? value.byFaction?.[id] : null;
    const valid = Number.isSafeInteger(saved?.amount) && saved.amount > 0 && Number.isSafeInteger(saved?.lastCrimeAbs) && saved.lastCrimeAbs >= 1;
    return [id, { amount: valid ? saved.amount : 0, lastCrimeAbs: valid ? saved.lastCrimeAbs : null }];
  }));
  const history = (Array.isArray(value?.history) ? value.history : [])
    .filter(row => row && Object.hasOwn(CRIME_REWARDS, row.kind) && Number.isSafeInteger(row.day) && row.day >= 1)
    .map(row => ({ kind: row.kind, day: row.day,
      factionId: value?.version === 2 && WANTED_FACTIONS.includes(row.factionId) ? row.factionId : null,
      amount: value?.version === 2 && Number.isSafeInteger(row.amount) && row.amount > 0 ? row.amount : null }))
    .sort((a, b) => b.day - a.day).slice(0, CRIME_HISTORY_LIMIT);
  const emergencyFood = Object.fromEntries(Object.entries(value?.emergencyFood || {}).filter(([id, row]) => id.length <= 100 && row && Number.isSafeInteger(row.season) && row.season >= 0 && Number.isSafeInteger(row.used) && row.used >= 0).map(([id, row]) => [id, { season: row.season, used: row.used }]));
  const savedDetention = value?.detention;
  const detention = WANTED_FACTIONS.includes(savedDetention?.factionId) && Number.isSafeInteger(savedDetention.remaining) && savedDetention.remaining >= 0 && savedDetention.remaining <= 120
    ? { factionId: savedDetention.factionId, remaining: savedDetention.remaining } : null;
  const pursuitUntil = Number.isSafeInteger(value?.pursuitUntil) && value.pursuitUntil >= 0 ? value.pursuitUntil : null;
  const settlementActions = Object.fromEntries(Object.entries(value?.settlementActions || {}).filter(([id, row]) => id.length <= 100 && row && typeof row === "object").map(([id, row]) => [id, Object.fromEntries(["theftSeason", "raidSeason", "bannedUntil"].filter(key => Number.isSafeInteger(row[key]) && row[key] >= 0).map(key => [key, row[key]]))]));
  const amnestySeasons = Object.fromEntries(WANTED_FACTIONS.filter(id => Number.isSafeInteger(value?.amnestySeasons?.[id]) && value.amnestySeasons[id] >= 0).map(id => [id, value.amnestySeasons[id]]));
  const forgeryUntil = Number.isSafeInteger(value?.forgeryUntil) && value.forgeryUntil >= 0 ? value.forgeryUntil : null;
  const judicialUntil = Number.isSafeInteger(value?.judicialUntil) && value.judicialUntil >= 0 ? value.judicialUntil : null;
  return { version: 2, byFaction, history, emergencyFood, detention, pursuitUntil, settlementActions, amnestySeasons, forgeryUntil, judicialUntil };
}

/** 成立済みの行動オブジェクトに適用印を残す。戦闘の勝敗では加算しない。 @param {object} state 状態。 @param {string} kind 犯罪種別。 @param {object} action 成立行動。 @param {number} now 絶対日。 @param {string} factionId 対象勢力。 @returns {number} 加算額。 */
export function recordCrime(state, kind, action, now, factionId) {
  const amount = CRIME_REWARDS[kind];
  if (!amount || !action || action.crimeRecorded || !WANTED_FACTIONS.includes(factionId) || !Number.isSafeInteger(now) || now < 1) return 0;
  state.wanted = normalizeWanted(state.wanted);
  expireWanted(state.wanted, now);
  action.crimeRecorded = true;
  const target = state.wanted.byFaction[factionId];
  const previous = target.amount;
  target.amount = Math.min(Number.MAX_SAFE_INTEGER, target.amount + amount);
  recordVoyage(state, "wantedEarned", target.amount - previous);
  target.lastCrimeAbs = now;
  state.wanted.history = [{ kind, day: now, factionId, amount }, ...(state.wanted.history || [])].slice(0, CRIME_HISTORY_LIMIT);
  return amount;
}

/** 最後の犯罪から600日経過したら掲載と手配を解除する。 @param {object} wanted 手配状態。 @param {number} now 絶対日。 @returns {boolean} 解除したか。 */
export function expireWanted(wanted, now) {
  let expired = false;
  for (const id of WANTED_FACTIONS) {
    const record = wanted?.byFaction?.[id];
    if (!record?.amount || now - record.lastCrimeAbs < BOUNTY_CONFIG.lifetime) continue;
    record.amount = 0; record.lastCrimeAbs = null; expired = true;
  }
  return expired;
}
