const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/**
 * 新機能の定義、旧セーブ補完、装備の重複除外、効果計算を実モジュールで検証する。
 * @returns {Promise<void>}
 */
async function main() {
  const modules = new Map();
  /**
   * 共通のモジュールを一度だけ読み込む。
   * @param {string} name 相対ファイル名。
   * @returns {Promise<vm.Module>} 検証用モジュール。
   */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const source = await fs.readFile(path.join(__dirname, "..", name), "utf8");
    const module = new vm.SourceTextModule(source, { identifier: name });
    modules.set(name, module);
    await module.link(load);
    return module;
  }
  await load("./fleet.js");
  const module = await load("./outfitting.js");
  await module.evaluate();
  const { createExpansionState, normalizeExpansionState, normalizeOutfitting } = modules.get("./expansionState.js").namespace;
  const { EXPLORATION_CONFIG, CHART_CONFIG, OUTFITTING_ITEMS } = modules.get("./expansionConfig.js").namespace;
  const { getOutfittingEffects, applyCapacityBonus, applyConsumptionReduction, effectiveSupportCount } = module.namespace;

  assert.equal(EXPLORATION_CONFIG.commonDailyChance * 60, 3);
  assert.equal(EXPLORATION_CONFIG.wreckDailyChance * 60, 1);
  assert.equal(CHART_CONFIG.battleFragmentChance, 0.005);
  assert.equal(CHART_CONFIG.questFragmentChance, 0.03);
  assert.equal(CHART_CONFIG.rumorChance, 0.05);
  assert.equal(Object.keys(OUTFITTING_ITEMS).length, 18);
  assert.equal(OUTFITTING_ITEMS.harpoon.attack.power, 30);
  assert.equal(OUTFITTING_ITEMS.arrow_box.effects.rangedAtk, 10);
  assert.ok(Object.isFrozen(OUTFITTING_ITEMS.harpoon.attack));
  assert.ok(Object.isFrozen(EXPLORATION_CONFIG.dangerLevels));

  const first = createExpansionState();
  const second = createExpansionState();
  first.exploration.sites.push({ id: 1 });
  first.outfitting.owned.push("harpoon");
  assert.equal(second.exploration.sites.length, 0);
  assert.equal(second.outfitting.owned.length, 0);
  for (const invalid of [undefined, null, [], 7, "old save"]) {
    const normalized = normalizeExpansionState(invalid);
    assert.equal(normalized.outfitting.slots, 1);
    assert.equal(normalized.exploration.initialized, false);
    assert.equal(normalized.charts.active.length, 0);
  }
  const damaged = normalizeExpansionState({ exploration: { sites: {}, nextId: -1 }, charts: { active: null }, outfitting: null });
  assert.equal(damaged.exploration.sites.length, 0);
  assert.equal(damaged.exploration.nextId, 1);
  const gear = normalizeOutfitting({ slots: 99, owned: ["harpoon", "harpoon", "ballista", "bad", "toString"], equipped: ["harpoon", "harpoon", "cannon", "ballista"] });
  assert.equal(gear.slots, 5);
  assert.equal(gear.owned.length, 2);
  assert.equal(gear.equipped[0], "harpoon");
  assert.equal(gear.equipped[1], null);
  assert.equal(gear.equipped[2], null);
  assert.equal(gear.equipped[3], "ballista");
  assert.equal(gear.equipped[4], null);
  const fiveSlots = { slots: 5, owned: ["harpoon", "ballista", "cannon", "cargo_tent", "lifesaving"], equipped: ["harpoon", "ballista", "cannon", "cargo_tent", "lifesaving"] };
  assert.deepEqual(normalizeOutfitting(JSON.parse(JSON.stringify(fiveSlots))), fiveSlots);
  assert.equal(getOutfittingEffects(fiveSlots).supplyCap, 20);
  assert.equal(getOutfittingEffects(fiveSlots).medics, 5);

  const input = { slots: 3, owned: ["cargo_tent", "expanded_hold", "lifesaving"], equipped: ["cargo_tent", "expanded_hold", "lifesaving"] };
  const before = JSON.stringify(input);
  const effects = getOutfittingEffects(input);
  assert.equal(effects.supplyCap, 30);
  assert.equal(effects.troopCap, 10);
  assert.equal(effects.medics, 5);
  assert.equal(applyCapacityBonus(105, 20), 126);
  assert.equal(applyCapacityBonus(105, effects.supplyCap), 136);
  assert.equal(applyConsumptionReduction(120, 10), 108);
  assert.equal(applyConsumptionReduction(2, 10), 1);
  assert.equal(applyConsumptionReduction(9 + 9, 10), 16);
  assert.equal(effectiveSupportCount(0, 5), 5);
  assert.equal(effectiveSupportCount(5, 5), 10);
  assert.equal(effectiveSupportCount(12, 5), 10);
  assert.equal(JSON.stringify(input), before);
  assert.equal(getOutfittingEffects(input).supplyCap, effects.supplyCap);
  const attacks = getOutfittingEffects({ slots: 3, owned: ["harpoon", "ballista", "cannon"], equipped: ["cannon", "harpoon", "ballista"] }).attacks;
  assert.equal(attacks[0].interval, 20);
  assert.equal(attacks[0].destroy, true);
  assert.equal(attacks[1].power, 30);
  assert.equal(attacks[2].power, 100);
  const buffs = getOutfittingEffects({ slots: 3, owned: ["iron_coating", "round_shields", "arrow_box"], equipped: ["iron_coating", "round_shields", "arrow_box"] });
  assert.equal(buffs.def + buffs.meleeDef, 15);
  assert.equal(buffs.def + buffs.rangedDef, 5);
  assert.equal(buffs.rangedAtk, 10);
  const stateModule = await load("./state.js");
  await stateModule.evaluate();
  const { state, resetState } = stateModule.namespace;
  state.expansion.outfitting.owned.push("harpoon");
  state.expansion.exploration.initialized = true;
  resetState();
  assert.equal(state.expansion.outfitting.owned.length, 0);
  assert.equal(state.expansion.exploration.initialized, false);
  assert.equal(state.funds, 1000);
  console.log("新機能の設定・保存補完・艤装効果計算: 全項目成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
