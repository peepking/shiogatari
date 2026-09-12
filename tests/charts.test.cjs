const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/** @returns {Promise<void>} 海図の予約・報酬・入場抽選・保存を検証する。 */
async function main() {
  const state = { funds: 1000, year: 1000, season: 0, position: { x: 20, y: 20 }, quests: { active: [] } };
  const events = [];
  const context = vm.createContext({ Math: Object.create(Math) });
  context.Math.random = () => 0;
  const mapData = Array.from({ length: 50 }, (_, y) => Array.from({ length: 50 }, () => ({ terrain: y < 25 ? "plain" : "sea", building: "none" })));
  /** @param {object} exports 公開値。 @returns {vm.Module} 依存モジュール。 */
  function mock(exports) {
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  }
  const modules = new Map([
    ["./state.js", mock({ state })], ["./map.js", mock({ mapData })],
    ["./events.js", mock({ enqueueEvent: e => events.push(e) })],
    ["./dom.js", mock({ pushLog: () => {}, pushToast: () => {} })],
  ]);
  /** @param {string} name ファイル。 @returns {Promise<vm.Module>} 実モジュール。 */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const module = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "..", name), "utf8"), { context });
    modules.set(name, module); await module.link(load); return module;
  }
  const root = await load("./chartWorld.js"); await root.evaluate();
  const base = await load("./expansionState.js"); await base.evaluate();
  const { createExpansionState, normalizeExpansionState } = base.namespace;
  const { chooseChart, assignChart, claimFragment, chartRoom, reconcileCharts, rollChartReward, visibleChartSites } = modules.get("./charts.js").namespace;
  const { offerQuestFragment, reserveQuestFragment, payQuestFunds, awardBattleFragment, rollChartRumor, syncChartReservations } = root.namespace;
  state.expansion = createExpansionState();
  const data = state.expansion.charts;
  const q = { id: 100, reward: 500 };
  offerQuestFragment(q);
  assert.equal(q.reward, 0); assert.equal(q.originalFunds, 500); assert.equal(data.active.length, 0);
  assert.equal(reserveQuestFragment(q), true); state.quests.active.push(q);
  const c = data.active[0];
  assert.equal(chartRoom(c), 2);
  const distance = Math.abs(c.destination.x - 20) + Math.abs(c.destination.y - 20);
  assert.ok(distance >= 10 && distance <= 20);
  assert.equal(awardBattleFragment(q.id), null);
  assert.equal(c.fragments, 0);
  const settlement = { id: "v1", coords: { x: 20, y: 20 } };
  rollChartRumor(settlement);
  assert.ok(c.rumor); assert.equal(chartRoom(c), 1);
  const rumorDistance = Math.abs(c.rumor.x - 20) + Math.abs(c.rumor.y - 20);
  assert.ok(rumorDistance >= 10 && rumorDistance <= 15);
  const count = events.length; rollChartRumor(settlement); assert.equal(events.length, count);
  assert.equal(awardBattleFragment(null).id, c.id); assert.equal(c.fragments, 1);
  assert.equal(chartRoom(c), 0);
  payQuestFunds(q); state.quests.active = [];
  assert.equal(state.funds, 1000); assert.equal(c.fragments, 2);
  payQuestFunds(q); assert.equal(c.fragments, 2);
  assert.equal(claimFragment(c, "battle"), false);
  assert.equal(claimFragment(c, "rumor"), true); assert.equal(c.fragments, 3);
  assert.equal(claimFragment(c, "rumor"), false);
  assert.equal(visibleChartSites(data)[0].kind, "altar");
  const second = chooseChart(data); assert.equal(second.size, 5);
  const c5 = assignChart(data, second, { x: 2, y: 2 });
  c5.fragments = 5;
  assert.equal(chooseChart(data), null); assert.equal(awardBattleFragment(null), null);
  const old = { id: 101, reward: 100, rewardFragment: { chartId: c.id, size: c.size, kind: c.kind } };
  assert.equal(reserveQuestFragment(old), false);
  const goods = ["spice", "arms", "textile", "brew", "leather"];
  for (const size of [3, 5]) {
    const r = rollChartReward({ kind: "inlet", size }, goods, () => 0);
    assert.equal(Object.keys(r.supplies).length, 5);
    assert.equal(Object.values(r.supplies).reduce((a, b) => a + b, 0), size === 3 ? 100 : 200);
    assert.equal(r.ships, size === 3 ? 2 : 4);
    const restoredInlet = normalizeExpansionState({ charts: { active: [{ id: 1, kind: "inlet", size, fragments: size, destination: { x: 2, y: 2 } }], pending: { chartId: 1, kind: "destination", dayApplied: true, reward: r } } });
    assert.ok(restoredInlet.charts.pending);
    assert.equal(Object.values(restoredInlet.charts.pending.reward.supplies).reduce((a, b) => a + b, 0), size === 3 ? 100 : 200);
    const altar = rollChartReward({ kind: "altar", size }, goods, () => 0.999999);
    assert.equal(altar.faith, size === 3 ? 110 : 220);
    assert.equal(altar.fame, size === 3 ? 11 : 22);
    assert.equal(rollChartReward({ kind: "treasure", size }, goods).funds, size === 3 ? 25000 : 50000);
  }
  data.pending = { chartId: c.id, kind: "destination", dayApplied: true, reward: rollChartReward(c, goods) };
  const restored = normalizeExpansionState(JSON.parse(JSON.stringify(state.expansion)));
  assert.equal(restored.charts.pending.dayApplied, true);
  assert.equal(restored.charts.active.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.charts.pending.reward)), JSON.parse(JSON.stringify(data.pending.reward)));
  data.pending = null;
  data.active = [];
  const empty = assignChart(data, { chartId: null, size: 3, kind: "treasure" }, { x: 1, y: 1 });
  empty.questIds.push(101);
  reconcileCharts(data, []); assert.equal(data.active.length, 0);
  const failed = { id: 102, reward: 500 }; offerQuestFragment(failed); reserveQuestFragment(failed); state.quests.active.push(failed);
  const save = normalizeExpansionState(JSON.parse(JSON.stringify(state.expansion)));
  reconcileCharts(save.charts, state.quests.active);
  assert.equal(save.charts.active[0].questIds[0], 102);
  state.quests.active = []; syncChartReservations(); assert.equal(data.active.length, 0);
  context.Math.random = () => 0.99;
  state.season = 1; rollChartRumor(settlement);
  context.Math.random = () => 0;
  rollChartRumor(settlement); assert.equal(data.active.length, 0);
  state.season = 2; rollChartRumor(settlement); assert.equal(data.active.length, 1);
  payQuestFunds({ reward: 700 }); assert.equal(state.funds, 1700);
  const corrupted = normalizeExpansionState({ charts: { active: [null, { ...c, destination: { x: -1, y: 1 } }], pending: { chartId: c.id, kind: "destination", dayApplied: true } } });
  assert.equal(corrupted.charts.active.length, 0); assert.equal(corrupted.charts.pending, null);
  const { enqueueChartMerchant, handleChartPurchase, rollChartMerchant, awardExplorationFragment } = root.namespace;
  state.expansion = createExpansionState(); state.funds = 10000; context.Math.random = () => 0;
  assert.equal(enqueueChartMerchant("sailor"), true);
  const purchase = JSON.parse(JSON.stringify(events.at(-1).actions[0]));
  context.Math.random = () => 0.99;
  handleChartPurchase(purchase);
  const bought = state.expansion.charts.active[0];
  assert.equal(bought.fragments, 1); assert.equal(state.funds, 9000);
  handleChartPurchase(purchase); assert.equal(state.funds, 9000);
  assert.equal(claimFragment(bought, "sailor"), false);
  assert.equal(claimFragment(bought, "archivist"), true);
  const persisted = normalizeExpansionState(JSON.parse(JSON.stringify(state.expansion)));
  assert.equal(persisted.charts.active[0].merchantClaims.length, 2);
  assert.equal(claimFragment(persisted.charts.active[0], "sailor"), false);
  bought.rumor = { x: 3, y: 3 };
  assert.equal(claimFragment(bought, "exploration"), false);
  state.expansion = createExpansionState(); context.Math.random = () => 0.99;
  enqueueChartMerchant("archivist");
  const fake = events.at(-1).actions[0];
  context.Math.random = () => 0;
  handleChartPurchase(fake);
  assert.equal(state.funds, 7000); assert.equal(state.expansion.charts.active.length, 0);
  enqueueChartMerchant("archivist"); state.funds = 1999;
  handleChartPurchase(events.at(-1).actions[0]); assert.equal(state.funds, 1999);
  assert.equal(state.expansion.charts.active.length, 0);
  const beforeMerchant = events.length;
  rollChartMerchant({ id: "port", kind: "village" }); assert.equal(events.length, beforeMerchant);
  rollChartMerchant({ id: "port", kind: "town" }); assert.equal(events.length, beforeMerchant + 1);
  rollChartMerchant({ id: "port", kind: "town" }); assert.equal(events.length, beforeMerchant + 1);
  state.expansion = normalizeExpansionState(JSON.parse(JSON.stringify(state.expansion)));
  rollChartMerchant({ id: "port", kind: "town" }); assert.equal(events.length, beforeMerchant + 1);
  assert.ok(awardExplorationFragment());
  assert.equal(state.expansion.charts.active[0].fragments, 1);
  console.log("海図の予約・完成・購入上限・偽物・入場抽選・復元: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
