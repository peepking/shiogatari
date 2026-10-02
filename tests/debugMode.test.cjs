const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/**
 * 起動条件と通常起動での操作遮断を、実際の画面接続モジュールで検証する。
 * @param {string} url 起動URL。
 * @returns {Promise<object>} 検証用の状態・操作・公開値。
 */
async function environment(url) {
  const nodes = new Map();
  /** @param {string} id 要素ID。 @returns {object} 管理画面の操作を模擬する要素。 */
  function node(id) {
    if (!nodes.has(id)) {
      const handlers = new Map();
      nodes.set(id, { value: "0",
        /** @param {string} type 操作名。 @param {Function} handler 操作を保持する。 @returns {void} */
        addEventListener(type, handler) { handlers.set(type, handler); },
        /** @returns {void} 非表示の要素に対する手動クリックも模擬する。 */
        click() { handlers.get("click")?.(); },
      });
    }
    return nodes.get(id);
  }
  const location = new URL(url);
  const state = { fleet: { counts: { cog: 1, knarr: 2 } }, funds: 1000, faith: 0, fame: 0, expansion: { fishing: { codex: {} } } };
  const calls = { opened: 0, bound: 0, syncs: 0, unlocks: 0, confirms: 0, confirmed: true, logs: [] };
  const context = vm.createContext({ URLSearchParams, location, document: { getElementById: node },
    /** @returns {boolean} 図鑑全開放の確認結果。 */
    confirm() { calls.confirms++; return calls.confirmed; },
  });
  const elements = Object.fromEntries(["manualModalBtn", "manualModal", "manualModalClose", "shipsIn", "faithIn", "fundsIn", "fameIn"].map(id => [id, node(id)]));
  const mocks = {
    "state.js": { state },
    "dom.js": { elements,
      /** @param {string} title 操作名。 @returns {void} 保存経路のログ呼び出しを確認する。 */
      pushLog(title) { calls.logs.push(title); },
    },
    "troops.js": {
      /** @returns {object} 現在の部隊表示。 */
      formatTroopDisplay() { return { total: 10, cap: 30 }; },
    },
    "supplies.js": {
      /** @returns {object} 現在の物資表示。 */
      formatSupplyDisplay() { return { total: 10, cap: 60 }; },
    },
    "fishing.js": {
      /** @param {object} target 状態。 @returns {void} 全開放の呼び出しを検出する。 */
      unlockAllCodex(target) { calls.unlocks++; target.expansion.fishing.codex.test_fish = { count: 1 }; },
    },
  };
  const cache = new Map();
  /** @param {string} specifier 依存名。 @returns {vm.Module} 実モジュールまたは外部画面の代替。 */
  function get(specifier) {
    const name = specifier.replace(/^\.\//, "");
    if (!cache.has(name)) {
      const exports = mocks[name];
      cache.set(name, exports ? new vm.SyntheticModule(Object.keys(exports),
        /** @returns {void} 代替の公開値を設定する。 */
        function initialize() { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context })
        : new vm.SourceTextModule(readSource(name), { context, identifier: name }));
    }
    return cache.get(name);
  }
  const root = get("debugUI.js");
  await root.link(get); await root.evaluate();
  root.namespace.wireDebugTools({
    /** @returns {void} 手動上書き画面を開いた回数。 */
    openModal() { calls.opened++; },
    /** @returns {void} 手動上書き画面の接続回数。 */
    bindModal() { calls.bound++; },
    /** @returns {void} 状態反映の回数。 */
    syncUI() { calls.syncs++; },
  });
  return { node, state, calls, location, mode: cache.get("debugMode.js").namespace };
}

/** @returns {Promise<void>} 起動条件・クリック遮断・デバッグ操作の互換性を検証する。 */
async function main() {
  const enabled = await environment("http://localhost:5500/index.html?debug=1");
  const { isDebugLocation } = enabled.mode;
  for (const url of ["http://localhost/?debug=1", "http://127.0.0.1:8781/?debug=1", "http://[::1]/?debug=1", "http://localhost/?seed=1&debug=1"]) {
    assert.equal(isDebugLocation(new URL(url)), true, url);
  }
  for (const url of ["http://localhost/", "http://localhost/?debug", "http://localhost/?debug=0", "http://localhost/?debug=true",
    "http://localhost/?debug=1&debug=0", "https://peepking.github.io/shiogatari/?debug=1", "http://192.168.0.10/?debug=1",
    "https://localhost.example.com/?debug=1", "file:///index.html?debug=1"]) {
    assert.equal(isDebugLocation(new URL(url)), false, url);
  }
  assert.equal(isDebugLocation(undefined), false);
  for (const url of ["http://localhost/", "https://peepking.github.io/shiogatari/?debug=1"]) {
    const normal = await environment(url);
    const before = JSON.stringify(normal.state);
    normal.node("fundsIn").value = "99999";
    for (const id of ["manualModalBtn", "syncBtn", "unlockCodexBtn"]) normal.node(id).click();
    assert.equal(normal.mode.DEBUG_MODE, false);
    assert.equal(JSON.stringify(normal.state), before, "通常起動では直接クリックしても資産・図鑑を変更しない");
    assert.equal(normal.calls.opened + normal.calls.bound + normal.calls.syncs + normal.calls.unlocks + normal.calls.confirms, 0);
  }
  enabled.node("manualModalBtn").click(); assert.equal(enabled.calls.opened, 1);
  enabled.node("fundsIn").value = "4321"; enabled.node("faithIn").value = "10";
  enabled.node("shipsIn").value = "3"; enabled.node("fameIn").value = "20";
  enabled.node("syncBtn").click();
  assert.equal(enabled.state.funds, 4321); assert.equal(enabled.state.faith, 10);
  assert.equal(enabled.state.fleet.counts.cog, 3); assert.equal(enabled.state.fleet.counts.knarr, 2);
  assert.equal(enabled.calls.logs[0], "手動更新");
  enabled.calls.confirmed = false; enabled.node("unlockCodexBtn").click();
  assert.equal(enabled.calls.unlocks, 0, "確認を取り消すと図鑑を変えない");
  enabled.calls.confirmed = true; enabled.node("unlockCodexBtn").click();
  assert.equal(enabled.calls.unlocks, 1); assert.equal(enabled.calls.logs[1], "魚図鑑全開放");
  enabled.location.search = "";
  assert.equal(enabled.mode.DEBUG_MODE, true, "判定はその起動で固定し、次回起動時に切り替える");
  assert.equal("debug" in enabled.state, false);
  assert.equal("debugMode" in enabled.state, false);
  console.log("デバッグ起動: ローカル判定・明示指定・通常起動の操作遮断・管理操作の検証成功");
}

/** @param {Error} error 検証失敗。 @returns {void} 失敗を報告する。 */
function reportFailure(error) { console.error(error); process.exitCode = 1; }
main().catch(reportFailure);
