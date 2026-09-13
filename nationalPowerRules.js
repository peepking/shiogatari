import { NATIONAL_POWER_CONFIG as CONFIG, NATIONAL_POWER_FACTIONS } from "./nationalPowerConfig.js";
import { normalizeNationalPower, nationalPowerDay, isNationalPowerFaction, changeNationalPower, nationalPowerRecovery, nationalPowerDailyCost, nationalPowerWarBias } from "./nationalPower.js";

const NORMAL_QUESTS = new Set(["supply", "delivery", "pirate_hunt", "bounty_hunt", "noble_supply", "noble_scout", "noble_security", "noble_refugee"]);
const WAR_QUESTS = new Set(["noble_logistics", "noble_hunt", "war_defend_raid", "war_attack_raid", "war_skirmish", "war_supply", "war_escort", "war_blockade", "war_truce"]);

/**
 * 依頼主は保存済み指定、貴族所属、依頼の勢力、受注元の順で解決する。難民イベントや神託には国家報酬を付けない。
 * @param {object} q 依頼。 @param {Array} factions 勢力定義。 @param {Array} settlements 拠点。
 * @returns {object} 支援先と敵。状態を変更しない。
 */
export function questPowerParties(q, factions, settlements) {
  if (!NORMAL_QUESTS.has(q.type) && !WAR_QUESTS.has(q.type)) return { ally: null, enemy: null };
  const nobleFaction = factions.find(f => f.nobles?.some(n => n.id === q.nobleId))?.id;
  const ally = Object.hasOwn(q, "powerFactionId") ? q.powerFactionId : nobleFaction || q.factionId || settlements.find(s => s.id === q.originId)?.factionId;
  const enemy = Object.hasOwn(q, "powerEnemyId") ? q.powerEnemyId : q.enemyFactionId || q.targetFactionId;
  return { ally: isNationalPowerFaction(ally) ? ally : null, enemy: isNationalPowerFaction(enemy) && enemy !== ally ? enemy : null };
}

/** @param {object} q 依頼。 @param {Array} factions 勢力。 @param {Array} settlements 拠点。 @returns {void} 受注時・移行時に支援先を一度だけ固定する。 */
export function bindQuestPower(q, factions, settlements) {
  const { ally, enemy } = questPowerParties(q, factions, settlements);
  if (!Object.hasOwn(q, "powerFactionId")) q.powerFactionId = ally;
  if (!Object.hasOwn(q, "powerEnemyId")) q.powerEnemyId = enemy;
}

/** @param {object} q 依頼。 @param {Array} factions 勢力。 @param {Array} settlements 拠点。 @param {Function} atWar 交戦判定。 @returns {Array} 予定増減。和平後は通常依頼相当のみ。 */
export function questPowerPlan(q, factions, settlements, atWar) {
  const { ally, enemy } = questPowerParties(q, factions, settlements);
  if (!ally) return [];
  if (WAR_QUESTS.has(q.type) && enemy && atWar(ally, enemy)) return [{ factionId: ally, delta: CONFIG.warActionGain }, { factionId: enemy, delta: -CONFIG.warActionLoss }];
  return [{ factionId: ally, delta: CONFIG.questGain }];
}

/** @param {object} state 状態。 @param {Array} plan 予定増減。 @returns {Array} 上下限適用後の増減。各勢力は独立して更新する。 */
export function applyNationalPowerPlan(state, plan) {
  state.nationalPower = normalizeNationalPower(state.nationalPower, nationalPowerDay(state));
  return plan.map(row => ({ ...row, delta: changeNationalPower(state.nationalPower, row.factionId, row.delta) }));
}

/**
 * 完了した依頼へ一度だけ付与する。未完了戦闘・期限切れは付与しない。
 * @param {object} state 状態。 @param {object} q 依頼。 @param {Array} factions 勢力。 @param {Array} settlements 拠点。 @param {Function} atWar 交戦判定。
 * @returns {Array} 今回の実増減。
 */
export function completeQuestPower(state, q, factions, settlements, atWar) {
  if (q.powerAwarded || q.fights?.some(f => !f.done) || (q.deadlineAbs != null && q.deadlineAbs < nationalPowerDay(state))) return [];
  bindQuestPower(q, factions, settlements);
  q.powerChanges = applyNationalPowerPlan(state, questPowerPlan(q, factions, settlements, atWar));
  q.powerAwarded = true;
  return q.powerChanges;
}

/**
 * 交戦中の有効な前線を1拠点1件として数える。解決済み・所有者不一致を除外する。
 * @param {object} state 状態。 @param {Array} settlements 拠点。 @param {Function} atWar 交戦判定。
 * @returns {object} 国家別攻撃・防衛件数。
 */
export function nationalPowerFrontCounts(state, settlements, atWar) {
  const counts = Object.fromEntries(NATIONAL_POWER_FACTIONS.map(id => [id, { attacks: 0, defenses: 0 }]));
  const seen = new Set();
  for (const entry of state.warLedger?.entries || []) {
    for (const front of entry.activeFronts || []) {
      if (!front || front.resolved || seen.has(front.settlementId) || !counts[front.attacker] || !counts[front.defender] || !atWar(front.attacker, front.defender)) continue;
      if (settlements.find(s => s.id === front.settlementId)?.factionId !== front.defender) continue;
      seen.add(front.settlementId); counts[front.attacker].attacks++; counts[front.defender].defenses++;
    }
  }
  return counts;
}

/**
 * 季節回復、既存前線消耗、全ペアの補正をこの順で一度だけ適用する。決着・新規前線は呼び出し後に処理する。
 * @param {object} state 状態。 @param {Array} settlements 拠点。 @param {Function} atWar 交戦判定。
 * @returns {Array} 季節回復の実増減。日次の通知は作らない。
 */
export function tickNationalPower(state, settlements, atWar) {
  const today = nationalPowerDay(state);
  state.nationalPower = normalizeNationalPower(state.nationalPower, today);
  if (state.nationalPower.lastProcessedAbs >= today) return [];
  const counts = nationalPowerFrontCounts(state, settlements, atWar);
  const recovery = state.day === 1 ? applyNationalPowerPlan(state, NATIONAL_POWER_FACTIONS.map(factionId => ({ factionId, delta: nationalPowerRecovery(settlements, factionId) }))) : [];
  applyNationalPowerPlan(state, NATIONAL_POWER_FACTIONS.map(factionId => ({ factionId, delta: -nationalPowerDailyCost(counts[factionId].attacks, counts[factionId].defenses) })));
  const pairs = new Set();
  for (const entry of state.warLedger?.entries || []) {
    const [a, b] = entry.factions || [];
    if (!isNationalPowerFaction(a) || !isNationalPowerFaction(b) || a === b || !atWar(a, b)) continue;
    const key = [a, b].sort().join(":");
    if (pairs.has(key)) continue;
    pairs.add(key);
    const bias = nationalPowerWarBias(state.nationalPower, a, b);
    entry.score = Math.round(((entry.score || 0) + bias) * 1e9) / 1e9;
  }
  state.nationalPower.lastProcessedAbs = today;
  return recovery;
}

/**
 * 依頼・探索・行商人襲撃を通常の正規軍撃破と区別し、戦闘に入る前の所属と交戦状態を固定する。
 * @param {object} state 状態。 @param {object} encounter 遭遇。 @param {Function} atWar 交戦判定。 @returns {object} 戦闘結果用の固定情報。
 */
export function snapshotBattlePower(state, encounter, atWar) {
  const ally = state.playerFactionId; const enemy = encounter.enemyFactionId;
  const regular = !encounter.eventTag || encounter.eventTag === "checkpoint_force";
  const eligible = regular && encounter.questId == null && !encounter.questType && encounter.explorationId == null && isNationalPowerFaction(ally) && isNationalPowerFaction(enemy) && ally !== enemy && atWar(ally, enemy);
  return { ally, enemy, eligible };
}

/** @param {object} state 状態。 @param {object} encounter 遭遇。 @param {boolean} won 勝利。 @returns {Array} 固定済み条件に基づく一度だけの国力報酬。 */
export function completeBattlePower(state, encounter, won) {
  const context = encounter.powerContext;
  if (!won || !context?.eligible || encounter.powerAwarded || encounter.questId != null || encounter.questType || encounter.explorationId != null) return [];
  encounter.powerAwarded = true;
  return applyNationalPowerPlan(state, [{ factionId: context.ally, delta: CONFIG.regularVictoryGain }, { factionId: context.enemy, delta: -CONFIG.regularVictoryLoss }]);
}
