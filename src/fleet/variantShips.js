import { SHIP_TYPES } from "./shipConfig.js";

/** 賞金の低い順に船種を割り当てる。同額の賞金は同価格帯とは限らない。 */
export const VARIANT_SHIPS = Object.freeze(Object.fromEntries([
  ["caravel", ["gull", "red_sail", "reed"], ["潮鴎号", "赤帆号", "葦笛号"]],
  ["knarr", ["mist", "amber", "chain"], ["霧渡り号", "琥珀号", "鉄鎖号"]],
  ["longship", ["crown", "raven", "wolf"], ["灰冠号", "夜鴉号", "白狼号"]],
  ["cog", ["bell", "thorn", "shark"], ["沈鐘号", "黒棘号", "黒鮫号"]],
  ["galley", ["viper", "mirror", "lamp"], ["海蛇号", "水鏡号", "青灯号"]],
  ["fluyt", ["salt", "moon", "fang"], ["塩風号", "欠月号", "冬牙号"]],
  ["carrack", ["stone", "storm", "devourer"], ["黒礁号", "嵐呼び号", "海喰らい号"]],
  ["galleass", ["ember", "anvil", "tide"], ["残火号", "鉄槌号", "断潮号"]],
  ["galleon", ["eclipse", "abyss", "throne"], ["日蝕号", "深淵号", "空位の玉座号"]],
].flatMap(([base, ids, names]) => ids.map((id, i) => [id, Object.freeze({ id, base, name: names[i], supplies: [10, 0, 5][i], troops: [0, 10, 5][i] })]))));

/** 保存された個体を検証し、重複IDは最初の記録だけを残す。 @param {unknown} value 保存値。 @returns {Array} 独立した個体一覧。 */
export function normalizeVariants(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).filter(v => {
    if (!v || !Number.isSafeInteger(v.id) || v.id < 1 || seen.has(v.id) || !Object.hasOwn(VARIANT_SHIPS, v.variantId)) return false;
    seen.add(v.id); return true;
  }).map(v => ({ id: v.id, variantId: v.variantId, sourceName: typeof v.sourceName === "string" ? v.sourceName.slice(0, 120) : "来歴不明",
    acquiredAbs: Number.isSafeInteger(v.acquiredAbs) && v.acquiredAbs >= 0 ? v.acquiredAbs : 0 }));
}

/** @param {string} id 固有船種。 @returns {string} 容量ボーナスの説明。 */
export function variantBonusText(id) {
  const v = VARIANT_SHIPS[id];
  return `通常の${SHIP_TYPES[v.base].name}に加えて${[v.supplies ? `物資上限＋${v.supplies}` : "", v.troops ? `部隊上限＋${v.troops}` : ""].filter(Boolean).join(" / ")}`;
}
