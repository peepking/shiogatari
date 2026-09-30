/**
 * 前線を1拠点1件へ整理する。現所有者と防衛側が一致する未決着前線のうち、開始日の早いものを残す。
 * 同日は台帳順を優先する。不整合前線を勝敗なしで除外し、無効になった前線依頼・未表示の要請も取り除く。
 * @param {object} state ゲーム状態。
 * @param {object[]} settlements 拠点一覧。
 * @returns {void}
 */
export function reconcileWarFronts(state, settlements) {
  const entries = state.warLedger?.entries || [];
  const owners = new Map(settlements.map(s => [s.id, s.factionId]));
  const candidates = entries.flatMap(entry => (entry.activeFronts || []).filter(Boolean));
  const kept = new Set();
  const bySettlement = new Map();
  for (const front of [...candidates].sort((a, b) => (a.startAbs || 0) - (b.startAbs || 0))) {
    if (front.resolved || !owners.has(front.settlementId) || owners.get(front.settlementId) !== front.defender
      || front.attacker === front.defender || bySettlement.has(front.settlementId)) continue;
    kept.add(front);
    bySettlement.set(front.settlementId, front);
  }
  const removedIds = new Set(candidates.filter(f => !kept.has(f)).map(f => f.id).filter(Boolean));
  const removedSites = new Set(candidates.filter(f => !kept.has(f)).map(f => f.settlementId));
  for (const entry of entries) entry.activeFronts = (entry.activeFronts || []).filter(f => kept.has(f));
  if (state.quests?.active) state.quests.active = state.quests.active.filter(q => {
    if (!q.type?.startsWith("war_") || !removedSites.has(q.frontSettlementId)) return true;
    if (q.frontId) return !removedIds.has(q.frontId);
    const front = bySettlement.get(q.frontSettlementId);
    if (!front) return false;
    return q.frontRole === "defend"
      ? q.factionId === front.defender && q.enemyFactionId === front.attacker
      : q.factionId === front.attacker && q.enemyFactionId === front.defender;
  });
  if (state.eventQueue) state.eventQueue = state.eventQueue.filter(event =>
    !(event.actions || []).some(action => removedIds.has(action.payload?.frontId)));
}
