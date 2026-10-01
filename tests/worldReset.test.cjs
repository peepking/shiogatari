const { readSource } = require("./helpers/source.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const mapSource = readSource("map.js");
const uiSource = readSource("ui.js");
const state = { logs: ["既存のログ"], funds: 99 };
const logEl = { innerHTML: "既存のログ" };
const calls = { resets: [], outputs: 0, syncs: 0 };
const nodes = new Map();

/** 入力・フォーカス・イベントを保持する画面要素を作る。 @param {string} id 要素ID。 @returns {object} 要素。 */
function createElement(id) {
  const handlers = new Map();
  return {
    id, hidden: id === "resetModal", dataset: {}, value: "", textContent: "", attributes: {},
    /** 操作ハンドラーを保持する。 @param {string} event イベント名。 @param {Function} handler 操作処理。 */
    addEventListener(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
    /** 操作を実行する。 @param {string} event イベント名。 @param {object} options イベント内容。 */
    fire(event, options = {}) {
      for (const handler of handlers.get(event) || []) handler({ target: this, preventDefault: noop, ...options });
    },
    /** 要素にフォーカスを移す。 */
    focus() { context.document.activeElement = this; },
    /** 入力文字列を選択する。 */
    select() { this.selected = true; },
    /** 属性を設定する。 @param {string} name 属性名。 @param {string} value 値。 */
    setAttribute(name, value) { this.attributes[name] = value; },
    /** 属性を削除する。 @param {string} name 属性名。 */
    removeAttribute(name) { delete this.attributes[name]; },
  };
}

const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
for (const id of ["resetBtn", "resetModal", "resetForm", "resetSeedInput", "resetSeedRandom", "resetSeedError", "resetModalClose", "resetCancel", "resetConfirm"]) {
  assert.ok(html.includes(`id="${id}"`), `${id} が実画面に存在する`);
  nodes.set(id, createElement(id));
}

/** 初期化に必要な外部処理を省略する。 @returns {void} */
function noop() {}

const context = vm.createContext({
  state, elements: { logEl }, settlements: [],
  randomValue: 0.5, calls,
  Math: Object.assign(Object.create(Math), {
    /** 抽選の境界を検証するため乱数値を固定する。 @returns {number} 乱数。 */
    random() { return context.randomValue; },
  }),
  document: {
    dispatchEvent: noop,
    querySelectorAll() { return [...nodes.values()].filter(node => node.id === "resetModal"); },
    /** リセット画面の要素だけを用意する。 @param {string} id 要素ID。 @returns {object|null} 要素。 */
    getElementById(id) { return nodes.get(id) || null; },
  },
  CustomEvent: class { constructor(type) { this.type = type; } },
  /** 実際のマップ生成処理でシードの伝達を確認する。 @param {number} seed シード。 */
  buildWorld(seed) { calls.resets.push(seed); context.mapData = context.generateMap(seed); },
  /** ゲーム状態を初期化する。 */
  resetState() { state.logs = []; state.funds = 1000; },
  /** 表示更新を記録する。 */
  setOutput() { calls.outputs++; },
  /** UI同期を記録する。 */
  syncUI() { calls.syncs++; },
  /** 起動ログを記録する。 @param {string} title タイトル。 @param {string} message 本文。 */
  pushLog(title, message) { state.logs.push({ title, message }); },
  refreshShipyard: noop, shipyardSeason: noop, resetSettlementSupport: noop,
  ensureFactionState: noop, seedWarDefaults: noop, ensureNobleHomes: noop,
  seedInitialQuests: noop, ensureSeasonalQuests: noop, getCurrentSettlement: noop,
  resetEncounterMeter: noop,
});

/** 実ソースから関数を読み込む。 @param {string} source ソース。 @param {string} name 関数名。 */
function loadFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} が存在する`);
  vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
}

for (const name of ["MAP_SIZE", "DEFAULT_WORLD_SEED"]) {
  const declaration = mapSource.match(new RegExp(`export const ${name} = [^;]+;`));
  assert.ok(declaration);
  vm.runInContext(declaration[0].replace("export ", ""), context);
}
for (const name of ["generateMap", "resetWorld"]) loadFunction(mapSource, name);
loadFunction(readSource("worldResetUI.js"), "wireWorldResetUI");
for (const name of ["resetAndSeedAll", "openModal", "closeModal", "bindCoreUtilityButtons"]) loadFunction(uiSource, name);
vm.runInContext("bindCoreUtilityButtons(); bindCoreUtilityButtons()", context);
const trigger = nodes.get("resetBtn");
const modal = nodes.get("resetModal");
const input = nodes.get("resetSeedInput");
const error = nodes.get("resetSeedError");
const form = nodes.get("resetForm");
const randomButton = nodes.get("resetSeedRandom");

/** 入力欄からリセットを確定する。 @param {string} value シードの入力。 */
function reset(value = "12345") {
  trigger.fire("click");
  assert.equal(input.value, "2025");
  assert.equal(modal.hidden, false);
  assert.equal(context.document.activeElement, input);
  input.value = value;
  form.fire("submit");
}

vm.runInContext("resetWorld()", context);
assert.equal(calls.resets.at(-1), 2025);
const defaultMap = JSON.stringify(context.mapData);
reset();
assert.equal(calls.resets.at(-1), 12345);
assert.equal(calls.resets.length, 2, "二重初期化しても確定時のリセットは一度だけ");
assert.equal(modal.hidden, true);
assert.equal(context.document.activeElement, trigger);
assert.equal(state.funds, 1000);
assert.equal(logEl.innerHTML, "");
assert.match(state.logs[0].message, /12345/);
const selectedMap = JSON.stringify(context.mapData);
assert.notEqual(selectedMap, defaultMap);
reset();
assert.equal(JSON.stringify(context.mapData), selectedMap, "同じシードの地形・建物配置を再現する");

for (const input of ["", "   ", "2025"]) {
  reset(input);
  assert.equal(calls.resets.at(-1), 2025);
  assert.equal(JSON.stringify(context.mapData), defaultMap);
}
for (const [input, seed] of [["0", 0], [" 42 ", 42], ["4294967295", 4294967295]]) {
  reset(input);
  assert.equal(calls.resets.at(-1), seed);
}

/** ゲーム状態と描画の検証用記録を返す。 @returns {string} 状態記録。 */
function snapshot() {
  return JSON.stringify({ state, logEl, map: context.mapData, calls });
}
for (const value of ["abc", "-1", "1.5", "4294967296", "Infinity", "1e3", "0x10"]) {
  const before = snapshot();
  reset(value);
  assert.equal(snapshot(), before);
  assert.equal(modal.hidden, false);
  assert.match(error.textContent, /整数/);
  assert.equal(input.attributes["aria-invalid"], "true");
  input.fire("input");
  assert.equal(error.textContent, "");
  assert.equal(input.attributes["aria-invalid"], undefined);
}

for (const [value, expected] of [[0, "0"], [0.5, "2147483648"], [1 - 1 / 0x100000000, "4294967295"]]) {
  const before = snapshot();
  context.randomValue = value;
  randomButton.fire("click");
  assert.equal(input.value, expected);
  assert.equal(snapshot(), before, "ランダム生成だけではゲーム状態を変更しない");
  assert.equal(context.document.activeElement, input);
}
form.fire("submit");
assert.equal(calls.resets.at(-1), 4294967295);
assert.equal(modal.hidden, true);

for (const id of ["resetCancel", "resetModalClose", "resetModal"]) {
  const before = snapshot();
  trigger.fire("click");
  randomButton.fire("click");
  nodes.get(id).fire("click");
  assert.equal(modal.hidden, true);
  assert.equal(snapshot(), before);
  assert.equal(context.document.activeElement, trigger);
}
trigger.fire("click");
modal.fire("click", { target: input });
assert.equal(modal.hidden, false, "内容をクリックしても取り消さない");
nodes.get("resetModalClose").focus();
modal.fire("keydown", { key: "Tab", shiftKey: true });
assert.equal(context.document.activeElement, nodes.get("resetConfirm"));
modal.fire("keydown", { key: "Tab", shiftKey: false });
assert.equal(context.document.activeElement, nodes.get("resetModalClose"));
const beforeCancel = snapshot();
modal.fire("keydown", { key: "Escape" });
assert.equal(modal.hidden, true);
form.fire("submit");
assert.equal(snapshot(), beforeCancel, "Escapeや閉じたフォームの送信ではリセットしない");
console.log("リセットのシード指定・既定値・地形再現・ランダム生成・取消・不正値: 全項目成功");
