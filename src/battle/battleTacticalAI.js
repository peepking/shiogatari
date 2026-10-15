import { isBattleActive, localPressure } from "./battleMorale.js";
import { isHostileZone, findTacticalPath, movementPriority } from "./battleMovement.js";
import { initializeTacticalOrders, applyPendingTacticalOrders, tacticalArea, tacticalDistance, TACTICAL_ORDER_RULES } from "./battleTacticalOrders.js";
import { findRegroupPlan, isRegrouping, regroupEnemies, isRegroupSafe } from "./battleRegroup.js";

/** @param {object} unit 部隊。 @param {Array} units 盤面。 @returns {object} 純粋な標的方針。 */
function decideTacticalTarget(unit, units) {
  const enemies = regroupEnemies(unit, units);
  const nearby = enemies.filter(enemy => tacticalDistance(unit, enemy) <= Math.max(unit.range, unit.role === "ranged" ? 4 : 3));
  if (unit.targetOrder !== "auto") return { mode: unit.targetOrder, reason: "手動の攻撃目標" };
  if (unit.role !== "melee" && nearby.some(enemy => enemy.role === "melee" && tacticalDistance(unit, enemy) === 1))
    return { mode: "selfDefense", reason: "接近した敵に対処" };
  if (unit.traits?.includes("antiCavalry") && nearby.some(enemy => enemy.traits?.includes("mounted")))
    return { mode: "antiCavalry", reason: "騎乗兵を迎撃" };
  if (nearby.some(enemy => enemy.hp / Math.max(1, enemy.maxHp) <= TACTICAL_ORDER_RULES.opportunityHp
    || enemy.morale <= TACTICAL_ORDER_RULES.opportunityMorale)) return { mode: "opportunity", reason: "崩れかけた敵を狙う" };
  return { mode: unit.role === "ranged" || unit.traits?.includes("mounted") ? "rear" : "close", reason: "兵種に合わせて攻撃" };
}

/** @param {object} unit 部隊。 @param {object} state 戦場。 @returns {object} 通常の進軍・待機。 */
function decideTacticalAction(unit, state) {
  const enemies = regroupEnemies(unit, state.units);
  if (unit.actionOrder !== "auto") return { action: unit.actionOrder === "regroup" ? "withdrawing" : unit.actionOrder, reason: "手動の行動指示" };
  if (unit.traits?.includes("mounted") && !unit.cavalryReleased) {
    const friends = state.units.filter(friend => friend.side === unit.side && friend.id !== unit.id && friend.role === "melee"
      && isBattleActive(friend) && !friend.arriving && !isRegrouping(friend));
    const engaged = friends.some(friend => enemies.some(enemy => enemy.role === "melee"
      && tacticalDistance(friend, enemy) <= Math.max(friend.range, enemy.range)));
    const release = !friends.length || engaged || isHostileZone(unit, unit, state.units)
      || enemies.some(enemy => tacticalDistance(unit, enemy) <= unit.range)
      || state.tick - unit.cavalryWaitStarted >= TACTICAL_ORDER_RULES.cavalryWait;
    if (!release) return { action: "hold", reason: "味方の接敵を待つ" };
    return { action: "advance", reason: "騎兵を投入", release: true };
  }
  if (unit.role === "support") {
    const direction = unit.side === "ally" ? 1 : -1;
    const friends = state.units.filter(friend => friend.side === unit.side && friend.role === "melee"
      && isBattleActive(friend) && !friend.arriving && !isRegrouping(friend));
    if (!friends.length || friends.some(friend => (friend.x - unit.x) * direction > 0 && tacticalDistance(friend, unit) <= 2))
      return { action: "hold", reason: friends.length ? "前衛の背後を維持" : "追随する前衛がいない" };
  } else if (enemies.some(enemy => tacticalDistance(unit, enemy) <= unit.range))
    return { action: "hold", reason: unit.role === "ranged" ? "射程内から射撃" : "前線を維持" };
  return { action: "advance", reason: unit.role === "support" ? "前衛の背後へ追随" : "交戦位置へ進軍" };
}

/**
 * 同じ開始盤面から後退希望を作り、希望同士を交代候補から除く。候補は一対一で割り当てる。
 * 緊急後退は維持期間を無視し、通常後退は近接兵だけ交代候補を必要とする。
 * @param {object} state 戦場。 @param {Array} active 通常部隊。 @returns {Set<string>} 後退を許可する部隊ID。
 */
function decideRegroupRecipients(state, active) {
  const rules = TACTICAL_ORDER_RULES;
  const wishes = active.filter(unit => {
    if (unit.actionOrder !== "auto" || isRegrouping(unit)) return false;
    const threat = !isRegroupSafe(unit, unit, state.units) || localPressure(unit, state.units) > 0 || unit.previousDamage > 0;
    const urgent = unit.morale <= rules.urgentMorale;
    return threat && (urgent || (state.tick >= unit.tacticalChangeAt && state.tick >= unit.regroupLockUntil && (unit.morale <= rules.lowMorale
      || (unit.hp / Math.max(1, unit.maxHp) <= rules.lowHp && unit.previousDamage > 0))))
      && findRegroupPlan(unit, state).path.length > 0;
  });
  const ids = new Set(wishes.map(unit => unit.id)), used = new Set(), allowed = new Set();
  wishes.sort((a, b) => a.morale - b.morale || a.hp / a.maxHp - b.hp / b.maxHp
    || movementPriority(a.id, state.randomSeed || 0, state.tick) - movementPriority(b.id, state.randomSeed || 0, state.tick) || a.id.localeCompare(b.id));
  const occupied = new Set(state.units.filter(unit => isBattleActive(unit) || unit.status === "routing").map(unit => `${unit.x},${unit.y}`));
  for (const unit of wishes) {
    if (unit.morale <= rules.urgentMorale || unit.role !== "melee") { allowed.add(unit.id); continue; }
    const enemies = regroupEnemies(unit, state.units).filter(enemy => tacticalDistance(unit, enemy) <= Math.max(unit.range, enemy.range));
    const candidate = active.filter(friend => friend.side === unit.side && friend.role === "melee" && !ids.has(friend.id)
      && !used.has(friend.id) && !isRegrouping(friend) && friend.actionOrder !== "regroup"
      && friend.morale > 45 && friend.hp / Math.max(1, friend.maxHp) > rules.lowHp
      && tacticalDistance(unit, friend) <= rules.reliefDistance)
      .sort((a, b) => a.id.localeCompare(b.id)).find(friend => enemies.some(enemy => tacticalDistance(friend, enemy) <= friend.range
        || (friend.actionOrder !== "hold" && findTacticalPath(friend, enemy, state.size, occupied, 0, state.units).length > 0)));
    if (candidate) { used.add(candidate.id); allowed.add(unit.id); }
  }
  return allowed;
}

/** @param {object} state 戦場。 @returns {string[]} 行動変化の通知。 */
export function resolveTacticalAI(state) {
  const active = state.units.filter(unit => isBattleActive(unit) && !unit.arriving);
  const logs = [];
  for (const unit of active) {
    if (!unit.actionOrder) initializeTacticalOrders(unit);
    applyPendingTacticalOrders(unit, state.tick, state.size);
    if (unit.cavalryWaitStarted == null) unit.cavalryWaitStarted = state.tick;
    if (unit.targetOrder === "focus" && !state.units.some(enemy => enemy.id === unit.focusEnemyId
      && enemy.side !== unit.side && isBattleActive(enemy) && enemy.status !== "reserve")) {
      unit.targetOrder = "auto"; unit.focusEnemyId = null; unit.switchLock = 0;
      logs.push(`${unit.name}の指定敵が戦闘不能になり、攻撃目標をおまかせに戻した。`);
    }
  }
  const retreating = decideRegroupRecipients(state, active);
  const decisions = active.map(unit => {
    const target = decideTacticalTarget(unit, state.units);
    let action;
    if (isRegrouping(unit) && unit.actionOrder === "auto" && unit.regroupComplete)
      action = { ...decideTacticalAction(unit, state), recovered: true };
    else if (isRegrouping(unit)) action = { action: unit.tacticalState, reason: unit.regroupComplete ? "立て直し完了・手動指示待ち" : "安全な後方で立て直す" };
    else if (retreating.has(unit.id)) action = { action: "withdrawing", reason: unit.morale <= TACTICAL_ORDER_RULES.lowMorale ? "士気低下で後退" : "損耗した前衛を下げる" };
    else action = decideTacticalAction(unit, state);
    return { unit, target, action };
  });
  for (const { unit, target, action } of decisions) {
    if (target.mode === "selfDefense" && unit.tacticalTargetMode !== target.mode) unit.switchLock = 0;
    if (unit.switchLock <= 1 || unit.targetOrder !== "auto" || target.mode === "selfDefense") {
      unit.tacticalTargetMode = target.mode; unit.tacticalTargetReason = target.reason;
    }
    if (action.recovered) {
      unit.regroupLockUntil = state.tick + TACTICAL_ORDER_RULES.regroupLock;
      unit.regroupComplete = false; unit.regroupGoal = null; unit.regroupSafeTicks = 0;
    }
    if (action.release) unit.cavalryReleased = true;
    if (unit.actionOrder !== "auto" || state.tick >= unit.tacticalChangeAt || isRegrouping(unit)
      || action.action === "withdrawing" || action.recovered || action.release) {
      if (unit.tacticalState !== action.action) {
        const labels = { advance: "進軍", hold: "待機", withdrawing: "後退", recovering: "士気回復" };
        logs.push(`${unit.side === "ally" ? "味方" : "敵"}の${unit.name}が${labels[action.action]}へ切り替えた。`);
        unit.tacticalChangeAt = state.tick + TACTICAL_ORDER_RULES.holdTicks;
      }
      unit.tacticalState = action.action; unit.tacticalReason = action.reason;
      unit.tacticalTargetArea = unit.targetAreaOrder === "auto" ? tacticalArea(unit.y, state.size) : unit.targetAreaOrder;
    }
  }
  return logs;
}
