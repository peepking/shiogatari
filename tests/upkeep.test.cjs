const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const path = require("node:path");

/**
 * 食料消費日・季節境界と旧形式を含む兵員の維持費、昇級内訳を検証する。
 * @returns {Promise<void>}
 */
async function main() {
  const state = { day: 1, funds: 10, supplies: { food: 1 }, troops: { infantry: 5, archer: { 1: 5 } } };
  const modules = new Map();
  /**
   * 表示と状態の依存を分離して対象モジュールを読み込む。
   * @param {string} name モジュール名。
   * @returns {Promise<object>} 検証用モジュール。
   */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    let source;
    if (name === "./dom.js") source = "export function confirmAction() {} export function pushLog() {} export function pushToast() {}";
    else if (name === "./state.js") {
      const module = new vm.SyntheticModule(["state"], function () { this.setExport("state", state); });
      modules.set(name, module);
      return module;
    } else source = await fs.readFile(path.join(__dirname, "..", name), "utf8");
    const module = new vm.SourceTextModule(source);
    modules.set(name, module);
    await module.link(load);
    return module;
  }
  const troops = await load("./troops.js");
  await troops.evaluate();
  const { getUpkeepForecast } = modules.get("./upkeep.js").namespace;
  const { TROOP_STATS, levelUpTroopsRandom } = troops.namespace;
  for (const [day, foodDays, fundsDays] of [[1,9,30],[10,20,21],[20,10,11],[30,10,1]]) {
    state.day = day;
    const result = getUpkeepForecast(state, TROOP_STATS);
    assert.equal(result.foodDays, foodDays);
    assert.equal(result.fundsDays, fundsDays);
    assert.equal(result.funds, 25);
    assert.equal(result.food, 2);
    assert.equal(result.fundsShortage, 15);
    assert.equal(result.foodShortage, 1);
  }
  state.troops = { infantry: { 3: 1 } };
  const promotions = [];
  assert.equal(levelUpTroopsRandom(5, promotions), 2);
  assert.deepEqual(JSON.parse(JSON.stringify(promotions)), [
    { type: "infantry", from: 3, to: 4, count: 1 },
    { type: "infantry", from: 4, to: 5, count: 1 },
  ]);
  assert.equal(state.troops.infantry[5], 1);
  console.log("維持費の境界・昇級内訳: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
