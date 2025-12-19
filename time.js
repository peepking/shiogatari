import { advanceDay as baseAdvanceDay, state } from "./state.js";
import { questTickDay } from "./quests.js";
import { TROOP_STATS, totalTroops } from "./troops.js";
import { pushLog } from "./dom.js";

/**
 * 日付更新と、それに連動するイベント処理を進める。
 * @param {number} [days=1]
 */
export function advanceDayWithEvents(days = 1) {
  const prevSeason = state.season;
  const prevYear = state.year;
  baseAdvanceDay(days);
  // 季節が進んだ回数だけ維持費処理を行う。
  const prevIndex = prevYear * 4 + prevSeason;
  const nowIndex = state.year * 4 + state.season;
  const seasonSteps = Math.max(0, nowIndex - prevIndex);
  for (let i = 0; i < seasonSteps; i++) {
    applySeasonUpkeep();
  }
  // 日付進行に合わせて依頼の期限/季節更新を処理する。
  questTickDay(days);
}

/**
 * 季節の切り替わり時に維持費と食料消費を適用する。
 */
function applySeasonUpkeep() {
  let upkeepCost = 0;
  Object.entries(state.troops || {}).forEach(([type, levels]) => {
    const stat = TROOP_STATS[type];
    const upkeep = stat?.upkeep ?? 0;
    if (typeof levels === "number") {
      upkeepCost += upkeep * levels;
      return;
    }
    Object.values(levels || {}).forEach((cnt) => {
      upkeepCost += upkeep * Number(cnt || 0);
    });
  });
  const troopCount = totalTroops();
  const foodNeed = Math.floor(troopCount * 0.5);

  const fundsBefore = state.funds || 0;
  const foodBefore = state.supplies?.food || 0;
  const fundsPaid = Math.min(fundsBefore, upkeepCost);
  const foodPaid = Math.min(foodBefore, foodNeed);
  state.funds = Math.max(0, fundsBefore - upkeepCost);
  if (!state.supplies) state.supplies = {};
  state.supplies.food = Math.max(0, foodBefore - foodNeed);

  if (upkeepCost === 0 && foodNeed === 0) return;
  pushLog(
    "維持費・消費",
    `資金 -${fundsPaid} / 食料 -${foodPaid}（必要資金 ${upkeepCost}, 食料 ${foodNeed}）`,
    state.lastRoll ?? "-"
  );
}
