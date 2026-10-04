import { mapData, settlements } from "../world/map.js";
import { buildDangerousSeaGeometry } from "./dangerousSeaGeometry.js";

let cachedMap = null;
let cachedSettlement = null;
let cachedGeometry = null;

/**
 * 地図生成・復元で地図または拠点参照が変わった時だけ、海の連結と港からの距離を再計算する。
 * @returns {object} 現在の危険海域の座標集合。
 */
export function dangerousSeaGeometry() {
  if (!cachedGeometry || cachedMap !== mapData || cachedSettlement !== settlements[0]) {
    cachedGeometry = buildDangerousSeaGeometry(mapData, settlements);
    cachedMap = mapData; cachedSettlement = settlements[0];
  }
  return cachedGeometry;
}

/** @param {{x:number,y:number}} position 座標。 @returns {object|null} 地形を変更しない海域属性。 */
export function dangerousSeaAt(position) {
  return position ? dangerousSeaGeometry().byPosition.get(`${position.x},${position.y}`) || null : null;
}

/** @param {string} regionId 海域ID。 @param {string} [level] 外縁・核心の絞り込み。 @returns {Array} 配置可能な海座標。 */
export function getDangerousSeaPositions(regionId, level) {
  const positions = dangerousSeaGeometry().positions[regionId] || [];
  return level ? positions.filter(p => p.level === level) : positions;
}
