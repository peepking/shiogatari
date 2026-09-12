const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../battle.js"), "utf8");
const context = vm.createContext({
  MAX_SQUADS: 20, MAX_UNIT_COUNT: 10, DECK_KEY: "deck",
  TROOP_STATS: {
    basic: { hp: 100, atk: 30, def: 20, spd: 3, terrain: { plain: 100, forest: 100 } },
    forest: { hp: 100, atk: 30, def: 20, spd: 3, terrain: { plain: 50, forest: 200 } },
  },
  battleState: { grid: Array.from({ length: 10 }, () => Array(10).fill("plain")) },
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
});
for (const name of ["buildDeploySlots", "createUnit", "createUnits", "terrainRate", "effectiveAtk", "effectiveDef", "calcStrength"]) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\n}", start) + 2;
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
}
vm.runInContext(`
  const entries = [...Array(20).fill({type:'basic',count:5,level:1}),
    ...Array(6).fill({type:'basic',count:10,level:5})];
  const before = JSON.stringify(entries);
  const result = createUnits(entries, 'enemy', 10);
`, context);
assert.equal(vm.runInContext("result.length", context), 20);
assert.equal(vm.runInContext("result.filter(u => u.level === 5).length", context), 6);
assert.equal(vm.runInContext("new Set(result.map(u => u.x + ',' + u.y)).size", context), 20);
assert.equal(vm.runInContext("JSON.stringify(entries) === before", context), true);
assert.equal(vm.runInContext("createUnits(entries.slice(0, 4), 'enemy', 10).length", context), 4);
assert.equal(vm.runInContext("createUnits(entries, 'enemy', 10, [{x:9,y:0}])[0].level", context), 5);
const terrainSelection = "createUnits([...Array(20).fill({type:'basic',count:10}), {type:'forest',count:10}], 'enemy', 10).some(u => u.type === 'forest')";
assert.equal(vm.runInContext(terrainSelection, context), false);
vm.runInContext("battleState.grid.forEach(row => row.fill('forest'))", context);
assert.equal(vm.runInContext(terrainSelection, context), true);
console.log("敵出撃上限・強い候補の優先・配置重複防止・地形適性: 全項目成功");
