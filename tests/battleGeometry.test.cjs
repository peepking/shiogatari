const { readSource } = require("./helpers/source.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");

/** @returns {Promise<void>} 戦闘描画へ周辺地形を渡し、再描画や甲板の変更を正しく反映するか検証する。 */
async function checkBattleTerrain() {
  const calls = [];
  const mapArt = new vm.SyntheticModule(["drawMapTile"], function () {
    this.setExport("drawMapTile", (...args) => calls.push(args));
  });
  const terrainArt = new vm.SourceTextModule(await readSource("battleTerrainArt.js"));
  await terrainArt.link(() => mapArt); await terrainArt.evaluate();
  const grid = [["shoal", "sea"], ["deck", "sea"]];
  const original = JSON.stringify(grid);
  const ctx = { setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const context = vm.createContext({
    elements: { battleCanvas: { width: 80 } }, battleState: { size: 2, grid, ctx, units: [] },
    resizeBattleCanvas() {}, isBattleOnBoard() {}, drawBattleTerrain: terrainArt.namespace.drawBattleTerrain,
  });
  const source = await readSource("battle.js"), start = source.indexOf("function renderBattle(");
  vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
  vm.runInContext("renderBattle()", context);
  assert.equal(calls.length, 4);
  const rendered = calls[0][8].grid, row = rendered[0], sea = rendered[0][1];
  assert.equal(calls[0][1], rendered[0][0]);
  assert.equal(rendered[0][0].terrain, "shoal");
  assert.equal(rendered[0][1].terrain, "sea", "浅瀬から隣接する海を参照できる");
  assert.equal(rendered[1][0].terrain, "deck");
  assert.equal(rendered[1][1], sea, "同じ地形の描画用マスを共有する");
  assert.ok(Object.isFrozen(sea));
  calls.forEach((call, index) => {
    const x = index % 2, y = Math.floor(index / 2), options = call[8];
    assert.equal(call[2], x * 40); assert.equal(call[3], y * 40);
    assert.equal(options.gx, x); assert.equal(options.gy, y);
    assert.equal(options.grid, rendered); assert.equal(typeof options.onReady, "function");
  });
  assert.equal(JSON.stringify(grid), original, "描画で戦闘判定用の地形を変更しない");
  calls.length = 0; vm.runInContext("renderBattle()", context);
  assert.equal(calls[0][8].grid, rendered); assert.equal(rendered[0], row);
  assert.equal(calls[1][1], sea, "再描画で地形オブジェクトを作り直さない");
  grid[0][0] = "sea"; grid[1] = ["forest", "shoal"];
  calls.length = 0; vm.runInContext("renderBattle()", context);
  assert.equal(calls[0][1], sea, "同じ戦場配列の地形変更を反映する");
  assert.equal(rendered[1][0].terrain, "forest"); assert.equal(rendered[1][1].terrain, "shoal");
}

/** @returns {Promise<void>} 全サイズの配置と、拡大・スクロール時の選択位置を検証する。 */
async function main() {
  await checkBattleTerrain();
  const geometry = new vm.SourceTextModule(await readSource("battleGeometry.js"));
  const formation = new vm.SourceTextModule(await readSource("battleFormation.js"));
  await geometry.link(() => {}); await geometry.evaluate(); await formation.link(() => {}); await formation.evaluate();
  const { selectBattleSize, deploymentDepth, battleDeploymentLimit, battleCellAt } = geometry.namespace;
  const modules = { "./battleGeometry.js": geometry };
  for (const name of ["battleUnitFormation", "battleTarget", "battleCore", "battleMorale", "battleMovement", "battleReinforcements"])
    modules[`./${name}.js`] = new vm.SourceTextModule(await readSource(`${name}.js`));
  await modules["./battleCore.js"].link(name => modules[name]); await modules["./battleCore.js"].evaluate();
  const battle = await readSource("battle.js");
  const context = vm.createContext({ ...geometry.namespace, DECK_KEY: "deck", battleState: { fieldRandom: () => 0.5 } });
  vm.runInContext(battle.match(/const TERRAIN_WEIGHTS_BY_BASE = \{[\s\S]*?\n\};/)[0], context);
  for (const name of ["buildBattleGrid", "buildDeploySlots"]) {
    const start = battle.indexOf(`function ${name}(`);
    vm.runInContext(battle.slice(start, battle.indexOf("\n}", start) + 2), context);
  }
  assert.deepEqual([0, 5, 6, 10, 11, 15, 16, 20].map(selectBattleSize), [8, 8, 10, 10, 12, 12, 15, 15]);
  for (const size of [8, 10, 12, 15]) {
    const limit = size === 8 ? 16 : 20;
    assert.equal(deploymentDepth(size), 2);
    assert.equal(battleDeploymentLimit(size), limit);
    context.size = size;
    for (const side of ["ally", "enemy"]) {
      context.side = side;
      const slots = vm.runInContext("buildDeploySlots(side, size)", context);
      assert.equal(slots.length, size * 2);
      assert.equal(new Set(slots.map(p => p.x)).size, 2);
    }
    for (const terrain of ["sea", "shoal"]) {
      context.terrain = terrain;
      const grid = vm.runInContext("buildBattleGrid(size, terrain)", context);
      assert.ok(grid.every(row => row.every((cell, x) => (cell === "deck") === (x < 2 || x >= size - 2))), "海戦の甲板は全サイズで両端2列");
    }
    for (const kind of ["balance", "assault", "defense"]) for (let total = 1; total <= 20; total++) for (let melee = 0; melee <= total; melee++) {
      const units = Array.from({ length: total }, (_, id) => ({ id, role: id < melee ? "melee" : "ranged", range: id < melee ? 1 : 4 }));
      const positions = formation.namespace.planBattleFormation(units, kind, size);
      assert.equal(positions.length, Math.min(total, limit));
      assert.equal(new Set(positions.map(p => `${p.x},${p.y}`)).size, Math.min(total, limit));
      assert.ok(positions.every(p => p.unit.id < limit), "上限超過は編成順の後ろから除外する");
      assert.ok(positions.every(p => p.x >= 0 && p.x < deploymentDepth(size) && p.y >= 0 && p.y < size));
      assert.ok(positions.every(p => size - 1 - p.x >= deploymentDepth(size)), "両陣営の初期配置領域が重ならない");
    }
    for (const width of [280, 360, 640, 720]) {
      const rect = { left: -217, top: -49, width, height: width };
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const hit = battleCellAt(rect.left + (x + 0.5) * width / size, rect.top + (y + 0.5) * width / size, rect, size);
        assert.equal(hit.x, x); assert.equal(hit.y, y);
      }
    }
    const units = ["ally", "enemy"].flatMap(side => {
      const army = Array.from({ length: limit }, (_, index) => ({ id: `${side}-${index}`, name: "兵", side,
        role: index < 12 ? "melee" : "ranged", range: index < 12 ? 1 : 4, count: 10,
        hp: 150, maxHp: 150, atk: 20, def: 10, spd: 2, move: 1, cooldown: 0, status: "active" }));
      return formation.namespace.planBattleFormation(army, "balance", size).map(p => ({ ...p.unit, x: side === "ally" ? p.x : size - 1 - p.x, y: p.y }));
    });
    const state = { units, size, tick: 0, elapsedMs: 0, grid: Array.from({ length: size }, () => Array(size).fill("plain")), outfitting: { effects: { attacks: [] } } };
    let result;
    do {
      result = modules["./battleCore.js"].namespace.stepBattle(state, { kiteMode: "kite" }, { defendedDamage: () => 10, fireOutfitting: () => [] });
      const board = units.filter(modules["./battleMorale.js"].namespace.isBattleOnBoard);
      assert.equal(new Set(board.map(u => `${u.x},${u.y}`)).size, board.length);
      assert.ok(board.every(u => u.x >= 0 && u.x < size && u.y >= 0 && u.y < size));
    } while (!result.ended && state.tick < 60);
    assert.equal(result.ended, true, `${size}マスの混成${limit}対${limit}が制限時間内に決着する`);
  }
  console.log("可変戦場: サイズ境界・全編成の重複なし・2列配置と盤上上限・拡大/スクロール時のマス選択: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
