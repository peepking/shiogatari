import { CONTRABAND, PIRATE_CONFIG, entryCheckpointChance } from "./pirateConfig.js";
import { state } from "./state.js";
import { settlements } from "./map.js";
import { adjustNobleFavor } from "./faction.js";
import { expireWanted } from "./playerWanted.js";
import { absDay, manhattan } from "./questUtils.js";
import { enqueueEvent } from "./events.js";
import { pushLog } from "./dom.js";
import { startTravelEncounter } from "./actions.js";
import { splitRosterCounts, rosterOptions } from "./rosterOptions.js";

/** @returns {object} 保存対象の海賊イベント状態。 */
export function piracyState() { return state.piracy ||= {lastTrade:null,checkpoint:null,nextId:1}; }

/** @returns {number} 所持禁制品の合計。 */
export function contrabandCount() { return CONTRABAND.reduce((n,item)=>n+(state.supplies?.[item.id]||0),0); }

/** @returns {object|null} 現在地から近い通常拠点。海賊港は国家の検問や追跡の基準にしない。 */
export function nearestLawfulSettlement() {
  return settlements.filter(s=>!s.pirateHaven && s.factionId !== "pirates")
    .map(s=>({s,d:manhattan(s.coords,state.position)})).filter(row=>row.d<=PIRATE_CONFIG.lawfulRadius)
    .sort((a,b)=>a.d-b.d || a.s.id.localeCompare(b.s.id))[0]?.s || null;
}

/** @returns {string|null} 手配中は近隣国家が追跡する。自分の所属勢力と期限切れは除外する。 */
export function wantedFaction() {
  expireWanted(state.wanted, absDay(state));
  const set=nearestLawfulSettlement();
  return set && state.wanted?.amount > 0 && !(state.honorFactions || []).includes(set.factionId) ? set.factionId : null;
}

/**
 * 出撃可能人数を編成オプション込みで最大20部隊まで数える。人数の多い部隊を優先し、控えは除く。
 * @returns {number} 賄賂判定用の兵員規模。
 */
function deployableCount() {
  const options=rosterOptions;
  const chunks=[];
  for (const [type,levels] of Object.entries(state.troops||{})) {
    if (options.excludeSupport && ["scout","medic"].includes(type)) continue;
    const total=typeof levels === "number" ? levels : Object.values(levels).reduce((a,b)=>a+b,0);
    chunks.push(...splitRosterCounts(total,options.sizeMode));
  }
  return chunks.sort((a,b)=>b-a).slice(0,20).reduce((a,b)=>a+b,0);
}

/** @returns {{price:number,chance:number}} 現在の賄賂費用と成功率。名声・兵員の寄与はそれぞれ20%まで。 */
export function bribeTerms() {
  const count=contrabandCount();
  const chance=PIRATE_CONFIG.bribeBaseChance+Math.min(0.2,(state.fame||0)/PIRATE_CONFIG.bribeFameScale)
    +Math.min(0.2,deployableCount()/PIRATE_CONFIG.bribeTroopScale)-count*PIRATE_CONFIG.bribeItemPenalty;
  return {price:PIRATE_CONFIG.bribeBase+count*PIRATE_CONFIG.bribePerItem,
    chance:Math.max(PIRATE_CONFIG.bribeMin,Math.min(PIRATE_CONFIG.bribeMax,chance))};
}

/** @returns {void} 同じ検問の継続選択を表示する。失敗した賄賂は候補に戻さない。 */
function showCheckpoint() {
  const check=piracyState().checkpoint;
  if (!check) return;
  const terms=bribeTerms(), count=contrabandCount();
  const actions=[{label:count ? "禁制品を引き渡す" : "警告を受け入れる",type:"pirate_surrender",payload:{id:check.id}}];
  if (!check.bribeFailed && state.funds>=terms.price) actions.push({label:`賄賂 ${terms.price}資金（成功率${Math.round(terms.chance*100)}%）`,type:"pirate_bribe",payload:{id:check.id}});
  actions.push({label:"強行突破",type:"pirate_force",payload:{id:check.id}});
  enqueueEvent({title:"禁制品の摘発",body:`${count ? `禁制品${count}個が発見されました。引き渡すと全て没収されます。` : "無法港での取引を追及されました。警告を受け入れると現地貴族の好感度が下がります。"}\n賄賂は失敗しても資金を消費します。${check.bribeFailed ? "\n賄賂は拒絶されました。別の対応を選んでください。" : ""}`,actions});
}

/** @param {object|null} settlement 入場時の対象。省略時は移動中の近隣拠点。 @returns {boolean} 所持または30日以内の売買記録があれば摘発を50%で抽選する。 */
export function enqueuePirateCheckpoint(settlement = null) {
  const data=piracyState(), set=settlement || nearestLawfulSettlement();
  if (!set || data.checkpoint) return false;
  const recorded=Number.isFinite(data.lastTrade) && absDay(state)-data.lastTrade<PIRATE_CONFIG.recordDays;
  if (!contrabandCount() && !recorded) return false;
  if (Math.random()>=PIRATE_CONFIG.inspectionChance) return false;
  data.checkpoint={id:data.nextId++,nobleId:set.nobleId,factionId:set.factionId,bribeFailed:false};
  showCheckpoint(); return true;
}

/** 街・村への入場ごとに抽選し、発生時だけ拠点ごとの季節枠を消費する。通常検問と摘発で枠を共有し、移動中の検問とは独立させる。 @param {object} settlement 入った拠点。 @param {Function} normal 通常検問の表示。 @returns {boolean} 発生したか。 */
export function enqueueSettlementCheckpoint(settlement, normal) {
  if (!settlement || !["town", "village"].includes(settlement.kind) || settlement.pirateHaven || settlement.factionId === "pirates" || state.pendingEncounter?.active) return false;
  const data = piracyState();
  if (data.checkpoint) return false;
  data.entrySeasons ||= {};
  const season = state.year * 4 + state.season;
  if (data.entrySeasons[settlement.id] === season) return false;
  const chance = entryCheckpointChance(contrabandCount(), settlement.support?.[settlement.factionId] ?? 0);
  if (chance <= 0 || Math.random() >= chance) return false;
  data.entrySeasons[settlement.id] = season;
  if (!enqueuePirateCheckpoint(settlement)) normal(settlement);
  return true;
}

/**
 * 同じ検問IDの行動だけ処理し、支払い・没収・戦闘移行を一度に限定する。
 * @param {object} action 選択肢。 @returns {boolean} 海賊検問の行動を処理したか。
 */
export function handlePirateCheckpoint(action) {
  if (!action?.type?.startsWith("pirate_")) return false;
  const data=piracyState(), check=data.checkpoint;
  if (!check || action.payload?.id!==check.id) return true;
  if (action.type === "pirate_bribe") {
    const terms=bribeTerms();
    if (check.bribeFailed || state.funds<terms.price) { showCheckpoint(); return true; }
    state.funds-=terms.price;
    if (Math.random()<terms.chance) { data.checkpoint=null; pushLog("検問通過",`賄賂：資金−${terms.price}`,"-"); }
    else {check.bribeFailed=true; adjustNobleFavor(check.nobleId,PIRATE_CONFIG.bribeFailureFavor); pushLog("賄賂失敗",`資金−${terms.price} / 貴族好感度${PIRATE_CONFIG.bribeFailureFavor}`,"-");showCheckpoint();}
  } else if (action.type === "pirate_surrender") {
    const count=contrabandCount();
    if (!count) adjustNobleFavor(check.nobleId,PIRATE_CONFIG.recordPenalty);
    CONTRABAND.forEach(item=>{state.supplies[item.id]=0;});
    data.lastTrade=null; data.checkpoint=null;
    pushLog("摘発に応じる",count ? `禁制品${count}個を引き渡しました。` : `警告：貴族好感度${PIRATE_CONFIG.recordPenalty}`,"-");
  } else if (action.type === "pirate_force") {
    data.checkpoint=null;
    startTravelEncounter({forceStrength:"elite",enemyFactionId:check.factionId,title:"検問突破",flavor:"正規軍が行く手を塞ぎます。",eventTag:"pirate_checkpoint",eventContext:check});
  }
  return true;
}
