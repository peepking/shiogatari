const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../map.js"), "utf8");
const state = { warLedger: { entries: [{ activeFronts: [{ settlementId: "town", attacker: "archipelago", defender: "north" }] }] } };
const context = vm.createContext({
  MAP_CELL: 14, state,
  mapData: [[{ terrain: "plain", settlement: { id: "town", name: "Town", factionId: "north" } }]],
  terrainKinds: [], visibleChartSites: () => [], nobleName: () => "Noble",
  displaySupportLabel: () => "Neutral", supportLabel: () => "neutral",
  factionName: id => ({ north: "北海連合", archipelago: "群島同盟" })[id],
});
for (const name of ["drawPin", "formatCellInfo", "buildPinCache"]) {
  const start = source.indexOf(`function ${name}(`);
  vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
}
assert.match(vm.runInContext("formatCellInfo(0, 0)", context), /攻撃: 群島同盟 → 防衛: 北海連合/);
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
