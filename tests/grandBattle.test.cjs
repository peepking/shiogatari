const { readSource } = require("./helpers/source.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");
/** @param {string} name ファイル。 @returns {Promise<string>} ソース。 */
function read(name) { return readSource(name); }
/** @param {string} source ソース。 @param {string} name 関数名。 @returns {string} 関数本体。 */
function extract(source, name) { const start = source.indexOf(`function ${name}(`); assert.ok(start >= 0); return source.slice(start, source.indexOf("\n}", start) + 2); }
/** @returns {Promise<void>} 大会戦の生成・編成・復元・盤上除外を検証する。 */
async function main() {
  const modules = {};
  for (const name of ["grandBattle", "battleReinforcements", "battleMovement", "battleMorale", "battlePersonnel"])
    modules[`./${name}.js`] = new vm.SourceTextModule(await read(`${name}.js`));
  await modules["./grandBattle.js"].link(name => modules[name]); await modules["./grandBattle.js"].evaluate();
  const { buildGrandReserve: build, restoreGrandRoster: restore } = modules["./grandBattle.js"].namespace;
  const front = Array.from({ length: 20 }, () => ({ type: "infantry", count: 10, level: 3 }));
  const reserves = build(front, () => 0);
  assert.equal(reserves.length, 10); assert.equal(reserves.reduce((n, u) => n + u.count, 0), 100);
  assert.equal(build([{ type: "archer", count: 9, level: 2 }], () => 0)[0].count, 4);
  assert.ok(reserves.every(u => u.level === 3));
  const entry = { type: "infantry", count: 10, level: 999, sources: { 1: 7, 5: 3 } };
  const standby = { infantry: [{ level: 1, count: 100 }, { level: 5, count: 6 }] };
  const restored = restore(standby, { sortie: [entry], reserve: [entry] });
  assert.equal(restored.standby.infantry[0].count, 86); assert.equal(restored.standby.infantry[1].count, 0);
  assert.equal(restored.reserve[0].level, 2.2); assert.equal(standby.infantry[1].count, 6);
  assert.equal(restore(standby, { sortie: [entry], reserve: [entry, entry] }), null, "同じ兵を二重割当しない");
  assert.equal(restore(standby, { sortie: [], reserve: Array(11).fill(entry) }), null);

  const battle = await read("battle.js");
  let saved = false;
  const state = { pendingEncounter: { active: true, enemyReserve: reserves } };
  const battleState = { battleKind: "grand", randomSeed: 1, size: 10, battleTerrain: "plain", grid: Array.from({ length: 10 }, () => Array(10).fill("plain")),
    enemyFormation: front, allyFormation: "balance", outfitting: { effects: {}, equipped: [] } };
  const context = vm.createContext({ state, battleState,
    battleRoster: { sortie: front.map(e => ({ ...e, sources: { 3: 10 } })), reserve: reserves.map(e => ({ ...e, sources: { 3: 10 } })) },
    deploymentDepth: size => Math.max(2, Math.ceil(20 / size)),
    MAX_SQUADS: 20, MAX_UNIT_COUNT: 10, BATTLE_HP_MULTIPLIER: 3, MORALE_RULES: { initial: 100 },
    REINFORCEMENT_RULES: { reserveLimit: 10 }, TROOP_STATS: { infantry: { hp: 100, atk: 20, def: 10 } },
    clamp: (n, min, max) => Math.max(min, Math.min(max, n)), outfittedStat: n => n,
    createBattleRandom: () => () => 0.5, snapshotOutfitting: () => ({ effects: {}, equipped: [] }), document: { getElementById: () => null },
    OUTFITTING_ITEMS: {}, DEFAULT_ENEMY_FORMATION: front, calcBattleSize: () => 10, pauseBattle() {},
    syncFormationUI() {}, updateSpeedUI() {}, updateBattleStatus() {}, updateBattleButtons() {}, addBattleLog() {}, renderBattle() {}, updateBattleInfo() {},
    saveGrandPreparation() { saved = true; }, applyFormations() {}, appliedRosterSignature: "",
  });
  for (const name of ["buildDeploySlots", "getSortieEntries", "createUnit", "createUnits", "resetBattle"])
    vm.runInContext(extract(battle, name), context);
  vm.runInContext("resetBattle()", context);
  assert.equal(saved, true);
  assert.equal(battleState.units.filter(u => u.status === "active").length, 40);
  assert.equal(battleState.units.filter(u => u.status === "reserve").length, 20);
  assert.equal(new Set(battleState.units.map(u => u.id)).size, 60);
  assert.ok(battleState.units.filter(u => u.status === "reserve").every(u => u.x === -1 && u.deployedAt == null));
  assert.equal(battleState.units[0].maxHp, battleState.units.find(u => u.id === "ally-reserve-0").maxHp);
  battleState.size = 8;
  battleState.grid = Array.from({ length: 8 }, () => Array(8).fill("plain"));
  const grid = battleState.grid;
  vm.runInContext("resetBattle()", context);
  assert.equal(battleState.size, 8, "編成再反映で盤面サイズを変更しない");
  assert.equal(battleState.grid, grid, "編成再反映で地形を再生成しない");
  const smallFront = battleState.units.filter(u => u.side === "ally" && u.status === "active");
  assert.equal(smallFront.length, 20);
  assert.equal(new Set(smallFront.map(u => `${u.x},${u.y}`)).size, 20);

  const quests = await read("quests.js"), questState = { quests: { active: [] } };
  const qctx = vm.createContext({ state: questState, ensureState() {}, absDay: () => 0, nextNobleId: () => questState.quests.active.length + 1,
    predictEnemyTotal: () => 100, bindQuestPower() {}, FACTIONS: [], settlements: [], pushLog() {} });
  vm.runInContext(quests.match(/const QUEST_TYPES = \{[\s\S]*?\n\};/)[0], qctx);
  for (const name of ["genWarFrontQuest", "addWarFrontQuest"]) vm.runInContext(extract(quests, name), qctx);
  vm.runInContext('var town = { id: "town", name: "街", coords: { x: 1, y: 1 } }; var front = { attacker: "north", defender: "west", startAbs: 0, endAbs: 30 };', qctx);
  const grand = vm.runInContext('addWarFrontQuest(town, front, "attack", "grand")', qctx);
  assert.equal(grand.battleKind, "grand"); assert.equal(grand.warScoreMultiplier, 2);
  assert.equal(grand.scoreDelta, undefined, "名声計算を戦況倍率で変更しない");
  assert.ok(vm.runInContext('addWarFrontQuest(town, front, "attack", "skirmish")', qctx), "小規模戦闘と大会戦は別行動");
  assert.equal(vm.runInContext('addWarFrontQuest(town, front, "attack", "grand")', qctx), null);
  console.log("大会戦: 敵予備隊・編成復元と重複拒否・前衛/予備隊生成・前線の独立した使用回数: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
