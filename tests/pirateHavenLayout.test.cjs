const { readSource } = require("./helpers/source.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");

/**
 * 実モジュールを読み、無法港の配置と既存港の移設を検証する。
 * @returns {Promise<void>} 検証の完了。
 */
async function main() {
  const modules = new Map(), context = vm.createContext({});
  /**
   * 配置に必要な実モジュールを再帰的に読み込む。
   * @param {string} name ファイル名。 @returns {Promise<vm.Module>} 読み込んだモジュール。
   */
  async function load(name) {
    name = name.replace(/^\.\//, "");
    if (modules.has(name)) return modules.get(name);
    const module = new vm.SourceTextModule(readSource(name), { context });
    modules.set(name, module);
    await module.link(load);
    return module;
  }
  const world = await load("pirateWorld.js");
  await world.evaluate();
  const { buildPirateHavens, migratePirateHavens } = world.namespace;
  const { havenDistance } = modules.get("pirateHavenLayout.js").namespace;
  const { PIRATE_CONFIG: config } = modules.get("pirateConfig.js").namespace;

  /**
   * 同じ海地形の正方形地図を作る。
   * @param {number} size 一辺の長さ。 @returns {Array} 地図。
   */
  function seaGrid(size = 50) {
    const grid = [];
    for (let y = 0; y < size; y++) {
      const row = [];
      for (let x = 0; x < size; x++) row.push({ terrain: "sea", building: "none", factionId: null });
      grid.push(row);
    }
    return grid;
  }

  /**
   * 新配置の端余白・最大海域・通常拠点距離・港間距離を検証する。
   * @param {Array} grid 地図。 @param {Array} settlements 拠点。 @returns {void}
   */
  function assertSafeHavens(grid, settlements) {
    for (const port of settlements) {
      if (!port.pirateHaven) continue;
      const { x, y } = port.coords;
      assert.ok(x >= 3 && y >= 3 && x < grid[y].length - 3 && y < grid.length - 3);
      assert.ok(["sea", "shoal"].includes(grid[y][x].terrain));
      assert.equal(grid[y][x].settlement, port);
      for (const other of settlements) {
        if (port === other) continue;
        assert.ok(havenDistance(port.coords, other.coords) >= (other.pirateHaven ? 6 : 4));
      }
    }
  }

  const grid = seaGrid(), settlements = [], homes = new Map();
  buildPirateHavens(grid, settlements, homes, () => {});
  assert.equal(settlements.length, 15);
  assert.deepEqual(JSON.parse(JSON.stringify(settlements.slice(0, 4).map(port => port.coords))),
    [{ x: 4, y: 4 }, { x: 45, y: 4 }, { x: 4, y: 45 }, { x: 45, y: 45 }]);
  assert.ok(settlements.some(port => port.coords.x >= 15 && port.coords.x <= 34 && port.coords.y >= 15 && port.coords.y <= 34));
  assert.equal(new Set(settlements.map(port => port.name)).size, 15);
  assertSafeHavens(grid, settlements);
  const before = JSON.stringify(settlements);
  buildPirateHavens(grid, settlements, homes, () => assert.fail("既存港は再初期化しない"));
  assert.equal(JSON.stringify(settlements), before);

  const collisionGrid = seaGrid(), collisionTown = { id: "haven-1", coords: { x: 25, y: 25 } };
  Object.assign(collisionGrid[25][25], { building: "town", settlement: collisionTown });
  const collisionPorts = [collisionTown];
  buildPirateHavens(collisionGrid, collisionPorts, new Map(), () => {});
  assert.equal(collisionPorts.length, 16);
  assert.equal(new Set(collisionPorts.map(port => port.id)).size, 16, "既存の通常拠点IDも避ける");
  assertSafeHavens(collisionGrid, collisionPorts);

  const splitGrid = seaGrid();
  for (let y = 0; y < 50; y++) splitGrid[y][25].terrain = "plain";
  const town = { id: "town", coords: { x: 4, y: 4 }, factionId: "north" };
  Object.assign(splitGrid[4][4], { building: "town", settlement: town });
  splitGrid[3][3].building = "ruins";
  splitGrid[6][6].terrain = "shoal";
  const splitPorts = [town], splitHomes = new Map();
  migratePirateHavens(splitGrid, splitPorts, splitHomes, () => {}, [{ x: 4, y: 45 }]);
  assertSafeHavens(splitGrid, splitPorts);
  assert.ok(splitPorts.filter(port => port.pirateHaven).every(port => port.coords.x < 25));
  assert.ok(splitPorts.every(port => port.coords.x !== 3 || port.coords.y !== 3));
  assert.ok(splitPorts.every(port => port.coords.x !== 4 || port.coords.y !== 45));
  assert.equal(splitGrid[3][3].building, "ruins");
  assert.equal(splitGrid[4][4].settlement, town);

  const smallPorts = [], tinyPorts = [];
  buildPirateHavens(seaGrid(8), smallPorts, new Map(), () => {});
  assert.equal(smallPorts.length, 1, "港間隔を緩めず置ける数だけ生成する");
  buildPirateHavens(seaGrid(6), tinyPorts, new Map(), () => {});
  assert.equal(tinyPorts.length, 0, "内側に安全な海域がなければ生成を省略する");

  const legacyGrid = seaGrid(), legacyPorts = [], legacyHomes = new Map();
  const legacyCoords = [{ x: 0, y: 0 }, { x: 49, y: 49 }, { x: 49, y: 0 }, { x: 0, y: 49 },
    { x: 24, y: 24 }, { x: 24, y: 0 }, { x: 0, y: 24 }, { x: 49, y: 24 }, { x: 24, y: 49 }, { x: 12, y: 12 }];
  for (let index = 0; index < legacyCoords.length; index++) {
    const port = { id: `haven-${index + 1}`, name: `保存済み港${index + 1}`, coords: legacyCoords[index],
      kind: "town", pirateHaven: true, factionId: "pirates", stock: { illegal_drug: index + 1 },
      support: { pirates: index + 5 }, shipyard: { available: ["ship"] }, recruitment: { pirate_axe: index + 2 } };
    legacyPorts.push(port);
    Object.assign(legacyGrid[port.coords.y][port.coords.x], { building: "town", settlement: port, factionId: "pirates" });
  }
  legacyHomes.set(config.nobleId, "haven-7");
  const savedPorts = legacyPorts.slice(), savedStates = legacyPorts.map(port => ({ ...port, coords: undefined }));
  let initialized = 0;
  const moves = migratePirateHavens(legacyGrid, legacyPorts, legacyHomes, () => initialized++, [{ x: 45, y: 4 }]);
  assert.equal(legacyPorts.length, 15);
  assert.equal(initialized, 5, "追加した港だけを初期化する");
  assert.equal(legacyHomes.get(config.nobleId), "haven-7", "黒ひげの本拠地IDを維持する");
  assert.equal(new Set(legacyPorts.map(port => port.id)).size, 15);
  assert.ok(moves.length > 0);
  assertSafeHavens(legacyGrid, legacyPorts);
  for (let index = 0; index < savedPorts.length; index++) {
    assert.equal(legacyPorts[index], savedPorts[index], "既存の港オブジェクトを維持する");
    assert.deepEqual({ ...legacyPorts[index], coords: undefined }, savedStates[index]);
  }
  for (const move of moves) {
    const oldCell = legacyGrid[move.from.y][move.from.x];
    if (!oldCell.settlement) assert.deepEqual(oldCell, { terrain: "sea", building: "none", settlement: null, factionId: null });
    assert.deepEqual(JSON.parse(JSON.stringify(move.to)), { ...legacyPorts.find(port => port.id === move.id).coords });
  }
  assert.ok(legacyPorts.every(port => port.coords.x !== 45 || port.coords.y !== 4));

  const blockedGrid = seaGrid(8), blockedHomes = new Map([[config.nobleId, "haven-1"]]);
  const stranded = { id: "haven-1", name: "維持する港", coords: { x: 0, y: 0 }, pirateHaven: true,
    kind: "town", factionId: "pirates", stock: { illegal_drug: 7 } };
  Object.assign(blockedGrid[0][0], { building: "town", settlement: stranded, factionId: "pirates" });
  const avoid = [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 4 }, { x: 4, y: 4 }];
  const blockedPorts = [stranded];
  assert.equal(migratePirateHavens(blockedGrid, blockedPorts, blockedHomes, () => assert.fail("配置候補がない"), avoid).length, 0);
  assert.equal(blockedPorts.length, 1);
  assert.deepEqual(stranded.coords, { x: 0, y: 0 }, "移せない既存港を削除しない");
  assert.equal(blockedGrid[0][0].settlement, stranded);
  assert.equal(stranded.stock.illegal_drug, 7);

  const crowdedGrid = seaGrid(8), crowdedPorts = [];
  for (const [index, coords] of [{ x: 0, y: 0 }, { x: 3, y: 3 }].entries()) {
    const port = { id: `haven-${index + 1}`, coords, pirateHaven: true, factionId: "pirates", kind: "town" };
    crowdedPorts.push(port);
    Object.assign(crowdedGrid[coords.y][coords.x], { building: "town", settlement: port, factionId: "pirates" });
  }
  const crowdedMoves = migratePirateHavens(crowdedGrid, crowdedPorts, new Map(), () => assert.fail("新港の安全な候補はない"));
  assert.equal(crowdedPorts.length, 2);
  assert.equal(crowdedMoves.length, 1, "未移設の既存港と競合する移設は省略する");
  assert.deepEqual(crowdedPorts[0].coords, { x: 0, y: 0 });
  assert.ok(havenDistance(crowdedPorts[0].coords, crowdedPorts[1].coords) >= 6);
  assert.equal(crowdedGrid[0][0].settlement, crowdedPorts[0]);
  console.log("無法港の15港配置・内側の四隅・最大海域・予約回避・旧港の状態維持: 全項目成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
