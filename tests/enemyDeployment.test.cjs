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
vm.runInContext(source.match(/const BATTLE_HP_MULTIPLIER = \d+;/)[0], context);
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
assert.equal(vm.runInContext("result[0].hp", context), 100);
assert.equal(vm.runInContext("result[19].maxHp", context), 280);
assert.equal(vm.runInContext("result.filter(u => u.level === 5).length", context), 6);
assert.equal(vm.runInContext("new Set(result.map(u => u.x + ',' + u.y)).size", context), 20);
assert.equal(vm.runInContext("JSON.stringify(entries) === before", context), true);
assert.equal(vm.runInContext("createUnits(entries.slice(0, 4), 'enemy', 10).length", context), 4);
assert.equal(vm.runInContext("createUnits(entries, 'enemy', 10, [{x:9,y:0}])[0].level", context), 5);
const terrainSelection = "createUnits([...Array(20).fill({type:'basic',count:10}), {type:'forest',count:10}], 'enemy', 10).some(u => u.type === 'forest')";
assert.equal(vm.runInContext(terrainSelection, context), false);
vm.runInContext("battleState.grid.forEach(row => row.fill('forest'))", context);
assert.equal(vm.runInContext(terrainSelection, context), true);
const actionsSource = fs.readFileSync(require("node:path").join(__dirname, "../actions.js"), "utf8");
const formationStart = actionsSource.indexOf("function buildEnemyFormation(");
context.state = { fame: 5611 };
context.NORMAL_ANCHORS = []; context.STRONG_ANCHORS = [];
context.enemyTroopPool = () => ["basic"];
vm.runInContext(actionsSource.slice(formationStart, actionsSource.indexOf("\n}", formationStart) + 2), context);
for (const fraction of [0, 0.5, 0.999]) {
  context.randInt = (min, max) => Math.floor(min + (max - min + 1) * fraction);
  for (let total = 1; total <= 200; total++) {
    context.pickAnchorRange = () => ({ min: total, max: total });
    for (const strength of ["normal", "elite"]) {
      context.strength = strength;
      const generated = vm.runInContext("buildEnemyFormation(strength, 'pirates')", context);
      assert.equal(generated.total, total);
      assert.ok(generated.formation.length <= 20);
      assert.ok(generated.formation.every(entry => entry.count >= 1 && entry.count <= 10));
      assert.equal(generated.formation.reduce((sum, entry) => sum + entry.count, 0), total);
      context.generated = generated;
      assert.equal(vm.runInContext("createUnits(generated.formation, 'enemy', 10).reduce((sum, unit) => sum + unit.count, 0)", context), total);
    }
  }
}
console.log("敵出撃上限・戦力選抜・全兵員の配分・報酬人数と出撃人数の一致: 全項目成功");
