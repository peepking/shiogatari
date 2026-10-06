import { state } from "../core/state.js";
import { FACTIONS } from "../world/lore.js";
import { FORGERY_CONFIG, quoteForgery, applyForgery } from "./forgery.js";
import { confirmAction, pushToast } from "../ui/dom.js";
import { saveGameToStorage } from "../core/storage.js";

/** 無法港の窓口で対象勢力を選ぶ。確定時に再検証し、保存できなければ決済も戻す。
 * @param {HTMLElement} card 表示先。 @param {Function} current 現地取得。 @param {Function} refresh 再表示。 @returns {void}
 */
export function appendForgery(card, current, refresh) {
  const port = current();
  if (!port?.pirateHaven) return;
  const details = document.createElement("details");
  const summary = document.createElement("summary"); summary.textContent = "身分偽造";
  const select = document.createElement("select"); select.setAttribute("aria-label", "身分偽造で賞金を減らす勢力");
  for (const id of ["north", "archipelago", "citadel"]) {
    const option = document.createElement("option"); option.value = id; option.textContent = FACTIONS.find(f => f.id === id)?.name || id; select.append(option);
  }
  const note = document.createElement("p"); note.className = "tiny";
  const button = document.createElement("button"); button.className = "btn"; button.textContent = "身分偽造を依頼";
  /** 選択中の勢力の費用と利用条件を更新する。 @returns {void} */
  function update() {
    const quote = quoteForgery(state, current(), select.value);
    note.textContent = quote.error || `賞金 ${quote.amount.toLocaleString()} → ${quote.remaining.toLocaleString()}・費用 ${quote.cost.toLocaleString()}資金。再利用まで${FORGERY_CONFIG.cooldownDays}日。${quote.affordable ? "" : "資金が不足しています。"}`;
    button.disabled = !!quote.error || !quote.affordable;
  }
  select.onchange = update;
  button.onclick = () => {
    const id = select.value, quote = quoteForgery(state, current(), id);
    if (quote.error || !quote.affordable) { update(); return; }
    const name = FACTIONS.find(f => f.id === id)?.name || id;
    confirmAction({ title: "身分偽造", body: `${name}からの手配賞金を減らします。`, guideTopic: "guide-wanted",
      sections: [
        { title: "費用と効果", items: [`費用 ${quote.cost.toLocaleString()}資金`, `賞金 ${quote.amount.toLocaleString()} → ${quote.remaining.toLocaleString()}（必ず成功）`] },
        { title: "利用条件", items: [`次の利用まで${FORGERY_CONFIG.cooldownDays}日`, "拠点の利用禁止は解除されません。"] }
      ], onConfirm: () => {
      const previous = structuredClone({ funds: state.funds, wanted: state.wanted });
      if (current()?.id !== port.id || !applyForgery(state, current(), id, quote.amount, quote.cost)) { pushToast("利用できません", "状態が変わりました。再確認してください。", "warn"); refresh(); return; }
      if (!saveGameToStorage()) { Object.assign(state, previous); pushToast("保存できません", "支払いと賞金の変更を取り消しました。", "warn"); }
      else pushToast("身分偽造", `${name}の賞金が${quote.remaining.toLocaleString()}になりました。`);
      refresh();
    } });
  };
  details.append(summary, select, note, button); card.append(details); update();
}
