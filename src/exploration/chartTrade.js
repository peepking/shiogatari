import { state } from "../core/state.js";
import { CHART_CONFIG as CONFIG } from "../core/expansionConfig.js";
import { saveGameToStorage } from "../core/storage.js";
import { chooseChart, canAssignChart, claimFragment, normalizeChartTradeDeal } from "./charts.js";
import { allocateChart, syncChartReservations } from "./chartWorld.js";

/**
 * 商品生成時にだけ出現を抽選し、既存海図を優先して対象・本物1枚・価格を固定する。
 * 依頼・噂の予約は作らず、同じ購入元で取得済みの海図は候補から除く。
 * @param {string} source 購入元。 @returns {object|null} 断片の商品。
 */
export function createChartTradeDeal(source) {
  if (!["trader", "haven"].includes(source)) return null;
  const settings = CONFIG.merchants[source];
  if (!settings || Math.random() >= settings.chance) return null;
  syncChartReservations();
  const offer = chooseChart(state.expansion.charts, false, Math.random, source);
  return offer && normalizeChartTradeDeal({ id: "chart", price: settings.price, stock: 1,
    chartSource: source, chartOffer: offer }, source);
}

/**
 * 各無法港で季節に一度だけ在庫を生成し、不発・購入済みも保存して再表示で補充しない。
 * 保存に失敗しても同じ滞在中の抽選結果は保持し、購入時に保存を再試行する。
 * @param {object|null} settlement 現在の港。 @returns {object|null} 固定された商品。
 */
export function havenChartDeal(settlement) {
  if (!settlement?.pirateHaven) return null;
  const data = state.expansion.charts;
  data.havenStocks ||= {};
  const season = state.year * 4 + state.season;
  if (data.havenStocks[settlement.id]?.season !== season) {
    data.havenStocks[settlement.id] = { season, deal: createChartTradeDeal("haven") };
    saveGameToStorage();
  }
  return data.havenStocks[settlement.id].deal;
}

/**
 * 取引画面が参照する在庫と現在地を照合し、未予約枠・同一購入元の上限を再検証する。
 * @param {object} deal 商品。 @param {string} source 購入元。
 * @param {object|null} [settlement] 港。 @param {object|null} [trade] 行商人取引。 @returns {string} 不可理由。
 */
export function chartTradeError(deal, source, settlement = null, trade = null) {
  if (!normalizeChartTradeDeal(deal, source) || deal.stock !== 1) return "海図の断片の在庫がありません。";
  if (source === "trader") {
    if (trade !== state.eventTrade || trade?.source !== "merchant" || !trade.deals?.includes(deal)) return "行商人との取引は終了しています。";
  } else {
    const inventory = state.expansion.charts.havenStocks?.[settlement?.id];
    if (!settlement?.pirateHaven || settlement.coords?.x !== state.position.x || settlement.coords?.y !== state.position.y ||
      inventory?.season !== state.year * 4 + state.season || inventory.deal !== deal) return "海図の断片を販売していた無法港で取引してください。";
  }
  syncChartReservations();
  const data = state.expansion.charts;
  const chart = data.active.find(c => c.size === deal.chartOffer.size);
  return !canAssignChart(data, deal.chartOffer) || chart?.merchantClaims?.includes(source)
    ? "手元の海図には、この断片を加えられません。" : "";
}

/**
 * 海図・代金・同時取引・在庫・統計を一括保存し、失敗時は更新前へ戻す。
 * 通知は保存成功後に呼び出し元で行い、連打・再読込で同じ在庫を購入させない。
 * @param {object} deal 商品。 @param {string} source 購入元。 @param {Function} apply 同時取引の反映。
 * @param {object|null} [settlement] 港。 @param {object|null} [trade] 行商人取引。
 * @returns {{chart:object|null,error:string}} 保存済みの海図と不可理由。
 */
export function commitChartTrade(deal, source, apply, settlement = null, trade = null) {
  const error = chartTradeError(deal, source, settlement, trade);
  if (error) return { chart: null, error };
  const before = JSON.parse(JSON.stringify({ funds: state.funds, supplies: state.supplies, charts: state.expansion.charts,
    voyageStats: state.voyageStats, piracy: state.piracy, eventTrade: state.eventTrade, stock: settlement?.stock }));
  try {
    const chart = allocateChart(deal.chartOffer);
    if (!chart || !claimFragment(chart, source)) throw new Error("chart-unavailable");
    deal.stock = 0;
    apply();
    if (!Number.isSafeInteger(state.funds) || state.funds < 0 || !saveGameToStorage()) throw new Error("chart-save-failed");
    return { chart, error: "" };
  } catch {
    state.funds = before.funds;
    state.supplies = before.supplies;
    state.expansion.charts = before.charts;
    state.voyageStats = before.voyageStats;
    state.piracy = before.piracy;
    if (trade && before.eventTrade) {
      Object.assign(trade, before.eventTrade);
      state.eventTrade = trade;
    } else state.eventTrade = before.eventTrade;
    if (settlement) settlement.stock = before.stock;
    return { chart: null, error: "取引を保存できませんでした。資金・商品・海図は取引前に戻しました。" };
  }
}
