const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vm = require('node:vm');
const path = require('node:path');

/** 恩恵の境界・期限・配布・抽選回数・救済を固定乱数で検証する。 */
async function main() {
  const mod = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, '../faith.js'), 'utf8'));
  await mod.link(() => {}); await mod.evaluate();
  const { faithEffects, activateAfterglow, grantFaithSeason, rollFaithRecruitment, faithRecruitSlot, rescueFaithLosses, normalizeFaith } = mod.namespace;
  const state = { year:1000, season:3, day:30, faith:0, supplies:{food:5} };
  for (const [faith, ratio] of [[0,0],[250,0.5],[500,1],[2000,1]]) {
    state.faith=faith;
    const e=faithEffects(state);
    assert.equal(e.upkeep,0.1*ratio);assert.equal(e.sale,0.05*ratio);
    assert.equal(e.rescue,0.5*ratio);assert.equal(e.recruitChance,0.25*ratio);
    assert.equal(e.food,Math.floor(faith/10));
  }
  state.faith=500;activateAfterglow(state);activateAfterglow(state);
  assert.equal(state.faithBenefits.afterglowUntil,4004);
  assert.ok(Math.abs(faithEffects(state).upkeep-0.15)<1e-12);
  state.faith=250;assert.ok(Math.abs(faithEffects(state).sale-0.0375)<1e-12);
  state.year=1001;state.season=0;state.day=1;
  assert.equal(faithEffects(state).afterglow,true);
  const gift=grantFaithSeason(state,20);
  assert.equal(gift.received,15);assert.equal(gift.missed,10);
  assert.equal(state.supplies.food,20);assert.equal(faithEffects(state).afterglow,false);
  assert.equal(grantFaithSeason(state,100),null);
  activateAfterglow(state);assert.equal(state.faithBenefits.afterglowUntil,4005);
  const restored=JSON.parse(JSON.stringify(state));restored.faithBenefits=normalizeFaith(restored.faithBenefits);
  assert.equal(faithEffects(restored).afterglow,true);
  assert.equal(normalizeFaith().afterglowUntil,null);
  const stats={infantry:{},archer:{},medic:{},scout:{}};
  const town={id:'a'};
  state.faith=500;
  const slot=rollFaithRecruitment(state,town,stats,()=>0);
  assert.equal(slot.type,'infantry');assert.equal(slot.level,3);assert.equal(slot.remaining,5);
  slot.remaining=2;
  assert.equal(rollFaithRecruitment(state,town,stats,()=>{throw Error('再抽選');}),null);
  assert.equal(faithRecruitSlot(state,town).remaining,2);
  state.faith=0;assert.equal(rollFaithRecruitment(state,{id:'b'},stats,()=>0),null);
  state.faith=500;assert.equal(rollFaithRecruitment(state,{id:'b'},stats,()=>{throw Error('再抽選');}),null);
  state.season=1;assert.equal(faithRecruitSlot(state,town),null);
  assert.equal(rollFaithRecruitment(state,town,stats,()=>0).remaining,5);
  assert.equal(grantFaithSeason(state,10).received,0);
  const losses={infantry:4};let n=0;
  assert.equal(rescueFaithLosses(losses,0.5,true,()=>n++%2?0.9:0.1).infantry,2);
  assert.equal(rescueFaithLosses(losses,0.5,false,()=>{throw Error('敗北時の抽選');}),losses);
  assert.equal(rescueFaithLosses(losses,0,true,()=>{throw Error('無効時の抽選');}),losses);
  assert.equal(Object.keys(rescueFaithLosses(losses,0.5,true,()=>0)).length,0);
  console.log('信仰の効果・期限・配布・雇用・救済: 全項目成功');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
