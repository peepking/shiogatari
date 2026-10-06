const { readSource } = require("./helpers/source.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");

/** @returns {Promise<void>} 海図探索の保存中断・日数・報酬の一度だけの適用を検証する。 */
async function main() {
  const state = { day: 10, modeLabel: "normal", funds: 1000, ships: 0, faith: 0, fame: 0, supplies: {}, expansion: { charts: {} } };
  let world = { days: 0 }; let fail = false; let failAt = null; let writes = 0; let saved; const events = [];
  const context = vm.createContext({ structuredClone });
  /** @param {object} values 公開値。 @returns {vm.Module} 検証用依存。 */
  function mock(values) {
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  }
  const modules = new Map([
    ["./dangerousSeaHazards.js", mock({ beginDangerousSeaAction: () => 1, finishDangerousSeaAction: () => {}, dangerousSeaActionBlocked: () => false })],
    ["./state.js", mock({ state })],
    ["./constants.js", mock({ MODE_LABEL: { NORMAL: "normal", PREP: "prep" } })],
    ["./chartWorld.js", mock({ chartLabel: () => "海図", announceFragment: c => events.push(c.fragments) })],
    ["./dom.js", mock({ confirmAction: () => {}, pushToast: () => {}, pushLog: () => {} })],
    ["./events.js", mock({ enqueueEvent: e => events.push(e) })],
    ["./supplies.js", mock({ SUPPLY_ITEMS: [{ id: "spice", name: "香辛料" }], SUPPLY_TYPES: {}, formatSupplyDisplay: () => ({ total: Object.values(state.supplies).reduce((sum, qty) => sum + qty, 0), cap: 60 }) })],
    ["./troops.js", mock({ formatTroopDisplay: () => ({ total: 0, cap: 30 }) })],
    ["./time.js", mock({ advanceDayWithEvents: n => { state.day += n; world.days += n; } })],
    ["./map.js", mock({ snapshotWorld: () => world, restoreWorld: value => { world = value; }, focusMapPosition: () => {} })],
    ["./storage.js", mock({ saveGameToStorage: () => { writes++; if (fail || writes === failAt) return false; saved = structuredClone(state); return true; } })],
  ]);
  /** @param {string} name ファイル。 @returns {Promise<vm.Module>} 読み込んだモジュール。 */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const m = new vm.SourceTextModule(await readSource(name), { context });
    modules.set(name, m); await m.link(load); return m;
  }
  const fleet = await load("./fleet.js"); await fleet.evaluate();
  const { totalShips, migrateFleet } = fleet.namespace;
  migrateFleet(state);
  state.voyageStats = modules.get("./voyageStats.js").namespace.createVoyageStats(state);
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
  assert.equal(state.day, 10); assert.equal(world.days, 0); assert.equal(totalShips(state.fleet), 0);
  assert.equal(state.expansion.charts.pending.dayApplied, false); assert.equal(state.modeLabel, "prep");
  assert.equal(state.voyageStats.chartsCompleted, 0, "報酬確定前の保存中断を達成へ含めない");
  fail = false;
  resumeChartExploration(() => {});
  assert.equal(state.day, 11); assert.equal(world.days, 1); assert.equal(totalShips(state.fleet), 1); assert.equal(state.supplies.spice, 50);
  assert.equal(state.expansion.charts.active.length, 0); assert.equal(saved.expansion.charts.pending, null);
  assert.equal(state.voyageStats.chartsCompleted, 1); assert.equal(saved.voyageStats.chartsCompleted, 1);
  assert.ok(!events.at(-1).body.includes("上限超過"), "上限内なら整理の注意を出さない");
  resumeChartExploration(() => {}); assert.equal(totalShips(state.fleet), 1); assert.equal(state.day, 11);
  assert.equal(state.voyageStats.chartsCompleted, 1, "結果の再表示で達成数を増やさない");
  seed(true); resumeChartExploration(() => {});
  assert.equal(state.day, 11); assert.equal(totalShips(state.fleet), 2);
  assert.equal(state.voyageStats.chartsCompleted, 2, "日数適用済みの探索も報酬回収時に一度だけ数える");
  assert.ok(events.at(-1).body.includes("物資40個が上限超過"), "超過した対象と量を結果に知らせる");
  assert.ok(!events.at(-1).body.includes("兵員"), "超過していない兵員の注意を出さない");
  state.expansion.charts = { active: [{ id: 2, kind: "altar", size: 3, fragments: 2, rumor: { x: 1, y: 1 }, questIds: [] }],
    pending: { chartId: 2, kind: "rumor", dayApplied: false, reward: null } };
  resumeChartExploration(() => {});
  assert.equal(state.day, 12); assert.equal(state.expansion.charts.active[0].fragments, 3);
  assert.equal(state.expansion.charts.active[0].rumor, null); assert.equal(state.expansion.charts.pending, null);
  assert.equal(state.voyageStats.chartsCompleted, 2, "噂の回収で断片が揃っても、まだ達成数を増やさない");
  resumeChartExploration(() => {}); assert.equal(state.day, 12);
  seed(false); failAt = writes + 2;
  resumeChartExploration(() => {});
  assert.equal(state.day, 12); assert.equal(world.days, 2); assert.equal(totalShips(state.fleet), 2);
  assert.equal(state.voyageStats.chartsCompleted, 2, "日数チェックポイントの保存失敗でも統計を維持する");
  failAt = null; resumeChartExploration(() => {});
  assert.equal(state.voyageStats.chartsCompleted, 3);
  Object.assign(state, structuredClone(saved));
  resumeChartExploration(() => {});
  assert.equal(state.voyageStats.chartsCompleted, 3, "保存復元後に回収済み海図を重複加算しない");
  console.log("海図探索の保存失敗・再開・日数・二重報酬防止: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
