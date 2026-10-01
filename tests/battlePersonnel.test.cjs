const { readSource } = require("./helpers/source.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");

/** @param {unknown} value 値。 @returns {unknown} 比較用の通常オブジェクト。 */
function plain(value) { return JSON.parse(JSON.stringify(value)); }

/** @returns {Promise<void>} 混成レベル・待機兵・予備隊・救護・昇級を検証する。 */
async function main() {
  const module = new vm.SourceTextModule(await readSource("battlePersonnel.js"));
  await module.link(() => { throw new Error("兵員台帳は外部状態に依存しない"); });
  await module.evaluate();
  const { takeBattlePersonnel: take, returnBattlePersonnel: back, settleBattlePersonnel: settle } = module.namespace;
  const standby = { infantry: [{ level: 1, count: 20 }, { level: 5, count: 3 }] };
  const group = take(standby, "infantry", 10);
  assert.deepEqual(plain(group), { count: 10, level: 2.2, sources: { 1: 7, 5: 3 } });
  back(standby, "infantry", group.sources);
  assert.deepEqual(plain(standby.infantry), [{ level: 5, count: 3 }, { level: 1, count: 20 }]);
  for (let i = 0; i < 10; i++) back(standby, "infantry", take(standby, "infantry", 10).sources);
  assert.equal(standby.infantry.reduce((n, row) => n + row.count, 0), 23);
  assert.equal(standby.infantry.length, 2);

  const troops = { infantry: { 1: 100, 5: 10 }, archer: { 1: 20 } };
  const destroyed = { id: "a", side: "ally", type: "infantry", count: 10, hp: 0,
    status: "destroyed", deployedAt: 0, sources: { 5: 10 } };
  const reserve = { id: "b", side: "ally", type: "archer", count: 10, hp: 100,
    status: "reserve", deployedAt: null, sources: { 1: 10 } };
  const before = JSON.stringify({ troops, destroyed, reserve });
  const result = settle(troops, [destroyed, reserve], { lossProb: 0.6, upgrades: 100 }, () => 0);
  assert.deepEqual(plain(result.troops), { infantry: { 2: 100, 5: 4 }, archer: { 1: 20 } });
  assert.equal(result.leveled, 100, "投入兵がLv5だけでも待機兵が昇級する");
  assert.deepEqual(plain(result.losses), { infantry: 6 });
  assert.equal(JSON.stringify({ troops, destroyed, reserve }), before, "入力は変更しない");

  const rescued = settle(troops, [destroyed], { lossProb: 0.6, rescue: 0.5, won: true }, () => 0);
  assert.deepEqual(plain(rescued.troops), troops);
  const defeat = settle(troops, [destroyed], { lossProb: 0.6, rescue: 1, won: false }, () => 0);
  assert.equal(defeat.losses.infantry, 6);

  const active = { ...destroyed, hp: 50, status: "active", sources: { 1: 10 } };
  const leveled = settle(troops, [active, reserve], { lossProb: 0.6, upgrades: 1000 }, () => 0);
  assert.deepEqual(plain(leveled.troops), { infantry: { 5: 110 }, archer: { 5: 20 } });
  assert.equal(leveled.leveled, 480, "待機兵・未投入予備隊も複数回昇級しLv5で止まる");
  const reserveUpgrade = settle(troops, [active, reserve], { lossProb: 0.6, upgrades: 1 }, () => 0.999);
  assert.deepEqual(plain(reserveUpgrade.troops.archer), { 1: 19, 2: 1 }, "未投入予備隊の兵種も抽選対象になる");
  const weighted = settle({ infantry: { 1: 3 }, archer: { 1: 1 } }, [], { lossProb: 0, upgrades: 1 }, () => 0.74);
  assert.deepEqual(plain(weighted.promotions), [{ type: "infantry", from: 1, to: 2, count: 1 }], "兵種数ではなく人数比で抽選する");
  const lost = settle({ infantry: { 1: 10 }, archer: { 1: 1 } }, [{ ...destroyed, sources: { 1: 10 } }],
    { lossProb: 1, upgrades: 1 }, () => 0);
  assert.deepEqual(plain(lost.troops), { archer: { 2: 1 } }, "損耗した兵は抽選対象から除く");
  const mixed = { ...destroyed, sources: { 1: 7, 5: 3 } };
  const mixedResult = settle({ infantry: { 1: 7, 5: 30 } }, [mixed], { lossProb: 0.6 }, () => 0.999);
  assert.deepEqual(plain(mixedResult.troops), { infantry: { 1: 4, 5: 27 } });
  assert.throws(() => settle(troops, [destroyed, destroyed], { lossProb: 0.6 }), /重複/);
  assert.throws(() => settle(troops, [destroyed, { ...destroyed, id: "other" }], { lossProb: 0.6 }), /重複/);
  assert.throws(() => settle(troops, [{ ...destroyed, sources: {} }], { lossProb: 0.6 }), /内訳/);
  const empty = settle(troops, [], { lossProb: 0.6, upgrades: 0 });
  assert.deepEqual(plain(empty.troops), troops);
  assert.equal(empty.leveled, 0);
  for (const status of ["routing", "escaped"]) {
    const routed = { ...destroyed, hp: 1, status };
    const survivors = settle(troops, [routed], { lossProb: 1, upgrades: 0 });
    assert.deepEqual(plain(survivors.troops), troops, "敗走・退出だけでは恒久損耗を生まない");
  }
  const battleSource = await readSource("battle.js");
  const context = vm.createContext({ takeBattlePersonnel: take, returnBattlePersonnel: back,
    MORALE_RULES: { initial: 100 },
    battleRoster: { standby: { infantry: [{ level: 5, count: 3 }, { level: 1, count: 7 }] } },
    TROOP_STATS: { infantry: { hp: 110, atk: 26, def: 18 } }, MAX_UNIT_COUNT: 10,
    MAX_SQUADS: 20, BATTLE_HP_MULTIPLIER: 3, battleState: { outfitting: { effects: {} } },
    clamp: (n, min, max) => Math.max(min, Math.min(max, n)), outfittedStat: n => n });
  vm.runInContext(readSource("battleGeometry.js").replace(/^export /gm, ""), context);
  for (const name of ["takeFromStandby", "pushToStandby", "createUnit", "createUnits"]) {
    if (name === "createUnits") vm.runInContext(readSource("battleUnitFormation.js").replace(/^export /gm, ""), context);
    const start = battleSource.indexOf(`function ${name}(`);
    vm.runInContext(battleSource.slice(start, battleSource.indexOf("\n}", start) + 2), context);
  }
  vm.runInContext(`
    const entry = { type: 'infantry', ...takeFromStandby('infantry', 10) };
    const deployed = createUnits([entry], 'ally', 10, [{x:1,y:4}]);
    pushToStandby(entry.type, entry.sources);
  `, context);
  const deployed = vm.runInContext("deployed", context);
  assert.deepEqual(plain(deployed[0].sources), { 1: 7, 5: 3 });
  assert.equal(deployed[0].deployedAt, 0);
  assert.equal(deployed[0].status, "active");
  deployed[0].hp = 0;
  const integrated = settle({ infantry: { 1: 7, 5: 3 } }, deployed, { lossProb: 0.6 }, () => 0);
  assert.deepEqual(plain(integrated.troops), { infantry: { 1: 1, 5: 3 } });
  console.log("戦闘兵員台帳: 元レベル復元・待機/予備隊の保護・救護・昇級・重複拒否: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
