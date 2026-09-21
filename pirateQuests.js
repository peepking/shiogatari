import { PIRATE_CONFIG, CONTRABAND, pirateRelation, PIRATE_RELATION_LABELS } from "./pirateConfig.js";
import { state } from "./state.js";
import { settlements } from "./map.js";
import { buildEnemyFormation } from "./actions.js";
import { adjustNobleFavor, adjustSupport, getNobleFavor } from "./faction.js";
import { enqueueEvent } from "./events.js";
import { pushLog } from "./dom.js";
import { manhattan, randomHuntTarget } from "./questUtils.js";
import { FACTIONS } from "./lore.js";

/**
 * 依頼の基準地点から最寄りの通常拠点を固定する。同距離はID順。
 * @param {object} q 依頼。 @param {object} origin 発注港。 @returns {void}
 */
function bindVictim(q, origin) {
  const location = ["smuggle","raid","fleetRaid"].includes(q.pirateKind)
    ? q.target || settlements.find(s => s.id === q.targetId)?.coords || origin.coords : origin.coords;
  const victim = settlements.filter(s => !s.pirateHaven && s.factionId !== "pirates")
    .sort((a,b) => manhattan(a.coords,location)-manhattan(b.coords,location) || a.id.localeCompare(b.id))[0];
  if (victim) q.pirateVictim = {settlementId:victim.id,nobleId:victim.nobleId,factionId:victim.factionId};
}

/**
 * 既存依頼の進捗・期限・マーカーを活用し、海賊固有の積荷と固定編成を設定する。
 * 5種を候補に毎季節3件を重複なしで一様抽選する。
 * @param {object} origin 発注港。 @param {object} factories 既存の依頼生成関数。 @returns {Array} 依頼。
 */
export function makePirateQuests(origin, factories) {
  const existing = [...(state.quests?.active || []), ...Object.values(state.quests?.availableBySettlement || {}).flat(),
    ...Object.values(state.nobleQuests?.availableByNoble || {}).flat()];
  const occupied = existing.flatMap(q => [q.target, ...(q.fights || []).map(f => f.target)]).filter(Boolean);
  const kinds = ["raid","fleetRaid","smuggle","courier","supply"];
  for (let i=kinds.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1)); [kinds[i],kinds[j]]=[kinds[j],kinds[i]];
  }
  return kinds.slice(0,3).map(kind => {
    const q = kind === "raid" ? factories.hunt(origin) : kind === "fleetRaid" ? factories.bounty(origin)
      : kind === "supply" ? factories.supply(origin) : factories.delivery(origin);
    q.pirateKind = kind;
    if (kind === "smuggle" || kind === "courier") {
      const targets = settlements.filter(s => s.id !== origin.id && (kind === "courier" ? s.pirateHaven : !s.pirateHaven));
      if (!targets.length) return null;
      const target=targets[Math.floor(Math.random()*targets.length)];
      const item=CONTRABAND[Math.floor(Math.random()*CONTRABAND.length)];
      q.itemId=item.id; q.targetId=target.id; q.qty=1;
      q.reward=manhattan(origin.coords,target.coords)*100;
      q.title=`${kind === "smuggle" ? "密輸" : "運び屋"}：${target.name}へ${item.name}`;
      q.desc=`${target.name}へ${item.name}を${q.qty}個届ける。禁制品は検問で没収される場合があります。`;
    } else if (kind === "raid" || kind === "fleetRaid") {
      q.target=randomHuntTarget(origin.coords,2,5,occupied);
      occupied.push(q.target);
      q.fixedEnemy=buildEnemyFormation(kind === "fleetRaid" ? "elite" : "normal", "pirates", {scale:PIRATE_CONFIG.raidScale,regularPool:true});
      q.estimatedTotal=q.fixedEnemy.total;
      q.reward=Math.round((q.estimatedTotal*50+100)*PIRATE_CONFIG.raidRewardScale);
      q.rewardFame=Math.floor(q.estimatedTotal/2)+5;
      q.title=kind === "raid" ? "隊商襲撃" : "商船団襲撃";
      q.desc=`(${q.target.x+1}, ${q.target.y+1})で${q.title}。推定${q.estimatedTotal}人・${q.fixedEnemy.strength === "elite" ? "強編成" : "通常編成"}。`;
    } else q.title=`海賊の物資納品：${q.title}`;
    bindVictim(q,origin);
    return q;
  }).filter(Boolean);
}

/**
 * 完了した海賊依頼だけで固定対象へ変化を適用し、通常討伐では黒ひげだけを減点する。
 * 重複完了への防御として依頼にも適用済み印を保存する。
 * @param {object} q 達成依頼。 @returns {void}
 */
export function resolvePirateRelations(q) {
  if (q.pirateRelationsApplied) return;
  const hunt=["pirate_hunt","bounty_hunt"].includes(q.type);
  if (!q.pirateKind && !hunt) return;
  q.pirateRelationsApplied=true;
  const delta=q.pirateKind ? PIRATE_CONFIG.favorDelta : -PIRATE_CONFIG.favorDelta;
  const before=getNobleFavor(PIRATE_CONFIG.nobleId);
  adjustNobleFavor(PIRATE_CONFIG.nobleId,delta);
  const messages=[`黒ひげとの好感度 ${delta>0?"+":""}${delta}`];
  const victim=q.pirateVictim;
  if (q.pirateKind && victim) {
    const set=settlements.find(s=>s.id===victim.settlementId);
    if (set) { adjustSupport(set.id,victim.factionId,-delta); messages.push(`${set.name}の支持度 −${delta}`); }
    if (victim.nobleId) {
      adjustNobleFavor(victim.nobleId,-delta);
      const noble=FACTIONS.flatMap(f=>f.nobles || []).find(n=>n.id===victim.nobleId);
      messages.push(`${noble?.name || "担当貴族"}の好感度 −${delta}`);
    }
  }
  const after=getNobleFavor(PIRATE_CONFIG.nobleId);
  q.pirateImpact=messages.join(" / ");
  const changed=pirateRelation(before)!==pirateRelation(after);
  if (changed) messages.push(`海賊との関係：${PIRATE_RELATION_LABELS[pirateRelation(before)]} → ${PIRATE_RELATION_LABELS[pirateRelation(after)]}`);
  pushLog("関係の変化",messages.join(" / "),"-");
  if (changed) enqueueEvent({title:"関係の変化",body:messages.join("\n")});
}
