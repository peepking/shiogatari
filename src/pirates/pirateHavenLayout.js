import { PIRATE_CONFIG } from "./pirateConfig.js";

/**
 * 上下左右の移動で数えた座標間の距離を返す。
 * @param {object} a 座標。 @param {object} b 座標。 @returns {number} 距離。
 */
export function havenDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * 船で行き来できる海・浅瀬を上下左右につなぎ、最大の海域だけを選ぶ。
 * 同じ広さの海域は、上から左の順に見つかった海域を優先する。
 * @param {Array} grid 地図。 @returns {Array} 最大海域の座標。
 */
function largestHavenSea(grid) {
  const seen = new Set();
  let largest = [];
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
    const key = `${x},${y}`;
    if (seen.has(key) || !["sea", "shoal"].includes(grid[y][x].terrain)) continue;
    const region = [{ x, y }];
    seen.add(key);
    for (let i = 0; i < region.length; i++) {
      const p = region[i];
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = p.x + dx, ny = p.y + dy, nextKey = `${nx},${ny}`;
        if (seen.has(nextKey) || !["sea", "shoal"].includes(grid[ny]?.[nx]?.terrain)) continue;
        seen.add(nextKey);
        region.push({ x: nx, y: ny });
      }
    }
    if (region.length > largest.length) largest = region;
  }
  return largest;
}

/**
 * 最大海域から端・通常拠点・建物・予約地点を除き、安全な配置候補を作る。
 * 移設される既存港のマスは候補へ戻すが、その港の間隔は選択時に保護する。
 * @param {Array} grid 地図。 @param {Array} settlements 拠点。
 * @param {Array} avoid 予約座標。 @returns {Array} 配置候補。
 */
export function havenPlacementCandidates(grid, settlements, avoid = []) {
  const occupied = new Map(), normal = [], reserved = new Set();
  for (const port of settlements) {
    if (port.pirateHaven) occupied.set(`${port.coords.x},${port.coords.y}`, port.id);
    else normal.push(port);
  }
  for (const coords of avoid) if (coords) reserved.add(`${coords.x},${coords.y}`);
  const candidates = [], margin = PIRATE_CONFIG.havenEdgeMargin;
  for (const coords of largestHavenSea(grid)) {
    const { x, y } = coords, key = `${x},${y}`, cell = grid[y][x];
    if (x < margin || y < margin || x >= grid[y].length - margin || y >= grid.length - margin || reserved.has(key)) continue;
    const existingPort = occupied.has(key) && cell.settlement?.id === occupied.get(key);
    if (cell.settlement && !existingPort) continue;
    if (cell.building && cell.building !== "none" && !existingPort) continue;
    let nearSettlement = false;
    for (const settlement of normal) {
      if (havenDistance(coords, settlement.coords) < PIRATE_CONFIG.havenSettlementDistance) {
        nearSettlement = true;
        break;
      }
    }
    if (!nearSettlement) candidates.push(coords);
  }
  return candidates;
}

/**
 * 最初の4港は端から4マス内側の四隅へ近い候補、残りは他港との最小距離が最大の候補を選ぶ。
 * 港間6マス以上を守り、同点は上から左の順で決める。安全な候補がなければ配置を省略する。
 * @param {Array} grid 地図。 @param {Array} candidates 配置候補。
 * @param {Array} occupied 他港の座標。 @param {number} index 配置順。
 * @returns {object|null} 配置座標。
 */
export function selectHavenCoordinate(grid, candidates, occupied, index) {
  const inset = PIRATE_CONFIG.havenCornerInset;
  const right = (grid[0]?.length || 0) - 1 - inset, bottom = grid.length - 1 - inset;
  const anchors = [{ x: inset, y: inset }, { x: right, y: inset },
    { x: inset, y: bottom }, { x: right, y: bottom }];
  let best = null, bestScore = -Infinity;
  for (const coords of candidates) {
    let minimum = Infinity;
    for (const other of occupied) minimum = Math.min(minimum, havenDistance(coords, other));
    if (minimum < PIRATE_CONFIG.havenSpacing) continue;
    const score = index < anchors.length ? -havenDistance(coords, anchors[index]) : minimum;
    if (score > bestScore || (score === bestScore && (!best || coords.y < best.y || (coords.y === best.y && coords.x < best.x)))) {
      best = coords;
      bestScore = score;
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}
