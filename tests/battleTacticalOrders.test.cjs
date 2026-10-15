/* eslint-env node */
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadTestModule } = require("./helpers/module.cjs");
const { readSource } = require("./helpers/source.cjs");

/** @param {object} extra 上書き。 @returns {object} 検証用の実戦部隊。 */
function troop(extra = {}) {
  return { id: "ally-1", side: "ally", name: "歩兵", type: "infantry", role: "melee", traits: [], count: 10,
    hp: 1000, maxHp: 1000, morale: 100, atk: 20, def: 0, range: 1, move: 1, spd: 2, cooldown: 0,
    x: 2, y: 3, status: "active", terrain: { plain: 100 }, formationOrder: "line", ...extra };
}

/** @param {Array} units 部隊。 @returns {object} 決定的な戦場。 */
function battlefield(units) {
  return { units, size: 8, grid: Array.from({ length: 8 }, () => Array(8).fill("plain")),
    tick: 0, elapsedMs: 0, randomSeed: 42, outfitting: { effects: { attacks: [] } }, moraleShocks: [] };
}

/** @returns {Promise<void>} 指示・局所戦術・立て直し・互換性を実際の戦闘計算で検証する。 */
async function main() {
  const core = await loadTestModule("battleCore.js");
  const orders = (await loadTestModule("battleTacticalOrders.js")).namespace;
  const ai = (await loadTestModule("battleTacticalAI.js")).namespace;
  const regroup = (await loadTestModule("battleRegroup.js")).namespace;
  const targets = (await loadTestModule("battleTarget.js")).namespace;
  const { stepBattle: step, battleResult } = core.namespace;
  const strategy = { kiteMode: "kite", retreatThreshold: 30, chargeMode: "cavalry" };
  const deps = { defendedDamage: atk => Math.max(1, Math.round(atk)), fireOutfitting: () => [] };
  /** @param {object} extra 上書き。 @returns {object} 履歴を持つ部隊。 */
  function unit(extra = {}) {
    const item = troop(extra); orders.initializeTacticalOrders(item); Object.assign(item, extra); return item;
  }
  /** @param {object} extra 上書き。 @returns {object} 手動待機する敵。 */
  function enemy(extra = {}) { return unit({ id: "enemy-1", side: "enemy", actionOrder: "hold", cooldown: 100, x: 6, ...extra }); }
  /** @param {object} state 戦場。 @param {object} options 作戦。 @returns {object} 1tickの通知。 */
  function tick(state, options = strategy) { return step(state, options, deps); }

  const defaults = unit();
  for (const field of Object.keys(orders.TACTICAL_ORDERS)) assert.equal(defaults[field], "auto");
  assert.equal(orders.normalizeTacticalOrder("actionOrder", "__proto__"), "auto");
  assert.equal(orders.normalizeTacticalOrders({ targetOrder: "focus" }).targetOrder, "auto");
  const waiting = unit({ actionOrder: "hold" }), far = enemy();
  const held = battlefield([waiting, far]); tick(held);
  assert.equal(waiting.x, 2, "手動待機は射程外の敵を追わない");
  orders.queueTacticalOrder(waiting, "actionOrder", "advance");
  assert.equal(waiting.actionOrder, "hold", "指示は停止中に即時適用しない");
  orders.queueTacticalOrder(waiting, "targetOrder", "rear");
  orders.queueTacticalOrder(waiting, "actionOrder", "hold");
  tick(held); assert.equal(waiting.x, 2); assert.equal(waiting.targetOrder, "rear");
  orders.queueTacticalOrder(waiting, "actionOrder", "advance"); tick(held);
  assert.ok(waiting.x > 2, "再開後の次tickに進軍する");

  for (const count of [4, 10]) {
    const bow = unit({ role: "ranged", type: "archer", range: 3, actionOrder: "hold" });
    const close = enemy({ x: 3, count });
    const state = battlefield([bow, close]); tick(state);
    assert.ok(bow.x !== 2 || bow.y !== 3, "待機中も射撃兵は距離維持する");
    assert.equal(close.hp < 1000, count < 5, "拘束を離脱したtickは射撃せず、小部隊からの距離維持後は射撃できる");
  }
  const staticBow = unit({ role: "ranged", range: 3, actionOrder: "hold" });
  tick(battlefield([staticBow, enemy({ x: 3 })]), { ...strategy, kiteMode: "none" });
  assert.equal(staticBow.x, 2); assert.equal(staticBow.y, 3);
  const focusBow = unit({ role: "ranged", range: 3, actionOrder: "hold", targetOrder: "focus", focusEnemyId: "far-enemy" });
  const nearEnemy = enemy({ x: 3, count: 4 });
  tick(battlefield([focusBow, nearEnemy, enemy({ id: "far-enemy", x: 7 })]));
  assert.ok(focusBow.x !== 2 || focusBow.y !== 3, "射程外の指定敵がいても近い敵から距離維持する");
  assert.ok(nearEnemy.hp < 1000, "指定敵が射程外なら射程内の敵を撃つ");

  const medic = unit({ role: "support", type: "medic", actionOrder: "hold", x: 0 });
  tick(battlefield([medic, unit({ id: "guard", x: 4 }), enemy({ x: 7 })]));
  assert.equal(medic.x, 0, "待機中の支援兵は前衛を追わない");
  const cavalry = unit({ type: "cavalry", traits: ["mounted"], move: 2, x: 0 });
  const guard = unit({ id: "guard", x: 1, y: 1, actionOrder: "hold" });
  const cavalryState = battlefield([cavalry, guard, enemy({ x: 7 })]);
  for (let i = 0; i < 4; i++) tick(cavalryState);
  assert.equal(cavalry.x, 0); assert.equal(cavalry.y, 3);
  tick(cavalryState); assert.equal(cavalry.cavalryReleased, true);
  assert.ok(cavalry.x > 0, "味方が接敵しなくても4tick後に騎兵を投入する");
  const solo = unit({ type: "cavalry", traits: ["mounted"], move: 2, x: 0 });
  tick(battlefield([solo, enemy({ x: 7 })])); assert.equal(solo.cavalryReleased, true);

  for (const side of ["ally", "enemy"]) for (const type of ["cavalry", "cavalier", "raider_cavalry"]) {
    const ownX = side === "ally" ? 0 : 7, otherX = 7 - ownX;
    const mounted = unit({ id: "mounted", side, type, traits: ["mounted"], move: 2, x: ownX });
    const friend = unit({ id: "friend", side, actionOrder: "hold", x: side === "ally" ? 1 : 6, y: 1 });
    const opponent = unit({ id: "opponent", side: side === "ally" ? "enemy" : "ally", actionOrder: "hold", x: otherX, cooldown: 100 });
    const opening = battlefield([mounted, friend, opponent]); tick(opening);
    assert.equal(mounted.tacticalState, type === "cavalry" ? "hold" : "advance", `${side}の${type}は兵種の役割に従って初動を決める`);
    assert.equal(mounted.x === ownX, type === "cavalry", "重騎兵と略奪騎兵は味方の接敵を待たず実際に移動する");

    const attacker = unit({ id: "attacker", side, type, x: 3, traits: ["mounted"], switchLock: 0 });
    const near = unit({ id: "near", side: opponent.side, x: 4, actionOrder: "hold" });
    const rear = unit({ id: "rear", side: opponent.side, role: "ranged", x: 5, actionOrder: "hold" });
    const targeting = battlefield([attacker, near, rear]); targeting.tick = 1;
    ai.resolveTacticalAI(targeting);
    assert.equal(attacker.tacticalTargetMode, type === "cavalry" ? "rear" : "close");
    const evaluation = { size: 8, seed: 42, tick: 1, strength: item => item.hp };
    assert.equal(targets.selectBattleTarget(attacker, [near, rear], evaluation).id, type === "cavalry" ? "rear" : "near",
      "重騎兵と略奪騎兵は健康な後衛より目の前の敵を優先する");
    rear.hp = 200; attacker.switchLock = 0; targeting.tick++;
    ai.resolveTacticalAI(targeting);
    assert.equal(attacker.tacticalTargetMode, type === "cavalier" ? "close" : "opportunity");
    assert.equal(targets.selectBattleTarget(attacker, [near, rear], evaluation).id, type === "cavalier" ? "near" : "rear",
      "重騎兵は前線を維持し、略奪騎兵と通常騎兵は弱った敵への好機を使う");
  }
  for (const type of ["cavalier", "raider_cavalry"]) {
    const manual = unit({ type, traits: ["mounted"], actionOrder: "hold", targetOrder: "rear", x: 0 });
    const friend = unit({ id: "friend", x: 1, y: 1, actionOrder: "hold" });
    tick(battlefield([manual, friend, enemy({ x: 7 })]));
    assert.equal(manual.x, 0); assert.equal(manual.tacticalTargetMode, "rear", "前衛用の方針より手動待機・標的を優先する");
    const injured = unit({ type, traits: ["mounted"], x: 3, morale: 20 });
    tick(battlefield([injured, enemy({ x: 4 })]));
    assert.equal(regroup.isRegrouping(injured), true, "前衛を担う騎乗兵も危険時の立て直しを継続する");
    const reserveCavalry = unit({ id: "reserve-cavalry", type: "cavalry", traits: ["mounted"], move: 2, x: 0 });
    const mountedFront = unit({ id: "mounted-front", type, traits: ["mounted"], move: 2, x: 3 });
    const combined = battlefield([reserveCavalry, mountedFront, enemy({ x: 5 })]);
    tick(combined); assert.equal(reserveCavalry.tacticalState, "hold");
    for (let i = 0; i < 3 && !reserveCavalry.cavalryReleased; i++) tick(combined);
    assert.equal(reserveCavalry.cavalryReleased, true,
      "重騎兵・略奪騎兵の接敵によって通常騎兵を4tickより早く投入できる");
  }

  const picker = unit({ range: 5, actionOrder: "hold", targetOrder: "hp", tacticalTargetMode: "hp", tacticalTargetArea: "lower" });
  const upper = enemy({ id: "upper", x: 4, y: 1, hp: 1 }), lower = enemy({ id: "lower", x: 4, y: 6, hp: 500 });
  const context = { size: 8, seed: 1, tick: 1, strength: item => item.hp };
  assert.equal(targets.selectBattleTarget(picker, [upper, lower], context).id, "lower", "担当区域を標的方針より優先する");
  Object.assign(picker, { targetOrder: "focus", focusEnemyId: "upper" });
  assert.equal(targets.selectBattleTarget(picker, [upper, lower], context).id, "upper", "指定敵は区域より優先する");
  const beforePicker = JSON.stringify(picker);
  targets.selectBattleTarget(picker, [upper, lower], context);
  assert.equal(JSON.stringify(picker), beforePicker, "陣形用の仮評価は状態を変更しない");
  Object.assign(picker, { targetOrder: "auto", focusEnemyId: null, tacticalTargetMode: "close", tacticalTargetArea: "all", targetId: "lower", switchLock: 2 });
  assert.equal(targets.selectBattleTarget(picker, [upper, lower], context).id, "lower", "有効な標的を維持する");
  picker.switchLock = 0;
  picker.range = 1;
  assert.equal(targets.selectBattleTarget(picker, [upper, lower], { ...context, reachable: item => item.id === "lower" }).id, "lower");
  const obsolete = unit({ targetOrder: "focus", focusEnemyId: "missing" });
  tick(battlefield([obsolete, enemy()])); assert.equal(obsolete.targetOrder, "auto"); assert.equal(obsolete.focusEnemyId, null);

  const urgent = unit({ x: 3, morale: 20 });
  const retreatState = battlefield([urgent, enemy({ x: 4 })]); tick(retreatState);
  assert.equal(urgent.status, "active"); assert.equal(regroup.isRegrouping(urgent), true);
  assert.ok(urgent.x < 3 || urgent.y !== 3, "単独でも緊急後退する");
  assert.equal(battleResult([urgent]), "win", "立て直し中も戦闘可能として扱う");
  const low = unit({ x: 3, hp: 200, previousDamage: 10 });
  tick(battlefield([low, enemy({ x: 4 })])); assert.equal(regroup.isRegrouping(low), false, "通常の近接後退には交代候補が必要");
  const reliefLow = unit({ x: 3, hp: 200, previousDamage: 10 });
  const relief = unit({ id: "relief", x: 3, y: 2 });
  tick(battlefield([reliefLow, relief, enemy({ x: 4 })])); assert.equal(regroup.isRegrouping(reliefLow), true);
  const firstLow = unit({ id: "low-1", x: 3, y: 2, hp: 200, previousDamage: 10, morale: 80 });
  const secondLow = unit({ id: "low-2", x: 3, y: 4, hp: 200, previousDamage: 10, morale: 90 });
  const sharedRelief = unit({ id: "shared-relief", x: 3, y: 3, range: 2 });
  const sharedState = battlefield([firstLow, secondLow, sharedRelief, enemy({ x: 4, y: 2 }), enemy({ id: "enemy-2", x: 4, y: 4 })]);
  sharedState.tick = 1; ai.resolveTacticalAI(sharedState);
  assert.equal([firstLow, secondLow].filter(regroup.isRegrouping).length, 1, "交代候補1部隊で複数の前衛を同時に下げない");
  assert.equal(regroup.isRegrouping(firstLow), true, "士気が低い部隊を先に下げる");
  const fixed = unit({ actionOrder: "hold", x: 3, hp: 200, morale: 20 });
  tick(battlefield([fixed, enemy({ x: 4 })])); assert.equal(regroup.isRegrouping(fixed), false, "手動待機をAIが上書きしない");

  const locked = unit({ x: 3, y: 3, actionOrder: "regroup" });
  const walls = [[2, 3], [3, 2], [3, 4]].map(([x, y], i) => unit({ id: `wall-${i}`, x, y, actionOrder: "hold" }));
  const sealed = battlefield([locked, ...walls, enemy({ x: 4 })]);
  const wallPositions = JSON.stringify(walls.map(item => [item.x, item.y])); tick(sealed);
  assert.equal(locked.x, 3); assert.equal(locked.y, 3); assert.equal(locked.tacticalReason, "退路なし");
  assert.equal(JSON.stringify(walls.map(item => [item.x, item.y])), wallPositions, "通常後退は味方を押しのけない");

  for (const manual of [false, true]) {
    const recovering = unit({ actionOrder: manual ? "regroup" : "auto", tacticalState: "recovering", x: 0, hp: 100, morale: 55 });
    const state = battlefield([recovering, enemy({ x: 7 })]);
    for (let i = 0; i < 3; i++) tick(state);
    assert.equal(recovering.regroupComplete, true); assert.equal(recovering.hp, 100, "立て直しでHPは回復しない");
    tick(state);
    assert.equal(regroup.isRegrouping(recovering), manual, "手動は待機継続、おまかせは次tickで復帰");
    if (!manual) assert.ok(recovering.regroupLockUntil > state.tick);
  }
  const routed = unit({ actionOrder: "regroup", x: 3, morale: 15, move: 0 });
  tick(battlefield([routed, enemy({ x: 4, cooldown: 0 })]));
  assert.equal(routed.status, "routing"); assert.equal(routed.regroupComplete, false);
  assert.equal(orders.queueTacticalOrder(routed, "actionOrder", "advance"), false);
  const reserve = unit({ status: "reserve", x: -1, y: -1 });
  orders.queueTacticalOrder(reserve, "actionOrder", "hold"); assert.equal(reserve.actionOrder, "hold");
  const reserveSnapshot = JSON.stringify(reserve);
  tick(battlefield([unit(), enemy(), reserve])); assert.equal(JSON.stringify(reserve), reserveSnapshot, "未投入兵の履歴を進めない");

  const identity = orders.tacticalEnemyIdentity([{ type: "infantry", count: 10, level: 1 }]);
  const legacyEntries = [{}, {}];
  orders.migrateTacticalRoster(legacyEntries, { version: 3, strategy: { targetMode: "rear" } }, identity);
  assert.ok(legacyEntries.every(item => item.actionOrder === "auto" && item.targetOrder === "rear"));
  const saved = [{ actionOrder: "hold", targetOrder: "focus", focusEnemyId: "enemy-1" }];
  orders.migrateTacticalRoster(saved, { version: 4, enemyIdentity: identity }, identity); assert.equal(saved[0].targetOrder, "focus");
  orders.migrateTacticalRoster(saved, { version: 4, enemyIdentity: identity }, "other"); assert.equal(saved[0].targetOrder, "auto");

  /** @param {boolean} reverse 配列を反転するか。 @returns {string} 配列順に依存しない戦闘結果。 */
  function replay(reverse) {
    const units = [unit(), unit({ id: "ally-2", role: "ranged", type: "archer", range: 3, y: 4 }),
      enemy({ actionOrder: "auto" }), enemy({ id: "enemy-2", actionOrder: "auto", y: 4 })];
    const state = battlefield(reverse ? units.reverse() : units);
    for (let i = 0; i < 20; i++) tick(state);
    return JSON.stringify(state.units.sort((a, b) => a.id.localeCompare(b.id)));
  }
  assert.equal(replay(false), replay(true), "同じシードでは部隊配列順を変えても戦闘状態が同じ");
  assert.equal(replay(false), replay(false), "同じ条件を再現できる");
  const timers = battlefield([unit({ actionOrder: "hold" }), enemy()]);
  let result; for (let i = 0; i < 60; i++) result = tick(timers);
  assert.equal(result.ended, true); assert.equal(result.forceDraw, true);
  const raw = readSource("battle.js");
  const start = raw.indexOf("function rosterSignature(");
  const roster = { sortie: [{ count: 10, actionOrder: "auto", targetOrder: "auto" }], reserve: [] };
  const signatureContext = vm.createContext({ battleRoster: roster });
  vm.runInContext(raw.slice(start, raw.indexOf("\n}", start) + 2), signatureContext);
  const signature = vm.runInContext("rosterSignature()", signatureContext);
  roster.sortie[0].actionOrder = "hold"; roster.sortie[0].focusEnemyId = "enemy-1";
  assert.equal(vm.runInContext("rosterSignature()", signatureContext), signature);

  const groupOrders = (await loadTestModule("battleUnitFormationOrders.js")).namespace;
  const ui = (await loadTestModule("battleTacticalOrdersUI.js")).namespace;
  const preparingUnit = unit({ rosterUnitId: "roster-1" });
  const preparingEntry = { type: "infantry", rosterUnitId: "roster-1", count: 10, sources: { 1: 10 } };
  const preparingState = { ...battlefield([preparingUnit, enemy()]), started: false, battleKind: "grand", customSlots: {}, enemyIdentity: identity };
  const integration = vm.createContext({ ...orders, ...groupOrders,
    battleState: preparingState, battleRoster: { sortie: [preparingEntry], reserve: [] },
    state: { pendingEncounter: { active: true } }, battleStrategy: strategy,
    buildDeploySlots: () => [], saveGameToStorage() {}, renderRosterUI() {}, updateBattleInfo() {}, renderBattle() {},
    pauseBattle() { preparingState.running = false; }, isBattleActive: item => item.hp > 0 && item.status === "active" });
  for (const name of ["rosterSignature", "saveGrandPreparation", "changeTacticalOrders"]) {
    const from = raw.indexOf(`function ${name}(`);
    vm.runInContext(raw.slice(from, raw.indexOf("\n}", from) + 2), integration);
  }
  integration.appliedRosterSignature = vm.runInContext("rosterSignature()", integration);
  vm.runInContext("changeTacticalOrders(battleRoster.sortie, 'actionOrder', 'hold')", integration);
  assert.equal(integration.state.pendingEncounter.preparation.roster.sortie[0].actionOrder, "hold");
  assert.equal(integration.state.pendingEncounter.preparation.version, 4);
  assert.equal(integration.state.pendingEncounter.preparation.enemyIdentity, identity);
  preparingState.started = true; preparingState.running = true; integration.selected = [preparingUnit];
  vm.runInContext("changeTacticalOrders(selected, 'actionOrder', 'regroup'); changeTacticalOrders(selected, 'targetAreaOrder', 'lower')", integration);
  assert.equal(preparingState.running, false); assert.equal(preparingUnit.actionOrder, "hold");
  assert.match(ui.tacticalInfoMarkup(preparingUnit, preparingState), /行動→立て直し/);
  assert.match(ui.tacticalInfoMarkup(preparingUnit, preparingState), /区域→下側/);
  assert.equal(integration.state.pendingEncounter.preparation.roster.sortie[0].actionOrder, "hold", "開始後の指示を準備保存へ書き戻さない");
  tick(preparingState); assert.equal(preparingUnit.actionOrder, "regroup"); assert.equal(preparingUnit.tacticalTargetArea, "lower");
  console.log("部隊戦術: 待機・射撃距離維持・騎兵投入・区域と指定・立て直し・復帰・旧保存・再現性を確認");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
