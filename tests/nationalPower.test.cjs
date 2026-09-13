const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/** @returns {Promise<void>} 国力のデータ・精度・境界・変更を伴わない予告を検証する。 */
async function main() {
  const modules = new Map();
  /** @param {string} name 相対パス。 @returns {Promise<vm.Module>} 実モジュール。 */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const module = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "..", name), "utf8"));
    modules.set(name, module); await module.link(load); return module;
  }
  const module = await load("./nationalPower.js"); await module.evaluate();
  const { createNationalPower, normalizeNationalPower, nationalPowerDay, getNationalPower, changeNationalPower,
    nationalPowerRecovery, nationalPowerDailyCost, nationalPowerWarBias, quoteNationalPowerDonation } = module.namespace;
  const config = modules.get("./nationalPowerConfig.js").namespace.NATIONAL_POWER_CONFIG;
  assert.ok(Object.isFrozen(config) && Object.isFrozen(config.recovery) && Object.isFrozen(config.warBias));
  assert.equal(config.recovery.town, config.recovery.village * 2);
  const today = nationalPowerDay({year:1000,season:0,day:1});
  assert.equal(today,120001);
  assert.equal(nationalPowerDay({year:1001,season:0,day:1}) - nationalPowerDay({year:1000,season:3,day:30}),1);
  const data = createNationalPower(today);
  assert.equal(data.lastProcessedAbs,today);
  assert.deepEqual(Object.keys(data.values),["north","archipelago","citadel"]);
  assert.equal(getNationalPower(data,"north"),600); assert.equal(getNationalPower(data,"pirates"),null);
  assert.equal(changeNationalPower(data,"pirates",5),0);
  assert.equal(changeNationalPower(data,"north",1000),400);
  assert.equal(changeNationalPower(data,"north",1),0);
  assert.equal(changeNationalPower(data,"north",-2000),-1000);
  const restored = normalizeNationalPower(JSON.parse(JSON.stringify(data)),today+1);
  assert.equal(getNationalPower(restored,"north"),0);
  assert.equal(restored.lastProcessedAbs,today);
  const damaged = normalizeNationalPower({values:{north:0,archipelago:-5,citadel:2000000,pirates:1},lastProcessedAbs:Infinity},today);
  assert.deepEqual(damaged.values,{north:0,archipelago:0,citadel:1000000});
  assert.equal(damaged.lastProcessedAbs,today);
  assert.equal(getNationalPower(normalizeNationalPower({values:{north:NaN}},today),"north"),600);
  for (let i=0;i<1000;i++) changeNationalPower(data,"north",0.001);
  assert.equal(getNationalPower(data,"north"),1);
  for (let i=0;i<5;i++) changeNationalPower(data,"north",-0.2);
  assert.equal(getNationalPower(data,"north"),0);
  assert.throws(()=>changeNationalPower(data,"north",Infinity),RangeError);
  assert.equal(nationalPowerRecovery([{factionId:"north",kind:"town"},{factionId:"north",kind:"village"},{factionId:"citadel",kind:"town"}],"north"),3);
  assert.equal(nationalPowerRecovery([],"north"),0);
  assert.equal(nationalPowerDailyCost(2,2),1.2);
  assert.equal(nationalPowerDailyCost(0,0),0);
  data.values.north=600000; data.values.citadel=600000;
  for (const [difference,expected] of [[0,0],[250,0.1],[500,0.2],[600,0.2]]) {
    data.values.citadel=(600-difference)*1000;
    assert.equal(nationalPowerWarBias(data,"north","citadel"),expected);
    assert.equal(nationalPowerWarBias(data,"citadel","north"),expected === 0 ? 0 : -expected);
  }
  assert.equal(nationalPowerWarBias(data,"north","pirates"),0);
  const before=JSON.stringify(data);
  assert.equal(quoteNationalPowerDonation(data,"north",1000,1).delta,0.001);
  assert.equal(quoteNationalPowerDonation(data,"north",1000000,400000).after,1000);
  for (const amount of [0,-1,0.5,Infinity,400001]) assert.ok(quoteNationalPowerDonation(data,"north",1000000,amount).error);
  assert.ok(quoteNationalPowerDonation(data,"north",10,11).error);
  assert.equal(JSON.stringify(data),before);
  data.values.north=1000000; assert.ok(quoteNationalPowerDonation(data,"north",1000,1).error);
  await load("./fleet.js"); await load("./expansionState.js");
  const stateModule=await load("./state.js"); await stateModule.evaluate();
  const {state,resetState,advanceDay}=stateModule.namespace;
  assert.equal(state.nationalPower.lastProcessedAbs,nationalPowerDay(state));
  const initial=JSON.stringify(state.nationalPower);
  advanceDay(31); assert.equal(JSON.stringify(state.nationalPower),initial);
  changeNationalPower(state.nationalPower,"north",10); resetState();
  assert.equal(getNationalPower(state.nationalPower,"north"),600);
  assert.equal(state.nationalPower.lastProcessedAbs,nationalPowerDay(state));
  const rulesModule = await load("./nationalPowerRules.js"); await rulesModule.evaluate();
  const rules = rulesModule.namespace;
  const game = { year:1000, season:1, day:1, nationalPower:createNationalPower(today), playerFactionId:"north" };
  const places = [{ id:1, kind:"town", factionId:"north" }, { id:2, kind:"village", factionId:"citadel" }];
  const atWar = (a,b) => a !== b;
  const front = { settlementId:2, attacker:"north", defender:"citadel" };
  game.warLedger = { entries:[{ factions:["north","citadel"], score:0, activeFronts:[front, {...front}] }, { factions:["north","archipelago"], score:0, activeFronts:[] }] };
  game.nationalPower.values.north = 999000;
  rules.tickNationalPower(game, places, atWar);
  assert.equal(getNationalPower(game.nationalPower,"north"),999.6);
  assert.equal(getNationalPower(game.nationalPower,"citadel"),600.8);
  assert.equal(game.warLedger.entries[0].score,0.15952);
  assert.equal(game.warLedger.entries[1].score,0.15984);
  const processed = JSON.stringify(game);
  rules.tickNationalPower(game,places,atWar); assert.equal(JSON.stringify(game),processed);
  places[1].factionId = "archipelago";
  game.day++;
  rules.tickNationalPower(game,places,atWar);
  assert.equal(getNationalPower(game.nationalPower,"north"),999.6);
  delete game.warLedger; game.season++; game.day=1;
  rules.tickNationalPower(game,places,()=>false);
  assert.equal(getNationalPower(game.nationalPower,"north"),1000);
  assert.equal(getNationalPower(game.nationalPower,"archipelago"),601);
  const quest = { type:"delivery", originId:1 };
  rules.bindQuestPower(quest,[],places); places[0].factionId="citadel";
  game.nationalPower.values.north=600000;
  rules.completeQuestPower(game,quest,[],places,atWar);
  assert.equal(getNationalPower(game.nationalPower,"north"),601);
  assert.equal(rules.completeQuestPower(game,quest,[],places,atWar).length,0);
  const warQuest = { type:"war_blockade", factionId:"north", enemyFactionId:"citadel", fights:[{done:true},{done:false}] };
  assert.equal(rules.completeQuestPower(game,warQuest,[],places,atWar).length,0);
  warQuest.fights[1].done=true; game.nationalPower.values.citadel=1000;
  const changes=rules.completeQuestPower(game,warQuest,[],places,atWar);
  assert.equal(changes[0].delta,2); assert.equal(changes[1].delta,-1);
  assert.equal(rules.completeQuestPower(game,warQuest,[],places,atWar).length,0);
  const peaceful = {type:"noble_hunt",factionId:"north",targetFactionId:"citadel"};
  assert.equal(rules.completeQuestPower(game,peaceful,[],places,()=>false)[0].delta,1);
  assert.equal(rules.completeQuestPower(game,{type:"supply",originId:1,deadlineAbs:today},[],places,atWar).length,0);
  assert.equal(rules.completeQuestPower(game,{type:"oracle",factionId:"north"},[],places,atWar).length,0);
  for (const extra of [{questId:1},{explorationId:1},{eventTag:"merchant_attack"},{enemyFactionId:"pirates"}]) {
    assert.equal(rules.snapshotBattlePower(game,{enemyFactionId:"citadel",...extra},atWar).eligible,false);
  }
  const encounter={enemyFactionId:"citadel"};
  encounter.powerContext=rules.snapshotBattlePower(game,encounter,atWar);
  assert.equal(rules.completeBattlePower(game,encounter,false).length,0);
  game.playerFactionId="archipelago";
  const battleChanges=rules.completeBattlePower(game,encounter,true);
  assert.equal(battleChanges[0].factionId,"north");
  assert.equal(battleChanges[0].delta,2); assert.equal(battleChanges[1].delta,0);
  assert.equal(rules.completeBattlePower(game,encounter,true).length,0);
  const factionSource = await fs.readFile(path.join(__dirname,"../faction.js"),"utf8");
  const context = vm.createContext({ state:game, settlements:places, FACTIONS:[], NATIONAL_POWER_CONFIG:config,
    applyNationalPowerPlan:rules.applyNationalPowerPlan, nationalPowerResources:()=>[], getPlayerFactionId:()=>null,
    pushToast(){}, pushLog(){}, enqueueEvent(){} });
  const start = factionSource.indexOf("function resolveFront(");
  vm.runInContext(factionSource.slice(start,factionSource.indexOf("\n}",start)+2),context);
  game.nationalPower.values.citadel=600000;
  context.front={settlementId:1,attacker:"north",defender:"citadel"};
  vm.runInContext("resolveFront({},front,false)",context);
  assert.equal(getNationalPower(game.nationalPower,"citadel"),600);
  context.front={settlementId:1,attacker:"north",defender:"citadel"};
  vm.runInContext("resolveFront({},front,true)",context);
  assert.equal(places[0].factionId,"north"); assert.equal(getNationalPower(game.nationalPower,"citadel"),520);
  vm.runInContext("resolveFront({},front,true)",context);
  assert.equal(getNationalPower(game.nationalPower,"citadel"),520);
  const questSource=await fs.readFile(path.join(__dirname,"../quests.js"),"utf8");
  Object.assign(context,{ensureState(){},addFrontScore(){},absDay:()=>nationalPowerDay(game),
    awardQuestNationalPower:q=>rules.completeQuestPower(game,q,[],places,atWar),
    payQuestFunds:()=>0,adjustNobleFavor(){},enqueueQuestResult(){}});
  vm.runInContext(questSource.match(/const QUEST_TYPES = \{[\s\S]*?\n\};/)[0],context);
  for (const name of ["applyWarFrontScore","completeWarBattleQuest","completeNobleBattleQuest"]) {
    const offset=questSource.indexOf(`function ${name}(`);
    vm.runInContext(questSource.slice(offset,questSource.indexOf("\n}",offset)+2),context);
  }
  for (const [type,fn,gain] of [["war_blockade","completeWarBattleQuest",2],["noble_security","completeNobleBattleQuest",1]]) {
    game.fame=0; game.quests={active:[{id:1,type,factionId:"north",enemyFactionId:"citadel",frontSettlementId:1,fights:[{done:false},{done:false}]}]};
    const before=getNationalPower(game.nationalPower,"north");
    vm.runInContext(type==="war_blockade" ? `${fn}(1,true,0)` : `${fn}(1,true,10,0)`,context);
    assert.equal(getNationalPower(game.nationalPower,"north"),before);
    vm.runInContext(type==="war_blockade" ? `${fn}(1,true,1)` : `${fn}(1,true,10,1)`,context);
    assert.equal(getNationalPower(game.nationalPower,"north"),before+gain); assert.equal(game.quests.active.length,0);
    vm.runInContext(`${fn}(1,true)`,context); assert.equal(getNationalPower(game.nationalPower,"north"),before+gain);
  }
  Object.assign(context,{nextId:()=>7,randomHuntTarget:()=>({x:2,y:3}),predictEnemyTotal:()=>10,
    reserveQuestFragment:()=>true,getQuestDeadlineDays:()=>60,bindQuestPower:rules.bindQuestPower,addWarScore(){}});
  for (const name of ["genPirateHuntQuest","genBountyHuntQuest","acceptQuest","completeHuntBattleQuest"]) {
    const offset=questSource.indexOf(`function ${name}(`);
    vm.runInContext(questSource.slice(offset,questSource.indexOf("\n}",offset)+2),context);
  }
  context.origin={id:1,factionId:"north",coords:{x:0,y:0}};
  for (const generator of ["genPirateHuntQuest","genBountyHuntQuest"]) {
    game.quests={active:[],availableBySettlement:{}};
    const generated=vm.runInContext(`${generator}(origin)`,context);
    assert.equal(generated.originId,1);
    assert.equal(rules.questPowerPlan(generated,[],places,atWar)[0].factionId,"north");
    delete generated.originId; generated.powerFactionId=null;
    game.quests.availableBySettlement[1]=[generated];
    vm.runInContext("acceptQuest(7,origin)",context);
    assert.equal(generated.originId,1); assert.equal(generated.powerFactionId,"north");
    places[0].factionId="citadel";
    const before=getNationalPower(game.nationalPower,"north");
    vm.runInContext("completeHuntBattleQuest(7,true)",context);
    assert.equal(getNationalPower(game.nationalPower,"north"),before+1);
    assert.equal(generated.powerChanges[0].delta,1);
    vm.runInContext("completeHuntBattleQuest(7,true)",context);
    assert.equal(getNationalPower(game.nationalPower,"north"),before+1);
    game.quests.active=[{id:8,type:generated.type,powerFactionId:"north"}];
    vm.runInContext("completeHuntBattleQuest(8,false)",context);
    assert.equal(getNationalPower(game.nationalPower,"north"),before+1);
    places[0].factionId="north";
  }
  await testDonationUI(module,modules.get("./nationalPowerConfig.js"),rulesModule);
  console.log("国力データ・日次処理・活動報酬・占領・軍資金提供の確定と取り消し: 全項目成功");
}

/** @param {vm.Module} base 純粋計算。 @param {vm.Module} config 設定。 @param {vm.Module} rules 進行規則。 @returns {Promise<void>} 実際の提供画面の確定処理と保存失敗時の復元を検証する。 */
async function testDonationUI(base,config,rules) {
  const state={modeLabel:"audience",funds:10000,nationalPower:base.namespace.createNationalPower(1)};
  let honor=true; let saveOK=true; let nobleId="n1"; let saves=0;
  const elements=new Map();
  const document={ getElementById(id) {
    if (!elements.has(id)) elements.set(id,{hidden:true,value:"",focus(){}});
    return elements.get(id);
  }, querySelectorAll:()=>[] };
  const mocked={
    "./state.js":{state}, "./lore.js":{FACTIONS:[{id:"north",name:"北海連合",nobles:[{id:"n1"},{id:"n2"}]}]},
    "./map.js":{settlements:[]}, "./faction.js":{isHonorFaction:()=>honor}, "./constants.js":{MODE_LABEL:{AUDIENCE:"audience"}},
    "./nationalPowerWorld.js":{nationalPowerAtWar:()=>false,nationalPowerResources:()=>[]},
    "./storage.js":{saveGameToStorage:()=>{saves++;return saveOK;}}, "./dom.js":{pushToast(){},pushLog(){}},
    "./util.js":{escapeHtml:v=>v}, "./resourceUI.js":{resourceList:()=>""},
  };
  const ui=new vm.SourceTextModule(await fs.readFile(path.join(__dirname,"../nationalPowerUI.js"),"utf8"));
  await ui.link(name=> {
    if (name==="./nationalPower.js") return base;
    if (name==="./nationalPowerConfig.js") return config;
    if (name==="./nationalPowerRules.js") return rules;
    const values=mocked[name];
    return new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value] of Object.entries(values)) this.setExport(key,value);});
  });
  const originalDocument=global.document; global.document=document;
  try {
    await ui.evaluate(); ui.namespace.initNationalPowerUI(()=>({nobleId}),()=>{});
    const open=document.getElementById("nationalPowerDonate"); const input=document.getElementById("nationalPowerAmount");
    const submit=document.getElementById("nationalPowerSubmit"); const modal=document.getElementById("nationalPowerModal");
    open.onclick(); input.value="1000"; input.oninput(); submit.onclick();
    assert.equal(state.funds,10000); assert.equal(saves,0);
    submit.onclick(); submit.onclick();
    assert.equal(state.funds,9000); assert.equal(saves,1); assert.equal(base.namespace.getNationalPower(state.nationalPower,"north"),601);
    open.onclick(); input.value="1"; input.oninput();
    assert.match(document.getElementById("nationalPowerPreview").textContent,/601\.001/);
    submit.onclick(); saveOK=false; submit.onclick();
    assert.equal(state.funds,9000); assert.equal(base.namespace.getNationalPower(state.nationalPower,"north"),601);
    saveOK=true; submit.onclick(); honor=false; submit.onclick();
    assert.equal(state.funds,9000);
    honor=true; submit.onclick(); nobleId="n2"; submit.onclick();
    assert.equal(state.funds,9000);
    state.nationalPower.values.north=999999; input.value="2"; input.oninput(); assert.equal(submit.disabled,true);
    input.value="1"; input.oninput(); submit.onclick(); submit.onclick();
    assert.equal(state.funds,8999); assert.equal(base.namespace.getNationalPower(state.nationalPower,"north"),1000);
    open.onclick(); input.value="1"; input.oninput(); assert.equal(submit.disabled,true);
    document.getElementById("nationalPowerClose").onclick(); state.modeLabel="normal"; open.onclick(); assert.equal(modal.hidden,true);
  } finally { if (originalDocument===undefined) delete global.document; else global.document=originalDocument; }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
