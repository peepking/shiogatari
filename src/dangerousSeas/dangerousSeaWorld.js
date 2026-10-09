import { mapData, settlements } from "../world/map.js";
import { buildDangerousSeaGeometry, dangerousSeaExpeditionPort } from "./dangerousSeaGeometry.js";

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

/**
 * 危険海域内の無法港にも周囲と同じ水面を描く。危険判定は従来の索引だけを参照する。
 * @param {{x:number,y:number}} position 座標。 @returns {object|null} 港を含む描画用の海域属性。
 */
export function dangerousSeaMapAt(position) {
  return position ? dangerousSeaGeometry().mapByPosition.get(`${position.x},${position.y}`) || null : null;
}

/**
 * 円中心の選択に使った実港だけを遠征港とする。補正で港が円外にあっても対応は維持する。
 * @param {{x:number,y:number}} position 座標。 @returns {string|null} 対応する海域ID。
 */
export function dangerousSeaExpeditionRegionAt(position) {
  if (!position) return null;
  for (const regionId of ["sw", "se"]) {
    const port = dangerousSeaExpeditionPort(regionId, settlements);
    if (port?.coords.x === position.x && port.coords.y === position.y) return regionId;
  }
  return null;
}

/**
 * 現在の危険海域か、その海域に対応する遠征港だけで予報を案内する。
 * @param {{x:number,y:number}} position 座標。 @returns {string|null} 表示・通知する海域ID。
 */
export function dangerousSeaForecastRegionAt(position) {
  return dangerousSeaAt(position)?.regionId || dangerousSeaExpeditionRegionAt(position);
}

/** @param {string} regionId 海域ID。 @param {string} [level] 外縁・核心の絞り込み。 @returns {Array} 配置可能な海座標。 */
export function getDangerousSeaPositions(regionId, level) {
  const positions = dangerousSeaGeometry().positions[regionId] || [];
  return level ? positions.filter(p => p.level === level) : positions;
}
