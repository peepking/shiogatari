/* eslint-env node */
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadTestModule } = require("./helpers/module.cjs");

/** @param {string} [terrain=sea] 初期地形。 @returns {object[][]} 独立した五十マス四方の地図。 */
function makeMap(terrain = "sea") {
  return Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => ({ terrain, building: "none", settlement: null })));
}

/** @param {number} x 横座標。 @param {number} y 縦座標。 @param {object} [extra] 追加属性。 @returns {object} 保存形式に沿う無法港。 */
function port(x, y, extra = {}) { return { kind: "village", pirateHaven: true, coords: { x, y }, ...extra }; }

/** @param {object[][]} map 地図。 @param {object[]} ports 港一覧。 @returns {void} 港の建物マスを地図へ置く。 */
function placePorts(map, ports) {
  for (const haven of ports) Object.assign(map[haven.coords.y][haven.coords.x], { building: haven.kind, settlement: haven });
}

/** @param {object} result 区域。 @param {string} regionId 海域。 @returns {string[]} 比較用の昇順座標キー。 */
function keys(result, regionId) { return [...result.positions[regionId]].map(point => `${point.x},${point.y}`).sort(); }

/**
 * 半径六の式から世界内の円を求める。港・建物の対象除外と核心の距離条件も別々に判定する。
 * @param {object} center 中心。 @param {object[]} settlements 補給拠点。 @param {string} regionId 海域。
 * @returns {object[]} 全海地図で期待する地点。
 */
function expectedCircle(center, settlements, regionId) {
  const sites = [], minimumX = regionId === "sw" ? 0 : 45, maximumX = regionId === "sw" ? 4 : 49;
  for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) {
    if ((x - center.x) ** 2 + (y - center.y) ** 2 > 36 || settlements.some(settlement => settlement.coords.x === x && settlement.coords.y === y)) continue;
    const core = x >= minimumX && x <= maximumX && y >= 45 && y <= 49
      && settlements.every(settlement => Math.abs(settlement.coords.x - x) + Math.abs(settlement.coords.y - y) >= 5);
    sites.push({ x, y, level: core ? "core" : "outer" });
  }
  return sites;
}

/**
 * 仕様の順位を明示した独立の比較表から中心を求め、全ての整数港配置で核心四隅の維持を調べる。
 * @param {object} target 実港。 @param {string} regionId 海域。 @returns {object} 最適中心。
 */
function expectedCenter(target, regionId) {
  const offset = regionId === "sw" ? 0 : 40, anchor = { x: regionId === "sw" ? 4 : 45, y: 45 };
  const cornerX = regionId === "sw" ? [0, 4] : [45, 49], candidates = [];
  for (let y = 40; y < 50; y++) for (let x = offset; x < offset + 10; x++) {
    if (!cornerX.every(cx => [45, 49].every(cy => (x - cx) ** 2 + (y - cy) ** 2 <= 36))) continue;
    candidates.push({ x, y, portDistance: (x - target.x) ** 2 + (y - target.y) ** 2, anchorDistance: (x - anchor.x) ** 2 + (y - anchor.y) ** 2 });
  }
  candidates.sort((a, b) => a.portDistance - b.portDistance || a.anchorDistance - b.anchorDistance || a.y - b.y || a.x - b.x);
  return { x: candidates[0].x, y: candidates[0].y };
}

/** @param {object[][]} map 地図。 @param {number} x 左。 @param {number} y 上。 @param {number} size 一辺。 @returns {void} 連結した海域を作る。 */
function seaSquare(map, x, y, size) {
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) map[y + dy][x + dx].terrain = "sea";
}

/**
 * 無法港だけを描画用の海域へ含め、危険・配置の索引と母海域の条件を維持する。
 * @param {Function} build 区域の計算関数。 @returns {void}
 */
function verifyHarborSurfaces(build) {
  for (const terrain of ["sea", "shoal"]) {
    const map = makeMap(), ports = [port(4, 45), port(45, 45)];
    placePorts(map, ports);
    for (const haven of ports) map[haven.coords.y][haven.coords.x].terrain = terrain;
    const before = JSON.stringify(map), result = build(map, ports);
    for (const [regionId, haven] of [["sw", ports[0]], ["se", ports[1]]]) {
      const key = `${haven.coords.x},${haven.coords.y}`;
      assert.equal(result.mapByPosition.get(key)?.regionId, regionId, `${terrain}の無法港も対応海域の水面にする`);
      assert.equal(result.mapByPosition.get(key)?.level, "outer", "無法港の水面は核心にしない");
      assert.equal(result.byPosition.has(key), false, "港の危険判定を描画の変更で増やさない");
      assert.equal(result.positions[regionId].length, 96, "出来事の配置候補へ港を加えない");
    }
    for (const [key, sea] of result.byPosition) assert.deepEqual(result.mapByPosition.get(key), sea, "既存の危険な海の描画属性は変えない");
    assert.equal(result.mapByPosition.size, result.byPosition.size + 2, "描画索引に追加するのは円内の無法港だけ");
    assert.equal(JSON.stringify(map), before, "無法港の水面変更で保存地形を書き換えない");
  }
  const map = makeMap(), ports = [port(4, 45), port(45, 45)];
  placePorts(map, [...ports, port(3, 45, { pirateHaven: false, kind: "town" }), port(2, 45), port(4, 38), port(0, 49)]);
  map[45][2].terrain = "plain";
  map[49][1].terrain = "shoal";
  const result = build(map, ports);
  for (const key of ["3,45", "2,45", "4,38", "1,49"]) {
    assert.equal(result.mapByPosition.has(key), false, "通常の拠点・陸上港・円外港・通常浅瀬を危険海面にしない");
  }
  assert.equal(result.mapByPosition.get("0,49")?.regionId, "sw", "選択された遠征港以外も、円内の水上無法港なら同じ海面にする");
  assert.equal(result.mapByPosition.get("0,49")?.level, "outer");
  const isolated = makeMap("plain"), isolatedPort = port(0, 49);
  seaSquare(isolated, 20, 20, 10); isolated[49][0].terrain = "sea"; placePorts(isolated, [isolatedPort]);
  assert.equal(build(isolated, [isolatedPort]).mapByPosition.has("0,49"), false, "母海域から切れた孤立港には危険海面を描かない");
}

/** @returns {Promise<void>} 円境界・左右対称・中心補正・港選択・核心・母海域の従来条件を検証する。 */
async function main() {
  const build = (await loadTestModule("dangerousSeaGeometry.js", vm.createContext({}))).namespace.buildDangerousSeaGeometry;
  const standardPorts = [port(4, 45), port(45, 45)], standardMap = makeMap();
  placePorts(standardMap, standardPorts);
  const beforeMap = JSON.stringify(standardMap), beforePorts = JSON.stringify(standardPorts);
  const standard = build(standardMap, standardPorts);
  for (const [regionId, center] of [["sw", { x: 4, y: 45 }], ["se", { x: 45, y: 45 }]]) {
    assert.equal(expectedCircle(center, [], regionId).length, 97, "世界端で切った標準半径六の候補は九十七マス");
    assert.equal(standard.positions[regionId].length, 96, "港一マスを除く九十六マス");
    const expected = expectedCircle(center, standardPorts, regionId);
    assert.deepEqual(keys(standard, regionId), expected.map(point => `${point.x},${point.y}`).sort());
    for (const point of expected) assert.equal(standard.byPosition.get(`${point.x},${point.y}`).level, point.level);
  }
  assert.equal(standard.byPosition.has("9,40"), false, "南西の角を切る");
  assert.equal(standard.byPosition.has("40,40"), false, "南東の角を切る");
  for (const key of ["4,39", "10,45", "45,39", "39,45"]) assert.equal(standard.byPosition.get(key)?.level, "outer", "標準円は北・内側へ一マスだけ拡大する");
  assert.equal(standard.byPosition.has("4,38"), false); assert.equal(standard.byPosition.has("11,45"), false);
  assert.equal(standard.byPosition.has("45,38"), false); assert.equal(standard.byPosition.has("38,45"), false);
  assert.equal(standard.byPosition.has("10,44"), false, "半径六の斜め外側を除く");
  assert.equal(standard.byPosition.get("0,45").level, "outer", "港から上下左右四マスは核心にしない");
  assert.equal(standard.byPosition.get("0,46").level, "core", "港から五マスの境界を核心に含める");
  for (const point of standard.positions.sw) {
    const other = standard.byPosition.get(`${49 - point.x},${point.y}`);
    assert.equal(other?.regionId, "se"); assert.equal(other.level, point.level, "標準海域と核心は左右対称");
  }
  assert.equal(JSON.stringify(standardMap), beforeMap); assert.equal(JSON.stringify(standardPorts), beforePorts, "区域計算で港を並べ替えない");
  assert.deepEqual(keys(build(standardMap, standardPorts), "sw"), keys(standard, "sw"), "同じ入力の結果は安定する");

  // 港無しでも既定中心を使い、供給拠点がなければ角側五マス四方の核心を全て残す。
  const noPorts = build(makeMap());
  for (const regionId of ["sw", "se"]) {
    assert.equal(noPorts.positions[regionId].length, 97);
    assert.equal(noPorts.positions[regionId].filter(point => point.level === "core").length, 25);
  }

  // 港がずれた全百配置で、最短補正と核心の従来距離条件を保つ。
  for (let y = 40; y < 50; y++) for (let x = 0; x < 10; x++) {
    const target = port(x, y), map = makeMap(); placePorts(map, [target]);
    const center = expectedCenter(target.coords, "sw"), result = build(map, [target]);
    assert.deepEqual(keys(result, "sw"), expectedCircle(center, [target], "sw").map(point => `${point.x},${point.y}`).sort(), `港(${x},${y})の補正円`);
    for (let cy = 45; cy < 50; cy++) for (let cx = 0; cx < 5; cx++) {
      if (cx === x && cy === y) continue;
      const minimumDistance = Math.abs(cx - x) + Math.abs(cy - y);
      assert.equal(result.byPosition.get(`${cx},${cy}`)?.level, minimumDistance >= 5 ? "core" : "outer", "補正で核心候補を削らない");
    }
  }
  assert.deepEqual(expectedCenter({ x: 9, y: 49 }, "sw"), { x: 5, y: 48 });
  assert.deepEqual(expectedCenter({ x: 0, y: 40 }, "sw"), { x: 1, y: 44 });
  for (const [target, center] of [[port(49, 40), { x: 48, y: 44 }], [port(40, 49), { x: 44, y: 48 }]]) {
    const map = makeMap(); placePorts(map, [target]);
    assert.deepEqual(keys(build(map, [target]), "se"), expectedCircle(center, [target], "se").map(point => `${point.x},${point.y}`).sort(), "南東のずれた港も左右対応の補正を使う");
  }

  // 対応港は基準矩形内だけから選び、最小マンハッタン距離・同点の上・左を優先する。
  for (const [ports, center] of [
    [[port(9, 49), port(4, 46)], { x: 4, y: 46 }],
    [[port(1, 42), port(4, 40)], { x: 3, y: 44 }],
    [[port(3, 45), port(4, 44)], { x: 4, y: 45 }],
    [[port(5, 46), port(3, 46)], { x: 3, y: 46 }],
    [[port(10, 45), port(9, 49)], { x: 5, y: 48 }],
    [[port(4, 45, { pirateHaven: false, kind: "town" }), port(9, 49)], { x: 5, y: 48 }],
  ]) {
    const map = makeMap(); placePorts(map, ports);
    assert.deepEqual(keys(build(map, ports), "sw"), expectedCircle(center, ports, "sw").map(point => `${point.x},${point.y}`).sort());
    assert.deepEqual(keys(build(map, [...ports].reverse()), "sw"), keys(build(map, ports), "sw"), "保存内の港順序に依存しない");
  }
  const foreignTown = { kind: "town", pirateHaven: false, factionId: "enemy", coords: { x: 0, y: 42 }, entryDenied: true };
  const allSupply = [...standardPorts, foreignTown], supplyMap = makeMap(); placePorts(supplyMap, allSupply);
  const supplied = build(supplyMap, allSupply);
  assert.equal(supplied.byPosition.get("0,46").level, "outer", "入港できない別勢力の街も核心距離の対象");
  assert.equal(supplied.byPosition.get("0,47").level, "core");

  // 海以外・建物は対象外だが、浅瀬・海上建物は母海域の連結を維持する。
  const terrainMap = makeMap();
  terrainMap[49][0].terrain = "plain"; terrainMap[49][1].terrain = "shoal"; terrainMap[49][2].building = "village";
  const terrainBefore = JSON.stringify(terrainMap), terrainResult = build(terrainMap);
  for (const key of ["0,49", "1,49", "2,49"]) assert.equal(terrainResult.byPosition.has(key), false);
  assert.equal(JSON.stringify(terrainMap), terrainBefore, "島・浅瀬・建物を書き換えない");
  const bridge = makeMap("plain"); bridge[49][0].terrain = "sea"; bridge[49][1].terrain = "shoal"; bridge[49][2].terrain = "sea";
  assert.deepEqual(keys(build(bridge), "sw"), ["0,49", "2,49"]);
  bridge[49][1].terrain = "sea"; bridge[49][1].building = "town";
  assert.deepEqual(keys(build(bridge), "sw"), ["0,49", "2,49"], "海上建物は連結を切らず対象だけから除く");

  const islands = makeMap("plain"); seaSquare(islands, 0, 47, 3); seaSquare(islands, 45, 45, 4);
  const mother = build(islands); assert.equal(mother.positions.sw.length, 0); assert.equal(mother.positions.se.length, 16, "大きい母海域だけを使う");
  const tied = makeMap("plain"); seaSquare(tied, 2, 40, 3); seaSquare(tied, 45, 40, 3);
  assert.equal(build(tied).positions.sw.length, 9); assert.equal(build(tied).positions.se.length, 0, "同面積なら上から左の海域を使う");
  const separated = makeMap("plain"); seaSquare(separated, 20, 20, 10); separated[49][0].terrain = "sea";
  assert.equal(build(separated).byPosition.has("0,49"), false, "角の孤立した内海を対象にしない");
  verifyHarborSurfaces(build);
  console.log("dangerousSeaGeometry: 半径六・標準九十六マス・左右対称・百港補正・核心距離・地形母海域・無法港の描画専用海面の検証成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
