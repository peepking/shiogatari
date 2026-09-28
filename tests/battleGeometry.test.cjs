const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const path = require("node:path");
/** @returns {Promise<void>} 全サイズの配置と、拡大・スクロール時の選択位置を検証する。 */
async function main() {
  const geometry = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../battleGeometry.js"), "utf8"));
  const formation = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../battleFormation.js"), "utf8"));
  await geometry.link(() => {}); await geometry.evaluate(); await formation.link(() => {}); await formation.evaluate();
  const { selectBattleSize, deploymentDepth, battleCellAt } = geometry.namespace;
  const modules = {};
  for (const name of ["battleCore", "battleMorale", "battleMovement", "battleReinforcements"])
    modules[`./${name}.js`] = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, `../${name}.js`), "utf8"));
  await modules["./battleCore.js"].link(name => modules[name]); await modules["./battleCore.js"].evaluate();
  assert.deepEqual([0, 5, 6, 10, 11, 15, 16, 20].map(selectBattleSize), [8, 8, 10, 10, 12, 12, 15, 15]);
  for (const size of [8, 10, 12, 15]) {
    assert.ok(deploymentDepth(size) * size >= 20);
    for (const kind of ["balance", "assault", "defense"]) for (let total = 1; total <= 20; total++) for (let melee = 0; melee <= total; melee++) {
      const units = Array.from({ length: total }, (_, id) => ({ id, role: id < melee ? "melee" : "ranged", range: id < melee ? 1 : 4 }));
      const positions = formation.namespace.planBattleFormation(units, kind, size);
      assert.equal(positions.length, total);
      assert.equal(new Set(positions.map(p => `${p.x},${p.y}`)).size, total);
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
      const army = Array.from({ length: 20 }, (_, index) => ({ id: `${side}-${index}`, name: "兵", side,
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
    assert.equal(result.ended, true, `${size}マスの混成20対20が制限時間内に決着する`);
  }
  console.log("可変戦場: サイズ境界・全編成の重複なし・3列配置・拡大/スクロール時のマス選択: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
