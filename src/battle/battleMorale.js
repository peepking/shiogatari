/** 士気の初期調整値。堅固はtick低下上限を適用した後に軽減する。 */
export const MORALE_RULES = Object.freeze({ initial: 100, damage: 60, pressure: 3, shock: 6,
  shockCap: 12, lossCap: 20, recoverAfter: 3, recovery: 2, shaken: 35, rally: 45, rout: 15, attackRate: 0.9, steadfast: 0.8 });

/** @param {object} unit 部隊。 @returns {boolean} 戦闘可能か。 */
export function isBattleActive(unit) { return unit.hp > 0 && (!unit.status || unit.status === "active"); }

/** @param {object} unit 部隊。 @returns {boolean} 盤上にいるか。 */
export function isBattleOnBoard(unit) { return isBattleActive(unit) || (unit.hp > 0 && unit.status === "routing"); }

/** @param {object} a 座標。 @param {object} b 座標。 @returns {number} 四方向距離。 */
function distance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

/** @param {object} unit 部隊。 @returns {number} 人数の重み。 */
function weight(unit) { return Math.max(0, Math.min(1, (unit.count || 0) / 10)); }

/** 敵味方の近接人数と反対側からの挟撃を集計し、圧力を0〜3に制限する。
 * @param {object} unit 対象。 @param {Array} units 部隊。 @returns {number} 圧力。
 */
export function localPressure(unit, units) {
  const near = units.filter(other => isBattleActive(other) && !other.arriving && other.role === "melee" && distance(unit, other) === 1);
  const enemies = near.filter(other => other.side !== unit.side);
  const friendly = near.filter(other => other.side === unit.side).reduce((sum, other) => sum + weight(other), 0);
  const imbalance = Math.max(0, enemies.reduce((sum, other) => sum + weight(other), 0) - weight(unit) - friendly);
  const axis = (dx, dy) => weight(enemies.find(other => other.x === unit.x + dx && other.y === unit.y + dy) || {});
  const surround = Math.min(1, Math.min(axis(1, 0), axis(-1, 0)) + Math.min(axis(0, 1), axis(0, -1)));
  return Math.min(3, imbalance + surround);
}

/**
 * 士気を同じ盤面から一括計算する。撃破衝撃は当tick、敗走衝撃は次tickに1回だけ配る。
 * 敗走後の撃破では再度衝撃を発生させず、敗走部隊の士気を回復させない。
 * @param {object} state 戦場。 @param {Array} before tick開始時HP記録。 @returns {Array} 新たな敗走部隊。
 */
export function updateBattleMorale(state, before) {
  const shocks = [...(state.moraleShocks || [])];
  for (const unit of state.units) {
    if (unit.hp <= 0 && !unit.moraleShockSent && before.some(old => old.id === unit.id && old.hp > 0)) {
      shocks.push({ x: unit.x, y: unit.y, side: unit.side, count: unit.count });
      unit.moraleShockSent = true;
    }
  }
  const changes = state.units.filter(isBattleActive).map(unit => {
    const damage = Math.max(0, (before.find(old => old.id === unit.id)?.hp ?? unit.hp) - unit.hp);
    const pressure = localPressure(unit, state.units);
    const shock = Math.min(MORALE_RULES.shockCap, shocks.filter(event => event.side === unit.side && distance(unit, event) <= 2)
      .reduce((sum, event) => sum + MORALE_RULES.shock * weight(event), 0));
    const adjacentEnemy = state.units.some(enemy => isBattleOnBoard(enemy) && enemy.side !== unit.side && distance(unit, enemy) === 1);
    const safe = !damage && !adjacentEnemy ? (unit.safeTicks || 0) + 1 : 0;
    const loss = Math.min(MORALE_RULES.lossCap, damage / Math.max(1, unit.maxHp) * MORALE_RULES.damage + pressure * MORALE_RULES.pressure + shock)
      * (unit.traits?.includes("steadfast") ? MORALE_RULES.steadfast : 1);
    const morale = Math.max(0, Math.min(100, (unit.morale ?? MORALE_RULES.initial) - loss
      + (safe >= MORALE_RULES.recoverAfter && !loss ? MORALE_RULES.recovery : 0)));
    return { unit, morale, safe, pressure, loss };
  });
  state.moraleShocks = [];
  const routed = [];
  for (const { unit, morale, safe, pressure, loss } of changes) {
    unit.morale = morale; unit.safeTicks = safe; unit.pressure = pressure; unit.moraleLoss = loss;
    unit.shaken = morale <= MORALE_RULES.shaken || (unit.shaken && morale < MORALE_RULES.rally);
    if (morale <= MORALE_RULES.rout) {
      unit.status = "routing"; unit.moraleShockSent = true; routed.push(unit);
      state.moraleShocks.push({ x: unit.x, y: unit.y, side: unit.side, count: unit.count });
    }
  }
  return routed;
}
