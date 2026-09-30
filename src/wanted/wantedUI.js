import { state } from "../core/state.js";
import { canManageIdentity } from "./identityPolicy.js";
import { appendJudicialDeal } from "./judicialDealUI.js";
import { appendForgery } from "./forgeryUI.js";
import { appendAmnesty } from "./amnestyUI.js";
import { appendSurrender } from "./detentionUI.js";
import { calcSupplyPrice, calcSupplyCap, totalSupplies } from "../resources/supplies.js";
import { quoteEmergencyFood, buyEmergencyFood } from "./wantedFood.js";
import { MODE_LABEL } from "../core/constants.js";
import { getCurrentSettlement } from "../app/actions.js";
import { removeHonorFaction } from "../factions/faction.js";
import { FACTIONS } from "../world/lore.js";
import { absDay } from "../quests/questUtils.js";
import { confirmAction, pushToast } from "../ui/dom.js";
import { saveGameToStorage } from "../core/storage.js";
import { quoteWantedCompensation, compensateWanted, honorSuspensionReason, wantedFacilityReason, wantedEntryReason } from "./wantedPolicy.js";

/** 滞在中または入口にいる拠点でのみ手配対応を行う。 @returns {object|null} 現在拠点。 */
export function wantedSettlement() {
  return !state.pendingEncounter?.active && [MODE_LABEL.NORMAL, MODE_LABEL.IN_TOWN, MODE_LABEL.IN_VILLAGE].includes(state.modeLabel) ? getCurrentSettlement() : null;
}

/** 保存失敗時は決済・所属を戻し、二重払いを防ぐ。 @param {Function} change 変更。 @param {Function} refresh 再表示。 @returns {void} */
function commitWantedChange(change, refresh) {
  const previous = structuredClone({ funds: state.funds, supplies: state.supplies, wanted: state.wanted, honorFactions: state.honorFactions, playerFactionId: state.playerFactionId });
  if (!change()) { pushToast("変更できません", "状態が変わりました。一覧を確認してください。", "warn"); refresh(); return; }
  if (!saveGameToStorage()) {
    Object.assign(state, previous);
    pushToast("保存できません", "変更は行っていません。", "warn");
  }
  refresh();
}

/** 交渉窓口に現地勢力への手配対応を追加する。 @param {HTMLElement} card カード。 @param {Function} refresh 再表示。 @returns {void} */
export function appendWantedActions(card, refresh) {
  const settlement = wantedSettlement();
  if (!card || !settlement) return;
  const factionId = settlement.factionId;
  appendAmnesty(card, wantedSettlement, refresh);
  appendForgery(card, wantedSettlement, refresh);
  appendJudicialDeal(card, wantedSettlement, refresh);
  const pursuitDays = Math.max(0, (state.wanted?.pursuitUntil || 0) - absDay(state));
  if (pursuitDays) {
    const note = document.createElement("p");
    note.className = "tiny";
    note.textContent = `手配による再追跡まであと${pursuitDays}日。通常の遭遇・戦争中の遭遇は発生します。`;
    card.append(note);
  }
  appendSurrender(card, settlement, wantedSettlement, refresh);
  appendEmergencyFood(card, settlement, refresh);
  const restriction = wantedFacilityReason(state, settlement, "hire", absDay(state));
  if (restriction) {
    const note = document.createElement("p");
    note.className = "tiny";
    note.textContent = restriction;
    card.append(note);
  }
  const quote = quoteWantedCompensation(state, factionId, absDay(state));
  if (!quote.error) {
    const button = document.createElement("button");
    button.className = "btn";
    button.textContent = `賠償する（${quote.cost.toLocaleString()}資金）`;
    button.disabled = !quote.affordable;
    button.onclick = () => confirmAction({ title: "賠償による手配解除", body: `${quote.cost.toLocaleString()}資金を支払い、この拠点の勢力からの手配だけを解除します。犯罪履歴は残ります。`, onConfirm: () => commitWantedChange(() => wantedSettlement()?.factionId === factionId && compensateWanted(state, factionId, absDay(state), quote.amount), refresh) });
    card.append(button);
  }
}

/** 所属状態と場所に依存しない辞任を表示する。 @param {HTMLElement} card 表示先。 @param {Function} refresh 再表示。 @returns {void} */
export function appendIdentityActions(card, refresh) {
  if (!state.honorFactions?.length) {
    const note = document.createElement("p"); note.textContent = "現在、名誉家臣として所属する勢力はありません。"; card.append(note);
  }
  for (const id of state.honorFactions || []) {
    const affiliation = document.createElement("p");
    affiliation.textContent = `${FACTIONS.find(f => f.id === id)?.name || id}の名誉家臣`;
    card.append(affiliation);
    const reason = honorSuspensionReason(state, id, absDay(state));
    if (reason) {
      const note = document.createElement("p");
      note.className = "tiny";
      note.textContent = reason;
      card.append(note);
    }
    const button = document.createElement("button");
    button.className = "btn";
    const name = FACTIONS.find(f => f.id === id)?.name || id;
    button.textContent = `${name}の名誉家臣を辞する`;
    button.onclick = () => confirmAction({ title: "名誉家臣を辞する", body: `${name}の名誉家臣を辞します。好感度・支持度・賞金は変わりません。`, onConfirm: () => commitWantedChange(() => {
      if (!canManageIdentity(state) || !state.honorFactions?.includes(id)) return false;
      removeHonorFaction(id);
      return true;
    }, refresh) });
    card.append(button);
  }
}

/** 現地の通常買値と空き容量を取得する。 @param {object} settlement 拠点。 @returns {object} 購入条件。 */
function foodContext(settlement) {
  return { price: calcSupplyPrice("food", settlement.demand?.food ?? 10, { factionId: settlement.factionId, settlementId: settlement.id, mode: "buy" }), space: calcSupplyCap(state.fleet) - totalSupplies(state.supplies) };
}

/** 手配中の拠点で食料だけを買える窓口。数量はタップで選択できる。
 * @param {HTMLElement} card 表示先。 @param {object} settlement 拠点。 @param {Function} refresh 再表示。 @returns {void}
 */
function appendEmergencyFood(card, settlement, refresh) {
  if (!wantedFacilityReason(state, settlement, "trade", absDay(state)) && !wantedEntryReason(state, settlement, absDay(state))) return;
  const context = foodContext(settlement);
  const quote = quoteEmergencyFood(state, settlement, context.price, context.space);
  const note = document.createElement("p");
  note.textContent = `最低限の食料：1個 ${quote.unitPrice}資金（通常買値の1.5倍・切り上げ）。今季残り${quote.remaining}個。`;
  const select = document.createElement("select");
  select.setAttribute("aria-label", "食料の購入数");
  for (let n = 1; n <= quote.max; n++) {
    const option = document.createElement("option");
    option.value = String(n); option.textContent = `${n}個 / ${n * quote.unitPrice}資金`; select.append(option);
  }
  select.disabled = !quote.max;
  const button = document.createElement("button");
  button.className = "btn"; button.textContent = "食料を購入"; button.disabled = !quote.max;
  button.onclick = () => {
    const qty = Number(select.value);
    confirmAction({ title: "最低限の食料購入", body: `${qty}個を${qty * quote.unitPrice}資金で購入します。`, onConfirm: () => commitWantedChange(() => {
      const here = wantedSettlement();
      if (here?.id !== settlement.id || (!wantedFacilityReason(state, here, "trade", absDay(state)) && !wantedEntryReason(state, here, absDay(state)))) return false;
      const current = foodContext(here);
      return buyEmergencyFood(state, here, current.price, current.space, qty, quote.unitPrice);
    }, refresh) });
  };
  card.append(note, select, button);
}
