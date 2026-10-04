/** 港の選択・円中心の補正に使う基準範囲。座標は内部の0始まりで保持する。 */
const REGIONS = Object.freeze({
  sw: { outer: [0, 9, 40, 49], core: [0, 4, 45, 49], anchor: { x: 4, y: 45 } },
  se: { outer: [40, 49, 40, 49], core: [45, 49, 45, 49], anchor: { x: 45, y: 45 } },
});
/** 円の形状に使う半径。移動日数ではなく、マス中心間の直線距離で測る。 */
const DANGEROUS_SEA_RADIUS = 6;

/**
 * 海・浅瀬を上下左右につなぎ、最大の母海域を求める。同面積なら上から左の発見順を優先する。
 * 建物のある海も連結判定に含め、港で海路を分断しない。
 * @param {Array} map 地図。
 * @returns {Set<string>} 最大海域の座標キー。
 */
function largestDangerousSea(map) {
  const seen = new Set();
  let largest = [];
  for (let y = 0; y < map.length; y++) for (let x = 0; x < map[y].length; x++) {
    const key = `${x},${y}`;
    if (seen.has(key) || !["sea", "shoal"].includes(map[y][x]?.terrain)) continue;
    const region = [{ x, y }];
    seen.add(key);
    for (let index = 0; index < region.length; index++) {
      const point = region[index];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = { x: point.x + dx, y: point.y + dy }, nextKey = `${next.x},${next.y}`;
        if (seen.has(nextKey) || !["sea", "shoal"].includes(map[next.y]?.[next.x]?.terrain)) continue;
        seen.add(nextKey);
        region.push(next);
      }
    }
    if (region.length > largest.length) largest = region;
  }
  return new Set(largest.map(point => `${point.x},${point.y}`));
}

/**
 * 座標が両端を含む矩形の内部にあるか判定する。
 * @param {object} position 座標。
 * @param {number[]} range 左・右・上・下。
 * @returns {boolean} 範囲内か。
 */
function inDangerousRange(position, range) {
  return position.x >= range[0] && position.x <= range[1] && position.y >= range[2] && position.y <= range[3];
}

/**
 * マス中心間の直線距離の二乗を返す。
 * @param {object} a 座標。 @param {object} b 座標。 @returns {number} 距離の二乗。
 */
function squaredDangerousDistance(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/**
 * 基準矩形内で既定中心に上下左右で最も近い無法港を選ぶ。同距離なら上・左の順とする。
 * 円中心の補正と港での予報表示は、この同じ実港を使う。
 * @param {string} regionId 海域ID。 @param {Array} [settlements] 拠点。
 * @returns {object|null} 対応する遠征港。候補がなければnull。
 */
export function dangerousSeaExpeditionPort(regionId, settlements = []) {
  const ranges = Object.hasOwn(REGIONS, regionId) ? REGIONS[regionId] : null;
  if (!ranges) return null;
  const ports = settlements.filter(port => port?.pirateHaven && port.coords && inDangerousRange(port.coords, ranges.outer));
  ports.sort((a, b) => {
    const distanceA = Math.abs(a.coords.x - ranges.anchor.x) + Math.abs(a.coords.y - ranges.anchor.y);
    const distanceB = Math.abs(b.coords.x - ranges.anchor.x) + Math.abs(b.coords.y - ranges.anchor.y);
    return distanceA - distanceB || a.coords.y - b.coords.y || a.coords.x - b.coords.x;
  });
  return ports[0] || null;
}

/**
 * 核心候補5×5の四隅を半径6に含む整数中心から、実港への直線距離が最小の位置を選ぶ。
 * 同距離なら既定中心への直線距離、上・左の順で決め、港がずれても核心候補を削らない。
 * 港がない海域は既定中心を使い、地形や港位置は変更しない。
 * @param {string} regionId 海域ID。 @param {object} ranges 基準矩形・核心候補・既定中心。 @param {Array} settlements 拠点。
 * @returns {{x:number,y:number}} 円の中心。
 */
function dangerousSeaCenter(regionId, ranges, settlements) {
  const target = dangerousSeaExpeditionPort(regionId, settlements)?.coords || ranges.anchor;
  const corners = [
    { x: ranges.core[0], y: ranges.core[2] }, { x: ranges.core[1], y: ranges.core[2] },
    { x: ranges.core[0], y: ranges.core[3] }, { x: ranges.core[1], y: ranges.core[3] },
  ];
  let best = ranges.anchor, bestDistance = Infinity, bestAnchorDistance = Infinity;
  for (let y = ranges.outer[2]; y <= ranges.outer[3]; y++) for (let x = ranges.outer[0]; x <= ranges.outer[1]; x++) {
    const center = { x, y };
    if (!corners.every(corner => squaredDangerousDistance(center, corner) <= DANGEROUS_SEA_RADIUS ** 2)) continue;
    const distance = squaredDangerousDistance(center, target), anchorDistance = squaredDangerousDistance(center, ranges.anchor);
    if (distance > bestDistance || (distance === bestDistance && anchorDistance >= bestAnchorDistance)) continue;
    best = center; bestDistance = distance; bestAnchorDistance = anchorDistance;
  }
  return best;
}

/**
 * 地形を書き換えず、港付近を中心とする半径6の円内の海タイルに外縁・核心の共通属性を作る。
 * 核心は角側5×5かつ全補給拠点から距離5以上とし、入港制限・勢力関係は距離判定へ使わない。
 * @param {Array} map 地図。
 * @param {Array} settlements 街・村・無法港。
 * @returns {{byPosition:Map,positions:object}} 座標索引と海域別の候補。
 */
export function buildDangerousSeaGeometry(map, settlements = []) {
  const mother = largestDangerousSea(map), byPosition = new Map(), positions = { sw: [], se: [] };
  const supplyPositions = settlements.filter(settlement => settlement?.coords && (settlement.kind === "town" || settlement.kind === "village" || settlement.pirateHaven)).map(settlement => settlement.coords);
  for (const [regionId, ranges] of Object.entries(REGIONS)) {
    const center = dangerousSeaCenter(regionId, ranges, settlements);
    for (let y = center.y - DANGEROUS_SEA_RADIUS; y <= center.y + DANGEROUS_SEA_RADIUS; y++) for (let x = center.x - DANGEROUS_SEA_RADIUS; x <= center.x + DANGEROUS_SEA_RADIUS; x++) {
      const position = { x, y }, cell = map[y]?.[x], key = `${x},${y}`;
      if (squaredDangerousDistance(position, center) > DANGEROUS_SEA_RADIUS ** 2) continue;
      if (!cell || cell.terrain !== "sea" || !mother.has(key) || cell.settlement || (cell.building && cell.building !== "none")) continue;
      const core = inDangerousRange(position, ranges.core) && supplyPositions.every(point => Math.abs(point.x - x) + Math.abs(point.y - y) >= 5);
      const level = core ? "core" : "outer";
      byPosition.set(key, { regionId, level });
      positions[regionId].push({ ...position, level });
    }
  }
  return { byPosition, positions };
}
