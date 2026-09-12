import { SHIP_TYPES, SHIP_SELL_RATE, SHIP_STOCK_TIERS } from "./shipConfig.js";
import { normalizeFleet, shipCount } from "./fleet.js";

/** @param {object} state 日付状態。 @returns {number} 年をまたぐ季節番号。 */
export function shipyardSeason(state) { return state.year * 4 + state.season; }

/**
 * 街ごとに価格帯2/1/1枠を重複なし均等抽選し、定番と目標在庫を固定する。
 * 初期化済みは同じ品揃えを維持し、新季節だけ不足を補充する。買取在庫は保持する。
 * @param {object} settlement 街。 @param {number} season 季節番号。 @param {Function} random 乱数。
 * @returns {object|null} 造船所。
 */
export function refreshShipyard(settlement, season, random = Math.random) {
  if (settlement?.kind !== "town") return null;
  const saved = settlement.shipyard;
  const valid = Array.isArray(saved?.regular) && saved.regular.length === 4 && new Set(saved.regular.map(r => r.type)).size === 4
    && saved.regular.every(r => Object.hasOwn(SHIP_TYPES, r.type) && shipCount(r.targetStock) > 0);
  if (!valid) {
    const regular = [];
    for (const tier of SHIP_STOCK_TIERS) {
      const pool = [...tier.types];
      for (let i = 0; i < tier.slots; i++) {
        const type = pool.splice(Math.min(pool.length - 1, Math.floor(random() * pool.length)), 1)[0];
        regular.push({ type, targetStock: tier.min + Math.floor(random() * (tier.max - tier.min + 1)) });
      }
    }
    settlement.shipyard = { regular, stock: Object.fromEntries(regular.map(r => [r.type, r.targetStock])), lastRestockSeason: season };
  }
  const yard = settlement.shipyard;
  yard.stock = Object.fromEntries(Object.keys(SHIP_TYPES).map(id => [id, shipCount(yard.stock?.[id])]));
  if (!Number.isFinite(yard.lastRestockSeason) || yard.lastRestockSeason < season) {
    for (const row of yard.regular) yard.stock[row.type] = Math.max(yard.stock[row.type], row.targetStock);
    yard.lastRestockSeason = season;
  }
  return yard;
}

/** @param {string} type 船種。 @param {string} mode 売買方向。 @returns {number} 単価。 */
export function shipTradePrice(type, mode) { return Math.floor(SHIP_TYPES[type].price * (mode === "sell" ? SHIP_SELL_RATE : 1)); }

/**
 * 売買を検証して変更後の独立状態を返す。容量超過は許可し、兵員・物資は変更しない。
 * @param {object} state 状態。 @param {object} settlement 街。 @param {string} type 船種。
 * @param {string} mode 売買方向。 @param {number} quantity 数量。 @returns {object} 検証結果と変更値。
 */
export function quoteShipTrade(state, settlement, type, mode, quantity) {
  if (settlement?.kind !== "town" || !settlement.shipyard) return { error: "街の造船所で取引してください。" };
  if (!Object.hasOwn(SHIP_TYPES, type) || !["buy", "sell"].includes(mode) || !Number.isSafeInteger(quantity) || quantity <= 0)
    return { error: "取引数は1以上の整数を入力してください。" };
  const fleet = normalizeFleet(state.fleet);
  const stock = { ...settlement.shipyard.stock };
  if (mode === "buy" && quantity > (stock[type] || 0)) return { error: "在庫が不足しています。" };
  if (mode === "sell" && quantity > fleet.counts[type]) return { error: "所持数が不足しています。" };
  const amount = shipTradePrice(type, mode) * quantity;
  const funds = state.funds + (mode === "buy" ? -amount : amount);
  if (funds < 0) return { error: "資金が不足しています。" };
  fleet.counts[type] += mode === "buy" ? quantity : -quantity;
  stock[type] = (stock[type] || 0) + (mode === "buy" ? -quantity : quantity);
  if (![amount, funds, fleet.counts[type], stock[type]].every(Number.isSafeInteger)) return { error: "取引数が大きすぎます。" };
  return { fleet, stock, funds, amount };
}

/** @param {object} state 状態。 @param {object} settlement 街。 @param {string} type 船種。 @param {string} mode 売買方向。 @param {number} quantity 数量。 @returns {object} 再検証し一括反映した結果。 */
export function tradeShip(state, settlement, type, mode, quantity) {
  const result = quoteShipTrade(state, settlement, type, mode, quantity);
  if (result.error) return result;
  state.fleet = result.fleet; state.funds = result.funds; settlement.shipyard.stock = result.stock;
  return result;
}
