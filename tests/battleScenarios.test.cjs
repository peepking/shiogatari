const { readSource } = require("./helpers/source.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { createSimulation } = require("./pirateBalance.sim.cjs");

/** 実兵種・実艤装・可変盤面を組み合わせ、占有・兵員・終了条件を毎tick検証する。
 * 勝率を合否にせず、調整用に時間切れと増援投入数を記録する。
 * @returns {Promise<void>} 検証の完了。
 */
async function main() {
  const modules = new Map();
  /** @param {string} name 名前。 @returns {Promise<vm.Module>} 実モジュール。 */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const m = new vm.SourceTextModule(await readSource(name));
    modules.set(name, m); await m.link(load); return m;
  }
  await load("./fleet.js");
  const equipment = await load("./outfitting.js"); await equipment.evaluate();
  const context = createSimulation();
  Object.assign(context, { assert, ...equipment.namespace });
  vm.runInContext((await readSource("battleFormation.js")).replace(/^export /gm, ""), context);
  const items = modules.get("./expansionConfig.js").namespace.OUTFITTING_ITEMS;
  const attacks = Object.keys(items).filter(id => items[id].attack);
  const profiles = [[], ...attacks.map(id => [id]), attacks.slice(0, 5),
    ["iron_coating", "round_shields", "canopy", "brazier", "ram"],
    ["cannon", "grape_ballista", "arrow_box", "brazier", "iron_coating"]];
  const rows = [];
  for (const squads of [5, 10, 15, 20]) for (const terrain of ["plain", "deck"]) for (const equipped of profiles) {
    const fleet = equipped === profiles.at(-1) ? {counts:{galleass:2,longship:5,galleon:2}} : undefined;
    const effects = equipment.namespace.getOutfittingEffects({ slots: 5, owned: equipped, equipped }, fleet);
    Object.assign(context, { squads, terrain, effects });
    const result = vm.runInContext(`(() => {
      const size = selectBattleSize(squads);
      battleState.size = size; battleState.tick = 0; battleState.elapsedMs = 0;
      battleState.battleKind = squads === 20 ? 'grand' : 'normal';
      battleState.entryBlockedTicks = {}; battleState.moraleShocks = []; battleState.resultReason = null;
      battleState.random = createBattleRandom(1234); battleState.seed = 1234;
      battleState.outfitting = { effects }; battleState.attackFx = []; battleState.moveFx = [];
      battleState.grid = Array.from({length:size}, () => Array(size).fill(terrain));
      const types = ['shield','halberd','cavalier','archer','marine'];
      const entries = Array.from({length:squads}, (_,i) => ({type:types[i%types.length],count:10,level:3,sources:{3:10}}));
      battleState.units = ['ally','enemy'].flatMap(side => {
        const army = createUnits(entries, side, size);
        for (const p of planBattleFormation(army, 'balance', size)) {
          p.unit.x = side === 'ally' ? p.x : size - 1 - p.x; p.unit.y = p.y;
        }
        if (squads === 20) for (let i=0;i<10;i++) {
          const reserve = createUnit(types[i%types.length],side,i+20,{x:-1,y:-1},10,3);
          Object.assign(reserve,{status:'reserve',deployedAt:null,sources:{3:10}}); army.push(reserve);
        }
        return army;
      });
      let result;
      do {
        result = stepBattle(battleState,battleStrategy,{defendedDamage,fireOutfitting,random:battleState.random});
        const board = battleState.units.filter(isBattleOnBoard);
        assert.equal(new Set(board.map(u=>u.x+','+u.y)).size,board.length);
        assert.ok(board.every(u=>u.x>=0&&u.y>=0&&u.x<size&&u.y<size));
        for(const side of ['ally','enemy']) assert.ok(board.filter(u=>u.side===side).length<=20);
        assert.ok(battleState.units.every(u=>Number.isFinite(u.hp)&&u.hp>=0&&u.hp<=u.maxHp));
        assert.ok(battleState.units.filter(u=>u.status==='reserve').every(u=>u.deployedAt===null&&u.hp===u.maxHp));
      } while(!result.ended && battleState.tick<60);
      assert.equal(result.ended,true);
      return {size,tick:battleState.tick,reason:battleState.resultReason,
        reinforcements:battleState.units.filter(u=>u.deployedAt>0).length};
    })()`, context);
    rows.push({ squads, terrain, equipped: equipped.join("+"), ...result });
  }
  assert.ok(rows.some(row => row.reinforcements > 0), "実戦中に予備隊が投入される");
  console.log(JSON.stringify({ scenarios: rows.length, timeouts: rows.filter(r => r.reason === "timeout").length,
    meanTicks: rows.reduce((sum,r)=>sum+r.tick,0)/rows.length,
    ...(process.argv.includes("--details") ? {rows} : {}) }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
