const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const path = require("node:path");

/** @param {string} file ファイル。 @returns {Promise<string>} ソース。 */
function read(file) { return fs.readFile(path.join(__dirname, "..", file), "utf8"); }
/** @param {string} id ID。 @param {number} x 横。 @param {number} y 縦。 @param {object} extra 上書き。 @returns {object} 部隊。 */
function unit(id, x, y, extra = {}) {
  return { id, name: id, side: "ally", x, y, count: 10, hp: 100, maxHp: 100, morale: 100,
    status: "active", role: "melee", move: 1, range: 1, atk: 0, def: 0, spd: 1, cooldown: 0, ...extra };
}
/** @param {Array} units 部隊。 @returns {object} 戦場。 */
function field(units) { return { units, size: 6, tick: 0, elapsedMs: 0, grid: Array.from({ length: 6 }, () => Array(6).fill("plain")), outfitting: { effects: { attacks: [] } } }; }

/** @returns {Promise<void>} 士気・敗走・交換・新勝敗と引き分けの外部処理を検証する。 */
async function main() {
  const modules = {};
  for (const name of ["battleMorale", "battleMovement", "battleReinforcements", "battleCore"])
    modules[`./${name}.js`] = new vm.SourceTextModule(await read(`${name}.js`));
  await modules["./battleCore.js"].link(name => modules[name]);
  await modules["./battleCore.js"].evaluate();
  const { localPressure: pressure, updateBattleMorale: morale } = modules["./battleMorale.js"].namespace;
  const { findRoutPath, resolveBattleMovement } = modules["./battleMovement.js"].namespace;
  const { stepBattle, battleResult } = modules["./battleCore.js"].namespace;
  const a = unit("a", 2, 2), left = unit("left", 1, 2, { side: "enemy" }), right = unit("right", 3, 2, { side: "enemy" });
  assert.equal(pressure(a, [a, left]), 0);
  assert.equal(pressure(a, [a, left, right]), 2);
  assert.equal(pressure(a, [a, { ...left, count: 1 }, { ...right, count: 1 }]), 0.1);
  assert.equal(pressure(a, [a, { ...left, status: "routing" }, right]), 0);
  const hurt = unit("hurt", 2, 2, { hp: 1 });
  morale(field([hurt]), [{ id: "hurt", hp: 100 }]);
  assert.equal(hurt.morale, 80, "1tickの低下は20まで");
  const sturdy = unit("sturdy", 2, 2, { hp: 1, traits: ["steadfast"] });
  morale(field([sturdy]), [{ id: "sturdy", hp: 100 }]);
  assert.equal(sturdy.morale, 84, "堅固は低下上限20の適用後に20%軽減する");
  const surrounded = unit("surrounded", 2, 2, { traits: ["steadfast"] });
  const pressed = field([surrounded, left, right]);
  pressed.moraleShocks = [{ x: 2, y: 3, side: "ally", count: 10 }];
  morale(pressed, pressed.units);
  assert.ok(Math.abs(surrounded.moraleLoss - 9.6) < 1e-9, "圧力と味方敗走の衝撃も軽減する");
  const quiet = unit("quiet", 0, 0, { morale: 40, shaken: true });
  const safe = field([quiet]);
  for (let tick = 0; tick < 2; tick++) morale(safe, [quiet]);
  assert.equal(quiet.morale, 40);
  morale(safe, [quiet]); assert.equal(quiet.morale, 42); assert.equal(quiet.shaken, true);
  morale(safe, [quiet]); morale(safe, [quiet]); assert.equal(quiet.shaken, false);
  const first = unit("first", 2, 2, { morale: 15 }), neighbor = unit("neighbor", 2, 3, { morale: 20 });
  const cascade = field([first, neighbor]);
  morale(cascade, cascade.units);
  assert.equal(first.status, "routing"); assert.equal(neighbor.morale, 20, "同tickに敗走連鎖しない");
  morale(cascade, cascade.units);
  assert.equal(neighbor.status, "routing"); assert.equal(neighbor.morale, 14);
  const observer = unit("observer", 1, 2);
  cascade.units.push(observer); cascade.moraleShocks = []; first.hp = 0;
  morale(cascade, [{ id: first.id, hp: 100 }, neighbor, observer]);
  assert.equal(observer.morale, 100, "敗走後の撃破は二重の衝撃を出さない");

  const fugitive = unit("fugitive", 2, 2, { status: "routing" }), friend = unit("friend", 1, 2);
  const route = findRoutPath(fugitive, 6, [fugitive, friend], 0);
  assert.equal(route.at(-1).x, 0);
  const plans = [{ unit: fugitive, path: route.slice(0, 1), kind: "rout", wantsMove: true }, { unit: friend, path: [], kind: "hold" }];
  resolveBattleMovement(plans, [fugitive, friend], 6, 1, 1);
  assert.equal(fugitive.x, 1); assert.equal(friend.x, 2); assert.equal(plans[1].attackBlocked, true);
  const enemy = unit("blocker", 0, 2, { side: "enemy" });
  const trapped = unit("trapped", 1, 2, { status: "routing" });
  const wall = [enemy, unit("up", 1, 1, { side: "enemy" }), unit("down", 1, 3, { side: "enemy" }), unit("back", 2, 2, { side: "enemy" })];
  assert.equal(findRoutPath(trapped, 6, [trapped, ...wall], 0).length, 0);
  assert.equal(trapped.hp, 100, "退路封鎖だけで撃破しない");
  const deps = { defendedDamage: atk => atk, fireOutfitting: () => [] };
  const escape = field([unit("runner", 1, 0, { status: "routing" }), unit("ally", 2, 4), unit("enemy", 4, 4, { side: "enemy" })]);
  stepBattle(escape, { kiteMode: "none" }, deps);
  assert.equal(escape.units[0].status, "escaped");
  assert.equal(battleResult([unit("runner", 1, 0, { status: "routing" }), unit("enemy", 4, 4, { side: "enemy" })]), "lose");
  assert.equal(battleResult([a, { ...right, hp: 1 }], true), "draw", "HP差があっても時間切れは引き分け");
  const mutual = field([unit("a", 2, 2, { morale: 15 }), unit("e", 3, 2, { side: "enemy", morale: 15 })]);
  assert.equal(stepBattle(mutual, { kiteMode: "none" }, deps).ended, true);
  assert.equal(battleResult(mutual.units), "draw", "両軍同時敗走は引き分け");

  // 実際の戦後関数に引き分けを渡し、敗北処理・依頼失敗・戦況補正へ漏れないことを検証する。
  const raw = await read("ui.js"), start = raw.indexOf("function processBattleOutcome(");
  const body = raw.slice(start, raw.indexOf("\n}", start) + 2);
  for (const eventTag of ["merchant_attack", "merchant_rescue_help", "merchant_rescue_raid", "checkpoint_force", "wreck_attack", "bounty", "exploration"]) {
    const quest = { id: 1, type: "test" };
    const state = { funds: 5000, fame: 100, supplies: { food: 50 }, troops: {}, quests: { active: [quest] },
      pendingEncounter: { questId: 1, questFightIdx: 1, enemyFactionId: "north", enemyFormation: [{ type: "infantry", count: 10 }], eventTag } };
    if (eventTag === "bounty") { state.pendingEncounter.bountyId = 3; state.bounties = { active: [{ id: 3 }] }; }
    if (eventTag === "exploration") state.pendingEncounter.explorationId = 2;
    let explored = false;
    const context = vm.createContext({ state, absDay: () => 0, finishPursuit: () => false, BATTLE_RESULT: { WIN: "win", LOSE: "lose", DRAW: "draw" }, BATTLE_RESULT_LABEL: {}, NONE_LABEL: "なし",
      getPlayerFactionId: () => "west", settleBattlePersonnel: () => ({ troops: {}, losses: {}, promotions: [], leveled: 0 }),
      calcLosses: () => ({ lossProb: 0.6 }), killedEnemyCount: () => 0, calcCaptures: () => ({}),
      wasBattleDeployed: () => true, TROOP_STATS: {}, BONUS_CAPTURE_EVENT_TAGS: new Set(),
      nationalPowerResources: () => [], completeBattlePower: () => [], renderBattleSummary() {}, clearBattlePrep() {}, syncUI() {},
      addWarScore() { assert.fail("引き分けで戦況を変更しない"); },
      finishBounty() { assert.fail("引き分けで賞金首を討伐しない"); },
      finishExploration(won) { assert.equal(won, false); explored = true; return []; },
    });
    vm.runInContext(body, context);
    vm.runInContext('processBattleOutcome("draw", { units: [] })', context);
    assert.equal(state.funds, 5000); assert.equal(state.fame, 100); assert.equal(state.supplies.food, 50);
    assert.equal(state.quests.active.length, 1); assert.equal(quest.fixedEnemyByFight[1].formation[0].count, 10);
    if (eventTag === "bounty") assert.equal(state.bounties.active.length, 1);
    assert.equal(explored, eventTag === "exploration");
  }
  console.log("士気・圧力・遅延敗走・安全な場所譲り・退出・引き分けの精算: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
