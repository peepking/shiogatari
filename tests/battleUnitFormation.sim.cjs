const { readSource } = require("./helpers/source.cjs");
const { createSimulation } = require("./pirateBalance.sim.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const context = createSimulation(); context.assert = assert;
const outfit = readSource("outfitting.js"), start = outfit.indexOf("function fireOutfitting(");
vm.runInContext(outfit.slice(start, outfit.indexOf("\n}", start) + 2), context);
vm.runInContext(`
  /**
   * 実兵種で固定陣形・おまかせを横陣の相手と比較する。左右とシードを変え、時間切れを合否に使わない。
   * @param {object} profile 編成条件。 @param {string} order 指示。 @param {number} seed シード。
   * @param {boolean} mirror 比較側を敵側へ入れ替えるか。 @returns {object} 比較用の観測結果。
   */
  function compareFormation(profile, order, seed, mirror) {
    battleState.size=10; battleState.tick=0; battleState.elapsedMs=0; battleState.battleKind='normal';
    battleState.randomSeed=seed; battleState.moraleShocks=[]; battleState.resultReason=null;
    battleState.attackFx=[]; battleState.moveFx=[];
    battleState.grid=Array.from({length:10},()=>Array(10).fill('plain'));
    battleState.outfitting={effects:{attacks:profile.support ? [{id:'test',interval:5,power:45}] : []}};
    const selected=mirror ? 'enemy' : 'ally';
    const entries=Array.from({length:10},(_,i)=>({type:profile.types[i%profile.types.length],count:10,level:3}));
    battleState.units=['ally','enemy'].flatMap(side=>createUnits(entries,side,10));
    for(const unit of battleState.units) initializeUnitFormation(unit,unit.side===selected ? order : 'line');
    const used={}; let firstRout=null; let result; const random=createBattleRandom(seed);
    do {
      result=stepBattle(battleState,battleStrategy,{defendedDamage,fireOutfitting,random});
      const board=battleState.units.filter(isBattleOnBoard);
      assert.equal(new Set(board.map(unit=>unit.x+','+unit.y)).size,board.length);
      assert.ok(board.every(unit=>unit.x>=0&&unit.x<10&&unit.y>=0&&unit.y<10));
      assert.ok(battleState.units.every(unit=>unit.hp>=0&&unit.hp<=unit.maxHp&&Number.isFinite(unit.hp)));
      if(firstRout===null && battleState.units.some(unit=>unit.status==='routing'||unit.status==='escaped')) firstRout=battleState.tick;
      for(const unit of board.filter(unit=>unit.side===selected)) {
        const key=unit.type+':'+unit.formationId; used[key]=(used[key]||0)+1;
      }
    } while(!result.ended && battleState.tick<60);
    assert.equal(result.ended,true);
    const outcome=battleResult(battleState.units,result.forceDraw,battleState);
    return {tick:battleState.tick, won:outcome===(selected==='ally'?'win':'lose'), draw:outcome==='draw',
      killed:battleState.units.filter(unit=>unit.hp<=0).length,
      routed:battleState.units.filter(unit=>unit.status==='routing'||unit.status==='escaped').length, firstRout, used};
  }
`, context);
const profiles = [
  { name: "近接", types: ["shield", "infantry", "halberd"] },
  { name: "射撃", types: ["archer", "crossbow", "seaArcher"] },
  { name: "混成", types: ["shield", "halberd", "archer", "medic", "scout"] },
  { name: "騎兵", types: ["cavalry", "cavalier", "raider_cavalry"] },
  { name: "艤装あり", types: ["shield", "infantry", "archer", "crossbow"], support: true },
];
const rows = [];
for (const profile of profiles) for (const order of ["line", "shieldWall", "circle", "spread", "charge", "auto"]) {
  const samples=[];
  for (const seed of [1,83]) for (const mirror of [false,true]) {
    Object.assign(context, { profile, order, seed, mirror });
    samples.push(vm.runInContext("compareFormation(profile,order,seed,mirror)",context));
  }
  const used={};
  for (const sample of samples) for (const [key,count] of Object.entries(sample.used)) used[key]=(used[key]||0)+count;
  rows.push({ profile:profile.name,order,games:samples.length,wins:samples.filter(sample=>sample.won).length,
    draws:samples.filter(sample=>sample.draw).length,meanTicks:samples.reduce((sum,sample)=>sum+sample.tick,0)/samples.length,
    killed:samples.reduce((sum,sample)=>sum+sample.killed,0),routed:samples.reduce((sum,sample)=>sum+sample.routed,0),
    firstRoutTicks:samples.map(sample=>sample.firstRout),used });
}
console.log(JSON.stringify({scenarios:rows.reduce((sum,row)=>sum+row.games,0),profiles:profiles.length,orders:6,
  ...(process.argv.includes("--details") ? {rows} : {})}));
