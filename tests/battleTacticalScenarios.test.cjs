/* eslint-env node */
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { createSimulation } = require("./pirateBalance.sim.cjs");
const { readSource } = require("./helpers/source.cjs");

/** 実兵種で投入時機・集中攻撃・交代・射撃軍・騎兵軍・退路封鎖を左右と複数シードで比較する。
 * 勝敗を合否にせず、座標・HP・参加状態と終了を毎tick確認し、調整用の行動回数を記録する。
 * @returns {void} 検証完了。
 */
function main() {
  const context = createSimulation();
  vm.runInContext(readSource("battleFormation.js").replace(/^export /gm, ""), context);
  Object.assign(context, { assert });
  const rows = [];
  for (const profile of ["auto", "delayed", "focus", "relief", "ranged", "cavalry", "blocked"])
    for (const seed of [1, 83]) for (const reverse of [false, true]) {
      Object.assign(context, { profile, seed, reverse });
      const result = vm.runInContext(`(() => {
        const ownSide = reverse ? 'enemy' : 'ally';
        const otherSide = reverse ? 'ally' : 'enemy';
        const mixed = ['shield','shield','halberd','cavalry','archer','archer','marine','marine','medic','scout'];
        const types = profile === 'ranged' ? ['archer','crossbow','seaArcher'] : profile === 'cavalry' ? ['cavalry','cavalier','raider_cavalry'] : mixed;
        battleState.size = 10; battleState.tick = 0; battleState.elapsedMs = 0; battleState.battleKind = 'normal';
        battleState.randomSeed = seed; battleState.random = createBattleRandom(seed); battleState.moraleShocks = [];
        battleState.resultReason = null; battleState.attackFx = []; battleState.moveFx = [];
        battleState.outfitting = {effects:{attacks:[]}};
        battleState.grid = Array.from({length:10}, () => Array(10).fill('plain'));
        const armies = [ownSide,otherSide].map(side => {
          const list = side === ownSide ? types : mixed;
          const entries = Array.from({length:10}, (_,i) => ({type:list[i%list.length],count:10,level:3,sources:{3:10}}));
          const units = createUnits(entries,side,10);
          for(const p of planBattleFormation(units,'balance',10)) { p.unit.x = side === 'ally' ? p.x : 9-p.x; p.unit.y = p.y; }
          return units;
        });
        const [own,other] = armies; battleState.units = armies.flat();
        if(profile === 'delayed') for(const unit of own.filter(u=>u.traits.includes('mounted'))) unit.actionOrder='hold';
        if(profile === 'focus') for(const unit of own.filter(u=>u.role==='ranged')) {
          unit.targetOrder='focus'; unit.focusEnemyId=other.find(u=>u.role==='ranged').id; unit.targetAreaOrder='upper';
        }
        if(profile === 'relief') { own[0].hp=Math.floor(own[0].maxHp*0.25); own[0].morale=35; own[0].previousDamage=10; }
        if(profile === 'blocked') {
          const points=[[3,3],[2,3],[3,2],[3,4]];
          own.slice(0,4).forEach((unit,i)=>{unit.x=reverse?9-points[i][0]:points[i][0];unit.y=points[i][1];unit.actionOrder=i?'hold':'regroup';});
          other[0].x=reverse?5:4; other[0].y=3; other[0].actionOrder='hold';
        }
        let outcome, retreats=0,recoveries=0,blocked=0,peakTickMs=0;
        const initialHp = own.reduce((sum,u)=>sum+u.hp,0);
        do {
          if(profile==='delayed' && battleState.tick===6) for(const unit of own.filter(u=>u.traits.includes('mounted'))) {
            unit.actionOrder='advance'; unit.tacticalChangeAt=battleState.tick;
          }
          const previous = new Map(own.map(u=>[u.id,isRegrouping(u)]));
          const start=Date.now();
          outcome=stepBattle(battleState,battleStrategy,{defendedDamage,fireOutfitting,random:battleState.random});
          peakTickMs=Math.max(peakTickMs,Date.now()-start);
          retreats+=own.filter(u=>isRegrouping(u)&&!previous.get(u.id)).length;
          recoveries+=outcome.logs.filter(log=>log.startsWith(ownSide==='ally'?'味方の':'敵の')&&log.includes('立て直しを完了')).length;
          blocked+=outcome.observation.blockedSteps;
          const board=battleState.units.filter(isBattleOnBoard);
          assert.equal(new Set(board.map(u=>u.x+','+u.y)).size,board.length);
          assert.ok(board.every(u=>u.x>=0&&u.x<10&&u.y>=0&&u.y<10));
          assert.ok(battleState.units.every(u=>Number.isFinite(u.hp)&&u.hp>=0&&u.hp<=u.maxHp));
        } while(!outcome.ended);
        return {tick:battleState.tick,reason:battleState.resultReason,retreats,recoveries,blocked,peakTickMs,
          remainingHp:own.reduce((sum,u)=>sum+u.hp,0)/initialHp,
          enemyRearHp:other.filter(u=>u.role==='ranged').reduce((sum,u)=>sum+u.hp,0),
          ownRouts:own.filter(u=>['routing','escaped'].includes(u.status)).length};
      })()`, context);
      rows.push({ profile, seed, reverse, ...result });
    }
  assert.equal(rows.length, 28);
  assert.ok(rows.some(row => row.retreats > 0));
  assert.ok(rows.some(row => row.recoveries > 0));
  console.log(JSON.stringify({ scenarios: rows.length, timeouts: rows.filter(row => row.reason === "timeout").length,
    peakTickMs: Math.max(...rows.map(row => row.peakTickMs)),
    ...(process.argv.includes("--details") ? { rows } : {}) }));
}

main();
