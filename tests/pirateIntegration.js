import { state } from "../state.js";
import { buildWorld, settlements, mapData, nobleHome, snapshotWorld, restoreWorld } from "../map.js";
import { seedInitialQuests, acceptQuest, completeQuest, completeHuntBattleQuest } from "../quests.js";
import { buildEnemyFormation } from "../actions.js";
import { enemyTroopPool, TROOP_STATS } from "../troops.js";
import { CONTRABAND, PIRATE_CONFIG, PIRATE_IMAGES, pirateEnemyCount } from "../pirateConfig.js";
import { bribeTerms, enqueuePirateCheckpoint, handlePirateCheckpoint, piracyState } from "../pirateEncounters.js";
import { getNobleFavor } from "../faction.js";
import { MODE_LABEL } from "../constants.js";

const output=document.getElementById("result");
const notes=[];
/** @param {boolean} condition 条件。 @param {string} message 説明。 @returns {void} 失敗した条件を停止して表示する。 */
function check(condition,message) { if (!condition) throw new Error(message); notes.push(`成功：${message}`); }

/** @returns {void} 実際の世界・依頼・経済・検問モジュールをつないで検証する。 */
function run() {
  buildWorld();
  const ports=settlements.filter(s=>s.pirateHaven), normal=settlements.filter(s=>!s.pirateHaven);
  check(ports.length===10,"無法港10拠点");
  check(ports.some(s=>s.id===nobleHome.get(PIRATE_CONFIG.nobleId)),"黒ひげの本拠地は無法港");
  check(normal.every(s=>s.nobleId!==PIRATE_CONFIG.nobleId),"通常拠点へ黒ひげを割り当てない");
  check(ports.every(s=>["sea","shoal"].includes(mapData[s.coords.y][s.coords.x].terrain)),"無法港は海域に配置");
  check(ports.every(s=>s.recruitSlots.length===5 && s.recruitSlots.every(r=>PIRATE_IMAGES[r.type])),"海賊兵の雇用枠");
  check(normal.every(s=>s.recruitSlots.every(r=>!PIRATE_IMAGES[r.type])),"通常雇用枠の分離");
  check(normal.every(s=>CONTRABAND.every(i=>!s.stock[i.id])),"通常拠点へ禁制品を補充しない");
  check(ports.every(s=>CONTRABAND.every(i=>s.stock[i.id]===PIRATE_CONFIG.contrabandStock && s.demand[i.id]<=3)),"無法港の禁制品在庫と需要");
  check(enemyTroopPool(true,false).every(id=>!PIRATE_IMAGES[id]),"正規軍に海賊兵を混ぜない");
  check(Object.keys(PIRATE_IMAGES).every(id=>TROOP_STATS[id]),"全6兵種が実際の定義に存在");
  check(pirateEnemyCount({min:70,max:80},"normal",1,()=>0)===38,"人数下限50%");
  check(pirateEnemyCount({min:70,max:80},"normal",1,()=>1)===113,"人数上限150%");
  state.fame=10000;
  for(let i=0;i<50;i++) {
    const enemy=buildEnemyFormation("elite","north");
    if(enemy.total>200 || enemy.formation.length>20 || enemy.formation.reduce((n,r)=>n+r.count,0)!==enemy.total) throw new Error("敵人数と出撃人数が不一致");
  }
  notes.push("成功：敵200人・20部隊上限と配分を50回検証");
  state.quests.seeded=false;seedInitialQuests();
  const ordinary=normal.flatMap(s=>state.quests.availableBySettlement[s.id]);
  check(ordinary.every(q=>!CONTRABAND.some(i=>i.id===q.itemId)),"通常依頼に禁制品が混入しない");
  const all=ports.flatMap(s=>state.quests.availableBySettlement[s.id]);
  check(all.length===30 && all.every(q=>q.pirateKind && q.pirateVictim),"海賊依頼30件と固定対象");
  const cargo=all.find(q=>q.type==="delivery");
  check(!!cargo,"配達型海賊依頼を生成");
  const origin=ports.find(s=>s.id===cargo.originId), reward=cargo.reward;
  state.honorFactions=["north"];
  check(acceptQuest(cargo.id,origin)===null,"仕官中の新規受注を拒否");
  state.honorFactions=[];
  const accepted=acceptQuest(cargo.id,origin);
  check(accepted && accepted.reward===reward && state.supplies[cargo.itemId]>=cargo.qty,"積荷受領と報酬維持");
  const destination=settlements.find(s=>s.id===cargo.targetId);
  state.position={...destination.coords}; state.modeLabel=MODE_LABEL.IN_TOWN;state.honorFactions=["north"];
  const before=getNobleFavor(PIRATE_CONFIG.nobleId);
  check(completeQuest(cargo.id),"仕官前の海賊依頼は仕官後も達成可能");
  check(getNobleFavor(PIRATE_CONFIG.nobleId)===before+3,"海賊好感度を一度だけ加算");
  check(!completeQuest(cargo.id),"完了済み依頼は再完了不可");
  state.honorFactions=[];
  const raid=all.find(q=>q.fixedEnemy), raidOrigin=ports.find(s=>s.id===raid.originId);
  const savedFormation=JSON.stringify(raid.fixedEnemy);
  acceptQuest(raid.id,raidOrigin);state.fame=0;
  check(JSON.stringify(raid.fixedEnemy)===savedFormation,"受注後の名声変化で襲撃編成が変わらない");
  check(completeHuntBattleQuest(raid.id,true) && !completeHuntBattleQuest(raid.id,true),"襲撃の完了と重複拒否");
  state.position={...normal[0].coords};state.supplies[CONTRABAND[0].id]=5;state.funds=5000;state.troops={};
  const random=Math.random;
  try {
    Math.random=()=>0;
    check(enqueuePirateCheckpoint(),"禁制品の摘発");
    const cp=piracyState().checkpoint, funds=state.funds, terms=bribeTerms();
    Math.random=()=>0.999;
    handlePirateCheckpoint({type:"pirate_bribe",payload:{id:cp.id}});
    check(cp.bribeFailed && state.funds===funds-terms.price,"賄賂失敗でも支払い、再試行不可");
    handlePirateCheckpoint({type:"pirate_bribe",payload:{id:cp.id}});
    check(state.funds===funds-terms.price,"賄賂の二重徴収なし");
    state.funds=0;
    handlePirateCheckpoint({type:"pirate_surrender",payload:{id:cp.id}});
    check(!piracyState().checkpoint && !state.supplies[CONTRABAND[0].id],"兵員・資金ゼロでも没収で解決");
  } finally {Math.random=random;}
  const world=snapshotWorld();
  check(restoreWorld(world) && settlements.filter(s=>s.pirateHaven).length===10,"無法港を保存・復元");
  output.textContent=notes.join("\n")+"\n全項目成功";
}
try { run(); } catch(error) {output.textContent=notes.join("\n")+"\n失敗："+error.stack;throw error;}
