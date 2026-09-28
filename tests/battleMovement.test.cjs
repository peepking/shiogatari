const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const path = require("node:path");

/** @param {unknown} value 比較値。 @returns {unknown} 通常のオブジェクト。 */
function plain(value) { return JSON.parse(JSON.stringify(value)); }

/** @returns {Promise<void>} 迂回・移動競合・同時攻撃・役割分類の結合を検証する。 */
async function main() {
  const movement = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../battleMovement.js"), "utf8"));
  await movement.link(() => {}); await movement.evaluate();
  const { findAttackPath: find, findTacticalPath: tactical, resolveBattleMovement: resolve, isHostileZone: zone } = movement.namespace;
  const start = { id: "a", x: 1, y: 1, range: 1 };
  const occupied = new Set(["1,1", "2,1", "3,1", "4,1"]);
  const route = find(start, { x: 4, y: 1 }, 6, occupied);
  assert.ok(route.length > 0, "直進できなくても横から迂回する");
  assert.notEqual(route[0].y, 1);
  assert.ok(route.every(p => !occupied.has(`${p.x},${p.y}`)));
  let previous = start;
  for (const point of route) {
    assert.equal(Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y), 1);
    previous = point;
  }
  assert.equal(Math.abs(previous.x - 4) + Math.abs(previous.y - 1), 1);
  assert.equal(find(start, { x: 4, y: 1 }, 6, new Set([...occupied, "0,1", "1,0", "1,2"])).length, 0);
  assert.equal(find({ ...start, range: 3 }, { x: 4, y: 1 }, 6, occupied).length, 0, "射程内なら接近不要");

  /** @param {boolean} reverse 配列反転。 @param {number} wait 待機時間。 @returns {object} 競合結果。 */
  function conflict(reverse, wait = 0) {
    const units = [{ id: "ally", side: "ally", x: 1, y: 1 }, { id: "enemy", side: "enemy", x: 3, y: 1, moveWait: wait }];
    const plans = units.map(unit => ({ unit, kind: "approach", path: [{ x: 2, y: 1 }], wantsMove: true }));
    const result = resolve(reverse ? plans.reverse() : plans, reverse ? [...units].reverse() : units, 6, 83, 1);
    assert.equal(result.moves.length, 1);
    assert.equal(new Set(units.map(u => `${u.x},${u.y}`)).size, 2);
    return { units, result };
  }
  assert.deepEqual(plain(conflict(false)), plain(conflict(true)), "移動結果は配列順に依存しない");
  assert.equal(conflict(false, 5).result.moves[0].id, "enemy", "待たされた部隊を優先する");
  const crossing = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 3, y: 0 }];
  resolve([
    { unit: crossing[0], path: [{ x: 1, y: 0 }, { x: 2, y: 0 }], wantsMove: true },
    { unit: crossing[1], path: [{ x: 2, y: 0 }, { x: 1, y: 0 }], wantsMove: true },
  ], crossing, 6, 1, 1);
  assert.deepEqual(crossing.map(u => u.x), [1, 2], "移動2でも敵とすり抜けない");

  const guard = { id: "guard", side: "enemy", x: 3, y: 2, hp: 100, role: "melee", count: 5, range: 2 };
  const rider = { id: "rider", side: "ally", x: 1, y: 2, hp: 100 };
  assert.equal(zone({ x: 2, y: 2 }, rider, [guard]), true);
  assert.equal(zone({ x: 1, y: 2 }, rider, [guard]), false, "槍の拘束も1マス");
  for (const change of [{ count: 4 }, { hp: 0 }, { role: "ranged" }, { role: "support" }, { status: "routing" }, { status: "reserve" }])
    assert.equal(zone({ x: 2, y: 2 }, rider, [{ ...guard, ...change }]), false);
  const enter = { unit: rider, path: [{ x: 2, y: 2 }, { x: 2, y: 1 }], kind: "approach", wantsMove: true };
  assert.equal(resolve([enter], [rider, guard], 6, 1, 1).zocStops, 1);
  assert.deepEqual([rider.x, rider.y], [2, 2], "途中で拘束範囲へ入ったら停止");
  const leave = { unit: rider, path: [{ x: 1, y: 2 }, { x: 0, y: 2 }], kind: "kite", wantsMove: true };
  resolve([leave], [rider, guard], 6, 1, 2);
  assert.deepEqual([rider.x, rider.y], [1, 2], "離脱も1マスまで");
  assert.equal(leave.attackBlocked, true);
  const medic = { id: "medic", side: "ally", x: 1, y: 3, range: 1, role: "support" };
  const front = { id: "front", side: "ally", x: 3, y: 3, role: "melee", count: 10 };
  assert.equal(tactical(medic, guard, 6, new Set(["1,3", "3,3", "3,2"]), 0, [medic, front, guard]).length, 0,
    "前衛の後ろにいる支援兵は突出しない");
  const lagging = { ...medic, x: 0 };
  const follow = tactical(lagging, guard, 6, new Set(["0,3", "3,3", "3,2"]), 0, [lagging, front, guard]);
  assert.ok(follow.length > 0 && follow.at(-1).x < front.x, "離れた支援兵は前衛の背後へ追随");
  assert.equal(tactical(medic, guard, 6, new Set(), 0, [medic, guard]).length, 0, "前衛不在でも支援兵が単独突進しない");
  const mounted = { id: "mounted", side: "ally", x: 1, y: 3, range: 1, role: "melee", traits: ["mounted"] };
  const distant = { ...guard, x: 5, y: 3 };
  const flank = tactical(mounted, distant, 8, new Set(["1,3", "5,3"]), 0, [mounted, distant]);
  assert.notEqual(flank.at(-1).y, distant.y, "騎乗兵は2歩までの迂回なら側方の攻撃位置を選べる");

  const core = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../battleCore.js"), "utf8"));
  const morale = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../battleMorale.js"), "utf8"));
  await morale.link(() => {});
  const reinforcements = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../battleReinforcements.js"), "utf8"));
  await core.link(name => ({ "./battleMovement.js": movement, "./battleMorale.js": morale, "./battleReinforcements.js": reinforcements })[name]); await core.evaluate();
  const { stepBattle: step, battleResult } = core.namespace;
  /** @param {string} side 陣営。 @param {number} x 座標。 @returns {object} 部隊。 */
  function unit(side, x) {
    return { id: side, side, x, y: 2, type: "infantry", name: "歩兵", role: "melee", traits: [],
      hp: 100, maxHp: 100, atk: 500, def: 0, spd: 2, range: 1, move: 1, cooldown: 0,
      terrain: { plain: 100 }, status: "active" };
  }
  /** @param {Array} units 部隊。 @returns {object} 戦場。 */
  function field(units) {
    return { units, size: 6, grid: Array.from({ length: 6 }, () => Array(6).fill("plain")),
      elapsedMs: 0, tick: 0, randomSeed: 83, outfitting: { effects: { attacks: [] } } };
  }
  const dependencies = { defendedDamage: power => power, fireOutfitting: () => [] };
  const strategy = { targetMode: "type", kiteMode: "kite", chargeMode: "none" };
  const duel = field([unit("ally", 2), unit("enemy", 3)]);
  const result = step(duel, strategy, dependencies);
  assert.equal(result.ended, true);
  assert.ok(duel.units.every(u => u.hp === 0 && u.status === "destroyed"));
  assert.equal(battleResult(duel.units), "draw", "先に攻撃した側だけが生き残らず相打ちになる");
  assert.equal(result.logs.length, 2, "撃破ログを各部隊1回だけ出す");

  const spear = field([{ ...unit("ally", 2), atk: 10, type: "halberd", range: 2 }, { ...unit("enemy", 3), atk: 10 }]);
  step(spear, strategy, dependencies);
  assert.deepEqual(spear.units.map(u => u.x), [2, 3], "射程2の槍兵は遠隔の距離維持をしない");
  assert.deepEqual(spear.units.map(u => u.hp), [90, 90]);
  const archer = field([{ ...unit("ally", 2), role: "ranged", type: "archer", range: 4, atk: 10 }, { ...unit("enemy", 3), atk: 10 }]);
  step(archer, strategy, dependencies);
  assert.ok(archer.units[0].x !== 2 || archer.units[0].y !== 2, "射撃兵は距離維持する");
  assert.equal(archer.units[1].hp, 90, "距離維持の後でも射程内なら射撃する");

  const pinned = field([{ ...unit("ally", 2), role: "ranged", type: "archer", range: 4, atk: 10 },
    { ...unit("enemy", 3), count: 10, atk: 10 }]);
  const pinnedResult = step(pinned, strategy, dependencies);
  assert.ok(pinnedResult.observation.zocStops > 0);
  assert.equal(pinned.units[1].hp, 100, "拘束から離脱した射撃兵は射撃できない");

  let expectedBattle;
  for (const reverse of [false, true]) {
    const units = [{ ...unit("ally", 1), atk: 10 }, { ...unit("enemy", 4), atk: 10 }];
    const state = field(reverse ? units.reverse() : units);
    for (let tick = 0; tick < 5; tick++) step(state, strategy, dependencies);
    const compared = state.units.sort((a, b) => a.id.localeCompare(b.id));
    if (!reverse) expectedBattle = plain(compared);
    else assert.deepEqual(plain(compared), expectedBattle);
  }
  // 混成20対20を複数シードで最後まで進め、混雑時にも重複・範囲外が生じないことを確認する。
  for (const seed of [1, 83, 912]) {
    const units = ["ally", "enemy"].flatMap(side => Array.from({ length: 20 }, (_, index) => ({
      ...unit(side, side === "ally" ? Math.floor(index / 10) : 9 - Math.floor(index / 10)),
      id: `${side}${index}`, y: index % 10, hp: 300, maxHp: 300, count: 10, atk: 30,
      role: index < 5 ? "ranged" : index === 5 ? "support" : "melee", range: index < 5 ? 4 : 1,
    })));
    const state = { ...field(units), size: 10, randomSeed: seed, grid: Array.from({ length: 10 }, () => Array(10).fill("plain")) };
    let result;
    do {
      result = step(state, strategy, dependencies);
      const alive = state.units.filter(u => u.hp > 0 && u.status !== "escaped");
      assert.equal(new Set(alive.map(u => `${u.x},${u.y}`)).size, alive.length);
      assert.ok(alive.every(u => u.x >= 0 && u.x < 10 && u.y >= 0 && u.y < 10));
    } while (!result.ended && state.tick < 60);
    assert.equal(result.ended, true);
  }
  console.log("戦闘移動・競合の公平性・相打ち・槍兵と射撃兵の役割: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
