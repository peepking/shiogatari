const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/** @returns {Promise<void>} 海図探索の保存中断・日数・報酬の一度だけの適用を検証する。 */
async function main() {
  const state = { day: 10, modeLabel: "normal", funds: 1000, ships: 0, faith: 0, fame: 0, supplies: {}, expansion: { charts: {} } };
  let world = { days: 0 }; let fail = false; let saved; const events = [];
  const context = vm.createContext({ structuredClone });
  /** @param {object} values 公開値。 @returns {vm.Module} 検証用依存。 */
  function mock(values) {
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  }
  const modules = new Map([
    ["./state.js", mock({ state })],
    ["./constants.js", mock({ MODE_LABEL: { NORMAL: "normal", PREP: "prep" } })],
    ["./chartWorld.js", mock({ chartLabel: () => "海図", announceFragment: c => events.push(c.fragments) })],
    ["./dom.js", mock({ confirmAction: () => {}, pushToast: () => {}, pushLog: () => {} })],
    ["./events.js", mock({ enqueueEvent: e => events.push(e) })],
    ["./supplies.js", mock({ SUPPLY_ITEMS: [{ id: "spice", name: "香辛料" }], SUPPLY_TYPES: {} })],
    ["./time.js", mock({ advanceDayWithEvents: n => { state.day += n; world.days += n; } })],
    ["./map.js", mock({ snapshotWorld: () => world, restoreWorld: value => { world = value; }, focusMapPosition: () => {} })],
    ["./storage.js", mock({ saveGameToStorage: () => { if (fail) return false; saved = structuredClone(state); return true; } })],
  ]);
  /** @param {string} name ファイル。 @returns {Promise<vm.Module>} 読み込んだモジュール。 */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const m = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "..", name), "utf8"), { context });
    modules.set(name, m); await m.link(load); return m;
  }
  const root = await load("./chartUI.js"); await root.evaluate();
  const { resumeChartExploration } = root.namespace;
  /** @param {boolean} applied 日数適用済みか。 @returns {void} 完成地点の予約を用意する。 */
  function seed(applied) {
    state.expansion.charts = { active: [{ id: 1, kind: "inlet", size: 3, fragments: 3 }], pending: {
      chartId: 1, kind: "destination", dayApplied: applied, reward: { funds: 0, ships: 1, faith: 0, fame: 10, supplies: { spice: 50 } },
    } };
  }
  seed(false); fail = true;
  resumeChartExploration(() => {});
  assert.equal(state.day, 10); assert.equal(world.days, 0); assert.equal(state.ships, 0);
  assert.equal(state.expansion.charts.pending.dayApplied, false); assert.equal(state.modeLabel, "prep");
  fail = false;
  resumeChartExploration(() => {});
  assert.equal(state.day, 11); assert.equal(world.days, 1); assert.equal(state.ships, 1); assert.equal(state.supplies.spice, 50);
  assert.equal(state.expansion.charts.active.length, 0); assert.equal(saved.expansion.charts.pending, null);
  resumeChartExploration(() => {}); assert.equal(state.ships, 1); assert.equal(state.day, 11);
  seed(true); resumeChartExploration(() => {});
  assert.equal(state.day, 11); assert.equal(state.ships, 2);
  state.expansion.charts = { active: [{ id: 2, kind: "altar", size: 3, fragments: 2, rumor: { x: 1, y: 1 }, questIds: [] }],
    pending: { chartId: 2, kind: "rumor", dayApplied: false, reward: null } };
  resumeChartExploration(() => {});
  assert.equal(state.day, 12); assert.equal(state.expansion.charts.active[0].fragments, 3);
  assert.equal(state.expansion.charts.active[0].rumor, null); assert.equal(state.expansion.charts.pending, null);
  resumeChartExploration(() => {}); assert.equal(state.day, 12);
  console.log("海図探索の保存失敗・再開・日数・二重報酬防止: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
