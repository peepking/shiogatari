import { advanceDay as baseAdvanceDay, state } from "./state.js";
import { questTickDay } from "./quests.js";

/**
 * 日付更新と、それに連動するイベント処理を進める。
 * @param {number} [days=1]
 */
export function advanceDayWithEvents(days = 1) {
  baseAdvanceDay(days);
  // 日付進行に合わせて依頼の期限/季節更新を処理する。
  questTickDay(days);
}
