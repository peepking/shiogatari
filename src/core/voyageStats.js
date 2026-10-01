import { absDay, DAY_PER_YEAR } from "./calendar.js";

const COUNTERS = ["income", "faithEarned", "wantedEarned", "enemyDefeated", "bountiesDefeated", "variantsAcquired", "refugeesRescued", "tidePeople", "tideFunds", "fishCaught", "chartsCompleted"];
export const LOSS_CAUSES = ["battle", "food", "upkeep", "calamity", "other"];
export const EXPENSE_CAUSES = ["trade", "hire", "upkeep", "support", "other"];

/** 非負整数へ補完し、累計の上限を守る。 @param {*} value 値。 @returns {number} 正規値。 */
export function statNumber(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }

/** 兵種・レベル内訳から保有兵数を数える。 @param {object} troops 内訳。 @returns {number} 総人数。 */
export function voyageTroops(troops) {
  return Object.values(troops || {}).reduce((sum, levels) => sum + (typeof levels === "number" ? statNumber(levels) : Object.values(levels || {}).reduce((n, count) => n + statNumber(count), 0)), 0);
}

/** 航海の計測領域を作る。旧保存は累計を復元せず途中計測とする。 @param {object} state 状態。 @param {boolean} partial 途中開始。 @returns {object} 統計。 */
export function createVoyageStats(state, partial = false) {
  const now = statNumber(absDay(state)) || 1000 * DAY_PER_YEAR + 1;
  return { version: 1, startedAbs: partial ? 1000 * DAY_PER_YEAR + 1 : now, measuredAbs: now, partial,
    ...Object.fromEntries(COUNTERS.map(key => [key, 0])), losses: Object.fromEntries(LOSS_CAUSES.map(key => [key, 0])),
    expenses: Object.fromEntries(EXPENSE_CAUSES.map(key => [key, 0])), battles: { win: 0, lose: 0, draw: 0 },
    visited: [], acquiredVariantIds: [], peaks: { ships: Object.values(state.fleet?.counts || {}).reduce((sum, count) => sum + statNumber(count), 0) + (state.fleet?.variants?.length || 0), troops: voyageTroops(state.troops), fame: statNumber(state.fame) }, largestFish: null };
}

/** 保存値を独立した統計へ補完する。 @param {*} value 保存値。 @param {object} state 状態。 @returns {object} 正規値。 */
export function normalizeVoyageStats(value, state) {
  const result = createVoyageStats(state, true);
  if (value?.version !== 1) return result;
  for (const key of COUNTERS) result[key] = statNumber(value[key]);
  for (const [group, keys] of [["losses", LOSS_CAUSES], ["expenses", EXPENSE_CAUSES], ["battles", ["win", "lose", "draw"]], ["peaks", ["ships", "troops", "fame"]]]) {
    result[group] = Object.fromEntries(keys.map(key => [key, statNumber(value[group]?.[key])]));
  }
  result.startedAbs = statNumber(value.startedAbs) || result.startedAbs;
  result.measuredAbs = statNumber(value.measuredAbs) || result.measuredAbs;
  result.partial = value.partial !== false;
  result.visited = [...new Set((Array.isArray(value.visited) ? value.visited : []).filter(id => typeof id === "string" && id.length <= 100))];
  result.acquiredVariantIds = [...new Set((Array.isArray(value.acquiredVariantIds) ? value.acquiredVariantIds : []).filter(id => statNumber(id) > 0))];
  const fish = value.largestFish;
  if (fish && typeof fish.id === "string" && fish.id.length <= 100 && Number.isFinite(fish.size) && fish.size > 0 && statNumber(fish.day)) result.largestFish = { id: fish.id, size: fish.size, day: fish.day };
  return result;
}

/** 成立した増分だけを加算する。初期化・読込・管理操作では呼ばない。 @param {object} state 状態。 @param {string} key 項目。 @param {number} amount 増分。 */
export function recordVoyage(state, key, amount) {
  const stats = state.voyageStats;
  if (!stats || !COUNTERS.includes(key) || !Number.isSafeInteger(amount) || amount <= 0) return;
  stats[key] = Math.min(Number.MAX_SAFE_INTEGER, statNumber(stats[key]) + amount);
}

/** 実際の支払いを原因別に記録する。 @param {object} state 状態。 @param {number} amount 支払額。 @param {string} cause 原因。 */
export function recordExpense(state, amount, cause = "other") {
  const stats = state.voyageStats;
  if (!stats || !Number.isSafeInteger(amount) || amount <= 0) return;
  const key = EXPENSE_CAUSES.includes(cause) ? cause : "other";
  stats.expenses[key] = Math.min(Number.MAX_SAFE_INTEGER, statNumber(stats.expenses[key]) + amount);
}

/** 救護後の恒久損耗だけを記録し、任意の派遣・解雇を含めない。 @param {object} state 状態。 @param {number} amount 実損。 @param {string} cause 原因。 */
export function recordTroopLoss(state, amount, cause = "other") {
  const stats = state.voyageStats;
  if (!stats || !Number.isSafeInteger(amount) || amount <= 0) return;
  const key = LOSS_CAUSES.includes(cause) ? cause : "other";
  stats.losses[key] = Math.min(Number.MAX_SAFE_INTEGER, statNumber(stats.losses[key]) + amount);
}

/** 入場済み拠点を重複なく保存する。 @param {object} state 状態。 @param {object} settlement 拠点。 */
export function recordVisit(state, settlement) {
  if (state.voyageStats && settlement?.id && !state.voyageStats.visited.includes(settlement.id)) state.voyageStats.visited.push(settlement.id);
}

/** 成功した釣果だけを記録し、同じ体長なら最初の魚を残す。 @param {object} state 状態。 @param {object} species 魚種。 @param {number} size 体長。 */
export function recordVoyageFish(state, species, size) {
  recordVoyage(state, "fishCaught", 1);
  if (state.voyageStats && Number.isFinite(size) && size > (state.voyageStats.largestFish?.size || 0)) state.voyageStats.largestFish = { id: species.id, size, day: absDay(state) };
}

/** 同じ固有船の買い戻しを累計獲得へ重複加算しない。 @param {object} state 状態。 @param {number} id 個体ID。 */
export function recordVariant(state, id) {
  const stats = state.voyageStats;
  if (!stats || stats.acquiredVariantIds.includes(id)) return;
  stats.acquiredVariantIds.push(id);
  recordVoyage(state, "variantsAcquired", 1);
}

/** 確定した受取額を資金と累計収入へ反映する。 @param {object} state 状態。 @param {number} amount 受取額。 */
export function receiveFunds(state, amount) {
  state.funds = (state.funds || 0) + amount;
  recordVoyage(state, "income", amount);
}

/** 実際に支払えた額だけ累計支出へ反映する。 @param {object} state 状態。 @param {number} amount 請求額。 @param {string} cause 原因。 */
export function spendFunds(state, amount, cause = "other") {
  const paid = Math.min(state.funds || 0, amount);
  state.funds = Math.max(0, (state.funds || 0) - amount);
  recordExpense(state, paid, cause);
}

/** 確定した信仰の獲得分を記録する。 @param {object} state 状態。 @param {number} amount 獲得量。 */
export function receiveFaith(state, amount) {
  state.faith = (state.faith || 0) + amount;
  recordVoyage(state, "faithEarned", amount);
}
