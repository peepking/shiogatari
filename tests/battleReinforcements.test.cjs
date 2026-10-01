const { readSource } = require("./helpers/source.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");

/** @param {string} id 識別子。 @param {string} side 陣営。 @param {object} extra 上書き。 @returns {object} 部隊。 */
function unit(id, side, extra = {}) {
  return { id, side, name: id, type: "infantry", x: side === "ally" ? 2 : 7, y: 4,
    status: "active", deployedAt: 0, count: 10, sources: { 1: 10 }, hp: 100, maxHp: 100, formationOrder: "line",
    atk: 0, def: 0, spd: 2, range: 1, move: 1, cooldown: 0, role: "melee", morale: 100, ...extra };
}
/** @param {number} count 部隊数。 @param {string} side 陣営。 @returns {Array} 待機順の予備隊。 */
function reserves(count, side) { return Array.from({ length: count }, (_, i) => unit(`${side}-reserve-${i}`, side, { status: "reserve", deployedAt: null, x: null, y: null })); }
/** @param {Array} units 部隊。 @returns {object} 大会戦。 */
function field(units) { return { battleKind: "grand", units, size: 10, tick: 0, elapsedMs: 0,
  grid: Array.from({ length: 10 }, () => Array(10).fill("plain")), outfitting: { effects: { attacks: [] } } }; }

/** @returns {Promise<void>} 同時上限・後端投入・登場制限・継戦・封鎖・精算を検証する。 */
async function main() {
  const modules = {};
  for (const name of ["battleGeometry", "battleUnitFormation", "battleTarget", "battleCore", "battleMorale", "battleMovement", "battleReinforcements", "battlePersonnel"])
    modules[`./${name}.js`] = new vm.SourceTextModule(await readSource(`${name}.js`));
  const core = modules["./battleCore.js"];
  await core.link(name => modules[name]); await core.evaluate();
  const personnel = modules["./battlePersonnel.js"];
  await personnel.link(() => {}); await personnel.evaluate();
  const { stepBattle: step, battleResult: result } = core.namespace;
  const { deployReinforcements: deploy, canSideContinue: continues, REINFORCEMENT_RULES: rules } = modules["./battleReinforcements.js"].namespace;
  const { isBattleOnBoard: onBoard, localPressure } = modules["./battleMorale.js"].namespace;
  const { isHostileZone } = modules["./battleMovement.js"].namespace;
  const deps = { defendedDamage: atk => atk, fireOutfitting: () => [] }, strategy = { kiteMode: "none" };
  for (const count of [0, 15, 19, 20]) {
    const front = Array.from({ length: count }, (_, i) => unit(`front-${i}`, "ally", { x: 2 + Math.floor(i / 10), y: i % 10 }));
    const state = field([...front, ...reserves(4, "ally")]); state.tick = 1;
    const arrived = deploy(state);
    assert.equal(arrived.length, Math.min(2, 20 - count));
    assert.ok(state.units.filter(onBoard).length <= 20);
    assert.ok(arrived.every(u => u.x === 0 && u.deployedAt === 1 && u.arriving));
    assert.deepEqual(arrived.map(u => u.id), Array.from({ length: arrived.length }, (_, i) => `ally-reserve-${i}`));
    if (arrived.length === 2) assert.deepEqual(arrived.map(u => u.y), [4, 5]);
  }
  const simultaneous = field([...reserves(3, "ally"), ...reserves(3, "enemy")]);
  step(simultaneous, strategy, deps);
  assert.equal(simultaneous.units.filter(onBoard).length, 4);
  assert.equal(simultaneous.units.find(u => u.side === "enemy" && u.arriving).x, 9);
  assert.equal(new Set(simultaneous.units.filter(onBoard).map(u => `${u.x},${u.y}`)).size, 4);
  const routingFull = field([...Array.from({ length: 20 }, (_, i) => unit(`r-${i}`, "ally", { x: 2 + Math.floor(i / 10), y: i % 10, status: "routing" })), ...reserves(2, "ally")]);
  assert.equal(deploy(routingFull).length, 0, "敗走中も盤上20部隊の枠を使用する");
  for (const size of [8, 10, 12, 15]) for (const status of ["active", "routing"]) {
    const limit = modules["./battleGeometry.js"].namespace.battleDeploymentLimit(size);
    for (const count of [limit - 2, limit - 1, limit]) {
      const front = ["ally", "enemy"].flatMap(side => Array.from({ length: count }, (_, i) =>
        unit(`${side}-${i}`, side, { x: side === "ally" ? 2 + Math.floor(i / size) : size - 3 - Math.floor(i / size), y: i % size, status })));
      const state = field([...front, ...reserves(4, "ally"), ...reserves(4, "enemy")]);
      state.size = size;
      const arrived = deploy(state);
      for (const side of ["ally", "enemy"]) {
        assert.equal(arrived.filter(u => u.side === side).length, limit - count);
        assert.equal(state.units.filter(u => u.side === side && onBoard(u)).length, limit);
      }
    }
  }
  const longQueue = field([...reserves(50, "ally"), ...reserves(50, "enemy")]);
  const ids = new Set();
  for (let tick = 1; tick <= 50; tick++) {
    longQueue.tick = tick;
    for (const side of ["ally", "enemy"]) {
      const front = longQueue.units.filter(u => u.side === side && onBoard(u));
      if (front.length >= 18) front.slice(0, 2).forEach(u => { u.hp = 0; u.status = "destroyed"; });
      // 後端を空け、上限と投入順だけを独立に検証する。
      longQueue.units.filter(u => u.side === side && onBoard(u)).forEach((u, i) => { u.x = side === "ally" ? 2 + Math.floor(i / 10) : 7 - Math.floor(i / 10); u.y = i % 10; });
    }
    for (const deployed of deploy(longQueue)) { assert.equal(ids.has(deployed.id), false); ids.add(deployed.id); }
    for (const side of ["ally", "enemy"]) assert.ok(longQueue.units.filter(u => u.side === side && onBoard(u)).length <= 20);
  }
  assert.equal(ids.size, 100, "大きな予備隊キューもID重複や投入漏れなし");
  const newcomer = reserves(1, "ally")[0]; newcomer.atk = 90; newcomer.range = 10;
  const archer = unit("archer", "enemy", { x: 2, y: 4, range: 10, role: "ranged", atk: 7 });
  const arrival = field([newcomer, archer]);
  step(arrival, strategy, deps);
  assert.equal(newcomer.x, 0); assert.equal(newcomer.y, 4); assert.equal(newcomer.cooldown, 0);
  assert.equal(newcomer.hp, 93, "登場tickも被攻撃対象"); assert.equal(archer.hp, 100, "登場tickは攻撃不可");
  assert.equal(isHostileZone({ x: 1, y: 4 }, archer, [newcomer]), false, "登場tickはZoCなし");
  assert.equal(localPressure({ ...archer, x: 1, count: 1 }, [newcomer]), 0, "登場tickは局所圧力なし");
  step(arrival, strategy, deps); assert.equal(archer.hp, 10, "翌tickから攻撃可能");

  const wall = Array.from({ length: 10 }, (_, y) => unit(`block-${y}`, "enemy", { x: 0, y }));
  const sealed = field([...wall, ...reserves(2, "ally")]);
  for (let tick = 1; tick <= 3; tick++) {
    const outcome = step(sealed, strategy, deps);
    assert.equal(outcome.ended, tick === 3); assert.equal(sealed.entryBlockedTicks.ally, tick);
  }
  assert.equal(sealed.resultReason, "blockade"); assert.equal(result(sealed.units, false, sealed), "lose");
  const zoneWall = field([...wall.map(u => ({ ...u, x: 1 })), ...reserves(1, "ally")]);
  assert.equal(deploy(zoneWall).length, 0, "空きマスでも敵ZoC内へ投入しない");
  const friendJam = field([...wall.filter(u => u.y !== 4), unit("runner", "ally", { x: 0, y: 4, status: "routing" }), ...reserves(1, "ally")]);
  for (let i = 0; i < 5; i++) deploy(friendJam);
  assert.equal(friendJam.entryBlockedTicks.ally, 0, "味方の入口渋滞は封鎖敗北の待ち時間に含めない");
  assert.equal(continues(friendJam, "ally"), true);
  const wiped = field([...Array.from({ length: 20 }, (_, i) => unit(`a-${i}`, "ally", { x: 2 + Math.floor(i / 10), y: i % 10 })),
    unit("enemy", "enemy"), ...reserves(3, "ally")]);
  const first = step(wiped, strategy, { ...deps, fireOutfitting: (_tick, units) => { units.filter(u => u.side === "ally").forEach(u => { u.hp = 0; }); return []; } });
  assert.equal(first.ended, false, "盤上全滅後も予備隊の投入機会を残す");
  step(wiped, strategy, deps);
  assert.equal(wiped.units.filter(u => u.arriving).length, 2);
  assert.ok(wiped.units.filter(u => u.arriving).every(u => u.deployedAt === 2));
  const normal = field([unit("a", "ally"), ...reserves(3, "enemy")]); delete normal.battleKind;
  assert.equal(deploy(normal).length, 0); assert.equal(result(normal.units, false, normal), "win", "通常戦に予備隊を混ぜない");
  const deadline = field([unit("a", "ally"), unit("e", "enemy"), ...reserves(4, "enemy")]);
  deadline.tick = rules.maxTicks - 1;
  const expired = step(deadline, strategy, deps);
  assert.equal(expired.forceDraw, true); assert.equal(result(deadline.units, true, deadline), "draw");
  const finalBlock = field([...wall, ...reserves(1, "ally")]);
  finalBlock.tick = rules.maxTicks - 1; finalBlock.entryBlockedTicks = { ally: 2 };
  assert.equal(step(finalBlock, strategy, deps).forceDraw, false, "最終tickでも継戦不能が時間切れに優先する");
  const { wasBattleDeployed, settleBattlePersonnel } = personnel.namespace;
  assert.equal(wiped.units.filter(u => u.side === "ally" && wasBattleDeployed(u)).reduce((n, u) => n + u.count, 0), 220);
  const settled = settleBattlePersonnel({ infantry: { 1: 230 } }, wiped.units, { lossProb: 1, upgrades: 0 });
  assert.equal(settled.troops.infantry[1], 30, "未投入・増援生還兵は損耗しない");
  console.log("増援: 20部隊上限・順序・後端・登場制限・全滅後投入・敵封鎖と味方渋滞・時間切れ・人数精算: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
