const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/** @returns {Promise<void>} 初期配置・日次・固定報酬・予約・復元を検証する。 */
async function main() {
  const modules = new Map();
  /** @param {string} name ファイル名。 @returns {Promise<vm.Module>} 対象モジュール。 */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const module = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "..", name), "utf8"));
    modules.set(name, module); await module.link(load); return module;
  }
  const module = await load("./expansionState.js"); await module.evaluate();
  const { createExpansionState, normalizeExpansionState } = module.namespace;
  const { initializeExploration, tickExploration, rollExplorationReward, consumeExploration, describeDanger } = modules.get("./exploration.js").namespace;
  const data = createExpansionState().exploration;
  const map = Array.from({ length: 10 }, (_, y) => Array.from({ length: 10 }, () => ({ terrain: y < 5 ? "sea" : "plain", building: "none" })));
  map[5][0].building = "town";
  /** @returns {number} 必ず抽選を当てる。 */
  function zero() { return 0; }
  /** @returns {number} 出現を見送る。 */
  function high() { return 0.999999; }
  initializeExploration(data, map, 100, new Set(["0,0"]), zero);
  assert.equal(data.sites.length, 3);
  assert.equal(new Set(data.sites.map(s => `${s.position.x},${s.position.y}`)).size, 3);
  assert.ok(!data.sites.some(s => s.position.x === 0 && [0, 5].includes(s.position.y)));
  const initial = JSON.stringify(data);
  initializeExploration(data, map, 100, new Set(), high);
  assert.equal(JSON.stringify(data), initial);
  for (let day = 101; day <= 110; day++) tickExploration(data, map, day, new Set(), zero);
  assert.equal(data.sites.filter(s => s.kind === "wreck").length, 2);
  assert.equal(data.sites.filter(s => s.kind !== "wreck").length, 5);
  const unchanged = JSON.stringify(data);
  tickExploration(data, map, 110, new Set(), zero);
  assert.equal(JSON.stringify(data), unchanged);
  const goods = ["spice", "arms", "textile", "brew", "leather"];
  const reward = rollExplorationReward("wreck", goods, ["infantry", "archer"], zero);
  assert.equal(reward.funds, 900);
  assert.equal(reward.ships, 1);
  assert.equal(Object.keys(reward.supplies).length, 2);
  assert.equal(Object.values(reward.supplies).reduce((a, b) => a + b, 0), 4);
  assert.equal(reward.troops.infantry, 3);
  const maxReward = rollExplorationReward("wreck", goods, ["infantry"], high);
  assert.equal(maxReward.funds, 1100);
  assert.equal(maxReward.ships, 0);
  assert.equal(maxReward.troops.infantry, 5);
  const site = data.sites[0];
  data.pending = { siteId: site.id, dayApplied: true, reward, encounter: null };
  tickExploration(data, map, 400, new Set(), high);
  assert.equal(data.sites.length, 1);
  const restored = normalizeExpansionState(JSON.parse(JSON.stringify({ exploration: data })));
  assert.equal(restored.exploration.pending.reward.funds, 900);
  assert.equal(consumeExploration(restored.exploration, true).funds, 900);
  assert.equal(consumeExploration(restored.exploration, true), null);
  assert.equal(restored.exploration.sites.length, 0);
  assert.equal(consumeExploration(data, false), null);
  assert.equal(data.sites.length, 0);
  const bad = normalizeExpansionState({ exploration: { sites: [null, { ...site, position: { x: -1, y: 1 } }], pending: { siteId: site.id } } });
  assert.equal(bad.exploration.pending, null);
  assert.equal(bad.exploration.sites.length, 0);
  assert.ok(describeDanger(0).includes("0%"));
  assert.ok(describeDanger(1).includes("100%"));
  console.log("自然探索の配置・上限・期限・報酬・復元: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
