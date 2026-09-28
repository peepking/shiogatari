const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/** 実際の戦後処理へ勝敗を渡し、経路別通知・予備隊除外・再戦維持を検証する。
 * 外部の依頼更新や画面描画は呼出記録へ置換し、報酬計算と兵員精算は実処理を使う。
 * @returns {Promise<void>} 検証完了。
 */
async function main() {
  const raw = await fs.readFile(path.join(__dirname, "../ui.js"), "utf8");
  const start = raw.indexOf("function processBattleOutcome(");
  const body = raw.slice(start, raw.indexOf("\n}", start) + 2);
  const personnel = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../battlePersonnel.js"), "utf8"));
  await personnel.link(() => {}); await personnel.evaluate();
  const QUEST_TYPES = Object.fromEntries(["ORACLE_HUNT", "ORACLE_ELITE", "PIRATE_HUNT", "BOUNTY_HUNT",
    "NOBLE_SECURITY", "NOBLE_HUNT", "WAR_DEFEND_RAID", "WAR_ATTACK_RAID", "WAR_SKIRMISH", "WAR_BLOCKADE"].map(id => [id,id]));
  const routes = ["normal", "exploration", "bounty", ...Object.keys(QUEST_TYPES)];
  for (const route of routes) for (const outcome of ["win", "lose", "draw"]) {
    const quest = { id: 1 };
    const pending = { enemyFactionId: "north", enemyFormation: [{type:"infantry",count:20}], enemyTotal:120 };
    if (QUEST_TYPES[route]) Object.assign(pending,{questId:1,questType:route,questFightIdx:1});
    if (route === "bounty") pending.bountyId = 1;
    if (route === "exploration") pending.explorationId = 1;
    const state = { funds:1000,fame:100,supplies:{food:50},troops:{},quests:{active:[quest]},
      pendingEncounter:pending,bounties:{active:[{id:1}]} };
    const calls = [];
    /** @param {string} name 呼出名。 @returns {Function} 呼出記録。 */
    const record = name => (...args) => { calls.push({name,args}); return []; };
    const context = vm.createContext({ state, QUEST_TYPES, ...personnel.namespace,
      Math:Object.assign(Object.create(Math),{random:()=>0.5}),
      BATTLE_RESULT:{WIN:"win",LOSE:"lose",DRAW:"draw"},BATTLE_RESULT_LABEL:{},NONE_LABEL:"なし",
      SUPPLY_ITEMS:[{id:"food",name:"食料"}],TROOP_STATS:{},BONUS_CAPTURE_EVENT_TAGS:new Set(),
      getPlayerFactionId:()=>"west", calcLosses:()=>({lossProb:0.6}), killedEnemyCount:()=>0,
      calcCaptures:()=>({}),awardBattleFragment:()=>null,absDay:()=>0,
      nationalPowerResources:()=>[],completeBattlePower:()=>[],addWarScore:record("war"),
      completeOracleBattleQuest:record("oracleWin"),failOracleBattleQuest:record("oracleLose"),
      completeHuntBattleQuest:record("hunt"),completeNobleBattleQuest:record("noble"),completeWarBattleQuest:record("front"),
      finishExploration:record("exploration"),finishBounty:record("bounty"),
      renderBattleSummary:record("summary"),clearBattlePrep:record("clear"),syncUI:record("sync") });
    vm.runInContext(body,context);
    context.meta = {units:[
      {side:"enemy",count:10,hp:0,status:"destroyed",deployedAt:0},
      {side:"enemy",count:10,hp:100,status:"escaped",deployedAt:3},
      {side:"enemy",count:100,hp:100,status:"reserve",deployedAt:null},
    ]};
    vm.runInContext(`processBattleOutcome(${JSON.stringify(outcome)},meta)`,context);
    assert.equal(calls.filter(c=>c.name==="clear").length,1);
    assert.equal(calls.find(c=>c.name==="summary").args[3],20,"未投入の敵を報酬基準へ含めない");
    assert.equal(state.funds,outcome==="win"?1400:outcome==="lose"?500:1000);
    assert.equal(state.fame,outcome==="win"?105:outcome==="lose"?95:100);
    const completion = calls.filter(c=>["oracleWin","oracleLose","hunt","noble","front"].includes(c.name));
    assert.equal(completion.length,QUEST_TYPES[route] && outcome!=="draw"?1:0);
    if (completion.length) {
      const call=completion[0];
      const expected=route.startsWith("ORACLE")?(outcome==="win"?"oracleWin":"oracleLose")
        :route.startsWith("NOBLE")?"noble":route.startsWith("WAR")?"front":"hunt";
      assert.equal(call.name,expected);
      if (["hunt","noble","front"].includes(expected)) assert.equal(call.args[1],outcome==="win");
      if (expected==="front") assert.equal(call.args[2],1);
    }
    assert.equal(calls.filter(c=>c.name==="bounty").length,route==="bounty"&&outcome==="win"?1:0);
    assert.equal(calls.filter(c=>c.name==="exploration").length,route==="exploration"?1:0);
    if (route==="exploration") assert.equal(calls.find(c=>c.name==="exploration").args[0],outcome==="win");
    if (outcome==="draw" && QUEST_TYPES[route]) assert.equal(quest.fixedEnemyByFight[1].total,20);
  }
  console.log("戦後接続: 通常遭遇・神託・討伐・貴族・前線・探索・賞金首の39経路、未投入報酬除外: 成功");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
