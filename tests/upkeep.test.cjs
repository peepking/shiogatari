const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const path = require("node:path");

/**
 * 食料消費日・季節境界と旧形式を含む兵員の維持費、昇級内訳を検証する。
 * @returns {Promise<void>}
 */
async function main() {
  const state = { day: 1, funds: 10, supplies: { food: 1 }, troops: { infantry: 5, archer: { 1: 5 } } };
  const modules = new Map();
  /**
   * 表示と状態の依存を分離して対象モジュールを読み込む。
   * @param {string} name モジュール名。
   * @returns {Promise<object>} 検証用モジュール。
   */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    let source;
    if (name === "./dom.js") source = "export function confirmAction() {} export function pushLog() {} export function pushToast() {}";
    else if (name === "./state.js") {
      const module = new vm.SyntheticModule(["state"], function () { this.setExport("state", state); });
      modules.set(name, module);
      return module;
    } else source = await fs.readFile(path.join(__dirname, "..", name), "utf8");
    const module = new vm.SourceTextModule(source);
    modules.set(name, module);
    await module.link(load);
    return module;
  }
  await load("./fleet.js");
  await load("./outfitting.js");
  const troops = await load("./troops.js");
  await troops.evaluate();
  const { getUpkeepForecast } = modules.get("./upkeep.js").namespace;
  const { TROOP_STATS, levelUpTroopsRandom } = troops.namespace;
  for (const [day, foodDays, fundsDays] of [[1,9,30],[10,20,21],[20,10,11],[30,10,1]]) {
    state.day = day;
    const result = getUpkeepForecast(state, TROOP_STATS);
    assert.equal(result.foodDays, foodDays);
    assert.equal(result.fundsDays, fundsDays);
    assert.equal(result.funds, 25);
    assert.equal(result.food, 2);
    assert.equal(result.fundsShortage, 15);
    assert.equal(result.foodShortage, 1);
  }
  state.troops = { infantry: { 3: 1 } };
  const promotions = [];
  assert.equal(levelUpTroopsRandom(5, promotions), 2);
  assert.deepEqual(JSON.parse(JSON.stringify(promotions)), [
    { type: "infantry", from: 3, to: 4, count: 1 },
    { type: "infantry", from: 4, to: 5, count: 1 },
  ]);
  assert.equal(state.troops.infantry[5], 1);
  const shipModule=await load("./shipUpkeep.js"); await shipModule.evaluate();
  const {shipUpkeepCost,payShipUpkeep}=shipModule.namespace;
  const {normalizeFleet}=modules.get("./fleet.js").namespace;
  const ships={funds:10000,fleet:normalizeFleet({counts:{fluyt:4,cog:1}}),expansion:{outfitting:{slots:1,owned:["shipwright"],equipped:["shipwright"]}},troops:{},supplies:{food:999}};
  assert.equal(shipUpkeepCost(ships),568);
  ships.fleet.counts.fluyt=5; assert.equal(shipUpkeepCost(ships),688);
  ships.fleet=normalizeFleet({counts:{fluyt:1}}); ships.expansion.outfitting=null;
  assert.equal(shipUpkeepCost(ships),146);
  ships.funds=0;
  const sale=payShipUpkeep(ships);
  assert.equal(sale.sold[0].id,"fluyt"); assert.equal(ships.funds,5854); assert.equal(shipUpkeepCost(ships),0);
  assert.equal(ships.supplies.food,999);
  ships.fleet=normalizeFleet({counts:{caravel:1,cog:100,galleon:1}}); ships.funds=0;
  const bulk=payShipUpkeep(ships);
  assert.deepEqual(bulk.sold.map(row=>[row.id,row.count]),[["caravel",1],["cog",2]]);
  assert.equal(ships.funds,620);
  const timeSource=await fs.readFile(path.join(__dirname,"../time.js"),"utf8");
  const fixture={day:30,season:3,year:1000,funds:5,troops:{infantry:10},supplies:{food:900},fleet:normalizeFleet({counts:{cog:1}})};
  const notices=[];
  const toasts=[];
  const tideModule = await load("./tideAlliance.js"); await tideModule.evaluate();
  const context=vm.createContext({state:fixture,TROOP_STATS:{infantry:{upkeep:2}},getUpkeepForecast,payShipUpkeep,
    grantFaithSeason: modules.get("./faith.js").namespace.grantFaithSeason, calcSupplyCap: () => 60,
    settleTideSeason: tideModule.namespace.settleTideSeason,
    SHIP_TYPES:modules.get("./shipConfig.js").namespace.SHIP_TYPES,
    buildLossesMap:n=>n,applyTroopLosses:n=>{fixture.troops.infantry-=n;},pushLog(){},enqueueEvent:e=>notices.push(e),
    pushToast:(title,body)=>toasts.push({title,body}),
    baseAdvanceDay:()=>{fixture.day++;if(fixture.day>30){fixture.day=1;fixture.season++;if(fixture.season>3){fixture.season=0;fixture.year++;}}},
    settlements:[],FOOD_CONSUMPTION_DAYS:[],absDay:()=>0,updateExplorationWorld(){},tickDailyWar(){},tickRelationDrift(){},
    maybeQueueHonorInvite(){},applySupportDrift(){},processScheduledOmens(){},questTickDay(){}});
  for (const name of ["applySeasonUpkeep","advanceDayWithEvents"]) {
    const offset=timeSource.indexOf(`function ${name}(`);
    vm.runInContext(timeSource.slice(offset,timeSource.indexOf("\n}",offset)+2),context);
  }
  vm.runInContext("advanceDayWithEvents(1)",context);
  assert.equal(fixture.year,1001); assert.equal(fixture.day,1); assert.equal(fixture.troops.infantry,8);
  assert.equal(fixture.funds,4290); assert.equal(notices.length,1); assert.equal(fixture.supplies.food,900);
  fixture.troops={}; fixture.funds=0; fixture.day=30; fixture.fleet=normalizeFleet({counts:{cog:2}});
  vm.runInContext("advanceDayWithEvents(61)",context);
  assert.equal(fixture.fleet.counts.cog,1); assert.equal(fixture.funds,3960);
  const faithful={year:1000,season:0,day:30,faith:500,troops:{infantry:100},fleet:normalizeFleet({counts:{cog:1}}),funds:1000,supplies:{}};
  assert.equal(getUpkeepForecast(faithful,TROOP_STATS).troopFunds,180);
  assert.equal(shipUpkeepCost(faithful),99);
  modules.get("./faith.js").namespace.activateAfterglow(faithful);
  assert.equal(getUpkeepForecast(faithful,TROOP_STATS).troopFunds,170);
  assert.equal(shipUpkeepCost(faithful),93);
  Object.assign(fixture,{year:1000,season:3,day:30,faith:500,funds:1000,troops:{infantry:10},supplies:{food:0},fleet:normalizeFleet({counts:{cog:1}}),faithBenefits:undefined});
  modules.get("./faith.js").namespace.activateAfterglow(fixture);
  vm.runInContext("advanceDayWithEvents(1)",context);
  assert.equal(fixture.funds,890); assert.equal(fixture.supplies.food,50);
  assert.equal(fixture.faithBenefits.afterglowUntil,null);
  fixture.troops={};fixture.fleet=normalizeFleet();fixture.day=30;fixture.supplies={};
  modules.get("./faith.js").namespace.activateAfterglow(fixture);
  vm.runInContext("advanceDayWithEvents(1)",context);
  assert.equal(fixture.faithBenefits.afterglowUntil,null);assert.equal(fixture.supplies.food,50);
  const noticesBeforeTide = notices.length;
  toasts.length = 0;
  fixture.day=30; fixture.faith=509; fixture.supplies={};
  fixture.tideAlliance={sites:{a:{funds:200000,people:50,order:1}}};
  vm.runInContext("advanceDayWithEvents(1)",context);
  assert.equal(fixture.supplies.food,50);
  assert.equal(fixture.faith,510);
  assert.equal(fixture.tideAlliance.bonus,10);
  assert.equal(notices.length, noticesBeforeTide);
  assert.deepEqual(toasts.map(row => row.title), ['潮待ちの恵み', '潮盟の支え']);
  console.log("部隊・船維持費の分離、季節境界・複数季節、自動売却・端数・軽減上限・潮盟の支給順: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
