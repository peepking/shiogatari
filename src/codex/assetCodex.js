import { VARIANT_SHIPS } from "../fleet/variantShips.js";

/** @param {*} value 保存値。 @returns {string[]} 重複や不正値を除いた記録用識別子。 */
function identifiers(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(id => typeof id === "string" && /^[a-zA-Z][a-zA-Z_]{0,49}$/.test(id)))];
}

/**
 * 図鑑の保存値を独立した記録へ補完する。固有船の同じ個体は最初の来歴を残す。
 * @param {*} value 保存値。
 * @returns {object} 図鑑記録。
 */
export function normalizeAssetCodex(value) {
  const records = new Map();
  for (const record of Array.isArray(value?.variants) ? value.variants : []) {
    if (!Number.isSafeInteger(record?.id) || record.id < 1 || records.has(record.id) || !identifiers([record.variantId]).length) continue;
    records.set(record.id, { id: record.id, variantId: record.variantId,
      sourceName: typeof record.sourceName === "string" ? record.sourceName.slice(0, 120) : "来歴不明",
      acquiredAbs: Number.isSafeInteger(record.acquiredAbs) && record.acquiredAbs >= 0 ? record.acquiredAbs : 0 });
  }
  return { version: 1, partial: value?.partial !== false, troops: identifiers(value?.troops),
    ships: identifiers(value?.ships), equipment: identifiers(value?.equipment), variants: [...records.values()] };
}

/** @param {*} levels レベル別人数または旧人数。 @returns {number} 現在の保有人数。 */
export function codexTroopCount(levels) {
  const counts = typeof levels === "number" ? [levels] : Object.values(levels || {});
  return counts.reduce((sum, count) => sum + (Number.isSafeInteger(count) && count > 0 ? count : 0), 0);
}

/**
 * 現在保有している資産を過去の記録へ追加した独立の候補を返す。
 * 読み込みと表示では実状態を変えず、保存成功時だけ候補を確定する。
 * @param {object} state 現在の状態。
 * @returns {object} 保存・閲覧用の図鑑記録。
 */
export function collectAssetCodex(state) {
  const result = normalizeAssetCodex(state.assetCodex);
  result.troops = identifiers([...result.troops, ...Object.keys(state.troops || {}).filter(id => codexTroopCount(state.troops[id]) > 0)]);
  const owned = state.expansion?.outfitting?.owned;
  result.equipment = identifiers([...result.equipment, ...(Array.isArray(owned) ? owned : [])]);
  result.variants = normalizeAssetCodex({ variants: [...result.variants, ...(Array.isArray(state.fleet?.variants) ? state.fleet.variants : [])] }).variants;
  result.ships = identifiers([...result.ships, ...Object.keys(state.fleet?.counts || {}).filter(id => state.fleet.counts[id] > 0),
    ...result.variants.map(record => VARIANT_SHIPS[record.variantId]?.base).filter(Boolean)]);
  return result;
}
