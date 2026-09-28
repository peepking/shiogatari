const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const path = require("node:path");

/** @param {unknown} value 値。 @returns {unknown} 比較用の通常オブジェクト。 */
function plain(value) { return JSON.parse(JSON.stringify(value)); }

/** @returns {Promise<void>} 混成レベル・待機兵・予備隊・救護・昇級を検証する。 */
async function main() {
  const module = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../battlePersonnel.js"), "utf8"));
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
  assert.deepEqual(plain(result.troops), { infantry: { 1: 100, 5: 4 }, archer: { 1: 20 } });
  assert.equal(result.leveled, 0, "待機と未投入の低レベル兵は昇級しない");
  assert.deepEqual(plain(result.losses), { infantry: 6 });
  assert.equal(JSON.stringify({ troops, destroyed, reserve }), before, "入力は変更しない");

  const rescued = settle(troops, [destroyed], { lossProb: 0.6, rescue: 0.5, won: true }, () => 0);
  assert.deepEqual(plain(rescued.troops), troops);
  const defeat = settle(troops, [destroyed], { lossProb: 0.6, rescue: 1, won: false }, () => 0);
  assert.equal(defeat.losses.infantry, 6);

  const active = { ...destroyed, hp: 50, status: "active", sources: { 1: 10 } };
  const leveled = settle(troops, [active, reserve], { lossProb: 0.6, upgrades: 100 }, () => 0);
  assert.deepEqual(plain(leveled.troops), { infantry: { 1: 90, 5: 20 }, archer: { 1: 20 } });
  assert.equal(leveled.leveled, 40, "投入兵だけが複数回昇級しLv5で止まる");
  const mixed = { ...destroyed, sources: { 1: 7, 5: 3 } };
  const mixedResult = settle({ infantry: { 1: 7, 5: 30 } }, [mixed], { lossProb: 0.6 }, () => 0.999);
  assert.deepEqual(plain(mixedResult.troops), { infantry: { 1: 4, 5: 27 } });
  assert.throws(() => settle(troops, [destroyed, destroyed], { lossProb: 0.6 }), /重複/);
  assert.throws(() => settle(troops, [destroyed, { ...destroyed, id: "other" }], { lossProb: 0.6 }), /重複/);
  assert.throws(() => settle(troops, [{ ...destroyed, sources: {} }], { lossProb: 0.6 }), /内訳/);
  const empty = settle(troops, [], { lossProb: 0.6, upgrades: 100 });
  assert.deepEqual(plain(empty.troops), troops);
  assert.equal(empty.leveled, 0);
  for (const status of ["routing", "escaped"]) {
    const routed = { ...destroyed, hp: 1, status };
    const survivors = settle(troops, [routed], { lossProb: 1, upgrades: 0 });
    assert.deepEqual(plain(survivors.troops), troops, "敗走・退出だけでは恒久損耗を生まない");
  }
  const battleSource = await fs.readFile(path.join(__dirname, "../battle.js"), "utf8");
  const context = vm.createContext({ takeBattlePersonnel: take, returnBattlePersonnel: back,
    MORALE_RULES: { initial: 100 },
    battleRoster: { standby: { infantry: [{ level: 5, count: 3 }, { level: 1, count: 7 }] } },
    TROOP_STATS: { infantry: { hp: 110, atk: 26, def: 18 } }, MAX_UNIT_COUNT: 10,
    MAX_SQUADS: 20, BATTLE_HP_MULTIPLIER: 3, battleState: { outfitting: { effects: {} } },
    clamp: (n, min, max) => Math.max(min, Math.min(max, n)), outfittedStat: n => n });
  for (const name of ["takeFromStandby", "pushToStandby", "createUnit", "createUnits"]) {
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
