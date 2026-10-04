import { state } from "../core/state.js";
import { absDay } from "../core/calendar.js";
import { getDangerousSeaPositions } from "./dangerousSeaWorld.js";
import { createDangerousSeaState } from "./dangerousSeaState.js";
import { worldReservedPositions } from "./dangerousSeaReservations.js";
import { initializeDangerousExploration, tickDangerousExploration } from "./dangerousSeaExploration.js";

/**
 * 世界の生成・復元後に専用探索を初期配置し、日付を進めた時だけ海域ごとの枠を補充する。
 * @param {boolean} [tick=false] 日次抽選を行うか。 @returns {void}
 */
export function updateDangerousExplorationWorld(tick = false) {
  const current = state.dangerousSeas ||= createDangerousSeaState();
  const positions = { sw: getDangerousSeaPositions("sw"), se: getDangerousSeaPositions("se") };
  const now = absDay(state), blocked = worldReservedPositions(state);
  initializeDangerousExploration(current, positions, now, blocked);
  if (tick) tickDangerousExploration(current, positions, now, blocked);
}
