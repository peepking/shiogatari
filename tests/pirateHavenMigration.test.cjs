const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");
const { loadTestModule } = require("./helpers/module.cjs");

/** @returns {void} 移行と無関係な描画・通知だけを省略する。 */
function noop() {}

/** @param {object} value 複製する状態。 @returns {object} 保存読込と同じJSON複製。 */
function clone(value) { return JSON.parse(JSON.stringify(value)); }

/** @param {string} name モジュール名。 @param {object} stubs 外部依存。 @param {object} context VM文脈。 @returns {Promise<vm.Module>} 評価済み実モジュール。 */
async function loadWithStubs(name, stubs, context) {
  const modules = new Map();
  /** @param {string} specifier 依存名。 @returns {vm.Module} 実処理または入出力を代替したモジュール。 */
  function get(specifier) {
    const key = specifier.replace(/^\.\//,"");
    if (!modules.has(key)) {
      const exports = stubs[key];
      const module = exports ? new vm.SyntheticModule(Object.keys(exports),
        /** @returns {void} 検証用依存を公開する。 */
        function() {
          for (const [key,value] of Object.entries(exports)) this.setExport(key,value);
        }, {context}) : new vm.SourceTextModule(readSource(key),{context,identifier:key});
      modules.set(key,module);
    }
    return modules.get(key);
  }
  const module = get(name);
  await module.link(get);
  await module.evaluate();
  return module;
}

/** @param {number} size 地図の一辺。 @returns {Array} 建物のない連続した海域。 */
function makeGrid(size = 50) {
  const grid = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) row.push({terrain:"sea",building:"none"});
    grid.push(row);
  }
  return grid;
}

/** @param {Array} grid 地図。 @returns {Array} 旧配置の10港と通常拠点。 */
function makeOldSettlements(grid) {
  const coords = [{x:0,y:0},{x:49,y:0},{x:0,y:49},{x:49,y:49},{x:25,y:0},
    {x:0,y:25},{x:49,y:25},{x:25,y:49},{x:15,y:0},{x:35,y:49}];
  const settlements = [];
  for (let i = 0; i < coords.length; i++) {
    const port = {id:`haven-${i+1}`,name:`旧無法港${i+1}`,kind:"town",pirateHaven:true,factionId:"pirates",
      nobleId:"pirate_blackbeard",controllerId:"pirate_blackbeard",coords:coords[i],
      stock:{illegal_drug:i+3},demand:{illegal_drug:i+1},recruitment:{pirate_shield:i+2},support:{pirates:i},
      goods:["食料"],specialty:null,warState:{contested:false,frontline:false}};
    settlements.push(port);
    Object.assign(grid[port.coords.y][port.coords.x],{building:"town",settlement:port,factionId:port.factionId});
  }
  const town = {id:"set-1",name:"通常の街",kind:"town",factionId:"north",nobleId:"north_noble",
    coords:{x:25,y:25},stock:{food:99},support:{north:60}};
  settlements.push(town);
  Object.assign(grid[town.coords.y][town.coords.x],{terrain:"plain",building:"town",settlement:town,factionId:town.factionId});
  return settlements;
}

/** @returns {object} 予約地点と保持すべき依頼を含んだ復元後の状態。 */
function makeGame() {
  const game = {year:1000,season:2,day:19,position:{x:0,y:0},selectedPosition:{x:49,y:0},
    expansion:{exploration:{sites:[{position:{x:4,y:4}}]},charts:{active:[{destination:{x:45,y:4},rumor:{x:4,y:45}}]}},
    bounties:{active:[{position:{x:45,y:45}}]},pirateKingStory:{active:{position:{x:25,y:4}}},
    quests:{active:[{id:"accepted_smuggle",pirateKind:"smuggle",originId:"haven-1",targetId:"set-1",reward:7000,
      target:{x:4,y:25},fights:[{target:{x:45,y:25}}]}],
      availableBySettlement:{"set-1":[{id:"normal_quest",target:{x:25,y:45}}]},
      lastSeasonBySettlement:{"set-1":{year:1000,season:2}}},
    nobleQuests:{availableByNoble:{north_noble:[{id:"noble_quest",target:{x:10,y:10},fights:[{target:{x:15,y:15}}]}]}}};
  for (let i = 1; i <= 10; i++) {
    game.quests.availableBySettlement[`haven-${i}`] = [{id:`pirate_offer_${i}`,target:{x:4,y:3}}];
    game.quests.lastSeasonBySettlement[`haven-${i}`] = {year:1000,season:2};
  }
  return game;
}

/** @param {Array} grid 地図。 @param {Array} settlements 拠点。 @param {Map} homes 本拠地。 @returns {object} 旧セーブの世界情報。 */
function oldSnapshot(grid, settlements, homes) {
  const cells = [];
  for (const row of grid) {
    const cellsRow = [];
    for (const cell of row) cellsRow.push({terrain:cell.terrain,building:cell.building,
      factionId:cell.factionId ?? null,settlementId:cell.settlement?.id || null});
    cells.push(cellsRow);
  }
  return {cells,settlements:clone(settlements),nobleHome:Array.from(homes.entries())};
}

/** @returns {Promise<void>} 既存港の状態保持・予約回避・位置追随・版番号による一度限りの移行を検証する。 */
async function main() {
  const migration = (await loadTestModule("pirateHavenMigration.js",vm.createContext({}))).namespace;
  assert.equal(migration.PIRATE_HAVEN_LAYOUT_VERSION,2);
  const grid = makeGrid(), settlements = makeOldSettlements(grid);
  const oldPorts = settlements.slice(0,10), oldPortStates = clone(oldPorts);
  const normalTown = settlements[10], normalBefore = clone(normalTown);
  const homes = new Map([["pirate_blackbeard","haven-2"],["north_noble","set-1"]]);
  const game = makeGame(), beforeGame = clone(game), initialized = [];
  /** @param {object} port 新しい港。 @returns {void} 新港だけに初期状態を設定する。 */
  function initialize(port) {
    assert.ok(!oldPorts.includes(port),"既存港の物資と雇用を初期化しない");
    initialized.push(port.id);
    port.stock = {illegal_drug:10}; port.recruitment = {pirate_shield:3};
  }
  migration.migratePirateHavenWorld(grid,settlements,homes,initialize,game);
  assert.equal(settlements.length,16);
  assert.deepEqual(initialized,["haven-11","haven-12","haven-13","haven-14","haven-15"]);
  assert.equal(new Set(settlements.map(
    /** @param {object} port 拠点。 @returns {string} 拠点ID。 */
    port=>port.id)).size,16,"追加港のIDは既存のIDと競合しない");
  for (let i = 0; i < oldPorts.length; i++) {
    const port = oldPorts[i], original = oldPortStates[i];
    assert.equal(settlements[i],port,"移設では既存港のオブジェクトを維持する");
    assert.deepEqual(clone({...port,coords:original.coords}),original,"港の座標以外の保存状態を保持する");
    assert.equal(grid[port.coords.y][port.coords.x].settlement,port);
    assert.equal(grid[original.coords.y][original.coords.x].settlement,null,"移設元の港表示を消す");
    assert.equal(grid[original.coords.y][original.coords.x].building,"none");
    assert.ok(!Object.hasOwn(game.quests.availableBySettlement,port.id));
    assert.ok(!Object.hasOwn(game.quests.lastSeasonBySettlement,port.id));
  }
  assert.deepEqual(clone(normalTown),normalBefore);
  assert.deepEqual(Array.from(homes.entries()),[["pirate_blackbeard","haven-2"],["north_noble","set-1"]]);
  assert.deepEqual(clone(game.position),clone(oldPorts[0].coords));
  assert.deepEqual(clone(game.selectedPosition),clone(oldPorts[1].coords));
  assert.deepEqual(game.quests.active,beforeGame.quests.active,"受注済み密輸の距離・報酬・目的地を保持する");
  assert.deepEqual(game.quests.availableBySettlement["set-1"],beforeGame.quests.availableBySettlement["set-1"]);
  assert.deepEqual(game.quests.lastSeasonBySettlement["set-1"],beforeGame.quests.lastSeasonBySettlement["set-1"]);
  assert.deepEqual(game.nobleQuests,beforeGame.nobleQuests);
  const reserved = [{x:4,y:4},{x:45,y:4},{x:4,y:45},{x:45,y:45},{x:25,y:4},
    {x:4,y:25},{x:45,y:25},{x:25,y:45},{x:10,y:10},{x:15,y:15}];
  for (const port of settlements) for (const position of reserved) {
    assert.ok(port.coords.x !== position.x || port.coords.y !== position.y,"探索・海図・討伐・物語・依頼の予約座標を避ける");
  }
  assert.deepEqual(clone(oldPorts[0].coords),{x:4,y:3},"未受注の海賊依頼の破棄予定地点は予約しない");

  const smallGrid = makeGrid(7), stranded = {id:"haven-1",name:"残す港",kind:"town",pirateHaven:true,
    factionId:"pirates",coords:{x:0,y:0},stock:{illegal_drug:77}};
  for (const row of smallGrid) for (const cell of row) cell.terrain = "plain";
  Object.assign(smallGrid[0][0],{terrain:"sea",building:"town",settlement:stranded,factionId:"pirates"});
  const strandedState = clone(stranded), strandedGame = makeGame(), strandedSets = [stranded];
  migration.migratePirateHavenWorld(smallGrid,strandedSets,new Map(),
    /** @returns {void} 候補不足時の港追加を拒否する。 */
    ()=>assert.fail("安全な配置候補がない場合は追加しない"),strandedGame);
  assert.deepEqual(strandedSets,[strandedState],"移設先がない既存港は状態と位置を維持する");
  assert.deepEqual(strandedGame.position,{x:0,y:0});
  assert.deepEqual(strandedGame.selectedPosition,{x:49,y:0},"無関係な選択位置を動かさない");

  await verifyWorldSnapshots();
  verifySeasonalRegeneration();
  console.log("無法港の既存セーブ移行・資産と依頼保持・予約回避・位置追随・一度限りの復元・季節途中の依頼再生成: 全項目成功");
}

/** @returns {Promise<void>} map.jsの実際の保存復元を通して旧版の移行と新版の再配置防止を検証する。 */
async function verifyWorldSnapshots() {
  const game = makeGame(), initialized = {recruitment:[],demand:[],stock:[]};
  const stubs = {
    "state.js":{state:game},"dom.js":{elements:{}},"mapViewport.js":{mapViewport:noop},
    "mapArt.js":{drawMapTile:noop,drawMapPlayer:noop,drawExplorationSite:noop,drawChartSite:noop},
    "charts.js":{visibleChartSites:noop},"expansionConfig.js":{CHART_CONFIG:{}},
    "exploration.js":{EXPLORATION_NAMES:{},describeDanger:noop},"constants.js":{FRONT_DURATION_DAYS:30},
    "quests.js":{QUEST_TYPES:{}},"questUtils.js":{absDay:noop},
    "bounty.js":{bountyName:noop},"bountyMapArt.js":{drawBountySite:noop},
    "pirateKingConfig.js":{pirateStoryTarget:noop},"pirateKingMapArt.js":{drawPirateStorySite:noop},
    "dangerousSeaEventWorld.js":{visibleDangerousSeaEvents:()=>[]},
    "util.js":{displaySupportLabel:noop,displayWarLabel:noop,supportLabel:noop},
    "lore.js":{FACTIONS:[{id:"north",nobles:[{id:"north_noble"}]},{id:"pirates",nobles:[{id:"pirate_blackbeard"}]}]},
    "supplies.js":{
      SUPPLY_TYPES:{raw:"raw",processed:"processed"},
      /** @returns {string} 配置検証と無関係な特産品を固定する。 */
      randomSupplyIdByType:()=>"food",
      /** @param {object} port 初期化する拠点。 @returns {void} 需要初期化の対象を記録する。 */
      refreshSettlementDemand:port=>initialized.demand.push(port.id),
      /** @param {object} port 初期化する拠点。 @returns {void} 在庫初期化の対象を記録する。 */
      refreshSettlementStock:port=>initialized.stock.push(port.id),
    },
    "troops.js":{
      /** @param {object} port 初期化する拠点。 @returns {void} 雇用初期化の対象を記録する。 */
      initSettlementRecruitment:port=>initialized.recruitment.push(port.id),
      refreshSettlementRecruitment:noop,
    },
  };
  const map = (await loadWithStubs("map.js",stubs,vm.createContext({console}))).namespace;
  for (const list of Object.values(initialized)) list.length = 0;
  const grid = makeGrid(), ports = makeOldSettlements(grid);
  const legacy = oldSnapshot(grid,ports,new Map([["pirate_blackbeard","haven-2"],["north_noble","set-1"]]));
  assert.equal(map.restoreWorld(legacy),true);
  assert.equal(map.snapshotWorld().pirateHavenLayoutVersion,0,"通常の世界復元は配置移行を行わない");
  assert.equal(map.settlements.length,11);
  assert.ok(game.quests.availableBySettlement["haven-1"]);
  assert.equal(initialized.stock.length,0);
  assert.equal(map.restoreWorld(legacy,{upgradePirateHavens:true}),true);
  const upgraded = clone(map.snapshotWorld());
  assert.equal(upgraded.pirateHavenLayoutVersion,2);
  assert.equal(map.settlements.length,16);
  for (const list of Object.values(initialized)) assert.deepEqual(list,["haven-11","haven-12","haven-13","haven-14","haven-15"]);
  assert.ok(!game.quests.availableBySettlement["haven-1"]);
  assert.deepEqual(clone(game.position),clone(map.settlements[0].coords));
  assert.deepEqual(clone(game.selectedPosition),clone(map.settlements[1].coords));
  assert.equal(map.nobleHome.get("pirate_blackbeard"),"haven-2");
  const position = clone(game.position), selected = clone(game.selectedPosition);
  game.quests.availableBySettlement["haven-1"] = [{id:"new_offer"}];
  game.quests.lastSeasonBySettlement["haven-1"] = {year:1000,season:2};
  for (const list of Object.values(initialized)) list.length = 0;
  assert.equal(map.restoreWorld(upgraded,{upgradePirateHavens:true}),true);
  assert.deepEqual(clone(map.snapshotWorld()),upgraded,"保存した新版の港配置は次回読込で変更しない");
  assert.deepEqual(clone(game.position),position);
  assert.deepEqual(clone(game.selectedPosition),selected);
  assert.deepEqual(game.quests.availableBySettlement["haven-1"],[{id:"new_offer"}],"新版の未受注依頼は消さない");
  for (const list of Object.values(initialized)) assert.equal(list.length,0,"新版の復元で港を初期化しない");
  for (const port of map.settlements) assert.equal(map.mapData[port.coords.y][port.coords.x].settlement,port,"復元後の地図は実拠点を参照する");

  const emptyGrid = makeGrid(), town = clone(ports[10]);
  Object.assign(emptyGrid[town.coords.y][town.coords.x],{terrain:"plain",building:"town",settlement:town,factionId:"north"});
  Object.assign(game,makeGame(),{position:{x:12,y:12},selectedPosition:{x:13,y:12}});
  assert.equal(map.restoreWorld(oldSnapshot(emptyGrid,[town],new Map()),{upgradePirateHavens:true}),true);
  assert.equal(map.settlements.length,16,"無法港がない旧セーブにも置ける15港を追加する");
  assert.equal(map.snapshotWorld().pirateHavenLayoutVersion,2);
  assert.ok(map.nobleHome.get("pirate_blackbeard"));
  assert.equal(map.nobleHome.get("north_noble"),"set-1","本拠地情報がない旧セーブでも通常貴族の本拠地を補完する");
  assert.deepEqual(game.position,{x:12,y:12},"既存港にいないプレイヤーの位置を保持する");
  assert.deepEqual(game.selectedPosition,{x:13,y:12});
  assert.equal(game.quests.active[0].id,"accepted_smuggle");
}

/** @returns {void} 初回の依頼再生成は季節途中でも行い、既存依頼は従来の季節初日に更新する。 */
function verifySeasonalRegeneration() {
  const game = {year:1000,season:2,day:19,quests:{availableBySettlement:{},lastSeasonBySettlement:{}}};
  const generated = [];
  const source = readSource("quests.js");
  const start = source.indexOf("export function ensureSeasonalQuests(");
  assert.ok(start >= 0);
  const functionSource = source.slice(start,source.indexOf("\n}",start)+2).replace("export ","");
  const context = vm.createContext({state:game,ensureState:noop,
    /** @param {object} port 発注港。 @returns {void} 再生成と季節印を記録する。 */
    generateSeasonQuestsForSettlement(port) {
      generated.push(port.id);
      game.quests.availableBySettlement[port.id] = [{id:`generated_${generated.length}`}];
      game.quests.lastSeasonBySettlement[port.id] = {year:game.year,season:game.season};
    }});
  vm.runInContext(functionSource,context);
  const port = {id:"haven-1",pirateHaven:true};
  context.port = port;
  vm.runInContext("ensureSeasonalQuests(port); ensureSeasonalQuests(port)",context);
  assert.deepEqual(generated,[port.id],"季節途中でも一覧を消した港は初回閲覧で一度生成する");
  game.quests.lastSeasonBySettlement[port.id] = {year:1000,season:1};
  vm.runInContext("ensureSeasonalQuests(port)",context);
  assert.equal(generated.length,1,"季節途中は既存の季節依頼を更新しない");
  game.day = 1;
  vm.runInContext("ensureSeasonalQuests(port); ensureSeasonalQuests(port)",context);
  assert.deepEqual(generated,[port.id,port.id],"季節初日の更新は一度だけ");
}

main().catch(
  /** @param {Error} error 検証失敗。 @returns {void} エラーを報告する。 */
  error=>{console.error(error);process.exitCode=1;});
