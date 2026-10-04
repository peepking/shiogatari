const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @returns {Promise<void>} 密輸の距離境界・候補不足時の補充・運び屋の既存仕様を実モジュールで検証する。 */
async function main() {
  const origin = {id:"haven",name:"発注港",pirateHaven:true,factionId:"pirates",coords:{x:10,y:10}};
  const settlements = [];
  const state = {quests:{active:[],availableBySettlement:{}},nobleQuests:{availableByNoble:{}}};
  const calls = [];
  const math = Object.create(Math);
  const context = vm.createContext({Math:math});
  const modules = new Map();
  let rolls = [], randomCalls = 0, nextId = 1;
  /** @returns {number} 予め定めた抽選値を順に渡し、余分な抽選を拒否する。 */
  math.random = () => {
    randomCalls++;
    assert.ok(rolls.length,"想定外の乱数消費");
    return rolls.shift();
  };
  /** @param {object} a 始点。 @param {object} b 終点。 @returns {number} 上下左右の移動距離。 */
  const manhattan = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  /** @param {string} kind 通常依頼の種類。 @returns {object} ID発行を記録する依頼。 */
  function makeQuest(kind) {
    calls.push(kind);
    return {id:`quest_${nextId++}`,type:kind,title:"元の依頼",reward:100,deadlineDays:60};
  }
  const factories = {
    /** @returns {object} 討伐依頼。 */
    hunt:()=>makeQuest("hunt"),
    /** @returns {object} 強敵討伐依頼。 */
    bounty:()=>makeQuest("bounty"),
    /** @returns {object} 配達依頼。 */
    delivery:()=>makeQuest("delivery"),
    /** @returns {object} 物資納品依頼。 */
    supply:()=>makeQuest("supply"),
  };
  const stubs = {
    "state.js":{state},
    "map.js":{settlements},
    "actions.js":{
      /** @param {string} strength 編成の強さ。 @returns {object} 固定された敵編成。 */
      buildEnemyFormation:strength=>({total:10,strength}),
    },
    "faction.js":{
      /** @returns {number} 中立時の好感度。 */
      getNobleFavor:()=>0,
      /** @returns {void} 関係処理の代替。 */
      adjustNobleFavor:()=>{},
      /** @returns {void} 支持度処理の代替。 */
      adjustSupport:()=>{},
    },
    "events.js":{
      /** @returns {void} 画面通知の代替。 */
      enqueueEvent:()=>{},
    },
    "dom.js":{
      /** @returns {void} 画面ログの代替。 */
      pushLog:()=>{},
    },
    "questUtils.js":{
      manhattan,
      /** @returns {number} 関係処理用の日時。 */
      absDay:()=>0,
      /** @returns {object} 配送と独立した討伐地点。 */
      randomHuntTarget:()=>({x:2,y:3}),
    },
    "lore.js":{FACTIONS:[]},
    "playerWanted.js":{
      /** @returns {void} 関係処理用の犯罪記録の代替。 */
      recordCrime:()=>{},
    },
  };
  /** @param {string} name 読み込むモジュール。 @returns {Promise<vm.Module>} 画面と世界状態だけを代替した実モジュール。 */
  async function load(name) {
    name = name.replace(/^\.\//,"");
    if (modules.has(name)) return modules.get(name);
    const exports = stubs[name];
    const module = exports ? new vm.SyntheticModule(Object.keys(exports),
      /** @returns {void} 代替依存を公開する。 */
      function() {
        for (const [key,value] of Object.entries(exports)) this.setExport(key,value);
      }, {context}) : new vm.SourceTextModule(readSource(name),{context});
    modules.set(name,module);
    await module.link(load);
    return module;
  }
  const quests = await load("pirateQuests.js");
  await quests.evaluate();
  const {makePirateQuests} = quests.namespace;
  const near = {id:"near",name:"近い街",factionId:"north",coords:{x:12,y:13}};
  const boundary = {id:"boundary",name:"境界の街",factionId:"north",coords:{x:20,y:20}};
  const far = {id:"far",name:"遠い街",factionId:"north",coords:{x:20,y:21}};
  const pirate = {id:"pirates",name:"海賊拠点",factionId:"pirates",coords:{x:11,y:10}};
  /** @param {Array} places 配送先候補。 @param {Array<number>} values 抽選値。 @returns {Array} 生成した海賊依頼。 */
  function generate(places, values) {
    settlements.splice(0,settlements.length,origin,...places);
    rolls = [...values]; randomCalls = 0; calls.length = 0; nextId = 1;
    const result = makePirateQuests(origin,factories);
    assert.equal(rolls.length,0,"必要な抽選だけを消費する");
    assert.equal(result.length,3,"配送先が不足しても他種で季節3件を維持する");
    assert.equal(new Set(result.map(
      /** @param {object} q 依頼。 @returns {string} 海賊依頼種別。 */
      q=>q.pirateKind)).size,3,"季節依頼の種類は重複しない");
    assert.deepEqual(Array.from(result,
      /** @param {object} q 依頼。 @returns {string} 発行されたID。 */
      q=>q.id),["quest_1","quest_2","quest_3"],"スキップした種類はIDを消費しない");
    return result;
  }
  for (const [targetRoll,target] of [[0,near],[0.499,near],[0.5,boundary],[0.999,boundary]]) {
    const result = generate([near,boundary,far,pirate],[0.999,0.999,0.999,0.999,targetRoll,0]);
    const smuggle = result.find(
      /** @param {object} q 依頼。 @returns {boolean} 密輸依頼か。 */
      q=>q.pirateKind === "smuggle");
    assert.equal(smuggle.targetId,target.id,"20マス以内の通常拠点から等確率で選ぶ");
    assert.equal(smuggle.reward,manhattan(origin.coords,target.coords)*100);
    assert.equal(smuggle.qty,1);
    assert.equal(smuggle.deadlineDays,60);
    assert.equal(smuggle.pirateVictim.settlementId,target.id);
    assert.equal(randomCalls,6);
  }
  const withoutTarget = generate([far,pirate],[0.999,0.999,0.999,0.999]);
  assert.deepEqual(Array.from(withoutTarget,
    /** @param {object} q 依頼。 @returns {string} 海賊依頼種別。 */
    q=>q.pirateKind),["raid","fleetRaid","supply"]);
  assert.deepEqual(calls,["hunt","bounty","supply"],"密輸も運び屋も候補なしなら配達生成を呼ばない");
  assert.equal(randomCalls,4,"配送先も禁制品も不要な再抽選をしない");
  const otherHaven = {id:"other_haven",name:"遠い無法港",pirateHaven:true,factionId:"pirates",coords:{x:40,y:40}};
  const courierResult = generate([far,pirate,otherHaven],[0.999,0.999,0.999,0.999,0,0]);
  assert.deepEqual(Array.from(courierResult,
    /** @param {object} q 依頼。 @returns {string} 海賊依頼種別。 */
    q=>q.pirateKind),["raid","fleetRaid","courier"]);
  assert.equal(courierResult[2].targetId,otherHaven.id,"運び屋は20マスを超える無法港も候補にする");
  assert.equal(courierResult[2].reward,6000);
  assert.deepEqual(calls,["hunt","bounty","delivery"],"密輸の代替だけを生成する");
  console.log("海賊依頼の密輸距離・候補なし補充・生成副作用・運び屋距離: 全項目成功");
}
main().catch(
  /** @param {Error} error 検証失敗。 @returns {void} エラーを報告する。 */
  error=>{console.error(error);process.exitCode=1;});
