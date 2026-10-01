const { readSource } = require("./helpers/source.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");

/** @param {string} file ファイル。 @returns {Promise<string>} ソース。 */
function read(file) { return readSource(file); }

/** @param {string} side 陣営。 @param {number} x 位置。 @returns {object} 検証用部隊。 */
function unit(side, x) {
  return { id: side, side, type: "infantry", name: "歩兵", count: 10, hp: 330, maxHp: 330,
    atk: 26, def: 18, spd: 2, range: 1, move: 1, terrain: { plain: 110 },
    x, y: 4, cooldown: 0, switchLock: 0, targetId: null };
}

/** @returns {object} DOMを持たない戦闘初期状態。 */
function initial() {
  return { size: 10, grid: Array.from({ length: 10 }, () => Array(10).fill("plain")),
    units: [unit("ally", 1), unit("enemy", 8)], elapsedMs: 0, tick: 0,
    attackFx: [], moveFx: [], outfitting: { effects: { attacks: [{ id: "test", interval: 5, power: 30 }] } } };
}

/** @returns {Promise<void>} 計算の独立性・再現性・画面接続を検証する。 */
async function main() {
  const modules = {};
  for (const name of ["battleGeometry", "battleUnitFormation", "battleTarget", "battleCore", "battleMovement", "battleMorale", "battleReinforcements"])
    modules[`./${name}.js`] = new vm.SourceTextModule(await read(`${name}.js`));
  const core = modules["./battleCore.js"];
  await core.link(name => modules[name]);
  await core.evaluate();
  const { stepBattle, battleResult, createBattleRandom, BATTLE_RULES } = core.namespace;
  const supportContext = vm.createContext({});
  const support = await read("outfitting.js");
  for (const name of ["defendedDamage", "fireOutfitting"]) {
    const start = support.indexOf(`export function ${name}(`);
    const end = name === "defendedDamage" ? support.indexOf("\n", start) : support.indexOf("\n}", start) + 2;
    vm.runInContext(support.slice(start, end).replace("export ", ""), supportContext);
  }
  const dependencies = vm.runInContext("({ defendedDamage, fireOutfitting })", supportContext);
  const strategy = { targetMode: "type", kiteMode: "kite", retreatThreshold: 30, chargeMode: "none" };

  /** @param {number} seed 乱数シード。 @returns {object} 全tickの再現用記録。 */
  function run(seed) {
    const state = initial();
    state.units.push({ ...unit("enemy", 8), id: "enemy-2", y: 5 });
    const random = createBattleRandom(seed);
    const records = [];
    let outcome;
    do {
      outcome = stepBattle(state, strategy, { ...dependencies, random });
      records.push(JSON.stringify({ state, outcome }));
    } while (!outcome.ended);
    assert.ok(state.tick <= BATTLE_RULES.maxTicks);
    return { records, result: battleResult(state.units, outcome.forceDraw) };
  }
  assert.deepEqual(run(12345), run(12345), "同じ初期状態とシードはログ・射撃・移動・HPまで再現する");
  assert.notDeepEqual(run(12345).records, run(98765).records, "異なるシードが支援射撃へ反映される");
  assert.equal(battleResult([], false), "draw");
  assert.equal(battleResult([unit("ally", 0)], false), "win");
  assert.equal(battleResult([unit("enemy", 9)], false), "lose");
  assert.equal(battleResult([unit("ally", 0), unit("enemy", 9)], true), "draw");

  const noFire = { ...dependencies, fireOutfitting: () => [] };
  /** 移動を止めた1tickで、地形・防御軽減を通した兵種特性の実ダメージを比較する。
   * @param {object} attacker 攻撃側。 @param {object} target 防御側。
   * @param {string} side 攻撃側陣営。 @returns {number} 実ダメージ。
   */
  function traitDamage(attacker = {}, target = {}, side = "ally") {
    const state = initial();
    state.units = [
      { ...unit(side, 4), role: "melee", move: 0, atk: 100, terrain: { plain: 100 }, ...attacker },
      { ...unit(side === "ally" ? "enemy" : "ally", 5), role: "melee", move: 0,
        cooldown: 100, terrain: { plain: 100 }, ...target },
    ];
    const hp = state.units[1].hp;
    stepBattle(state, { ...strategy, kiteMode: "none" }, noFire);
    return hp - state.units[1].hp;
  }
  const baseDamage = traitDamage();
  for (const side of ["ally", "enemy"]) {
    assert.equal(traitDamage({ traits: ["antiCavalry"] }, { traits: ["mounted"] }, side),
      Math.floor(baseDamage * 1.2), "対騎兵は防御軽減後の通常ダメージを増やす");
    assert.equal(traitDamage({ traits: ["antiCavalry"] }, {}, side), baseDamage);
    assert.equal(traitDamage({ role: "ranged" }, {}, side), dependencies.defendedDamage(70, 18));
    assert.equal(traitDamage({ role: "ranged", range: 3 }, { x: 6 }, side), baseDamage,
      "隣接していない近接兵では射撃威力を下げない");
    assert.equal(traitDamage({ role: "ranged" }, { role: "support" }, side), baseDamage);
    assert.equal(traitDamage({ role: "ranged" }, { status: "routing" }, side), baseDamage);
    assert.equal(traitDamage({ role: "ranged", shaken: true }, {}, side), dependencies.defendedDamage(63, 18),
      "動揺と接近時の弱体化は乗算する");
  }
  const volley = initial();
  volley.units.forEach(u => { u.move = 0; u.cooldown = 100; u.terrain = { plain: 100 }; });
  volley.units[0].role = "ranged";
  volley.units[0].traits = ["antiCavalry"];
  volley.units[0].shaken = true;
  volley.units[1].traits = ["mounted", "steadfast"];
  volley.units[1].role = "melee";
  volley.units[1].x = 2;
  volley.outfitting.effects.attacks = [{ id: "grape", interval: 1, power: 60, allEnemies: true }];
  stepBattle(volley, { ...strategy, kiteMode: "none" }, dependencies);
  const supportDamage = dependencies.defendedDamage(60, 18);
  assert.equal(volley.units[1].hp, 330 - supportDamage, "艤装射撃に射撃兵弱体化・動揺・対騎兵を流用しない");
  assert.ok(Math.abs(volley.units[1].moraleLoss - Math.min(20, supportDamage / 330 * 60) * 0.8) < 1e-9,
    "艤装による被害の士気低下にも堅固が有効");
  const reserveState = initial();
  const reserve = { ...unit("enemy", 2), id: "reserve", status: "reserve", deployedAt: null };
  reserveState.units.push(reserve);
  const reserveBefore = JSON.stringify(reserve);
  stepBattle(reserveState, strategy, dependencies);
  assert.equal(JSON.stringify(reserve), reserveBefore, "未投入部隊は移動・攻撃・被攻撃しない");
  assert.equal(battleResult([reserve, unit("ally", 0)]), "win", "増援未導入段階の盤上判定は未投入兵を除外する");
  const waiting = initial();
  waiting.units[1].x = 2;
  waiting.units.forEach(u => { u.atk = 1; u.hp = 100000; u.maxHp = 100000; });
  let last;
  for (let tick = 1; tick <= 60; tick++) {
    last = stepBattle(waiting, strategy, noFire);
    assert.equal(last.ended, tick === 60);
    assert.equal(last.observation.tick, tick);
  }
  assert.equal(last.forceDraw, true);

  const raw = await read("battle.js");
  const start = raw.indexOf("function advanceBattleTick(");
  const wrapper = raw.slice(start, raw.indexOf("\n}", start) + 2);
  const screenState = initial();
  const directState = initial();
  screenState.random = createBattleRandom(42);
  const random = createBattleRandom(42);
  const logs = [], endings = [];
  const screen = vm.createContext({ battleState: screenState, battleStrategy: strategy,
    ...dependencies, stepBattle, BASE_TICK_MS: BATTLE_RULES.tickMs, OUTFITTING_ITEMS: {},
    addBattleLog: text => logs.push(text), finishBattle: draw => endings.push(draw) });
  vm.runInContext(wrapper, screen);
  let result;
  do {
    result = stepBattle(directState, strategy, { ...dependencies, random });
    const ended = vm.runInContext("advanceBattleTick()", screen);
    assert.equal(ended, result.ended);
    assert.equal(JSON.stringify(screenState.units), JSON.stringify(directState.units));
  } while (!result.ended);
  assert.equal(endings.length, 1);
  assert.equal(endings[0], result.forceDraw);
  assert.equal(screenState.observations.length, screenState.tick);
  assert.ok(logs.length > 0);
  console.log("戦闘計算の独立性・乱数再現・60tick・画面接続: 全項目成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
