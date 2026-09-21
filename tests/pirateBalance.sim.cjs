const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/** @param {string} file ファイル名。 @returns {string} 本体のソース。 */
function read(file) { return fs.readFileSync(path.join(__dirname, "..", file), "utf8"); }

/**
 * 描画・終了後の報酬処理だけを差し替え、実際の戦闘処理を読み込む。
 * 艤装・信仰は不使用。兵種の能力値・標的優先は本体の実装を使用する。
 * @returns {object} 独立した実行環境。
 */
function createSimulation() {
  const troops = read("troops.js").match(/export const TROOP_STATS = ([\s\S]*?\n});/);
  assert.ok(troops, "兵種定義を読み込めること");
  const context = vm.createContext({
    elements: {},
    clamp: (n,min,max) => Math.max(min,Math.min(max,n)),
    outfittedStat: n => n,
    fireOutfitting: () => [],
  });
  vm.runInContext(`const TROOP_STATS = ${troops[1]};`, context);
  const damage = read("outfitting.js").match(/export function defendedDamage\([^\n]+/);
  assert.ok(damage, "本体のダメージ式を読み込めること");
  vm.runInContext(damage[0].replace("export ", ""), context);
  vm.runInContext(read("battle.js").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
  vm.runInContext(`
    /** @returns {void} 戦後のUIと報酬処理を省略する。 */
    finishBattle = function () {};
    battleStrategy.chargeMode = 'none';
    battleStrategy.kiteMode = 'kite';
    battleState.outfitting = { effects: { attacks: [] } };
  `, context);
  return context;
}

/**
 * 同人数・同レベル、均一地形で実戦の最大60tickまで進める。
 * 左右を入れ替えて先行処理と味方AIの偏りを平均化する。乱数の反復ではない。
 * @param {object} context 実行環境。 @param {string[]} a 比較側兵種。 @param {string[]} b 相手兵種。
 * @param {string} terrain 地形。 @param {number} level レベル。 @param {number} squads 部隊数。
 * @param {boolean} reverse 陣営を逆にするか。 @returns {object} 勝敗と残HP率。
 */
function simulate(context, a, b, terrain, level, squads, reverse) {
  Object.assign(context, { a,b,terrain,level,squads,reverse });
  return vm.runInContext(`(() => {
    battleState.tick = 0; battleState.elapsedMs = 0;
    battleState.attackFx = []; battleState.moveFx = []; battleState.logLines = [];
    battleState.grid = Array.from({length:10}, () => Array(10).fill(terrain));
    const entries = types => Array.from({length:squads}, (_,i) => ({type:types[i % types.length],count:10,level}));
    const allies = createUnits(entries(reverse ? b : a), 'ally', 10);
    const enemies = createUnits(entries(reverse ? a : b), 'enemy', 10);
    battleState.units = [...allies, ...enemies];
    const original = battleState.units.reduce((n,u) => n + u.hp, 0);
    while (battleState.tick < MAX_TICKS && !advanceBattleTick()) {}
    const own = reverse ? enemies : allies;
    const other = reverse ? allies : enemies;
    const hp = units => units.reduce((n,u) => n + u.hp, 0);
    const remaining = hp(own), opposing = hp(other);
    return {win: remaining > opposing ? 1 : remaining < opposing ? 0 : 0.5,
      hp: remaining / own.reduce((n,u) => n + u.maxHp, 0), tick:battleState.tick,
      original, final: remaining + opposing};
  })()`, context);
}

/** @returns {void} 条件別の対戦結果をCSVで標準出力し、再現性とHP不変条件を確認する。 */
function main() {
  const context = createSimulation();
  const pairs = [
    [["pirate_shield"],["shield"]], [["pirate_spear"],["halberd"]],
    [["pirate_archer"],["archer"]], [["pirate_archer"],["seaArcher"]],
    [["raider_cavalry"],["cavalier"]], [["pirate_axe"],["infantry"]],
    [["pirate_axe"],["shield"]], [["pirate_axe"],["marine"]],
    [["pirate_axe"],["archer"]], [["pirate_assault"],["pirate_axe"]],
    [["pirate_shield","pirate_spear","pirate_archer","raider_cavalry","pirate_axe","pirate_assault"],
      ["shield","halberd","archer","cavalier","marine","crossbow"]],
  ];
  context.types = pairs.flat(2);
  assert.equal(vm.runInContext("types.every(type => Boolean(TROOP_STATS[type]))", context), true);
  const first = simulate(context, ...pairs[0], "deck", 1, 1, false);
  assert.deepEqual(simulate(context, ...pairs[0], "deck", 1, 1, false), first);
  console.log("比較側,相手,地形,レベル,部隊数,左右平均勝率,平均残HP率,平均tick");
  for (const [a,b] of pairs) for (const terrain of ["plain","deck","forest","mountain","shoal","sea"])
    for (const level of [1,5]) for (const squads of [1,5,10,20]) {
      const results = [false,true].map(reverse => simulate(context,a,b,terrain,level,squads,reverse));
      for (const r of results) {
        assert.ok(r.tick > 0 && r.tick <= 60);
        assert.ok(r.final >= 0 && r.final <= r.original);
        assert.ok(r.hp >= 0 && r.hp <= 1);
      }
      const mean = key => results.reduce((n,r) => n + r[key],0) / results.length;
      console.log([a.join("+"),b.join("+"),terrain,level,squads,mean("win"),mean("hp").toFixed(3),mean("tick")].join(","));
    }
}

main();
