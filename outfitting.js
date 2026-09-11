import { OUTFITTING_CONFIG, OUTFITTING_ITEMS } from "./expansionConfig.js";
import { normalizeOutfitting } from "./expansionState.js";

/**
 * 装備中の効果を枠順で集計する。割合は加算し、射撃は独立して発動させる。
 * 船数・陸海・再描画の回数による倍率は付けない。
 * @param {object} outfitting 艤装状態。
 * @returns {object} 比較表示と実効果で共有する集計値。
 */
export function getOutfittingEffects(outfitting) {
  const result = { atk: 0, def: 0, meleeAtk: 0, meleeDef: 0, rangedAtk: 0, rangedDef: 0,
    supplyCap: 0, troopCap: 0, foodReduction: 0, upkeepReduction: 0, medics: 0, scouts: 0, attacks: [] };
  for (const id of normalizeOutfitting(outfitting).equipped) {
    if (!id) continue;
    const item = OUTFITTING_ITEMS[id];
    for (const [key, value] of Object.entries(item.effects || {})) result[key] += value;
    if (item.attack) result.attacks.push({ id, ...item.attack });
  }
  return result;
}

/**
 * 元の上限に割合増加を一度だけ適用し、最後に切り捨てる。
 * @param {number} base 元の上限。
 * @param {number} percent 増加率の合計。
 * @returns {number} 変更後の上限。
 */
export function applyCapacityBonus(base, percent) {
  return Math.floor(base * (100 + percent) / 100);
}

/**
 * 合計した消費額に割合軽減を一度だけ適用し、最後に切り捨てる。
 * 兵種・部隊ごとに丸めず、軽減率は0～100%に制限する。
 * @param {number} total 軽減前の必要量合計。
 * @param {number} percent 軽減率。
 * @returns {number} 軽減後の必要量。
 */
export function applyConsumptionReduction(total, percent) {
  return Math.floor(total * (100 - Math.min(100, Math.max(0, percent))) / 100);
}

/**
 * 実兵員と設備の仮想人数を合算し、最大10人分で打ち止めにする。
 * 実際の保有人数・維持費・食料消費は変更しない。
 * @param {number} troops 実兵員数。
 * @param {number} equipment 設備の加算人数。
 * @returns {number} 効果人数。
 */
export function effectiveSupportCount(troops, equipment) {
  return Math.min(OUTFITTING_CONFIG.supportLimit, Math.max(0, troops) + Math.max(0, equipment));
}
