/** @param {object} point 座標。 @returns {string} 占有キー。 */
function positionKey(point) { return `${point.x},${point.y}`; }

/** 戦線維持と移動先評価の初期調整値。 */
export const MOVEMENT_RULES = Object.freeze({ zocMinCount: 5, cohesion: 0.6, crowding: 0.4,
  rearGuard: 1.2, flank: 2.5, hostileZone: 2, supportDistance: 2 });

/** @param {object} a 座標。 @param {object} b 座標。 @returns {number} 四方向距離。 */
function distance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

/** 戦闘可能な近接兵だけが人数条件を満たした場合に拘束する。槍も隣接1マスだけ。
 * @param {object} point 調査座標。 @param {object} unit 移動部隊。 @param {Array} units 盤上部隊。
 * @returns {boolean} 敵の拘束範囲内か。
 */
export function isHostileZone(point, unit, units) {
  return units.some(enemy => enemy.side !== unit.side && enemy.hp > 0
    && (!enemy.status || enemy.status === "active") && !enemy.arriving && enemy.role === "melee"
    && enemy.count >= MOVEMENT_RULES.zocMinCount && distance(point, enemy) === 1);
}

/** シード・tick・部隊IDから競合順位を決め、配列順と乱数消費順から独立させる。
 * @param {string} id 部隊ID。 @param {number} seed シード。 @param {number} tick tick。
 * @returns {number} 順位値。
 */
export function movementPriority(id, seed, tick) {
  let hash = (seed ^ Math.imul(tick + 1, 0x9e3779b9)) >>> 0;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  return (hash ^ (hash >>> 13)) >>> 0;
}

/**
 * 四方向の幅優先探索で、標的を射程に収める空きマスまでの最短経路を返す。
 * 占有マスを通らず、標的から一旦離れる迂回も許可する。同距離は部隊別の順位で分散する。
 * @param {object} unit 部隊。 @param {object} target 標的。 @param {number} size 盤面。
 * @param {Set<string>} occupied 占有表。 @param {number} priority 同距離時の方向順位。
 * @param {object} evaluation 任意の到着条件・評価。小さい評価値を優先する。
 * @returns {object[]} 出発地点を含まない経路。
 */
export function findAttackPath(unit, target, size, occupied, priority = 0, evaluation = {}) {
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const offset = priority % 4;
  const ordered = directions.slice(offset).concat(directions.slice(0, offset));
  const queue = [{ x: unit.x, y: unit.y, parent: -1, depth: 0 }];
  const visited = new Set([positionKey(unit)]);
  let best = -1, bestScore = Infinity;
  for (let index = 0; index < queue.length; index++) {
    const point = queue[index];
    if (evaluation.goal ? evaluation.goal(point) : distance(point, target) <= unit.range) {
      const score = point.depth + (evaluation.score?.(point) || 0);
      if (score < bestScore) { best = index; bestScore = score; }
      if (!evaluation.score) break;
    }
    for (const [dx, dy] of ordered) {
      const next = { x: point.x + dx, y: point.y + dy, parent: index, depth: point.depth + 1 };
      const key = positionKey(next);
      if (next.x < 0 || next.y < 0 || next.x >= size || next.y >= size || visited.has(key) || occupied.has(key)) continue;
      visited.add(key); queue.push(next);
    }
  }
  const path = [];
  for (let cursor = best; cursor >= 0 && queue[cursor].parent !== -1; cursor = queue[cursor].parent)
    path.push({ x: queue[cursor].x, y: queue[cursor].y });
  return path.reverse();
}

/**
 * 最短距離を主に、近接の連続性・射撃の背後・騎乗の側方を補助評価する。
 * 支援兵は近接兵の後ろへ追随し、前衛がいなければ現在地を守る。
 * 人数で支援を重み付けし、少人数部隊の大量配置で評価を稼げないようにする。
 * @param {object} unit 部隊。 @param {object} target 標的。 @param {number} size 盤面。
 * @param {Set<string>} occupied 占有表。 @param {number} priority 同点順位。
 * @param {Array} units 盤上部隊。 @returns {Array} 経路。
 */
export function findTacticalPath(unit, target, size, occupied, priority, units) {
  const friends = units.filter(friend => friend.side === unit.side && friend.id !== unit.id && friend.role === "melee"
    && (!friend.status || friend.status === "active") && !friend.arriving);
  const direction = unit.side === "ally" ? 1 : -1;
  const support = unit.role === "support";
  if (support && !friends.length) return [];
  const behind = point => friends.some(friend => (friend.x - point.x) * direction > 0
    && distance(point, friend) <= MOVEMENT_RULES.supportDistance);
  return findAttackPath(unit, target, size, occupied, priority, {
    goal: point => support ? behind(point) : distance(point, target) <= unit.range,
    score: point => {
      const neighbors = friends.filter(friend => distance(point, friend) === 1);
      const weight = neighbors.reduce((sum, friend) => sum + Math.min(1, (friend.count || 0) / 10), 0);
      let score = isHostileZone(point, unit, units) && unit.role !== "melee" ? MOVEMENT_RULES.hostileZone : 0;
      if (unit.role === "melee") score -= Math.min(2, weight) * MOVEMENT_RULES.cohesion;
      if (unit.role === "ranged" && behind(point)) score -= MOVEMENT_RULES.rearGuard;
      score += Math.max(0, neighbors.length - 2) * MOVEMENT_RULES.crowding;
      if (unit.traits?.includes("mounted") && !isHostileZone(unit, unit, units)
        && point.y !== target.y) score -= MOVEMENT_RULES.flank;
      return score;
    },
  });
}

/** 後端への退路を探索する。安全な味方マスは場所譲り候補として通過可能とする。
 * @param {object} unit 敗走部隊。 @param {number} size 盤面。 @param {Array} units 盤上部隊。
 * @param {number} priority 同点順位。 @returns {Array} 退路。
 */
export function findRoutPath(unit, size, units, priority) {
  const occupied = new Set(units.filter(other => other.id !== unit.id && (other.side !== unit.side
    || other.status === "routing" || other.arriving || isHostileZone(other, other, units) || isHostileZone(unit, other, units))).map(positionKey));
  return findAttackPath(unit, unit, size, occupied, priority, { goal: point => point.x === (unit.side === "ally" ? 0 : size - 1) });
}

/**
 * 同一盤面から作った経路を1マスずつ解決する。各ステップ開始時の占有マスへの侵入は禁止。
 * 競合は待ちtickが長い部隊、次にシード順位で解決し、陣営固定の先手を作らない。
 * 敗れた部隊はそのtickの残り移動を中止する。移動失敗は次tickの優先度へ引き継ぐ。
 * @param {Array} plans 部隊・経路・退避種別。 @param {Array} units 盤上部隊。
 * @param {number} size 盤面。 @param {number} seed シード。 @param {number} tick tick。
 * @returns {{moves:Array,blocked:number,zocStops:number}} 移動イベントと停止部隊数。
 */
export function resolveBattleMovement(plans, units, size, seed, tick) {
  const moves = [], stopped = new Set(), moved = new Set();
  const zocStopped = new Set();
  const exchanged = new Set();
  // 敗走時の場所譲りは通常競合より先に解決する。同部隊の多重交換と危険な押し込みは禁止。
  for (const plan of [...plans].sort((a, b) => movementPriority(a.unit.id, seed, tick) - movementPriority(b.unit.id, seed, tick))) {
    const { unit } = plan, next = plan.path[0];
    if (unit.status !== "routing" || !next || exchanged.has(unit.id)) continue;
    const friend = units.find(other => other.x === next.x && other.y === next.y && other.side === unit.side
      && other.status !== "routing" && !other.arriving && !exchanged.has(other.id));
    if (!friend || distance(unit, friend) !== 1 || isHostileZone(friend, friend, units) || isHostileZone(unit, friend, units)) continue;
    const from = { x: unit.x, y: unit.y };
    unit.x = friend.x; unit.y = friend.y; friend.x = from.x; friend.y = from.y;
    const friendPlan = plans.find(other => other.unit.id === friend.id);
    if (friendPlan) { friendPlan.path = []; friendPlan.attackBlocked = true; }
    plan.path.shift(); plan.attackBlocked = true;
    for (const actor of [unit, friend]) { exchanged.add(actor.id); moved.add(actor.id); }
    moves.push({ id: unit.id, side: unit.side, fromX: from.x, fromY: from.y, toX: unit.x, toY: unit.y, retreat: true },
      { id: friend.id, side: friend.side, fromX: unit.x, fromY: unit.y, toX: from.x, toY: from.y, retreat: true });
  }
  const maxSteps = Math.max(0, ...plans.map(plan => plan.path.length));
  for (let step = 0; step < maxSteps; step++) {
    const occupied = new Set(units.map(positionKey));
    const winners = new Map();
    const contenders = plans.filter(p => !stopped.has(p.unit.id) && p.path[step])
      .sort((a, b) => (b.unit.moveWait || 0) - (a.unit.moveWait || 0)
        || movementPriority(a.unit.id, seed, tick) - movementPriority(b.unit.id, seed, tick)
        || a.unit.id.localeCompare(b.unit.id));
    for (const plan of contenders) {
      const { unit } = plan, next = plan.path[step], key = positionKey(next);
      const distance = Math.abs(unit.x - next.x) + Math.abs(unit.y - next.y);
      if (distance !== 1 || next.x < 0 || next.y < 0 || next.x >= size || next.y >= size || occupied.has(key) || winners.has(key)) {
        stopped.add(unit.id); continue;
      }
      winners.set(key, plan);
      plan.leavingZone = unit.status !== "routing" && isHostileZone(unit, unit, units);
      plan.enteringZone = unit.status !== "routing" && isHostileZone(next, unit, units);
    }
    for (const plan of winners.values()) {
      const { unit } = plan, next = plan.path[step];
      moves.push({ id: unit.id, side: unit.side, fromX: unit.x, fromY: unit.y,
        toX: next.x, toY: next.y, retreat: plan.kind !== "approach" });
      unit.x = next.x; unit.y = next.y; moved.add(unit.id);
      if (plan.leavingZone) plan.attackBlocked = true;
    }
    // 全員の座標を更新した後に判定し、同時に近づいた敵も拘束へ含める。
    for (const plan of winners.values()) {
      if (plan.unit.status !== "routing" && (plan.leavingZone || plan.enteringZone || isHostileZone(plan.unit, plan.unit, units))) {
        stopped.add(plan.unit.id); zocStopped.add(plan.unit.id);
      }
    }
  }
  for (const plan of plans) {
    plan.moved = moved.has(plan.unit.id);
    if (plan.moved) plan.unit.moveWait = 0;
    else if (plan.wantsMove) { plan.unit.moveWait = (plan.unit.moveWait || 0) + 1; stopped.add(plan.unit.id); }
    else plan.unit.moveWait = 0;
  }
  return { moves, blocked: [...stopped].filter(id => !zocStopped.has(id)).length, zocStops: zocStopped.size };
}
