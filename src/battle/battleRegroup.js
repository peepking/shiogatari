import { isBattleActive, isBattleOnBoard, localPressure } from "./battleMorale.js";
import { isHostileZone, movementPriority } from "./battleMovement.js";
import { tacticalDistance, TACTICAL_ORDER_RULES } from "./battleTacticalOrders.js";

/** @param {object} unit 部隊。 @returns {boolean} 立て直し中か。 */
export function isRegrouping(unit) { return ["withdrawing", "recovering"].includes(unit.tacticalState); }

/** @param {object} unit 部隊。 @param {Array} units 盤面。 @returns {Array} 実際に脅威となる敵。 */
export function regroupEnemies(unit, units) {
  return units.filter(enemy => enemy.side !== unit.side && isBattleActive(enemy) && !enemy.arriving);
}

/** @param {object} unit 部隊。 @param {object} point 座標。 @param {Array} units 盤面。 @returns {boolean} 通常射程・拘束範囲外か。 */
export function isRegroupSafe(unit, point, units) {
  return !isHostileZone(point, unit, units)
    && !regroupEnemies(unit, units).some(enemy => tacticalDistance(point, enemy) <= enemy.range);
}

/** @param {object} unit 部隊。 @param {object} point 座標。 @param {Array} units 盤面。 @returns {number[]} 危険度。 */
function regroupDanger(unit, point, units) {
  const enemies = regroupEnemies(unit, units);
  return [enemies.filter(enemy => tacticalDistance(point, enemy) <= enemy.range).length,
    localPressure({ ...unit, ...point }, units.filter(other => other.id !== unit.id)), -Math.min(100, ...enemies.map(enemy => tacticalDistance(point, enemy)))];
}

/** @param {number[]} a 比較値。 @param {number[]} b 比較値。 @returns {number} 辞書式の順序。 */
function compareRegroupScore(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * 同一占有盤面から安全な後方への経路を調べる。拘束への侵入数、経路長、前衛背後、地形の順で評価する。
 * 味方との交換を行わず、目標が有効なら保持する。安全位置がなければ危険が減る後方隣接だけを使う。
 * @param {object} unit 部隊。 @param {object} state 戦場。 @returns {{path:Array,goal:object|null,safe:boolean}} 退路。
 */
export function findRegroupPlan(unit, state) {
  const { units, size } = state;
  if (isRegroupSafe(unit, unit, units)) return { path: [], goal: { x: unit.x, y: unit.y }, safe: true };
  const occupied = new Set(units.filter(other => other.id !== unit.id && isBattleOnBoard(other)).map(other => `${other.x},${other.y}`));
  const direction = unit.side === "ally" ? 1 : -1;
  const priority = movementPriority(unit.id, state.randomSeed || 0, state.tick);
  const directions = [[-direction, 0], [0, priority % 2 ? 1 : -1], [0, priority % 2 ? -1 : 1], [direction, 0]];
  const start = { x: unit.x, y: unit.y, path: [], zones: 0 };
  const queue = [start], visited = new Map([[`${unit.x},${unit.y}`, [0, 0]]]);
  const candidates = [];
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i];
    if (point.path.length && (point.x - unit.x) * direction <= 0 && isRegroupSafe(unit, point, units)) candidates.push(point);
    for (const [dx, dy] of directions) {
      const next = { x: point.x + dx, y: point.y + dy };
      const key = `${next.x},${next.y}`;
      if (next.x < 0 || next.x >= size || next.y < 0 || next.y >= size || occupied.has(key)) continue;
      const zones = point.zones + Number(isHostileZone(next, unit, units));
      const score = [zones, point.path.length + 1];
      if (visited.has(key) && compareRegroupScore(visited.get(key), score) <= 0) continue;
      visited.set(key, score); queue.push({ ...next, zones, path: [...point.path, next] });
    }
  }
  const retained = candidates.filter(point => point.x === unit.regroupGoal?.x && point.y === unit.regroupGoal?.y)
    .sort((a, b) => compareRegroupScore([a.zones, a.path.length], [b.zones, b.path.length]))[0];
  const friends = units.filter(friend => friend.side === unit.side && friend.id !== unit.id && friend.role === "melee"
    && isBattleActive(friend) && !friend.arriving && !isRegrouping(friend));
  /** @param {object} point 安全位置。 @returns {number[]} 安全位置の順位。 */
  function score(point) {
    const behind = friends.some(friend => (friend.x - point.x) * direction > 0 && tacticalDistance(point, friend) <= 2);
    const terrain = state.grid[point.y]?.[point.x];
    return [point.zones, point.path.length, -Number(behind), -(unit.terrain?.[terrain] ?? unit.terrain?.[terrain === "deck" ? "plain" : terrain] ?? 100)];
  }
  const best = retained || candidates.sort((a, b) => compareRegroupScore(score(a), score(b)))[0];
  if (best) return { path: best.path, goal: { x: best.x, y: best.y }, safe: true };
  const current = regroupDanger(unit, unit, units);
  const fallback = directions.map(([dx, dy]) => ({ x: unit.x + dx, y: unit.y + dy }))
    .filter(point => point.x >= 0 && point.x < size && point.y >= 0 && point.y < size
      && (point.x - unit.x) * direction <= 0 && !occupied.has(`${point.x},${point.y}`)
      && compareRegroupScore(regroupDanger(unit, point, units), current) < 0)
    .sort((a, b) => compareRegroupScore(regroupDanger(unit, a, units), regroupDanger(unit, b, units)))[0];
  return { path: fallback ? [fallback] : [], goal: fallback || null, safe: false };
}

/** @param {object} state 戦場。 @param {Array} before tick開始時HP。 @returns {string[]} 完了の通知。 */
export function finishRegroupTick(state, before) {
  const logs = [];
  for (const unit of state.units) {
    if (unit.status === "reserve") continue;
    unit.previousDamage = Math.max(0, (before.find(old => old.id === unit.id)?.hp ?? unit.hp) - unit.hp);
    if (!isBattleActive(unit)) {
      unit.pendingTacticalOrders = {}; unit.regroupGoal = null; unit.regroupComplete = false;
      continue;
    }
    if (!isRegrouping(unit)) continue;
    const safe = isRegroupSafe(unit, unit, state.units) && !unit.previousDamage;
    unit.regroupSafeTicks = safe ? (unit.regroupSafeTicks || 0) + 1 : 0;
    if (!safe) unit.regroupComplete = false;
    if (safe) unit.tacticalState = "recovering";
    if (!unit.regroupComplete && unit.regroupSafeTicks >= TACTICAL_ORDER_RULES.safeTicks
      && unit.morale >= TACTICAL_ORDER_RULES.recoverMorale) {
      unit.regroupComplete = true;
      logs.push(`${unit.side === "ally" ? "味方" : "敵"}の${unit.name}が立て直しを完了した。`);
    }
  }
  return logs;
}
