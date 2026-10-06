import { state } from "../core/state.js";
import { quoteDetention, finishDetention } from "./detention.js";
import { CONTRABAND } from "../pirates/pirateConfig.js";
import { snapshotWorld, restoreWorld } from "../world/map.js";
import { advanceDayWithEvents } from "../app/time.js";
import { confirmAction, pushToast } from "../ui/dom.js";
import { saveGameToStorage } from "../core/storage.js";
import { showNextEvent } from "../app/events.js";
import { SEASONS } from "../core/util.js";

/** 保存済みの投獄を再開する。保存失敗時は操作をロックし、再試行だけを提供する。
 * @param {Function} refresh 表示更新。 @returns {void}
 */
export function resumeDetention(refresh) {
  if (!state.wanted?.detention) return;
  const dialog = document.createElement("dialog");
  dialog.className = "detention-dialog";
  dialog.addEventListener("cancel", event => event.preventDefault());
  const message = document.createElement("p"), retry = document.createElement("button");
  retry.className = "btn"; retry.textContent = "保存して投獄処理を再開";
  dialog.append(message, retry); document.body.append(dialog); dialog.showModal();
  /** @returns {void} 成功時だけ操作を解放する。 */
  function proceed() {
    retry.disabled = true;
    message.textContent = "投獄中の日数を進めています。";
    const success = finishDetention(state, { advance: advanceDayWithEvents, snapshotWorld, restoreWorld, save: saveGameToStorage });
    if (!success) {
      message.textContent = "保存できなかったため日数経過を取り消しました。保存容量を確保して再試行してください。再読み込みしても投獄は継続します。";
      retry.disabled = false;
      return;
    }
    dialog.close(); dialog.remove();
    pushToast("釈放", "投降先の勢力からの手配が解除されました。", "info");
    refresh(); showNextEvent();
  }
  retry.onclick = proceed;
  proceed();
}

/** 投降前に日数・没収・維持費の回数を確認し、没収済み状態を保存してから時間を進める。
 * @param {HTMLElement} card 表示先。 @param {object} settlement 拠点。 @param {Function} current 現在拠点取得。 @param {Function} refresh 表示更新。 @returns {void}
 */
export function appendSurrender(card, settlement, current, refresh) {
  const quote = quoteDetention(state, settlement.factionId);
  if (!quote) return;
  const button = document.createElement("button");
  button.className = "btn"; button.textContent = "投降して手配を解除";
  button.onclick = () => confirmAction({ title: "投降・投獄", body: "投降して刑期を終えると、投降先の勢力からの手配賞金が全額解除されます。", guideTopic: "guide-wanted",
    sections: [
      { title: "失うもの", items: ["禁制品をすべて没収", `${quote.days}日間の投獄（釈放予定：神歴${quote.year}年 ${SEASONS[quote.season]} ${quote.day}日）`] },
      { title: "投獄中の注意", items: [`維持費の支払い ${quote.upkeepCount}回`, "食料消費・依頼期限・世界情勢も進みます。", "投降による解除は、投降先の勢力の賞金だけが対象です。"] }
    ], onConfirm: () => {
    const updated = quoteDetention(state, settlement.factionId);
    if (current()?.id !== settlement.id || current()?.factionId !== settlement.factionId || state.eventQueue?.length || state.wanted?.detention || updated?.amount !== quote.amount || updated?.end !== quote.end) {
      pushToast("投降できません", "未解決のイベントを済ませ、現在の手配を確認してください。", "warn"); return;
    }
    const previous = structuredClone({ wanted: state.wanted, supplies: state.supplies });
    for (const item of CONTRABAND) if (state.supplies) delete state.supplies[item.id];
    state.wanted.detention = { factionId: settlement.factionId, remaining: quote.days };
    if (!saveGameToStorage()) {
      Object.assign(state, previous);
      pushToast("保存できません", "投降と没収は行っていません。", "warn"); return;
    }
    document.dispatchEvent(new CustomEvent("auto-move-stop"));
    resumeDetention(refresh);
  } });
  card.append(button);
}
