const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
/** @param {string} file ファイル名。 @returns {string} 検証対象のソース。 */
function read(file) { return fs.readFileSync(path.join(__dirname, "..", file), "utf8"); }
const quests = read("quests.js");
const state = { quests: { active: [] }, fame: 0 };
const context = vm.createContext({
  state, ensureState() {}, pushLog() {}, pushToast() {}, applyWarFrontScore() {},
  getSettlementById: () => ({ coords: { x: 8, y: 9 } }),
  PIN_STYLES: { move: { kind: "move" }, supply: { kind: "supply" } },
});
vm.runInContext(quests.match(/const QUEST_TYPES = \{[\s\S]*?\n\};/)[0], context);
/** @param {string} source ソース。 @param {string} name 関数名。 @returns {void} 実際の関数を依存先の代替とともに読み込む。 */
function load(source, name) {
  const start = source.indexOf(`function ${name}(`);
  vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
}
for (const name of ["completeWarBattleQuest", "getBattleQuestAt", "markNobleRefugeePickup", "markWarEscortPickup"]) load(quests, name);
load(read("map.js"), "questToPin");
const q = { id: 1, type: "war_blockade", fights: [
  { target: { x: 1, y: 2 }, done: false }, { target: { x: 3, y: 4 }, done: false },
] };
state.quests.active = [q];
context.questId = 1; context.isWin = true; context.enemyTotal = 189;
const call = read("ui.js").match(/completeWarBattleQuest\(questId,[^;]+;/)[0];
for (const index of [1, 0]) {
  context.questFightIdx = index;
  vm.runInContext(call, context);
  assert.equal(q.fights[index].done, true);
  context.target = q.fights[index].target;
  assert.equal(vm.runInContext("getBattleQuestAt(target)", context), null);
  context.q = q;
  assert.equal(vm.runInContext("questToPin(q, 0).length", context), index === 1 ? 1 : 0);
}
assert.equal(state.quests.active.length, 0);
for (const [type, pickup] of [["noble_refugee", "markNobleRefugeePickup"], ["war_escort", "markWarEscortPickup"]]) {
  context.q = { id: 2, type, originId: "home", target: { x: 1, y: 2 }, picked: false };
  state.quests.active = [context.q];
  assert.equal(vm.runInContext("questToPin(q, 0)[0].x", context), 1);
  vm.runInContext(`${pickup}(q.target)`, context);
  assert.equal(context.q.picked, true);
  assert.equal(vm.runInContext("questToPin(q, 0).length", context), 1);
  assert.equal(vm.runInContext("questToPin(q, 0)[0].x", context), 8);
  assert.equal(vm.runInContext("questToPin(q, 0)[0].kind", context), "supply");
}
console.log("補給封鎖の進捗・完了・再戦防止、護送2種のマーカー切替: 全項目成功");
