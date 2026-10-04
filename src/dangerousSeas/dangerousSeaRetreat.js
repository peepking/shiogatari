/**
 * 実際の上下左右移動と地図境界に沿って、区域外と港までの最短移動回数を探す。
 * 現行の移動は陸を含む全地形を通れるため、海専用の距離や障害物を追加しない。
 * @param {Array} map 地図。 @param {Array} settlements 拠点。
 * @param {object} position 現在地。 @param {Function} seaAt 危険海域の共通判定。
 * @returns {{exit:number|null,port:number|null}} 一日一マスでの退避距離。
 */
export function dangerousRetreatDistances(map, settlements, position, seaAt) {
  const ports = new Set(settlements.map(site => `${site.coords?.x},${site.coords?.y}`));
  const visited = new Set([`${position.x},${position.y}`]), queue = [{ ...position, distance: 0 }];
  let exit = null, port = null;
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (exit == null && !seaAt(current)) exit = current.distance;
    if (port == null && ports.has(`${current.x},${current.y}`)) port = current.distance;
    if (exit != null && port != null) break;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const next = { x: current.x + dx, y: current.y + dy, distance: current.distance + 1 }, key = `${next.x},${next.y}`;
      if (!map[next.y]?.[next.x] || visited.has(key)) continue;
      visited.add(key); queue.push(next);
    }
  }
  return { exit, port };
}
