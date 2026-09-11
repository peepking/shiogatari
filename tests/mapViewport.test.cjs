const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/** @returns {Promise<void>} 循環順・地図端の表示範囲・描画幅を検証する。 */
async function main() {
  const module = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../mapViewport.js"), "utf8"));
  await module.link(() => {}); await module.evaluate();
  const { nextMapMode, mapViewport } = module.namespace;
  assert.equal(nextMapMode("full"), "nearby");
  assert.equal(nextMapMode("nearby"), "zoom");
  assert.equal(nextMapMode("zoom"), "full");
  for (const [mode, cells] of [["full", 50], ["nearby", 19], ["zoom", 9]]) {
    for (const x of [0, 25, 49]) for (const y of [0, 25, 49]) {
      const view = mapViewport(mode, { x, y });
      assert.equal(view.cells, cells);
      assert.ok(Math.abs(view.cells * view.cellSize - 700) < 0.00001);
      assert.ok(view.startX >= 0 && view.startX + cells <= 50);
      assert.ok(view.startY >= 0 && view.startY + cells <= 50);
      assert.ok(x >= view.startX && x < view.startX + cells);
      assert.ok(y >= view.startY && y < view.startY + cells);
    }
  }
  assert.equal(mapViewport("nearby", { x: 25, y: 25 }).detailed, true);
  console.log("地図3段階・表示範囲・固定描画幅: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
