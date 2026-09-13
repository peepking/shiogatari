const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/** @returns {Promise<void>} 船団・取引・季節補充・戦闘補正の境界を検証する。 */
async function main() {
  const modules = new Map();
  /** @param {string} name 相対名。 @returns {Promise<vm.Module>} 共通の実モジュール。 */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const module = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "..", name), "utf8"));
    modules.set(name, module); await module.link(load); return module;
  }
  const fleetModule = await load("./fleet.js"); await fleetModule.evaluate();
  const { normalizeFleet, migrateFleet, totalShips, fleetEffects, rollShips, prepareShipReward, addShips, loseShips } = fleetModule.namespace;
  const { SHIP_TYPES } = modules.get("./shipConfig.js").namespace;
  assert.deepEqual(Object.values(SHIP_TYPES).map(s => [s.price, s.supplies, s.troops]), [
    [4000,35,10], [4500,45,10], [5000,30,15], [5500,75,10], [6000,25,25], [10000,90,30], [12000,55,35], [15000,80,35], [7500,60,10],
  ]);
  const old = { ships: 3, troops: { infantry: 100 } };
  migrateFleet(old); migrateFleet(old);
  assert.equal(totalShips(old.fleet), 3); assert.equal(old.fleet.counts.cog, 3); assert.equal("ships" in old, false);
  assert.equal(old.troops.infantry, 100);
  assert.equal(totalShips(normalizeFleet({ counts: { cog: -1, knarr: 2.5, galleon: Infinity, unknown: 10 } })), 0);
  const fleet = normalizeFleet({ counts: Object.fromEntries(Object.keys(SHIP_TYPES).map(id => [id, 10])) });
  const effects = fleetEffects(fleet);
  assert.equal(effects.upkeepReduction, 10); assert.equal(effects.supplyCap, 10); assert.equal(effects.troopCap, 10);
  assert.equal(effects.atk, 10); assert.equal(effects.def, 10); assert.equal(effects.supportPower, 20);
  assert.equal(effects.supplies, 4950); assert.equal(effects.troops, 1800);
  assert.equal(effects.shipUpkeepReduction, 10);
  assert.equal(fleetEffects(normalizeFleet({ counts: { galley: 1 } })).troopCap, 2.5);
  const outfittingModule = await load("./outfitting.js"); await outfittingModule.evaluate();
  const { getOutfittingEffects, snapshotOutfitting, applyCapacityBonus, fireOutfitting } = outfittingModule.namespace;
  const equipment = { slots: 3, owned: ["harpoon", "ballista", "cannon"], equipped: ["harpoon", "ballista", "cannon"] };
  for (const [count, power, cannonPower] of [[0,30,250],[1,33,275],[2,36,300],[3,36,300]]) {
    const f = normalizeFleet({ counts: { galleass: count } });
    const attacks = getOutfittingEffects(equipment, f).attacks;
    assert.equal(attacks[0].power, power); assert.equal(attacks[1].power, 100 + Math.min(count,2)*10);
    assert.equal(attacks[2].interval, 20); assert.equal(attacks[2].power, cannonPower);
  }
  const battleState = { fleet, expansion: { outfitting: equipment }, troops: {} };
  const snapshot = snapshotOutfitting(battleState);
  battleState.fleet = normalizeFleet(); assert.equal(snapshot.effects.atk, 10);
  const units = [{ side: "ally", hp: 100 }, ...Array.from({length:4}, () => ({ side: "enemy", hp: 10000 }))];
  const ticks = [];
  for (let tick = 0; tick <= 60; tick++) {
    if (fireOutfitting(tick, units, [snapshot.effects.attacks[2]], () => 0, () => 0).length) ticks.push(tick);
  }
  assert.deepEqual(ticks, [20,40,60]);
  assert.equal(units[1].hp, 9100);
  assert.equal(getOutfittingEffects(null, fleet).attacks.length, 0);
  const fireEquipment={slots:1,owned:["fire_ballista"],equipped:["fire_ballista"]};
  const fire=getOutfittingEffects(fireEquipment,normalizeFleet({counts:{galleass:2}})).attacks;
  assert.equal(fire[0].power,180); assert.equal(fire[0].interval,15);
  const fireUnits=[{side:"ally",hp:100},{side:"enemy",hp:1000}];
  assert.equal(fireOutfitting(14,fireUnits,fire,()=>100,()=>0).length,0);
  assert.equal(fireOutfitting(15,fireUnits,fire,()=>100,()=>0).length,1);
  assert.equal(fireUnits[1].hp,910);
  const cargo = { slots: 1, owned: ["cargo_tent"], equipped: ["cargo_tent"] };
  const cargoEffects = getOutfittingEffects(cargo, fleet);
  assert.equal(cargoEffects.supplyCap, 30);
  assert.equal(applyCapacityBonus(60 + effects.supplies, cargoEffects.supplyCap), 6513);
  const upkeepModule = await load("./upkeep.js"); await upkeepModule.evaluate();
  const cost = upkeepModule.namespace.getUpkeepForecast({ fleet, troops: { infantry: 23 }, day: 29,
    expansion: { outfitting: { slots: 1, owned: ["storm_cover"], equipped: ["storm_cover"] } } }, { infantry: { upkeep: 2 } });
  assert.equal(cost.troopFunds, 36);
  assert.equal(cost.shipFunds, 12510);
  assert.equal(cost.funds, 12546);
  const yardModule = await load("./shipyard.js"); await yardModule.evaluate();
  const { refreshShipyard, quoteShipTrade, tradeShip, shipyardSeason } = yardModule.namespace;
  assert.equal(shipyardSeason({year:1001,season:0}) - shipyardSeason({year:1000,season:3}), 1);
  assert.equal(refreshShipyard({kind:"village"}, 1), null);
  const town = { kind: "town" }; const yard = refreshShipyard(town, 1, () => 0);
  assert.deepEqual(yard.regular.map(r => r.type), ["caravel","knarr","galley","galleass"]);
  const state = { funds: 100000, fleet: normalizeFleet({counts:{galleon:2}}), troops: {infantry:200}, supplies:{food:1000} };
  const before = JSON.stringify([state, yard]);
  for (const count of [0, -1, 1.5, Infinity, 3]) assert.ok(quoteShipTrade(state,town,"caravel","buy",count).error);
  assert.ok(tradeShip({...state,funds:1},town,"caravel","buy",1).error);
  assert.equal(JSON.stringify([state,yard]),before);
  assert.equal(tradeShip(state,town,"caravel","buy",2).error, undefined);
  assert.equal(state.funds,92000); assert.equal(yard.stock.caravel,0);
  refreshShipyard(town,1); assert.equal(yard.stock.caravel,0);
  tradeShip(state,town,"galleon","sell",2); assert.equal(state.funds,116000); assert.equal(yard.stock.galleon,2);
  assert.equal(state.troops.infantry,200); assert.equal(state.supplies.food,1000);
  refreshShipyard(town,2); assert.equal(yard.stock.caravel,2); assert.equal(yard.stock.galleon,2);
  const restored = JSON.parse(JSON.stringify(town)); refreshShipyard(restored,2);
  assert.deepEqual(restored,town);
  tradeShip(state,town,"galleon","buy",2); assert.equal(yard.stock.galleon,0);
  refreshShipyard(town,3); assert.equal(yard.stock.galleon,0);
  addShips(state,{caravel:5}); tradeShip(state,town,"caravel","sell",5);
  refreshShipyard(town,4); assert.equal(yard.stock.caravel,7);
  assert.deepEqual(rollShips(2,()=>0),{caravel:2}); assert.deepEqual(rollShips(4,()=>0.99999),{fluyt:4});
  const reward = { ships: 2 }; prepareShipReward(reward,()=>0);
  const savedReward = JSON.parse(JSON.stringify(reward)); prepareShipReward(savedReward,()=>0.99999);
  assert.deepEqual(savedReward.shipTypes,{caravel:2});
  const lossState = {fleet:normalizeFleet({counts:{caravel:2,cog:3,galleon:1}})};
  assert.deepEqual(loseShips(lossState,4),{caravel:2,cog:2}); assert.equal(totalShips(lossState.fleet),2);
  console.log("船種・バフ上限・射撃・売買・補充・移行・報酬・喪失: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
