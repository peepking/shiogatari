import { resourceIcon } from "./resourceUI.js";
import { getOutfittingEffects, applyConsumptionReduction } from "./outfitting.js";

/** 食料を消費する季節内の日付。 */
export const FOOD_CONSUMPTION_DAYS = Object.freeze([10, 30]);

/**
 * 現在の編成から次回の維持費と食料消費を算出する。将来の雇用・損耗は含めない。
 * @param {object} state 現在の状態。
 * @param {object} stats 兵種定義。
 * @returns {object} 必要量・不足量・次回までの日数。
 */
export function getUpkeepForecast(state, stats) {
  let count = 0;
  let funds = 0;
  for (const [type, levels] of Object.entries(state.troops || {})) {
    const qty = typeof levels === "number" ? levels : Object.values(levels || {}).reduce((sum, n) => sum + Number(n || 0), 0);
    count += qty;
    funds += qty * (stats[type]?.upkeep || 0);
  }
  const day = state.day;
  const nextFoodDay = FOOD_CONSUMPTION_DAYS.find(d => d > day) ?? FOOD_CONSUMPTION_DAYS[0] + 30;
  const effects = getOutfittingEffects(state.expansion?.outfitting, state.fleet);
  funds = applyConsumptionReduction(funds, effects.upkeepReduction);
  const food = applyConsumptionReduction(Math.floor(count / 4), effects.foodReduction);
  return { funds, food, fundsDays: 31 - day, foodDays: nextFoodDay - day,
    fundsShortage: Math.max(0, funds - (state.funds || 0)),
    foodShortage: Math.max(0, food - (state.supplies?.food || 0)) };
}

/**
 * 資産詳細に次回の支払いと現在の不足分を表示する。
 * @param {object} state 現在の状態。
 * @param {object} stats 兵種定義。
 * @returns {string} 表示用HTML。
 */
export function renderUpkeepForecast(state, stats) {
  const forecast = getUpkeepForecast(state, stats);
  return `<div class="sideBlock mb-8"><div class="note">次回の維持費・食料消費</div>
    <div>${resourceIcon("funds")}資金 ${forecast.funds} / あと${forecast.fundsDays}日${forecast.fundsShortage ? `（現在${forecast.fundsShortage}不足）` : "（払い可能）"}</div>
    <div>${resourceIcon("food")}食料 ${forecast.food} / あと${forecast.foodDays}日${forecast.foodShortage ? `（現在${forecast.foodShortage}不足）` : "（補給可能）"}</div>
    <div class="tiny">維持費は毎季節1日、食料は毎季節10・30日に消費。</div></div>`;
}
