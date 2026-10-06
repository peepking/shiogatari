import { formatSupplyDisplay } from "../resources/supplies.js";
import { formatTroopDisplay } from "../resources/troops.js";

/**
 * 実際に上限を超えた対象だけ、超過量と移動前の整理方法を知らせる。
 * 報酬で船や艤装の容量が変わった場合も、受取後の現在値で判定する。
 * @param {{total:number,cap:number}} [supplies] 現在の物資数と上限。
 * @param {{total:number,cap:number}} [troops] 現在の兵員数と上限。
 * @returns {string} 超過がなければ空文字列。
 */
export function capacityOverflowText(supplies = formatSupplyDisplay(), troops = formatTroopDisplay()) {
  const excessSupplies = Math.max(0, supplies.total - supplies.cap);
  const excessTroops = Math.max(0, troops.total - troops.cap);
  const notices = [];
  if (excessSupplies) notices.push(`物資${excessSupplies}個が上限超過。移動前に物資詳細で破棄するか、拠点で売却してください。`);
  if (excessTroops) notices.push(`兵員${excessTroops}人が上限超過。移動前に部隊詳細で解雇してください。`);
  return notices.join("\n");
}
