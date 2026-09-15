const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../map.js"), "utf8");
const state = { selectedPosition: { x: 0, y: 0 }, warLedger: { entries: [{ activeFronts: [{ settlementId: "town", attacker: "archipelago", defender: "north", endAbs: 60 }] }] } };
/** 情報欄のテキストと子要素を保持し、再描画時には内容を消去する。 */
function createElement() {
  return { children: [], textContent: "", append(...nodes) { this.children.push(...nodes); },
    set innerHTML(value) { assert.equal(value, ""); this.children = []; this.textContent = ""; } };
}
/** 表示された情報欄を行順のテキストとして読む。 */
function renderedText(node) {
  return [node.textContent, ...node.children.map(renderedText)].filter(Boolean).join("\n");
}
const mapInfo = createElement();
const context = vm.createContext({
  MAP_CELL: 14, state,
  elements: { mapInfo }, document: { createElement },
  settlements: [{ id: "town", coords: { x: 0, y: 0 } }],
  absDay: () => 10, FRONT_DURATION_DAYS: 60,
  WAR_PIN_COLORS: { archipelago: "attack", north: "defense" },
  pinCache: { list: [], byPos: new Map() },
  mapData: [[{ terrain: "plain", settlement: { id: "town", name: "Town", factionId: "north" } }]],
  terrainKinds: [], visibleChartSites: () => [], nobleName: () => "Noble",
  displaySupportLabel: () => "Neutral", supportLabel: () => "neutral",
  factionName: id => ({ north: "北海連合", archipelago: "群島同盟" })[id],
});
for (const name of ["drawPin", "formatCellInfo", "buildPinCache", "refreshPinCache", "pinsAt", "updateMapInfo"]) {
  const start = source.indexOf(`function ${name}(`);
  vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
}
vm.runInContext("refreshPinCache(); updateMapInfo()", context);
assert.match(renderedText(mapInfo), /戦況: 防衛中/);
assert.match(renderedText(mapInfo), /防衛中（期限あと50日）, 攻: 群島同盟 → 防: 北海連合/);
assert.equal(vm.runInContext("pinsAt(0, 0)[0].color", context), "attack");
assert.equal(vm.runInContext("pinsAt(0, 0)[0].defenderColor", context), "defense");
state.selectedPosition = null;
vm.runInContext("updateMapInfo(formatCellInfo(0, 0), {x:0,y:0})", context);
assert.match(renderedText(mapInfo), /攻: 群島同盟 → 防: 北海連合/);
state.mapPinsVisible = false;
vm.runInContext("refreshPinCache(); updateMapInfo(formatCellInfo(0, 0), {x:0,y:0})", context);
assert.doesNotMatch(renderedText(mapInfo), /攻: 群島同盟/);
assert.equal(vm.runInContext("pinsAt(0, 0).length", context), 0);
assert.equal(vm.runInContext("buildPinCache([{x:0,y:0,info:'combatants'}]).byPos.get('0,0')[0].info", context), "combatants");
for (const size of [14, 700 / 19, 700 / 9]) {
  const points = [];
  const colors = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {}, stroke() {},
    moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); },
    fill() { colors.push(this.fillStyle); },
    fillRect() { colors.push(this.fillStyle); },
  };
  context.ctx = ctx; context.size = size;
  vm.runInContext("drawPin(ctx, {x:0,y:0,shape:'shield',color:'attack',defenderColor:'defense'}, 0, size, 0, 0)", context);
  assert.deepEqual(colors, ["attack", "defense"]);
  assert.ok(points.every(([x, y]) => x >= 0.7 && y >= 0.7 && x <= size - 0.7 && y <= size - 0.7));
}
console.log("防衛盾の攻守配色・3縮尺のマス内配置・情報欄の勢力名: 全項目成功");
