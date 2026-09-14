/** 信仰の恩恵で共有する調整値。 */
export const FAITH_CONFIG = Object.freeze({ cap: 500, upkeep: 0.10, sale: 0.05, rescue: 0.50, foodDivisor: 10, recruitChance: 0.25, recruitLevel: 3, recruitCount: 5, afterglow: 1.5 });

/** 年を含めた季節の通し番号を返す。 */
export function faithSeason(state) { return Math.trunc(Number(state.year) || 0) * 4 + Math.trunc(Number(state.season) || 0); }

/** 旧セーブを含め恩恵の保存領域を補完する。 */
export function normalizeFaith(data) {
  return { afterglowUntil: Number.isSafeInteger(data?.afterglowUntil) ? data.afterglowUntil : null,
    foodSeason: Number.isSafeInteger(data?.foodSeason) ? data.foodSeason : null,
    recruitment: data?.recruitment && typeof data.recruitment === 'object' ? data.recruitment : {} };
}

/** 現在信仰から効果量を算出する。次季節初日の精算中まで余潮を含める。 */
export function faithEffects(state) {
  const faith = Math.max(0, Number(state.faith) || 0);
  const ratio = Math.min(faith, FAITH_CONFIG.cap) / FAITH_CONFIG.cap;
  const until = state.faithBenefits?.afterglowUntil;
  const season = faithSeason(state);
  const afterglow = Number.isSafeInteger(until) && (season < until || (season === until && state.day === 1));
  const multiplier = afterglow ? FAITH_CONFIG.afterglow : 1;
  return { upkeep: FAITH_CONFIG.upkeep * ratio * multiplier, sale: FAITH_CONFIG.sale * ratio * multiplier,
    rescue: FAITH_CONFIG.rescue * ratio, food: Math.floor(faith / FAITH_CONFIG.foodDivisor),
    recruitChance: FAITH_CONFIG.recruitChance * ratio, afterglow, until };
}

/** 成功して信仰を支払った祈りに余潮を付与する。重複強化はしない。 */
export function activateAfterglow(state) {
  state.faithBenefits = normalizeFaith(state.faithBenefits);
  state.faithBenefits.afterglowUntil = faithSeason(state) + 1;
}

/** 維持費精算後に余潮を終了し、空き容量内で季節の食料を一度だけ支給する。 */
export function grantFaithSeason(state, capacity) {
  const data = state.faithBenefits = normalizeFaith(state.faithBenefits);
  const season = faithSeason(state);
  if (data.foodSeason === season) return null;
  data.afterglowUntil = null;
  data.foodSeason = season;
  data.recruitment = {};
  const amount = faithEffects(state).food;
  const total = Object.values(state.supplies || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const received = Math.min(amount, Math.max(0, Math.floor(capacity - total)));
  state.supplies ||= {};
  if (received) state.supplies.food = (state.supplies.food || 0) + received;
  return { amount, received, missed: amount - received };
}

/** 各拠点の季節初回だけ抽選し、成功時は戦闘兵種を等確率で選ぶ。失敗も記録する。 */
export function rollFaithRecruitment(state, settlement, stats, random = Math.random) {
  if (!settlement) return null;
  const data = state.faithBenefits = normalizeFaith(state.faithBenefits);
  const season = faithSeason(state);
  if (data.recruitment[settlement.id]?.season === season) return null;
  const entry = { season, slot: null };
  data.recruitment[settlement.id] = entry;
  if (random() >= faithEffects(state).recruitChance) return null;
  const pool = Object.keys(stats).filter(type => !['scout', 'medic'].includes(type));
  if (!pool.length) return null;
  entry.slot = { type: pool[Math.floor(random() * pool.length)], level: FAITH_CONFIG.recruitLevel, remaining: FAITH_CONFIG.recruitCount };
  return entry.slot;
}

/** 今季に有効な追加枠を通常雇用枠とは別の識別子で返す。 */
export function faithRecruitSlot(state, settlement) {
  const entry = state.faithBenefits?.recruitment?.[settlement?.id];
  return entry?.season === faithSeason(state) ? entry.slot : null;
}

/** 衛生兵救護後の損耗者を1人ずつ独立抽選し、勝利時だけ損耗を防ぐ。 */
export function rescueFaithLosses(losses, chance, won, random = Math.random) {
  if (!won || !(chance > 0)) return losses;
  const result = {};
  for (const [type, count] of Object.entries(losses)) {
    let lost = 0;
    for (let i = 0; i < count; i++) if (random() >= chance) lost++;
    if (lost) result[type] = lost;
  }
  return result;
}
