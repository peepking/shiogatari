import { movementPriority } from "./battleMovement.js";
import { isBattleActive, isBattleOnBoard } from "./battleMorale.js";
import { tacticalArea, TACTICAL_ORDER_RULES } from "./battleTacticalOrders.js";

/** 兵種ごとの標的方針。陣形判断と実際の攻撃で同じ優先順位を使う。 */
const UNIT_TARGET_MODE = Object.freeze({ pirate_shield: "hp", pirate_spear: "hp", pirate_archer: "rear",
  raider_cavalry: "hp", pirate_axe: "hp", pirate_assault: "hp", infantry: "hp", marine: "hp", shield: "hp",
  cavalry: "hp", cavalier: "hp", halberd: "hp", medic: "hp", scout: "hp", archer: "rear", crossbow: "rear", seaArcher: "rear" });

/** @param {object} a 座標。 @param {object} b 座標。 @returns {number} 四方向距離。 */
function distance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

/**
 * 部隊指示・区域・標的保持から標的を選ぶ。仮評価でも乱数列や部隊状態を変更しない。
 * @param {object} unit 部隊。 @param {Array} enemies 候補。 @param {object} context 作戦・シード・tick・強さ計算。
 * @returns {object|null} 標的。
 */
export function selectBattleTarget(unit, enemies, { strategy, seed, tick, strength, size = 10, reachable = null }) {
  const fighters = enemies.filter(isBattleActive);
  const alive = (fighters.length ? fighters : enemies.filter(isBattleOnBoard)).sort((a, b) =>
    movementPriority(a.id, seed, tick) - movementPriority(b.id, seed, tick) || a.id.localeCompare(b.id));
  if (!alive.length) return null;
  const searchRange = unit.role === "ranged" ? 4 : 3;
  const mode = unit.tacticalTargetMode || (unit.side === "ally" && strategy?.targetMode && strategy.targetMode !== "type"
    ? strategy.targetMode : UNIT_TARGET_MODE[unit.type] || "strong");
  /** HP・射撃役割・距離・強さの順序を作戦に合わせて比較する。
   * @param {string} selection 選択方式。 @param {Array} candidates 候補。 @returns {object|null} 標的。
   */
  function pick(selection, candidates) {
    if (!candidates.length) return null;
    if (selection === "rear") {
      const ranged = candidates.filter(enemy => enemy.role === "ranged");
      if (ranged.length) return pick("hp", ranged);
      selection = "hp";
    }
    if (selection === "hp") return candidates.reduce((best, cur) => !best || cur.hp < best.hp
      || (cur.hp === best.hp && distance(unit, cur) < distance(unit, best)) ? cur : best, null);
    if (selection === "close") return candidates.reduce((best, cur) => !best || distance(unit, cur) < distance(unit, best) ? cur : best, null);
    return candidates.reduce((best, cur) => !best || strength(cur) > strength(best)
      || (strength(cur) === strength(best) && distance(unit, cur) < distance(unit, best)) ? cur : best, null);
  }
  const focus = alive.find(enemy => enemy.id === unit.focusEnemyId && unit.targetOrder === "focus" && isBattleActive(enemy));
  if (focus && (!reachable || distance(unit, focus) <= unit.range || reachable(focus))) return focus;
  const local = alive.filter(enemy => distance(unit, enemy) <= Math.max(searchRange, unit.range));
  let pool = local.length ? local : alive;
  const self = mode === "selfDefense" ? pool.filter(enemy => enemy.role === "melee" && distance(unit, enemy) === 1) : [];
  const area = unit.tacticalTargetArea || "all";
  const inArea = pool.filter(enemy => tacticalArea(enemy.y, size) === area);
  if (self.length) pool = self;
  else if (inArea.length) pool = inArea;
  const preferred = mode === "antiCavalry" ? pool.filter(enemy => enemy.traits?.includes("mounted"))
    : mode === "opportunity" ? pool.filter(enemy => enemy.hp / Math.max(1, enemy.maxHp) <= TACTICAL_ORDER_RULES.opportunityHp
      || enemy.morale <= TACTICAL_ORDER_RULES.opportunityMorale) : [];
  if (preferred.length) pool = preferred;
  const selection = ["selfDefense", "opportunity"].includes(mode) ? "hp" : mode === "antiCavalry" ? "close" : mode;
  const current = pool.find(enemy => enemy.id === unit.targetId);
  if (current && unit.switchLock > 0 && (!reachable || distance(unit, current) <= unit.range || reachable(current))) return current;
  /** @param {Array} candidates 標的候補。 @param {string} policy 方針。 @returns {object|null} 到達可能な優先標的。 */
  function accessible(candidates, policy) {
    const remaining = [...candidates];
    while (remaining.length) {
      const best = pick(policy, remaining);
      if (!reachable || distance(unit, best) <= unit.range || reachable(best)) return best;
      remaining.splice(remaining.indexOf(best), 1);
    }
    return null;
  }
  return accessible(pool, local.length ? selection : "close")
    || accessible(alive.filter(enemy => !pool.includes(enemy)), "close");
}
