import { faithEffects } from "./faith.js";
import { SHIP_TYPES, SHIP_UPKEEP_RATE, SHIP_SELL_RATE } from "./shipConfig.js";
import { normalizeFleet } from "./fleet.js";
import { getOutfittingEffects, applyConsumptionReduction } from "./outfitting.js";

/** @param {object} state 状態。 @returns {number} 定価総額の維持費に船専用軽減を適用し、最後に一度だけ切り捨てる。聖船は対象外。 */
export function shipUpkeepCost(state) {
  const fleet = normalizeFleet(state.fleet);
  const price = Object.entries(fleet.counts).reduce((sum, [id, count]) => sum + SHIP_TYPES[id].price * count, 0);
  const effects = getOutfittingEffects(state.expansion?.outfitting, fleet);
  return applyConsumptionReduction(price * SHIP_UPKEEP_RATE, effects.shipUpkeepReduction + faithEffects(state).upkeep * 100);
}

/**
 * 部隊維持費支払い後の資金から船維持費を払う。不足時は定価の安い船から必要数だけ既存売却率で換金する。
 * 同額なら定義順。支払額は売却前に確定し、売却による軽減喪失は次季節から反映する。
 * 街の在庫へは加えず、余剰資金を保持する。物資・兵員・艤装には触れない。
 * @param {object} state 状態。 @param {number} cost 今季の確定額。 @returns {object} 売却内訳と支払額。
 */
export function payShipUpkeep(state, cost = shipUpkeepCost(state)) {
  const fleet = normalizeFleet(state.fleet);
  const sold = [];
  let funds = Math.max(0, state.funds || 0);
  for (const [id, ship] of Object.entries(SHIP_TYPES).sort((a, b) => a[1].price - b[1].price)) {
    if (funds >= cost) break;
    const price = Math.floor(ship.price * SHIP_SELL_RATE);
    if (price <= 0) continue;
    const count = Math.min(fleet.counts[id], Math.ceil((cost - funds) / price));
    if (!count) continue;
    fleet.counts[id] -= count;
    funds += price * count;
    sold.push({ id, count, proceeds: price * count });
  }
  const paid = Math.min(funds, cost);
  state.funds = funds - paid;
  state.fleet = fleet;
  return { cost, paid, shortage: cost - paid, sold };
}
