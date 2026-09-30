import { isBattleActive, isBattleOnBoard } from "./battleMorale.js";
import { isHostileZone } from "./battleMovement.js";

/** 通常戦には適用せず、大会戦の投入数・上限・制限時間をここで調整する。 */
export const REINFORCEMENT_RULES = Object.freeze({ onBoardLimit: 20, reserveLimit: 10,
  perTick: 2, blockedTicks: 3, maxTicks: 60, enemyRatio: 0.5 });

/** @param {object} state 戦場。 @param {string} side 陣営。 @returns {boolean} 継戦可能か。 */
export function canSideContinue(state, side) {
  if (state.units.some(unit => unit.side === side && isBattleActive(unit))) return true;
  return state.battleKind === "grand" && (state.entryBlockedTicks?.[side] || 0) < REINFORCEMENT_RULES.blockedTicks
    && state.units.some(unit => unit.side === side && unit.status === "reserve" && unit.hp > 0);
}

/**
 * 各tick開始時に後端中央寄りの空きマスへ、編成順に最大2部隊を投入する。
 * 両軍とも投入前のZoCで評価し、登場tickは被攻撃対象になるが行動・拘束・支援しない。
 * 戦闘可能部隊がなく全入口が敵に封鎖された場合だけ連続失敗を数える。味方の渋滞は数えない。
 * @param {object} state 戦場。 @returns {Array} 今回投入した部隊。
 */
export function deployReinforcements(state) {
  for (const unit of state.units) if (unit.arriving) unit.arriving = false;
  if (state.battleKind !== "grand") return [];
  state.entryBlockedTicks ||= { ally: 0, enemy: 0 };
  const board = state.units.filter(isBattleOnBoard);
  const occupied = new Map(board.map(unit => [`${unit.x},${unit.y}`, unit]));
  const arrivals = [];
  for (const side of ["ally", "enemy"]) {
    const queue = state.units.filter(unit => unit.side === side && unit.status === "reserve" && unit.hp > 0);
    const room = REINFORCEMENT_RULES.onBoardLimit - board.filter(unit => unit.side === side).length;
    const entrances = Array.from({ length: state.size }, (_, y) => ({ x: side === "ally" ? 0 : state.size - 1, y }))
      .sort((a, b) => Math.abs(a.y - (state.size - 1) / 2) - Math.abs(b.y - (state.size - 1) / 2) || a.y - b.y);
    const probe = { side };
    const free = entrances.filter(point => !occupied.has(`${point.x},${point.y}`) && !isHostileZone(point, probe, board));
    const sealed = entrances.every(point => {
      const occupant = occupied.get(`${point.x},${point.y}`);
      return occupant ? occupant.side !== side : isHostileZone(point, probe, board);
    });
    const count = Math.max(0, Math.min(room, queue.length, free.length, REINFORCEMENT_RULES.perTick));
    for (let index = 0; index < count; index++) {
      const unit = queue[index], point = free[index];
      unit.x = point.x; unit.y = point.y; unit.status = "active";
      unit.deployedAt = state.tick; unit.arriving = true;
      occupied.set(`${point.x},${point.y}`, unit);
      arrivals.push(unit);
    }
    const fighting = state.units.some(unit => unit.side === side && isBattleActive(unit));
    state.entryBlockedTicks[side] = !fighting && queue.length && sealed
      ? (state.entryBlockedTicks[side] || 0) + 1 : 0;
  }
  return arrivals;
}
