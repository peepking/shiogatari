import { state } from "../core/state.js";
import { AMNESTY_CONFIG, amnestyReason, acceptAmnesty } from "./amnesty.js";
import { getQuests } from "../quests/quests.js";
import { confirmAction, pushToast } from "../ui/dom.js";
import { saveGameToStorage } from "../core/storage.js";
import { FACTIONS } from "../world/lore.js";

/** 港外の恩赦窓口。確認後の対象・季節を照合し、保存失敗なら受注枠も戻す。
 * @param {HTMLElement} card 表示先。 @param {Function} current 現地取得。 @param {Function} refresh 再表示。 @returns {void}
 */
export function appendAmnesty(card, current, refresh) {
  const settlement = current();
  if (!settlement) return;
  getQuests();
  const reason = amnestyReason(state, settlement);
  const button = document.createElement("button");
  button.className = "btn"; button.textContent = "恩赦依頼を受ける"; button.disabled = !!reason; button.title = reason;
  card.append(button);
  if (reason) { const note = document.createElement("p"); note.className = "tiny"; note.textContent = reason; card.append(note); }
  button.onclick = () => {
    const factionId = settlement.factionId, season = `${state.year}:${state.season}`;
    const faction = FACTIONS.find(f => f.id === factionId)?.name || factionId;
    confirmAction({ title: "恩赦依頼", body: `${settlement.name}へ食料を納め、手配賞金を減らす依頼です。`, guideTopic: "guide-wanted",
      sections: [
        { title: "納入する品と期限", items: [`食料 ${AMNESTY_CONFIG.food}個・受注から${AMNESTY_CONFIG.days}日以内`] },
        { title: "報酬", items: [`${faction}の賞金を最大${AMNESTY_CONFIG.reduction}減額`, "資金・名声の報酬はありません。拠点の利用禁止は解除されません。"] },
        { title: "報告方法", items: ["入港を拒否されていても、依頼カードから報告できます。"] }
      ], onConfirm: () => {
      const here = current();
      if (here?.id !== settlement.id || here.factionId !== factionId || season !== `${state.year}:${state.season}`) { pushToast("再確認してください", "拠点や季節が変わりました。", "warn"); return; }
      const previous = structuredClone({ quests: state.quests, wanted: state.wanted });
      if (!acceptAmnesty(state, here)) { pushToast("受注できません", amnestyReason(state, here), "warn"); return; }
      if (!saveGameToStorage()) { Object.assign(state, previous); pushToast("保存できません", "受注は取り消しました。", "warn"); }
      refresh();
    } });
  };
}
