import { state } from "../core/state.js";
import { CONTRABAND } from "../pirates/pirateConfig.js";
import { CRIME_REWARDS } from "../bounty/bountyConfig.js";
import { JUDICIAL_CONFIG, quoteJudicialDeal, applyJudicialDeal } from "./judicialDeal.js";
import { FACTIONS } from "../world/lore.js";
import { confirmAction, pushToast } from "../ui/dom.js";
import { saveGameToStorage } from "../core/storage.js";

/** 港外でも利用できる司法取引。表示後の占領・資産変化を再確認し、保存失敗時は全変更を戻す。
 * @param {HTMLElement} card 表示先。 @param {Function} current 現地取得。 @param {Function} refresh 再表示。 @returns {void}
 */
export function appendJudicialDeal(card, current, refresh) {
  const place = current();
  if (!place || place.pirateHaven || !["north", "archipelago", "citadel"].includes(place.factionId)) return;
  const details = document.createElement("details"), summary = document.createElement("summary");
  summary.textContent = "司法取引";
  const select = document.createElement("select"); select.setAttribute("aria-label", "引き渡す禁制品");
  for (const item of CONTRABAND) {
    const option = document.createElement("option"); option.value = item.id; option.textContent = `${item.name}（所持${state.supplies?.[item.id] || 0}）`; select.append(option);
  }
  const note = document.createElement("p"); note.className = "tiny";
  const button = document.createElement("button"); button.className = "btn"; button.textContent = "司法取引を申し出る";
  /** 引渡品と現地の条件を更新する。 @returns {void} */
  function update() {
    const quote = quoteJudicialDeal(state, current(), select.value);
    note.textContent = quote.error || `禁制品${JUDICIAL_CONFIG.quantity}個を引き渡し、賞金 ${quote.amount} → ${quote.remaining}。黒ひげ好感度−${JUDICIAL_CONFIG.favorLoss}・海賊賞金＋${CRIME_REWARDS.judicial_deal}。再利用まで${JUDICIAL_CONFIG.cooldownDays}日。`;
    button.disabled = !!quote.error;
  }
  select.onchange = update;
  button.onclick = () => {
    const itemId = select.value, factionId = place.factionId, quote = quoteJudicialDeal(state, current(), itemId);
    if (quote.error) { update(); return; }
    const name = FACTIONS.find(f => f.id === factionId)?.name || factionId;
    const item = CONTRABAND.find(row => row.id === itemId);
    confirmAction({ title: "司法取引", body: `${item.name}${JUDICIAL_CONFIG.quantity}個を引き渡し、${name}の賞金を${quote.amount}から${quote.remaining}へ減らします。黒ひげの好感度−${JUDICIAL_CONFIG.favorLoss}、海賊の賞金＋${CRIME_REWARDS.judicial_deal}。海賊の最終犯罪日が今日になり、犯罪履歴に残ります。再利用まで${JUDICIAL_CONFIG.cooldownDays}日。拠点の利用禁止期間は変わりません。`, onConfirm: () => {
      const here = current();
      const previous = structuredClone({ supplies: state.supplies, wanted: state.wanted, nobleFavor: state.nobleFavor });
      if (here?.id !== place.id || here.factionId !== factionId || !applyJudicialDeal(state, here, itemId, quote.amount)) { pushToast("利用できません", "状態が変わりました。再確認してください。", "warn"); refresh(); return; }
      if (!saveGameToStorage()) { Object.assign(state, previous); pushToast("保存できません", "司法取引の変更を取り消しました。", "warn"); }
      else pushToast("司法取引が成立", `${name}の賞金が${quote.remaining}になりました。海賊の賞金と黒ひげの好感度も変化しました。`);
      refresh();
    } });
  };
  details.append(summary, select, note, button); card.append(details); update();
}
