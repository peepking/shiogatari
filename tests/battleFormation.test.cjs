const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const path = require("node:path");
/** @returns {Promise<void>} 射程順・配置重複・範囲・各配置の幅・少数から満員までの兵員保持を検証する。 */
async function main() {
  const module = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../battleFormation.js"), "utf8"));
  await module.link(() => {}); await module.evaluate();
  const plan = module.namespace.planBattleFormation;
  for (const kind of ["balance", "assault", "defense"]) {
    for (let short = 0; short <= 20; short++) for (let long = 0; long <= 20 - short; long++) {
      const units = Array.from({ length: short + long }, (_, i) => ({ id: i, range: i < long ? 5 : 2 }));
      const result = plan(units, kind, 10);
      assert.equal(result.length, units.length);
      assert.equal(new Set(result.map(p => `${p.x},${p.y}`)).size, units.length);
      assert.equal(new Set(result.map(p => p.unit)).size, units.length);
      assert.ok(result.every(p => [0, 1].includes(p.x) && p.y >= 0 && p.y < 10));
      const front = result.filter(p => p.x === 1);
      const back = result.filter(p => p.x === 0);
      assert.equal(front.length, Math.max(short + long - 10, Math.min(short, 10)));
      assert.ok(front.every(f => back.every(b => f.unit.range <= b.unit.range)));
      for (const column of [front, back]) {
        assert.ok(column.every((p, i) => !i || Math.abs(column[i - 1].y - 4.5) <= Math.abs(p.y - 4.5)));
        assert.ok(column.every((p, i) => !i || column[i - 1].unit.id < p.unit.id));
      }
      const frontRows = front.map(p => p.y).sort((a, b) => a - b);
      if (kind === "defense") assert.ok(frontRows.every((y, i) => !i || y - frontRows[i - 1] <= 2));
    }
  }
  const units = Array.from({ length: 10 }, (_, id) => ({ id, range: id < 5 ? 1 : 5 }));
  /** @param {string} kind 配置種別。 @returns {number} 前列の上下幅。 */
  function width(kind) {
    const rows = plan(units, kind, 10).filter(p => p.x === 1).map(p => p.y);
    return Math.max(...rows) - Math.min(...rows) + 1;
  }
  assert.equal(width("assault"), 5);
  assert.equal(width("balance"), 5);
  assert.equal(width("defense"), 7);
  const biased = units.slice(0, 3).concat(units.slice(5));
  assert.notDeepEqual(plan(biased, "balance", 10).map(p => p.y), plan(biased, "assault", 10).map(p => p.y));
  console.log("フォーメーションの射程・配置幅・全人数構成: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
