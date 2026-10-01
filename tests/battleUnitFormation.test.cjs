const { readSource } = require("./helpers/source.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");

/** @param {object} extra 上書き。 @returns {object} 実戦相当の検証部隊。 */
function unit(extra = {}) {
  return { id: "ally-1", side: "ally", type: "infantry", name: "歩兵", role: "melee", count: 10,
    hp: 1000, maxHp: 1000, morale: 100, atk: 100, def: 0, spd: 2, range: 1, move: 0,
    x: 3, y: 3, cooldown: 0, switchLock: 0, status: "active", deployedAt: 0, ...extra };
}

/** @param {Array} units 部隊。 @returns {object} 戦場。 */
function field(units) {
  return { units, size: 8, grid: Array.from({ length: 8 }, () => Array(8).fill("plain")), tick: 0,
    elapsedMs: 0, randomSeed: 42, outfitting: { effects: { attacks: [] } }, moraleShocks: [] };
}

/** @param {string} source 本体。 @param {string} name 関数名。 @returns {string} 画面接続用の本体関数。 */
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}

/**
 * 陣形の実ダメージ・士気・兵種別優先順位・予約・保存・停止再開を検証する。
 * 期待値は設計上の数値と操作の前後関係から求め、時間切れ率を合否に使わない。
 * @returns {Promise<void>} 完了。
 */
async function main() {
  const modules = {};
  for (const name of ["battleGeometry", "battleUnitFormation", "battleUnitFormationOrders", "battleUnitFormationUI", "battleTarget", "battleCore",
    "battleMorale", "battleMovement", "battleReinforcements", "grandBattle"])
    modules[`./${name}.js`] = new vm.SourceTextModule(readSource(`${name}.js`));
  await modules["./battleCore.js"].link(name => modules[name]);
  await modules["./battleCore.js"].evaluate();
  await modules["./grandBattle.js"].link(name => modules[name]);
  await modules["./grandBattle.js"].evaluate();
  await modules["./battleUnitFormationUI.js"].link(name => modules[name]);
  await modules["./battleUnitFormationUI.js"].evaluate();
  const f = modules["./battleUnitFormation.js"].namespace;
  const { stepBattle: step, createBattleRandom: random } = modules["./battleCore.js"].namespace;
  const { updateBattleMorale: morale } = modules["./battleMorale.js"].namespace;
  const { restoreGrandRoster: restore } = modules["./grandBattle.js"].namespace;
  const strategy = { targetMode: "type", kiteMode: "none", chargeMode: "none" };
  const outfitting = readSource("outfitting.js");
  const shotContext = vm.createContext({});
  vm.runInContext(outfitting.match(/export function defendedDamage[^\n]+/)[0].replace("export ", ""), shotContext);
  vm.runInContext(extract(outfitting, "fireOutfitting"), shotContext);
  const deps = vm.runInContext("({defendedDamage, fireOutfitting})", shotContext);

  assert.equal(f.normalizeFormationOrder("auto"), "auto");
  assert.equal(f.DEFAULT_FORMATION_ORDER, "auto");
  for (const order of [undefined, null]) {
    const initialUnit = unit(); f.initializeUnitFormation(initialUnit, order);
    assert.equal(initialUnit.formationOrder, "auto"); assert.equal(initialUnit.formationId, "line");
    assert.equal(initialUnit.formationChangeAt, 1);
  }
  for (const invalid of [null, undefined, "__proto__", "bogus", "横陣"]) assert.equal(f.normalizeFormationOrder(invalid), "line");
  assert.equal(f.formationDamage(100, { formationId: "charge" }, { formationId: "shieldWall" }), 91);
  assert.equal(f.formationDamage(1, { formationId: "shieldWall" }, { formationId: "shieldWall" }), 1);
  assert.equal(f.formationDamage(11, null, { formationId: "spread" }, "ranged"), 8);
  assert.equal(f.formationDamage(10, null, { formationId: "spread" }, "other"), 10);

  // 防御の四捨五入、特効の切り捨て、陣形の一括切り捨てを実際の攻撃で確認する。
  for (const side of ["ally", "enemy"]) for (const role of ["melee", "ranged", "support"]) {
    const attacker = unit({ id: "attacker", side, role, range: 2, atk: 10, traits: ["antiCavalry"] });
    const target = unit({ id: "target", side: side === "ally" ? "enemy" : "ally", role: "support",
      x: 4, def: 50, traits: ["mounted"], cooldown: 100 });
    f.initializeUnitFormation(attacker, "charge"); f.initializeUnitFormation(target, "spread");
    const state = field([attacker, target]);
    step(state, strategy, deps);
    assert.equal(1000 - target.hp, role === "ranged" ? 8 : 12,
      "従来7→特効8の整数へ突撃と散開を乗算し、支援と長射程の近接も分類する");
  }
  const victim = unit({ side: "enemy", id: "enemy", x: 6, cooldown: 100 });
  f.initializeUnitFormation(victim, "spread");
  const volley = field([unit({ cooldown: 100 }), victim]);
  volley.outfitting.effects.attacks = [{ id: "test", power: 100, interval: 1 }];
  step(volley, strategy, deps);
  assert.equal(victim.hp, 920, "艤装射撃は対象の射撃倍率だけを使う");
  assert.equal(victim.moraleLoss, 4.8, "士気低下は実際のHP減少から求める");

  const surrounded = unit({ hp: 990, formationId: "circle", traits: ["steadfast"] });
  const pressed = field([surrounded, unit({ id: "left", side: "enemy", x: 2 }),
    unit({ id: "right", side: "enemy", x: 4 }), unit({ id: "dead", hp: 0, y: 4 })]);
  pressed.moraleShocks = [{ side: "ally", x: 3, y: 2, count: 10 }];
  morale(pressed, pressed.units.map(item => ({ id: item.id, hp: 1000 })));
  assert.ok(Math.abs(surrounded.moraleLoss - 10.56) < 1e-9,
    "被害0.6＋圧力6×0.7＋撃破敗走衝撃12×0.7の後に堅固0.8");
  const capped = unit({ hp: 1, formationId: "circle", traits: ["steadfast"] });
  morale(field([capped]), [{ id: capped.id, hp: 1000 }]);
  assert.equal(capped.moraleLoss, 16, "円陣で被害を追加軽減せず、全体上限の後に堅固");

  const legacy = unit({ hp: 383, maxHp: 396, formationId: "line" });
  const legacyField = field([legacy, unit({ id: "left", side: "enemy", x: 2 }),
    unit({ id: "right", side: "enemy", x: 4 }), unit({ id: "friend", y: 4 })]);
  legacyField.moraleShocks = [{ side: "ally", x: 3, y: 2, count: 10 }];
  morale(legacyField, [{ id: legacy.id, hp: 396 }]);
  assert.equal(legacy.moraleLoss, 13 / 396 * 60 + 3 + 6, "横陣は被害→圧力→衝撃の加算順も従来どおり");

  for (const role of ["ranged", "support"]) {
    const low = unit({ role, hp: 300 });
    assert.equal(f.chooseUnitFormation(low).id, "line");
    assert.equal(f.chooseUnitFormation(low, { adjacentMelee: true }).id, "shieldWall");
    assert.equal(f.chooseUnitFormation(low, { rangedThreat: true }).id, "spread");
    assert.equal(f.chooseUnitFormation({ ...low, morale: 45 }, { pressure: 1, adjacentMelee: true }).id, "circle");
  }
  assert.equal(f.chooseUnitFormation(unit({ hp: 300 }), { pressure: 3, shock: true }).id, "shieldWall");
  assert.equal(f.chooseUnitFormation(unit({ type: "shield" }), { adjacentMelee: true }).id, "shieldWall");
  assert.equal(f.chooseUnitFormation(unit({ type: "cavalry" }), { target: unit({ hp: 400 }), canAttack: true }).id, "charge");
  assert.equal(f.chooseUnitFormation(unit({ role: "ranged", hp: 600 }), { target: victim, canAttack: true }).id, "line");
  assert.equal(f.chooseUnitFormation(unit({ role: "ranged", hp: 601 }), { target: victim, canAttack: true }).id, "charge");
  assert.equal(f.chooseUnitFormation(unit({ role: "ranged" }), { target: victim, canAttack: false }).id, "line");

  const ordered = unit(); f.initializeUnitFormation(ordered);
  f.queueUnitFormation(ordered, "charge");
  assert.equal(f.resolveUnitFormation(ordered, 1, () => assert.fail()), true);
  assert.equal(ordered.formationChangeAt, 4);
  f.queueUnitFormation(ordered, "circle"); f.queueUnitFormation(ordered, "shieldWall");
  assert.equal(f.resolveUnitFormation(ordered, 2, () => assert.fail()), false);
  assert.equal(f.resolveUnitFormation(ordered, 3, () => assert.fail()), false);
  assert.equal(ordered.formationId, "charge");
  assert.equal(f.resolveUnitFormation(ordered, 4, () => assert.fail()), true);
  assert.equal(ordered.formationId, "shieldWall");
  f.queueUnitFormation(ordered, "auto");
  assert.equal(f.resolveUnitFormation(ordered, 5, () => assert.fail()), false);
  assert.equal(f.resolveUnitFormation(ordered, 7, () => ({ id: "shieldWall", reason: "同じ陣形" })), false);
  assert.equal(ordered.formationChangeAt, 7, "同じ実陣形へ切り替えても制限を延長しない");
  ordered.status = "routing"; f.queueUnitFormation(ordered, "charge");
  f.resolveUnitFormation(ordered, 8, () => assert.fail());
  assert.equal(ordered.pendingFormationOrder, null); assert.equal(ordered.formationId, "shieldWall");

  const archer = unit({ role: "ranged", type: "archer", hp: 250, range: 4, cooldown: 100 });
  f.initializeUnitFormation(archer, "auto");
  const foe = unit({ id: "foe", side: "enemy", x: 4, cooldown: 100 });
  const withdrawal = field([archer, foe]); step(withdrawal, strategy, deps);
  assert.equal(archer.formationId, "shieldWall");
  foe.x = 7;
  for (let t = 2; t <= 3; t++) { step(withdrawal, strategy, deps); assert.equal(archer.formationId, "shieldWall"); }
  step(withdrawal, strategy, deps); assert.equal(archer.formationId, "line", "低HPの射撃兵も近接が離れれば盾壁を解除する");

  for (const excluded of [{ status: "routing" }, { status: "reserve" }, { arriving: true, deployedAt: 1 }]) {
    const bow = unit({ role: "ranged", type: "archer", cooldown: 100 }); f.initializeUnitFormation(bow, "auto");
    const enemy = unit({ id: "foe", side: "enemy", x: 4, cooldown: 100, ...excluded });
    const state = field([bow, enemy]);
    if (excluded.arriving) { state.battleKind = "grand"; enemy.status = "reserve"; enemy.x = -1; enemy.y = -1; }
    step(state, strategy, deps);
    assert.equal(bow.formationId, "line", "敗走・未投入・当tick増援は開始時の脅威に含めない");
  }
  const reserve = unit({ id: "reserve", status: "reserve", x: -1, y: -1, deployedAt: null });
  f.initializeUnitFormation(reserve); f.queueUnitFormation(reserve, "shieldWall");
  const arriving = field([unit({ cooldown: 100 }), unit({ id: "foe", side: "enemy", x: 6, cooldown: 100 }), reserve]);
  arriving.battleKind = "grand"; step(arriving, strategy, deps);
  assert.equal(reserve.arriving, true); assert.equal(reserve.formationId, "shieldWall");
  assert.equal(reserve.cooldown, 0, "増援の初期陣形は適用するが登場tickは攻撃しない");
  assert.equal(reserve.formationChangeAt, 2);

  // 前tickの記録ではなく開始時の実配置から判断し、配列順の違いでも同じ陣形を確定する。
  for (const reverse of [false, true]) {
    const surroundedUnit = unit({ pressure: 0, cooldown: 100 }); f.initializeUnitFormation(surroundedUnit, "auto");
    const units = [surroundedUnit, unit({ id: "left", side: "enemy", x: 2, cooldown: 100 }),
      unit({ id: "right", side: "enemy", x: 4, cooldown: 100 })];
    const state = field(reverse ? units.reverse() : units);
    const result = step(state, strategy, deps);
    assert.equal(surroundedUnit.formationId, "circle");
    assert.equal(result.logs.filter(log => log.includes("円陣に変更")).length, 1);
    assert.equal(step(state, strategy, deps).logs.filter(log => log.includes("円陣に変更")).length, 0);
  }

  const entries = [{ type: "infantry", count: 5, sources: { 1: 5 }, formationOrder: "charge", rosterUnitId: "roster-9" },
    { type: "infantry", count: 5, sources: { 1: 5 }, formationOrder: "auto", rosterUnitId: "roster-9" }];
  const source = JSON.stringify(entries);
  const restored = restore({ infantry: [{ level: 1, count: 20 }] }, { sortie: [entries[0]], reserve: [entries[1]] });
  assert.equal(JSON.stringify(entries), source, "復元は保存データを変更しない");
  assert.equal(restored.sortie[0].formationOrder, "charge"); assert.equal(restored.reserve[0].formationOrder, "auto");
  assert.notEqual(restored.sortie[0].rosterUnitId, restored.reserve[0].rosterUnitId);
  const old = restore({ infantry: [{ level: 1, count: 20 }] }, { sortie: [{ type: "infantry", count: 5, sources: { 1: 5 } }], reserve: [] });
  assert.equal(old.sortie[0].formationOrder, "auto");
  const normalized = [{ formationOrder: "line" }, { formationOrder: "shieldWall" }, { formationOrder: "bogus" }, {}];
  f.normalizeFormationRoster(normalized);
  assert.deepEqual(normalized.map(entry => entry.formationOrder), ["line", "shieldWall", "line", "auto"]);

  // 実際の停止・速度変更・再開を仮想時計へ接続し、タイマー重複と乱数列の変化を検出する。
  const raw = readSource("battle.js");
  const initial = field([unit({ move: 1 }), unit({ id: "foe", side: "enemy", x: 6, move: 1 })]);
  initial.outfitting.effects.attacks = [{ id: "test", interval: 5, power: 30 }];
  /** @param {boolean} paused 停止操作あり。 @returns {string} 完了時の比較記録。 */
  function run(paused) {
    const state = JSON.parse(JSON.stringify(initial));
    Object.assign(state, { ready: true, started: false, running: false, speed: 1, result: "", random: random(42) });
    const timers = new Map(); let id = 0;
    const context = vm.createContext({ battleState: state, battleStrategy: { ...strategy, speed: 1 }, ...deps,
      stepBattle: step, BASE_TICK_MS: 1000, SPEED_OPTIONS: [1, 2, 4], OUTFITTING_ITEMS: {}, elements: {},
      setInterval(callback) { timers.set(++id, callback); return id; }, clearInterval(key) { timers.delete(key); },
      updateSpeedUI() {}, updateBattleButtons() {}, updateBattleStatus() {}, updateBattleInfo() {}, renderRosterUI() {}, renderBattle() {},
      snapshotOutfitting: () => state.outfitting, faithEffects: () => ({}), state: {}, getUnitById: () => null,
      addBattleLog() {}, finishBattle() { state.result = "終了"; state.running = false; timers.clear(); } });
    for (const name of ["advanceBattleTick", "scheduleBattleTimer", "setBattleSpeed", "pauseBattle", "startBattle"])
      vm.runInContext(extract(raw, name), context);
    vm.runInContext("startBattle()", context);
    for (let tick = 1; tick <= 12; tick++) {
      if (paused) {
        const before = JSON.stringify(state);
        vm.runInContext("pauseBattle()", context);
        assert.equal(timers.size, 0);
        vm.runInContext("pauseBattle()", context);
        const copy = JSON.parse(before); copy.running = false; copy.timer = null;
        assert.equal(JSON.stringify(state), JSON.stringify(copy), "停止中は戦闘状態も乱数も進まない");
        vm.runInContext(`setBattleSpeed(${tick % 2 ? 4 : 2}); startBattle(); startBattle();`, context);
      }
      assert.equal(timers.size, 1, "再開を繰り返してもタイマーは1個");
      [...timers.values()][0]();
    }
    return JSON.stringify({ units: state.units, tick: state.tick, elapsedMs: state.elapsedMs, nextRandom: state.random() });
  }
  assert.equal(run(false), run(true), "停止・速度変更・再開でHP・士気・座標・時刻・乱数列は同じ");

  const roster = { sortie: [], reserve: [], standby: {} };
  const ctx = vm.createContext({ battleRoster: roster, rosterUnitSequence: 0, ...f });
  for (const name of ["createRosterEntry", "normalizeRosterFormations", "rosterSignature"]) vm.runInContext(extract(raw, name), ctx);
  const first = vm.runInContext("createRosterEntry({type:'infantry',count:5})", ctx);
  roster.sortie.push(first); vm.runInContext("normalizeRosterFormations()", ctx);
  const signature = vm.runInContext("rosterSignature()", ctx); first.formationOrder = "charge";
  assert.equal(vm.runInContext("rosterSignature()", ctx), signature, "指示だけの変更は編成未反映にしない");
  roster.sortie.pop(); roster.reserve.push(first); vm.runInContext("normalizeRosterFormations()", ctx);
  assert.equal(first.formationOrder, "charge"); roster.reserve.pop();
  const second = vm.runInContext("createRosterEntry({type:'infantry',count:5})", ctx);
  assert.notEqual(first.rosterUnitId, second.rosterUnitId); assert.equal(second.formationOrder, "auto");

  // 実際の準備保存を使い、版3の指示と識別子を確認する。戦闘中の予約は書き戻さない。
  second.sources = { 1: 5 }; second.level = 1; roster.sortie.push(second);
  ctx.state = { pendingEncounter: { active: true } };
  ctx.battleState = { ...field([]), battleKind: "grand", started: false, customSlots: {}, allyFormation: "balance" };
  ctx.battleStrategy = strategy; ctx.buildDeploySlots = () => [];
  let saved = 0; ctx.saveGameToStorage = () => { saved++; };
  ctx.appliedRosterSignature = vm.runInContext("rosterSignature()", ctx);
  vm.runInContext(extract(raw, "saveGrandPreparation"), ctx);
  vm.runInContext("saveGrandPreparation()", ctx);
  const preparation = JSON.stringify(ctx.state.pendingEncounter.preparation);
  assert.equal(ctx.state.pendingEncounter.preparation.version, 3);
  assert.equal(ctx.state.pendingEncounter.preparation.roster.sortie[0].rosterUnitId, second.rosterUnitId);
  assert.equal(ctx.state.pendingEncounter.preparation.roster.sortie[0].formationOrder, "auto");
  ctx.battleState.started = true; second.formationOrder = "charge";
  vm.runInContext("saveGrandPreparation()", ctx);
  assert.equal(saved, 1); assert.equal(JSON.stringify(ctx.state.pendingEncounter.preparation), preparation);
  console.log("部隊陣形: 攻防・艤装・士気・兵種別判断・3tick予約・予備隊・保存・停止再開: 全項目成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
