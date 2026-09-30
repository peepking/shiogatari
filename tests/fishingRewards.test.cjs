const { readSource } = require("./helpers/source.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");
/** @returns {Promise<void>} 解放維持・在庫・売値・抽選境界・季節重複を検証する。 */
async function main() {
  const modules = new Map();
  /** @param {string} name ファイル名。 @returns {Promise<vm.Module>} 実モジュール。 */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const m = new vm.SourceTextModule(await readSource(name));
    modules.set(name,m); await m.link(load); return m;
  }
  const fleet = await load("./fleet.js"); await fleet.evaluate();
  const fishing = await load("./fishing.js"); await fishing.evaluate();
  const yard = await load("./shipyard.js"); await yard.evaluate();
  const rewards = modules.get("./fishingRewards.js").namespace;
  const species = modules.get("./fishingConfig.js").namespace.FISH_SPECIES;
  const s = {year:1000,season:0,faith:0,funds:100000,fleet:{counts:{}},expansion:{fishing:fishing.namespace.createFishingState()}};
  /** @param {number} ratio 達成率。 @returns {void} 図鑑更新。 */
  function unlock(ratio) { s.expansion.fishing.codex=Object.fromEntries(species.slice(0,Math.ceil(species.length*ratio)).map(f=>[f.id,{count:1}])); rewards.fishingRewards(s); }
  const village={id:1,kind:"village"}, town={id:2,kind:"town"};
  assert.equal(rewards.fishingRecruitSlot(s,village),null);
  unlock(0.25);
  const slot=rewards.fishingRecruitSlot(s,village); slot.remaining=0;
  assert.equal(rewards.fishingRecruitSlot(s,village),slot);
  assert.equal(rewards.fishingRecruitSlot(s,village).remaining,0);
  assert.equal(rewards.fishingRecruitSlot(s,{...village,pirateHaven:true}),null);
  s.season++; assert.equal(rewards.fishingRecruitSlot(s,village).remaining,5);
  assert.equal(rewards.fishingRecruitSlot(s,village).type,slot.type);
  yard.namespace.refreshShipyard(town,4001,()=>0);
  assert.ok(yard.namespace.quoteShipTrade(s,town,"fishing_boat","buy",1).error);
  unlock(0.5);
  const shop=yard.namespace.fishingShipyard(s,town);
  assert.equal(shop.regular.length,4); assert.equal(shop.stock.fishing_boat,1);
  assert.equal(yard.namespace.tradeShip(s,town,"fishing_boat","buy",1).error,undefined);
  assert.equal(yard.namespace.fishingShipyard(s,town).stock.fishing_boat,0);
  s.season++; assert.equal(yard.namespace.fishingShipyard(s,town).stock.fishing_boat,1);
  s.fleet.counts.fishing_boat=9;
  s.expansion.fishing.bait.insect=1;
  assert.equal(fishing.namespace.consumeBait(s,"insect",()=>0.249),true);
  assert.equal(s.expansion.fishing.bait.insect,1);
  fishing.namespace.consumeBait(s,"insect",()=>0.25);
  assert.equal(s.expansion.fishing.bait.insect,0);
  assert.equal(fishing.namespace.consumeBait(s,"insect",()=>0),false);
  for(let i=0;i<100;i++) assert.equal(fleet.namespace.rollShips(1,()=>i/100).fishing_boat,undefined);
  unlock(0.75);
  const fish=species[0]; s.expansion.fishing.counts[fish.id]=3;
  assert.equal(fishing.namespace.sellCatch(s,fish.id,3),Math.floor(fish.sellPrice*1.2)*3);
  unlock(1);
  assert.equal(rewards.grantFishingSeason(s),0);
  s.season++; assert.equal(rewards.grantFishingSeason(s),5);
  assert.equal(rewards.grantFishingSeason(s),0);
  s.expansion.fishing=fishing.namespace.normalizeFishing(JSON.parse(JSON.stringify(s.expansion.fishing)));
  s.expansion.fishing.codex={};
  assert.equal(rewards.fishingRewards(s).unlocked.every(Boolean),true);
  assert.equal(rewards.grantFishingSeason(s),0);
  s.year++; s.season=0;
  assert.equal(rewards.grantFishingSeason(s),5);
  const legacy={...s,expansion:{fishing:fishing.namespace.normalizeFishing({codex:Object.fromEntries(species.map(f=>[f.id,{count:1}]))})}};
  assert.equal(rewards.grantFishingSeason(legacy),0,"旧セーブの読込時に過去分を配らない");
  legacy.season++; assert.equal(rewards.grantFishingSeason(legacy),5);
  console.log("釣り報酬: 解放・旧セーブ・雇用・漁船・餌節約・売値・季節重複防止: 成功");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
