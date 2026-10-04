const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/**
 * 実際の釣り画面関数を抽出し、手製のブラウザ文脈へ組み込む。
 * @param {string[]} names 検証対象。
 * @param {object} context ブラウザ文脈。
 * @returns {void} 組み込み完了。
 */
function loadFunctions(names, context) {
  const source = readSource("fishingUI.js");
  for (const name of names) {
    const body = source.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(body, `${name}を読み込める`);
    vm.runInContext(body, context);
  }
}

const state = {
  modeLabel: "normal", year: 1000, season: 0, day: 1, position: { x: 0, y: 49 },
  dangerousSeas: { action: null },
  expansion: { fishing: { rodId: "rod_basic", pending: null, bait: { insect: 5 }, counts: {}, codex: {} } },
};
let blocked = false;
let saved = true;
let begins = 0;
let finishes = 0;
let dangerous = true;
let draws = 0;
let redraws = 0;
const calls = [];
const context = vm.createContext({
  state, MODE_LABEL: { NORMAL: "normal" }, FISHING_CONFIG: { castsPerSession: 5 },
  BAIT_DEFS: { insect: { name: "虫餌" } }, structuredClone,
  elements: { fishingModal: { hidden: false } }, panelLocation: { x: 0, y: 49 }, resultScreen: null,
  document: { getElementById: () => ({ value: "insect" }), dispatchEvent() {} }, CustomEvent: class {}, panelSync: () => calls.push("sync"),
  currentEnv: () => ({ sea: true, regionId: "sw", season: 0, depth: "sea", dangerousSea: dangerous ? { regionId: "sw", level: "core" } : null }),
  absDay: value => value.year * 120 + value.season * 30 + value.day,
  dangerousSeaActionBlocked: () => blocked || !!(state.dangerousSeas.action || state.dangerousSeas.pendingHazard),
  beginDangerousSeaAction: kind => {
    assert.equal(kind, "fishing");
    assert.ok(!state.expansion.fishing.pending?.dayApplied, "日数適用前に行動開始を記録する");
    begins++;
    state.dangerousSeas.action = { id: `fishing-${begins}`, kind };
    return state.dangerousSeas.action.id;
  },
  finishDangerousSeaAction: kind => {
    assert.equal(kind, "fishing");
    assert.equal(state.expansion.fishing.pending, null, "残り投数を破棄してから危険を解決待ちにする");
    finishes++;
    if (state.dangerousSeas.pendingHazard?.stage === "action_running") state.dangerousSeas.pendingHazard.stage = "ready";
    state.dangerousSeas.action = null;
    calls.push("finish");
  },
  refreshFishingDay() {}, confirmAction: options => options.onConfirm(),
  saveGameToStorage: () => { calls.push("save"); return saved; },
  snapshotWorld: () => ({}), restoreWorld() {}, pushToast() {}, pushLog() {},
  advanceDayWithEvents: days => { state.day += days; },
  renderFishingPanel: () => { redraws++; }, openFishingPanel: () => assert.fail("表示中は直接再描画する"),
  biteActive: () => false, isWaiting: () => false, clearSessionTimer() {}, cancelBite() {},
  canSell: () => false, consumeBait: (value, bait) => { value.expansion.fishing.bait[bait]--; return true; },
  rollDangerousSeaCatch: environment => { assert.equal(environment.codex, state.expansion.fishing.codex); draws++; return { id: "dangouo" }; },
  rollCatch: environment => { assert.equal(environment.depth, "sea"); draws++; return { id: "aji" }; },
  biteWaitMs: () => 1000,
  speciesById: id => ({ id, name: id }), rollSize: () => 10,
  migrationFishIds: () => [],
  catchRecordFacts: () => ({ firstCatch: true, maxUpdate: true }),
  recordCatch: (value, caught) => { value.expansion.fishing.counts[caught.species.id] = 1; },
});
loadFunctions(["fishingDangerBlocked", "canContinueFishing", "beginFishing", "resumeFishing", "doCast", "closeFishingPanel"], context);

// 同じ日の再開・五投では日数と日次危険を増やさない。
vm.runInContext("beginFishing()", context);
assert.equal(state.day, 2);
assert.equal(begins, 1);
state.dangerousSeas.pendingHazard = { stage: "action_running" };
vm.runInContext("resumeFishing()", context);
assert.equal(state.day, 2);
assert.equal(begins, 1);
vm.runInContext("doCast()", context);
assert.equal(state.expansion.fishing.pending.hookSpeciesId, "dangouo");
assert.equal(state.expansion.fishing.bait.insect, 4);
assert.equal(state.day, 2);
assert.equal(finishes, 0, "一投の途中で危険を開かない");
assert.equal(draws, 1);

blocked = true;
state.dangerousSeas.pendingHazard = { stage: "ready" };
vm.runInContext("doCast()", context);
assert.equal(draws, 1, "解決待ちの危険中は餌消費も抽選もしない");
assert.equal(state.expansion.fishing.bait.insect, 4);
blocked = false;
state.dangerousSeas.pendingHazard = null;
dangerous = false;
vm.runInContext("doCast()", context);
assert.equal(state.expansion.fishing.pending.hookSpeciesId, "aji", "通常海域では通常抽選へ戻る");
const beforeFailedCast = JSON.stringify(state.expansion.fishing);
saved = false;
vm.runInContext("doCast()", context);
assert.equal(JSON.stringify(state.expansion.fishing), beforeFailedCast, "投の保存失敗では餌と残り投数と待機状態を戻す");
saved = true;

calls.length = 0;
vm.runInContext("closeFishingPanel()", context);
assert.equal(state.expansion.fishing.pending, null);
assert.equal(finishes, 1);
assert.ok(calls.indexOf("finish") < calls.indexOf("sync"), "別行動に移る前に危険を解決待ちにする");

blocked = true;
vm.runInContext("beginFishing()", context);
assert.equal(begins, 1);
assert.equal(state.day, 2);
blocked = false;
saved = false;
const previousDanger = structuredClone(state.dangerousSeas);
vm.runInContext("beginFishing()", context);
assert.equal(state.expansion.fishing.pending, null);
assert.deepEqual(state.dangerousSeas, previousDanger, "初回保存失敗では危険行動の開始も戻す");
assert.equal(state.day, 2);
assert.ok(redraws > 0);

// 五投目の釣果を保存してから確認を待ち、確認後にだけ保留危険を解決待ちへ移す。
saved = true;
state.dangerousSeas.action = { id: "five-casts", kind: "fishing" };
state.dangerousSeas.pendingHazard = { stage: "action_running" };
state.expansion.fishing.pending = { castsLeft: 0, catch: { speciesId: "dangouo", windowSeconds: 2 } };
loadFunctions(["resolveBite", "wireSessionButtons"], context);
const finishedBefore = finishes;
vm.runInContext("resolveBite(true)", context);
assert.equal(state.expansion.fishing.pending, null);
assert.equal(state.expansion.fishing.counts.dangouo, 1);
assert.equal(finishes, finishedBefore, "最終釣果の表示中は危険を発生させない");
assert.equal(state.dangerousSeas.pendingHazard.stage, "action_running");
let confirmResult;
context.document = {
  getElementById: id => id === "fishingNextBtn" ? { addEventListener: (type, listener) => { confirmResult = listener; } } : null,
  querySelector: () => ({ open: false }),
};
vm.runInContext("wireSessionButtons()", context);
confirmResult();
assert.equal(finishes, finishedBefore + 1);
assert.equal(state.dangerousSeas.pendingHazard.stage, "ready");
assert.equal(context.elements.fishingModal.hidden, true, "最終確認後は釣り画面を閉じて危険を表示できる");
assert.equal(state.day, 2);

// 日数適用前で止まった旧保存は、欠けている行動を補完してから一日だけ進める。
state.dangerousSeas = { action: null, pendingHazard: null };
state.expansion.fishing.pending = { castsLeft: 5, dayApplied: false, lastDay: null };
context.elements.fishingModal.hidden = false;
context.advanceDayWithEvents = days => {
  assert.equal(state.dangerousSeas.action.kind, "fishing", "暗黙の一日行動として先に終了させない");
  state.day += days;
  state.dangerousSeas.pendingHazard = { stage: "action_running" };
};
const beginsBeforeLegacy = begins;
vm.runInContext("resumeFishing()", context);
assert.equal(state.day, 3);
assert.equal(begins, beginsBeforeLegacy + 1);
assert.equal(state.expansion.fishing.pending.castsLeft, 5);
assert.equal(state.dangerousSeas.pendingHazard.stage, "action_running");
vm.runInContext("resumeFishing()", context);
assert.equal(state.day, 3);
assert.equal(begins, beginsBeforeLegacy + 1);

state.dangerousSeas = { action: null, pendingHazard: null };
state.expansion.fishing.pending = { castsLeft: 5, dayApplied: false, lastDay: null };
context.advanceDayWithEvents = () => 0;
assert.equal(vm.runInContext("resumeFishing()", context), false);
assert.equal(state.expansion.fishing.pending.dayApplied, false, "日付が進まなければ釣りの一日を適用済みにしない");
assert.equal(state.dangerousSeas.action, null);

context.advanceDayWithEvents = days => { state.day += days; };
context.document = { getElementById: () => ({ value: "insect" }) };
saved = false;
const beforeFailedDay = JSON.stringify(state);
assert.equal(vm.runInContext("resumeFishing()", context), false);
assert.equal(JSON.stringify(state), beforeFailedDay, "日数適用の保存失敗では日付と危険と釣りを戻す");
const baitBeforeUnapplied = state.expansion.fishing.bait.insect;
const drawsBeforeUnapplied = draws;
vm.runInContext("doCast()", context);
assert.equal(state.expansion.fishing.bait.insect, baitBeforeUnapplied, "未保存の日数を使って無料で投げない");
assert.equal(draws, drawsBeforeUnapplied);
assert.equal(state.day, 3);
saved = true;
vm.runInContext("beginFishing()", context);
assert.equal(state.expansion.fishing.pending.dayApplied, true, "再開操作で一日分の保存を再試行できる");
assert.equal(state.day, 4);
console.log("dangerousSeaFishingUI: 釣り再開・海域分岐・危険排他・終了・保存失敗の検証成功");
