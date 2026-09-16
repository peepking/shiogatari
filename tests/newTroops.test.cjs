const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const path = require("node:path");

/** @returns {Promise<void>} 新兵種の雇用候補・敵候補・既存雇用枠の維持を検証する。 */
async function main() {
  const context = vm.createContext({ Math: Object.create(Math) });
  let seed = 12345;
  context.Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const dependencies = {
    "./pirateConfig.js": { PIRATE_IMAGES: {pirate_shield:"p_shield",pirate_spear:"p_spear",pirate_archer:"p_archer",raider_cavalry:"p_cavalry",pirate_axe:"p_axe",pirate_assault:"p_stormtrooper"} },
    "./quantityUI.js": { quantityControl() {}, wireQuantityControls() {}, refreshQuantity() {} },
    "./dom.js": { confirmAction() {}, pushLog() {}, pushToast() {} },
    "./state.js": { state: {} },
    "./upkeep.js": { renderUpkeepForecast() {} },
    "./outfitting.js": { getOutfittingEffects() {}, applyCapacityBonus() {} },
    "./fleet.js": { fleetEffects() {} },
  };
  const module = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../troops.js"), "utf8"), { context });
  await module.link(name => new vm.SyntheticModule(Object.keys(dependencies[name]), function () {
    for (const [key, value] of Object.entries(dependencies[name])) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  const { TROOP_STATS: stats, enemyTroopPool, initSettlementRecruitment, refreshSettlementRecruitment } = module.namespace;
  for (const [id, reference, values] of [
    ["halberd", "infantry", [110, 36, 18, 3, 2, 1, 170, 3]],
    ["cavalier", "cavalry", [170, 32, 35, 4, 1, 2, 250, 5]],
  ]) {
    assert.deepEqual(["hp", "atk", "def", "spd", "range", "move", "hire", "upkeep"].map(key => stats[id][key]), values);
    assert.deepEqual(stats[id].terrain, stats[reference].terrain);
    assert.ok(!enemyTroopPool(false, false).includes(id));
    assert.ok(enemyTroopPool(true, false).includes(id));
    assert.ok(enemyTroopPool(false, true).includes(id));
    await fs.access(path.join(__dirname, `../image/troops/${id}.gif`));
  }
  for (const kind of ["village", "town"]) {
    const found = new Set();
    for (let n = 0; n < 300; n++) {
      const settlement = { kind };
      initSettlementRecruitment(settlement);
      assert.equal(settlement.recruitSlots.length, kind === "town" ? 5 : 3);
      assert.equal(new Set(settlement.recruitSlots.map(slot => slot.type)).size, settlement.recruitSlots.length);
      settlement.recruitSlots.forEach(slot => found.add(slot.type));
    }
    assert.ok(found.has("halberd") && found.has("cavalier"));
  }
  const existing = { kind: "village", recruitSlots: [{ type: "infantry", remaining: 0 }, { type: "archer", remaining: 1 }, { type: "scout", remaining: 0 }] };
  refreshSettlementRecruitment(existing);
  assert.equal(existing.recruitSlots.map(slot => slot.type).join(","), "infantry,archer,scout");
  assert.ok(existing.recruitSlots.every(slot => slot.remaining === 3));
  console.log("新兵種・雇用候補・敵プール・既存雇用枠: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
