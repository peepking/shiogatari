const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/** @returns {Promise<void>} 艤装購入・射撃境界・補助兵・消費を検証する。 */
async function main() {
  const modules = new Map();
  /** @param {string} name モジュール名。 @returns {Promise<vm.Module>} 実モジュール。 */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const m = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "..", name), "utf8"));
    modules.set(name, m); await m.link(load); return m;
  }
  await load("./fleet.js");
  const root = await load("./outfitting.js"); await root.evaluate();
  const { changeOutfitting, snapshotOutfitting, defendedDamage, fireOutfitting, outfittedStat, outfittingBattleLosses } = root.namespace;
  const { createExpansionState } = modules.get("./expansionState.js").namespace;
  const s = { funds: 100000, troops: { medic: { 1: 5 }, scout: 7, infantry: 20 }, expansion: createExpansionState() };
  assert.equal(changeOutfitting(s, "buy", "lifesaving"), true);
  assert.equal(s.expansion.outfitting.equipped[0], null);
  assert.equal(changeOutfitting(s, "buy", "lifesaving"), false);
  assert.equal(s.funds, 90000);
  assert.equal(changeOutfitting(s, "equip", "lifesaving", 0), true);
  const snapshot = snapshotOutfitting(s);
  assert.equal(snapshot.medics, 10); assert.equal(snapshot.scouts, 7);
  s.troops.medic[1] = 0; assert.equal(snapshot.medics, 10);
  assert.equal(snapshotOutfitting(s).medics, 5);
  assert.equal(changeOutfitting(s, "expand", null), true); assert.equal(s.funds, 85000);
  assert.equal(changeOutfitting(s, "equip", "lifesaving", 1), false);
  assert.equal(changeOutfitting(s, "expand", null), true); assert.equal(s.funds, 75000);
  s.funds = 14999;
  assert.equal(changeOutfitting(s, "expand", null), false);
  assert.equal(s.expansion.outfitting.slots, 3); assert.equal(s.funds, 14999);
  s.funds = 35000;
  assert.equal(changeOutfitting(s, "expand", null), true);
  assert.equal(s.expansion.outfitting.slots, 4); assert.equal(s.funds, 20000);
  assert.equal(s.expansion.outfitting.equipped[3], null);
  assert.equal(changeOutfitting(s, "expand", null), true);
  assert.equal(s.expansion.outfitting.slots, 5); assert.equal(s.funds, 0);
  assert.equal(s.expansion.outfitting.equipped[4], null);
  s.funds = 1000000;
  assert.equal(changeOutfitting(s, "expand", null), false);
  assert.equal(s.expansion.outfitting.slots, 5); assert.equal(s.funds, 1000000);
  assert.equal(changeOutfitting(s, "equip", null, 0), true);
  assert.equal(changeOutfitting(s, "equip", "lifesaving", 4), true);
  assert.equal(snapshotOutfitting(s).medics, 5);
  assert.equal(changeOutfitting(s, "equip", "lifesaving", 3), false);
  assert.equal(changeOutfitting(s, "equip", null, 4), true);
  assert.ok(s.expansion.outfitting.owned.includes("lifesaving"));
  s.funds = 1; assert.equal(changeOutfitting(s, "buy", "cannon"), false);
  assert.equal(defendedDamage(30, 46), 21); assert.equal(defendedDamage(100, 46), 68);
  const attacks = snapshotOutfitting({ expansion: { outfitting: { slots: 2, owned: ["cannon", "harpoon"], equipped: ["cannon", "harpoon"] } } }).effects.attacks;
  const units = [{ side: "ally", hp: 100 }, ...Array.from({ length: 4 }, () => ({ side: "enemy", hp: 10000 }))];
  const fired = [];
  for (let tick = 0; tick <= 60; tick++) fired.push(...fireOutfitting(tick, units, attacks, () => 46, () => 0).map(shot => ({ ...shot, tick })));
  assert.deepEqual(fired.filter(s => s.id === "cannon").map(s => s.tick), [20, 40, 60]);
  assert.equal(fired.filter(s => s.id === "harpoon").length, 12);
  assert.equal(fired.find(s => s.tick === 20 && s.id === "cannon").damage, 171);
  assert.equal(units[1].hp, 10000 - 171 * 3 - 21 * 12);
  units[0].hp = 0; assert.equal(fireOutfitting(80, units, attacks, () => 0).length, 0);
  for (const [id, interval, power] of [["grape_ballista",6,30],["fire_grape_ballista",12,60]]) {
    const owner={funds:15000,expansion:createExpansionState(),fleet:{counts:{galleass:2}}};
    assert.equal(changeOutfitting(owner,"buy",id),true); assert.equal(owner.funds,0);
    assert.equal(changeOutfitting(owner,"equip",id,0),true);
    const area=snapshotOutfitting(owner).effects.attacks;
    assert.equal(area[0].power,power*1.2); assert.equal(area[0].allEnemies,true);
    const targets=[{side:"ally",hp:100},...Array.from({length:20},(_,i)=>({side:"enemy",hp:1000,def:i*10})),{side:"enemy",hp:0,def:0}];
    const noRandom=()=>{throw new Error("全体射撃では標的抽選しない");};
    assert.equal(fireOutfitting(0,targets,area,u=>u.def,noRandom).length,0);
    assert.equal(fireOutfitting(interval-1,targets,area,u=>u.def,noRandom).length,0);
    const volley=fireOutfitting(interval,targets,area,u=>u.def,noRandom);
    assert.equal(volley.length,20); assert.equal(new Set(volley.map(s=>s.target)).size,20);
    for (const shot of volley) assert.equal(shot.target.hp,1000-defendedDamage(power*1.2,shot.target.def));
    assert.equal(targets[0].hp,100); assert.equal(targets[21].hp,0);
    const finishing=[{side:"ally",hp:100},{side:"enemy",hp:1},{side:"enemy",hp:1}];
    assert.equal(fireOutfitting(interval,finishing,area,()=>0,noRandom).length,2);
    assert.equal(fireOutfitting(interval*2,finishing,area,()=>0,noRandom).length,0);
  }
  const effects = { atk: 5, def: 5, meleeAtk: 10, meleeDef: 10, rangedAtk: 0, rangedDef: 0 };
  assert.equal(outfittedStat(40, 1, "atk", effects), 46); assert.equal(outfittedStat(46, 1, "def", effects), 52);
  assert.equal(outfittedStat(40, 4, "atk", effects), 42);
  const lostUnits = [{ side: "ally", type: "infantry", count: 10, hp: 0 }];
  s.troops.medic = 5;
  assert.equal(outfittingBattleLosses(lostUnits, snapshotOutfitting(s).medics).losses.infantry, 2);
  assert.ok(Math.abs(outfittingBattleLosses(lostUnits, snapshot.medics).lossProb - 0.1) < 1e-12);
  for (const [medics, expected] of [[0, 0.6], [1, 0.4], [10, 0.1], [15, 0.1]]) {
    const result = outfittingBattleLosses(lostUnits, medics);
    assert.ok(Math.abs(result.lossProb - expected) < 1e-12);
    assert.equal(result.losses.infantry, Math.round(10 * expected));
  }
  let previousGain = Infinity;
  for (let medics = 1; medics <= 10; medics++) {
    const gain = outfittingBattleLosses([], medics - 1).lossProb - outfittingBattleLosses([], medics).lossProb;
    assert.ok(gain > 0 && gain < previousGain);
    previousGain = gain;
  }
  const upkeep = await load("./upkeep.js"); await upkeep.evaluate();
  s.expansion.outfitting = { slots: 2, owned: ["storm_cover", "deck_tent"], equipped: ["storm_cover", "deck_tent"] };
  s.troops = { infantry: 23 }; s.day = 9;
  const cost = upkeep.namespace.getUpkeepForecast(s, { infantry: { upkeep: 2 } });
  assert.equal(cost.funds, 41); assert.equal(cost.food, 4); assert.equal(cost.foodDays, 1);
  console.log("艤装の購入・重複防止・射撃・待機衛生兵・消費軽減: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
