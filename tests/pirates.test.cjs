const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/** @returns {Promise<void>} 海賊設定・港配置・検問の失敗と再開を実モジュールで検証する。 */
async function main() {
  const modules = new Map();
  const state = {year:1000,season:0,day:1,fame:0,funds:1000,troops:{infantry:{1:10}},supplies:{}};
  const events = [], logs = [], battles = [];
  const places = [{id:"town",coords:{x:2,y:2},factionId:"north",nobleId:"n"}];
  const favors = {n:-20,pirate_blackbeard:30};
  const options = {excludeSupport:false,sizeMode:"any"};
  const math = Object.create(Math);
  const context=vm.createContext({Math:math,localStorage:{getItem:()=>null}});
  const stubs = {
    "state.js":{state}, "map.js":{settlements:places},
    "faction.js":{getNobleFavor:id=>favors[id]||0,adjustNobleFavor:(id,n)=>{favors[id]=(favors[id]||0)+n;}},
    "questUtils.js":{absDay:s=>s.year*120+s.season*30+s.day,manhattan:(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)},
    "events.js":{enqueueEvent:e=>events.push(e)}, "dom.js":{pushLog:(...args)=>logs.push(args)},
    "actions.js":{startTravelEncounter:e=>battles.push(e)},
  };
  /** @param {string} name モジュール。 @returns {Promise<vm.Module>} 純粋処理を読み、画面と入出力だけ代替する。 */
  async function load(name) {
    name=name.replace(/^\.\//,"");
    if(modules.has(name)) return modules.get(name);
    const exports=stubs[name];
    const mod=exports ? new vm.SyntheticModule(Object.keys(exports),function(){
      for(const [key,value] of Object.entries(exports)) this.setExport(key,value);
    },{context}) : new vm.SourceTextModule(await fs.readFile(path.join(__dirname,"..",name),"utf8"),{context});
    modules.set(name,mod);
    await mod.link(load);
    return mod;
  }
  const config=await load("pirateConfig.js");await config.evaluate();
  const c=config.namespace;
  for(const [kind,min] of Object.entries(c.PIRATE_CONFIG.minimum)) {
    assert.equal(c.pirateEnemyCount({min:0,max:0},kind,1,()=>0),min);
    assert.equal(c.pirateEnemyCount({min:10000,max:10000},kind,1,()=>1),200);
  }
  assert.equal(c.pirateEnemyCount({min:70,max:80},"normal",1,()=>0),38);
  assert.equal(c.pirateEnemyCount({min:70,max:80},"normal",1,()=>1),113);
  for(const [value,id] of [[-100,"hostile"],[-30,"hostile"],[-29,"wary"],[0,"neutral"],[29,"neutral"],[30,"welcomed"]]) assert.equal(c.pirateRelation(value),id);
  assert.equal(c.normalizePiracy().checkpoint,null);
  assert.equal(c.normalizePiracy({checkpoint:{id:3,factionId:"north",bribeFailed:true}}).nextId,4);
  for(const id of Object.keys(c.PIRATE_IMAGES)) await fs.access(path.join(__dirname,"..",c.troopImage(id)));
  const world=await load("pirateWorld.js");await world.evaluate();
  const grid=Array.from({length:50},()=>Array.from({length:50},()=>({terrain:"sea",building:"none"})));
  const sets=[], homes=new Map();
  world.namespace.buildPirateHavens(grid,sets,homes,()=>{});
  assert.equal(sets.length,10);assert.equal(new Set(sets.map(s=>`${s.coords.x},${s.coords.y}`)).size,10);
  assert.equal(homes.get(c.PIRATE_CONFIG.nobleId),sets[0].id);
  assert.ok(sets.every(s=>grid[s.coords.y][s.coords.x].settlement===s));
  const originalPorts=JSON.stringify(sets);
  world.namespace.buildPirateHavens(grid,sets,homes,()=>assert.fail("既設港を再初期化しない"));
  assert.equal(JSON.stringify(sets),originalPorts);
  const mapSource=await fs.readFile(path.join(__dirname,"..","map.js"),"utf8");
  const seasonalSource=mapSource.match(/function refreshSettlementDemandIfNeeded\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(seasonalSource);
  const refreshed={demand:0,stock:0,recruit:0};
  const calendar={year:1000,season:0,day:1};
  const seasonalContext=vm.createContext({state:calendar,settlements:sets,mapData:grid,nobleHome:homes,
    buildPirateHavens:()=>assert.fail("季節更新で港を生成しない"),
    refreshSettlementDemand:()=>refreshed.demand++,refreshSettlementStock:()=>refreshed.stock++,
    refreshSettlementRecruitment:()=>refreshed.recruit++});
  vm.runInContext(`let lastDemandSeason={year:1000,season:0}; ${seasonalSource}`,seasonalContext);
  for(let season=1;season<=8;season++) {
    Object.assign(calendar,{year:1000+Math.floor(season/4),season:season%4});
    vm.runInContext("refreshSettlementDemandIfNeeded(); refreshSettlementDemandIfNeeded();",seasonalContext);
    assert.equal(JSON.stringify(sets),originalPorts);
  }
  assert.deepEqual(refreshed,{demand:80,stock:80,recruit:80});
  const actionSource=await fs.readFile(path.join(__dirname,"..","actions.js"),"utf8");
  const encounterState={position:{x:0,y:0},fame:0,warLedger:{entries:[]}};
  let relation="peace", builtFaction=null, rescued=null;
  const encounterMath=Object.create(Math);encounterMath.random=()=>0.99;
  const encounterContext=vm.createContext({state:encounterState,Math:encounterMath,
    settlements:[{id:"enemyTown",factionId:"north",coords:{x:1,y:0}}],
    FACTIONS:[{id:"north",name:"North"},{id:"pirates",name:"Pirates"}],
    FRONT_ENCOUNTER_RADIUS:3,getPlayerFactionId:()=>"citadel",getRelation:()=>relation,
    manhattan:(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y),getWarEntry:()=>null,
    warScoreLabel:()=>"neutral",getTerrainAt:()=>"plain",STRONG_ANCHORS:[],
    pickAnchorRange:()=>({min:encounterState.fame,max:encounterState.fame}),
    PIRATE_CONFIG:c.PIRATE_CONFIG,MODE_LABEL:{PREP:"prep"},resetEncounterMeter:()=>{},
    buildEnemyFormation:(_strength,faction)=>{builtFaction=faction;return {formation:[],total:40,strength:"elite",kind:"regular"};},
    startTravelEncounter:options=>{rescued=options;}});
  for(const name of ["pickFrontEncounter","pickEncounterFaction","triggerEncounter","handleMerchantAction"]) {
    const body=actionSource.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(body,name);vm.runInContext(body,encounterContext);
  }
  vm.runInContext("triggerEncounter()",encounterContext);assert.equal(builtFaction,"pirates");
  encounterState.fame=1000;
  vm.runInContext("triggerEncounter()",encounterContext);assert.equal(builtFaction,"pirates");
  relation="war";encounterState.fame=0;
  vm.runInContext("triggerEncounter()",encounterContext);assert.equal(builtFaction,"north");
  encounterState.position={x:20,y:20};
  vm.runInContext("triggerEncounter()",encounterContext);assert.equal(builtFaction,"pirates");
  vm.runInContext('handleMerchantAction({type:"merchant_rescue_help",payload:{enemyFactionId:"north",nobleId:"n"}})',encounterContext);
  assert.equal(rescued.enemyFactionId,"pirates");
  assert.equal(rescued.eventContext.nobleId,"n");
  const enc=await load("pirateEncounters.js");await enc.evaluate();
  const e=enc.namespace;
  Object.assign(modules.get("rosterOptions.js").namespace.rosterOptions,options);
  state.position={x:2,y:2};
  assert.equal(e.wantedFaction(),"north");
  favors.n=-19;assert.equal(e.wantedFaction(),null);favors.n=-20;
  state.position={x:20,y:20};assert.equal(e.wantedFaction(),null);state.position={x:2,y:2};
  state.supplies.illegal_drug=5;math.random=()=>0;
  assert.equal(e.enqueuePirateCheckpoint(),true);
  const cp=e.piracyState().checkpoint;
  const terms=e.bribeTerms(),funds=state.funds;
  math.random=()=>0.999;
  e.handlePirateCheckpoint({type:"pirate_bribe",payload:{id:cp.id}});
  assert.equal(state.funds,funds-terms.price);assert.equal(cp.bribeFailed,true);
  assert.equal(favors.n,-23);
  assert.ok(events.at(-1).actions.every(a=>a.type!=="pirate_bribe"));
  state.piracy=c.normalizePiracy(JSON.parse(JSON.stringify(state.piracy)));
  e.handlePirateCheckpoint({type:"pirate_bribe",payload:{id:cp.id}});
  assert.equal(state.funds,funds-terms.price);
  state.funds=0;state.troops={};
  e.handlePirateCheckpoint({type:"pirate_surrender",payload:{id:cp.id}});
  assert.equal(state.supplies.illegal_drug,0);assert.equal(state.piracy.checkpoint,null);
  math.random=()=>0;
  const today=stubs["questUtils.js"].absDay(state);
  state.piracy.lastTrade=today-30;assert.equal(e.enqueuePirateCheckpoint(),false);
  state.piracy.lastTrade=today-29;assert.equal(e.enqueuePirateCheckpoint(),true);
  e.handlePirateCheckpoint({type:"pirate_surrender",payload:{id:state.piracy.checkpoint.id}});
  assert.equal(favors.n,-26);assert.equal(state.piracy.lastTrade,null);
  state.supplies.stolen_arms=1;state.funds=10000;state.troops={infantry:{1:1000}};state.fame=100000;
  assert.ok(e.bribeTerms().chance<=0.8);
  assert.equal(e.enqueuePirateCheckpoint(),true);
  e.handlePirateCheckpoint({type:"pirate_bribe",payload:{id:state.piracy.checkpoint.id}});
  assert.equal(state.piracy.checkpoint,null);
  assert.equal(battles.length,0);
  console.log("海賊の規模・画像・無法港配置・関係条件・賄賂失敗と復元・記録期限: 全項目成功");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
