const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vm = require('node:vm');
const path = require('node:path');

/** 支援の両条件・人員の厳密な離脱・季節固定・報酬の境界を検証する。 */
async function main() {
  const module = new vm.SourceTextModule(await fs.readFile(path.join(__dirname,'../tideAlliance.js'),'utf8'));
  await module.link(() => { throw Error('不要な依存'); }); await module.evaluate();
  const { tideStage, tideProgress, tideRanking, settleTideSeason, tideOracleReward, proposeTideSupport, visitTideSite, normalizeTide } = module.namespace;
  assert.equal(tideStage({funds:200000,people:4}),0);
  assert.equal(tideStage({funds:19999,people:50}),0);
  assert.equal(tideStage({funds:60000,people:15}),2);
  assert.equal(tideProgress({funds:90000,people:22}),7/15);
  const state = {year:1000,season:0,faith:0,funds:300000,troops:{infantry:{1:4,3:6},medic:2},tideAlliance:normalizeTide()};
  const original = JSON.stringify(state);
  assert.equal(proposeTideSupport(state,'a',-1),null);
  assert.equal(proposeTideSupport(state,'a',1.5),null);
  assert.equal(proposeTideSupport(state,'a',300001),null);
  assert.equal(proposeTideSupport(state,'a',0,[{type:'infantry',level:1,count:5}]),null);
  assert.equal(proposeTideSupport(state,'a',0,[{type:'infantry',level:1,count:3},{type:'infantry',level:1,count:2}]),null);
  assert.equal(JSON.stringify(state),original);
  let proposal = proposeTideSupport(state,'a',20000);
  assert.equal(proposal.stage,0);
  Object.assign(state,{funds:proposal.funds,troops:proposal.troops,tideAlliance:proposal.tideAlliance});
  proposal = proposeTideSupport(state,'a',0,[{type:'infantry',level:3,count:3},{type:'medic',level:1,count:2}]);
  assert.equal(proposal.stage,1); assert.equal(proposal.people,5);
  assert.equal(proposal.troops.infantry[1],4); assert.equal(proposal.troops.infantry[3],3); assert.equal(proposal.troops.medic,undefined);
  Object.assign(state,{funds:proposal.funds,troops:proposal.troops,tideAlliance:proposal.tideAlliance});
  visitTideSite(state,'a'); assert.equal(state.tideAlliance.sites.a.reaction,'first');
  visitTideSite(state,'a'); assert.equal(state.tideAlliance.sites.a.reaction,'return');
  assert.equal(settleTideSeason(state).gain,0);
  assert.equal(settleTideSeason(state),null);
  for(let i=0;i<4;i++) { state.season++; settleTideSeason(state); }
  assert.equal(state.faith,1); assert.equal(state.tideAlliance.remainder,0);
  const snapshot = JSON.stringify(state.tideAlliance.targets);
  state.tideAlliance.sites.a.funds=200000;state.tideAlliance.sites.a.people=50;
  assert.equal(JSON.stringify(state.tideAlliance.targets),snapshot);
  assert.equal(tideOracleReward(state,{type:'oracle_hunt',rewardFaith:49}),49);
  state.season++;settleTideSeason(state);
  assert.equal(tideOracleReward(state,{type:'oracle_hunt',rewardFaith:49}),53);
  for(let i=0;i<6;i++) state.tideAlliance.sites[`s${i}`]={funds:200000,people:50,order:i+2};
  assert.equal(tideRanking(state.tideAlliance).length,5);
  assert.equal(tideRanking(state.tideAlliance)[0].id,'a');
  state.tideAlliance.sites.s5.funds=900000;
  assert.ok(!tideRanking(state.tideAlliance).some(row=>row.id==='s5'));
  state.season++;const reward=settleTideSeason(state);
  assert.equal(reward.gain,5);assert.equal(reward.bonus,50);
  assert.equal(tideOracleReward(state,{type:'oracle_move',rewardFaith:21}),31);
  assert.equal(tideOracleReward(state,{type:'delivery',rewardFaith:21}),21);
  const restored=JSON.parse(JSON.stringify(state));
  assert.equal(settleTideSeason(restored),null);assert.equal(restored.faith,state.faith);
  assert.equal(normalizeTide().season,null);
  console.log('潮盟の両条件・人員離脱・順位・季節固定・繰越・神託補正: 全項目成功');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
