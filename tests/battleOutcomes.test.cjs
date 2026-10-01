const { readSource } = require("./helpers/source.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadTestModule } = require("./helpers/module.cjs");

/** 実際の戦後処理へ勝敗を渡し、経路別通知・予備隊除外・再戦維持を検証する。
 * 外部の依頼更新や画面描画は呼出記録へ置換し、報酬計算と兵員精算は実処理を使う。
 * @returns {Promise<void>} 検証完了。
 */
async function main() {
  const voyage = await loadTestModule("voyageStats.js");
  const raw = await readSource("ui.js");
  const start = raw.indexOf("function processBattleOutcome(");
  const body = raw.slice(start, raw.indexOf("\n}", start) + 2);
  const personnel = new vm.SourceTextModule(await readSource("battlePersonnel.js"));
  await personnel.link(() => {}); await personnel.evaluate();
  const pursuit = new vm.SourceTextModule(await readSource("pursuit.js"));
  const pursuitDependencies = new Map();
  /** @param {string} name 相対名。 @returns {Promise<vm.Module>} 追跡の実依存モジュール。 */
  async function loadPursuitDependency(name) {
    if (pursuitDependencies.has(name)) return pursuitDependencies.get(name);
    const module = new vm.SourceTextModule(await readSource(name));
    pursuitDependencies.set(name, module);
    await module.link(loadPursuitDependency);
    return module;
  }
  await pursuit.link(loadPursuitDependency); await pursuit.evaluate();
  const theft = await loadPursuitDependency("./settlementCrime.js"); await theft.evaluate();
  const QUEST_TYPES = Object.fromEntries(["ORACLE_HUNT", "ORACLE_ELITE", "PIRATE_HUNT", "BOUNTY_HUNT",
    "NOBLE_SECURITY", "NOBLE_HUNT", "WAR_DEFEND_RAID", "WAR_ATTACK_RAID", "WAR_SKIRMISH", "WAR_BLOCKADE"].map(id => [id,id]));
  const routes = ["normal", "armory", "raid", "pursuit", "hunter", "exploration", "bounty", ...Object.keys(QUEST_TYPES)];
  for (const route of routes) for (const outcome of ["win", "lose", "draw"]) {
    const quest = { id: 1 };
    const pending = { enemyFactionId: "north", enemyFormation: [{type:"infantry",count:20}], enemyTotal:120 };
    if (QUEST_TYPES[route]) Object.assign(pending,{questId:1,questType:route,questFightIdx:1});
    if (route === "bounty") pending.bountyId = 1;
    if (route === "exploration") pending.explorationId = 1;
    if (route === "pursuit") pending.pursuitKind = "regular";
    if (route === "hunter") pending.pursuitKind = "hunter";
    if (route === "armory") Object.assign(pending, { theftKind: "theft_armory", theftReward: { arms: 8, iron: 10 } });
    if (route === "raid") Object.assign(pending, { theftKind: "settlement_raid", theftReward: { food: 50, wood: 10 }, theftFunds: 5000 });
    const state = { funds:1000,fame:100,supplies:{food:50},troops:{infantry:{1:10}},quests:{active:[quest]},
      pendingEncounter:pending,bounties:{active:[{id:1}]},wanted:{} };
    state.voyageStats = voyage.namespace.createVoyageStats({ ...state, year: 1000, season: 0, day: 1 });
    const calls = [];
    /** @param {string} name 呼出名。 @returns {Function} 呼出記録。 */
    const record = name => (...args) => { calls.push({name,args}); return []; };
    const context = vm.createContext({ state, QUEST_TYPES, ...voyage.namespace, ...personnel.namespace, ...pursuit.namespace, finishTheftBattle: theft.namespace.finishTheftBattle,
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
    const killedStart = raw.indexOf("function killedEnemyCount(");
    vm.runInContext(raw.slice(killedStart, raw.indexOf("\n}", killedStart) + 2), context);
    context.meta = {faithRescue: 1, units:[
      {id:"ally",side:"ally",type:"infantry",count:10,hp:0,status:"destroyed",deployedAt:0,sources:{1:10}},
      {side:"enemy",count:10,hp:0,status:"destroyed",deployedAt:0},
      {side:"enemy",count:10,hp:100,status:"escaped",deployedAt:3},
      {side:"enemy",count:100,hp:100,status:"reserve",deployedAt:null},
    ]};
    vm.runInContext(`processBattleOutcome(${JSON.stringify(outcome)},meta)`,context);
    assert.equal(state.wanted.pursuitUntil, ["pursuit", "hunter"].includes(route) ? 3 : undefined);
    if (route === "armory") {
      assert.equal(state.supplies.arms || 0, outcome === "win" ? 8 : 0);
      assert.equal(calls.filter(c => c.name === "war").length, 0);
    }
    assert.equal(calls.filter(c=>c.name==="clear").length,1);
    assert.equal(calls.find(c=>c.name==="summary").args[3],20,"未投入の敵を報酬基準へ含めない");
    assert.equal(state.funds,outcome==="win"?(route==="raid"?6400:1400):outcome==="lose"?500:1000);
    if (route === "raid") assert.equal(calls.filter(c => c.name === "war").length, 0);
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
    assert.equal(state.voyageStats.enemyDefeated, 10, "敗走・未投入を撃破数へ含めない");
    assert.equal(state.voyageStats.battles[outcome], 1);
    assert.equal(state.voyageStats.losses.battle, outcome === "win" ? 0 : 6, "救護で生還した兵士は恒久損耗へ含めない");
    assert.equal(state.voyageStats.income, outcome === "win" ? (route === "raid" ? 5400 : 400) : 0);
    assert.equal(state.voyageStats.expenses.other, outcome === "lose" ? 500 : 0);
    const beforeRepeated = JSON.stringify(state);
    vm.runInContext(`processBattleOutcome(${JSON.stringify(outcome)},meta)`,context);
    assert.equal(JSON.stringify(state), beforeRepeated, "結果の再処理で報酬・撃破・戦闘数を増やさない");
  }
  console.log("戦後接続: 通常遭遇・神託・討伐・貴族・前線・探索・賞金首の39経路、未投入報酬除外: 成功");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
