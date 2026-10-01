import { movementPriority } from "./battleMovement.js";
import { isBattleActive, isBattleOnBoard } from "./battleMorale.js";

/** 兵種ごとの標的方針。陣形判断と実際の攻撃で同じ優先順位を使う。 */
const UNIT_TARGET_MODE = Object.freeze({ pirate_shield: "hp", pirate_spear: "hp", pirate_archer: "rear",
  raider_cavalry: "hp", pirate_axe: "hp", pirate_assault: "hp", infantry: "hp", marine: "hp", shield: "hp",
  cavalry: "hp", cavalier: "hp", halberd: "hp", medic: "hp", scout: "hp", archer: "rear", crossbow: "rear", seaArcher: "rear" });

/** @param {object} a 座標。 @param {object} b 座標。 @returns {number} 四方向距離。 */
function distance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

/**
 * 作戦・兵種・標的保持・同点順位から標的を選ぶ。乱数列と部隊状態を変更せず、従来規則を維持する。
 * @param {object} unit 部隊。 @param {Array} enemies 候補。 @param {object} context 作戦・シード・tick・強さ計算。
 * @returns {object|null} 標的。
 */
export function selectBattleTarget(unit, enemies, { strategy, seed, tick, strength }) {
  const fighters = enemies.filter(isBattleActive);
  const alive = (fighters.length ? fighters : enemies.filter(isBattleOnBoard)).sort((a, b) =>
    movementPriority(a.id, seed, tick) - movementPriority(b.id, seed, tick));
  if (!alive.length) return null;
  const searchRange = unit.role === "ranged" ? 4 : 3;
  const mode = unit.side === "ally" && strategy.targetMode && strategy.targetMode !== "type"
    ? strategy.targetMode : UNIT_TARGET_MODE[unit.type] || "strong";
  /** HP・射撃役割・距離・強さの順序を作戦に合わせて比較する。
   * @param {string} selection 選択方式。 @param {Array} candidates 候補。 @returns {object|null} 標的。
   */
  function pick(selection, candidates) {
    if (!candidates.length) return null;
    if (selection === "rear") {
      const ranged = candidates.filter(enemy => enemy.role === "ranged");
      if (ranged.length) return ranged.reduce((best, cur) => cur.hp < (best?.hp ?? Infinity) ? cur : best, null);
      selection = "hp";
    }
    if (selection === "hp") return candidates.reduce((best, cur) => cur.hp < (best?.hp ?? Infinity) ? cur : best, null);
    if (selection === "close") return candidates.reduce((best, cur) => !best || distance(unit, cur) < distance(unit, best) ? cur : best, null);
    return candidates.reduce((best, cur) => !best || strength(cur) > strength(best) ? cur : best, null);
  }
  const current = alive.find(enemy => enemy.id === unit.targetId);
  const candidates = alive.filter(enemy => distance(unit, enemy) <= searchRange);
  const best = pick(mode, candidates) || pick("strong", candidates);
  if (current && distance(unit, current) <= searchRange) {
    if (!best) return current;
    if (mode === "hp" && best.hp < current.hp * 0.8) return best;
    if (mode === "rear" && best.role === "ranged" && current.role !== "ranged") return best;
    if (strength(best) < strength(current) * 1.5) return current;
  }
  return best || current || alive.reduce((nearest, cur) => !nearest || distance(unit, cur) < distance(unit, nearest) ? cur : nearest, null);
}
