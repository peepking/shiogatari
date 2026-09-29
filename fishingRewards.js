import { FISH_SPECIES } from "./fishingConfig.js";

/** 図鑑追加報酬の調整値。 */
export const FISHING_REWARDS = Object.freeze({ thresholds: [0.25, 0.5, 0.75, 1], recruits: 5, sale: 1.2, faith: 5, baitPerShip: 0.05, shipLimit: 5 });

/** 達成履歴を保持し、旧セーブの図鑑からも解放する。 @param {object} value 保存値。 @param {object} codex 図鑑。 @returns {object} 保存用報酬状態。 */
export function normalizeFishingRewards(value, codex) {
  const ratio = FISH_SPECIES.filter(s => codex?.[s.id]?.count > 0).length / FISH_SPECIES.length;
  return { unlocked: FISHING_REWARDS.thresholds.map((t, i) => value?.unlocked?.[i] === true || ratio >= t),
    recruitment: value?.recruitment && typeof value.recruitment === "object" ? value.recruitment : {},
    lastSeason: Number.isSafeInteger(value?.lastSeason) ? value.lastSeason : null };
}

/** 解放時の季節を記録し、その季節に完成報酬を重複付与しない。 @param {object} state 状態。 @returns {object} 報酬状態。 */
export function fishingRewards(state) {
  const data = state.expansion?.fishing;
  if (!data) return normalizeFishingRewards(null, {});
  const wasComplete = data.rewards?.unlocked?.[3];
  data.rewards = normalizeFishingRewards(data.rewards, data.codex);
  if (data.rewards.lastSeason === null || (!wasComplete && data.rewards.unlocked[3])) data.rewards.lastSeason = state.year * 4 + state.season;
  return data.rewards;
}

/** 拠点IDの固定ハッシュで兵種を二択し、季節が変わった時だけ5人へ補充する。 @param {object} state 状態。 @param {object} settlement 拠点。 @returns {object|null} 雇用枠。 */
export function fishingRecruitSlot(state, settlement) {
  if (!settlement || settlement.pirateHaven || !["town", "village"].includes(settlement.kind)) return null;
  const rewards = fishingRewards(state);
  if (!rewards.unlocked[0]) return null;
  const id = String(settlement.id), season = state.year * 4 + state.season;
  let hash = 0;
  for (const ch of id) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  const type = hash % 2 ? "seaArcher" : "marine";
  const old = rewards.recruitment[id];
  const remaining = old?.season === season && Number.isSafeInteger(old.remaining) ? Math.max(0, Math.min(FISHING_REWARDS.recruits, old.remaining)) : FISHING_REWARDS.recruits;
  if (old?.season === season) { Object.assign(old, {type, level: 1, remaining}); return old; }
  return rewards.recruitment[id] = { type, level: 1, remaining, season };
}

/** 完成後は新季節に一度だけ信仰を付与する。 @param {object} state 状態。 @returns {number} 獲得信仰。 */
export function grantFishingSeason(state) {
  const rewards = fishingRewards(state), season = state.year * 4 + state.season;
  if (!rewards.unlocked[3] || rewards.lastSeason >= season) return 0;
  rewards.lastSeason = season;
  state.faith = (state.faith || 0) + FISHING_REWARDS.faith;
  return FISHING_REWARDS.faith;
}
