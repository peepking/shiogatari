import { quantityControl, wireQuantityControls, refreshQuantity } from "./quantityUI.js";
import { getCurrentSettlement } from "./actions.js";
import { elements, pushLog, pushToast, setInlineMessage } from "./dom.js";
import { adjustSupport } from "./faction.js";
import { sellCatch } from "./fishing.js";
import { state } from "./state.js";
import { SUPPLY_ITEMS, calcSupplyCap, calcSupplyPrice, totalSupplies } from "./supplies.js";
import { resourceIcon } from "./resourceUI.js";


/**
 * 物資取引モーダルのエラー表示を更新する。
 * @param {string} msg
 */
function setTradeError(msg) {
  setInlineMessage(elements.tradeError, msg);
}


/**
 * イベント取引モーダルのエラー表示を更新する。
 * @param {string} msg
 */
function setEventTradeError(msg) {
  setInlineMessage(elements.eventTradeError, msg);
}

/**
 * 物資取引の一覧を描画する。
 */
export function renderTradeSelects() {
  const settlement = getCurrentSettlement();
  if (!settlement || !elements.tradeTableBody) return;
  const demand = settlement.demand || {};
  const stock = settlement.stock || {};
  const rows = SUPPLY_ITEMS.map((i) => {
    const price = calcSupplyPrice(i.id, demand[i.id] ?? 10, {
      factionId: settlement.factionId,
      settlementId: settlement.id,
      mode: "buy",
    }) ?? 0;
    const basePrice = calcSupplyPrice(i.id, demand[i.id] ?? 10, {
      factionId: settlement.factionId,
      settlementId: settlement.id,
      mode: "reference", // 支持度と手数料を含まない比較価格
    }) ?? price;
    const discountPct = basePrice > 0 ? Math.max(0, Math.round((1 - price / basePrice) * 100)) : 0;
    const townQty = stock[i.id] ?? 0;
    const haveQty = state.supplies?.[i.id] ?? 0;
    return {
      id: i.id,
      name: i.name,
      price,
      basePrice,
      discountPct,
      townQty,
      haveQty,
    };
  })
    // 街/村の在庫または手持ちがある物資のみ表示する。
    .filter((r) => r.townQty > 0 || r.haveQty > 0);
  elements.tradeTableBody.innerHTML = rows
    .map(
      (r) => `
        <tr>
          <td class="ta-center">${resourceIcon(r.id)}</td>
          <td>${r.name}${r.discountPct > 0 ? `<span class="pill off-pill">買値${r.discountPct}%OFF</span>` : ""}</td>
          <td class="ta-center">買 ${r.price}<br>売 ${calcSupplyPrice(r.id, demand[r.id] ?? 10, { factionId: settlement.factionId, settlementId: settlement.id, mode: "sell" })}</td>
          <td class="ta-center">${r.townQty}</td>
          <td class="ta-center">${r.haveQty}</td>
          <td class="ta-center">${quantityControl(`<input type="number" min="${-r.haveQty}" max="${r.townQty}" step="1" value="0" aria-label="${r.name}の取引数量" data-id="${r.id}" class="trade-quantity">`, true)}</td>
        </tr>`
    )
    .join("");
  const deltaEl = elements.tradeDelta;
  if (deltaEl) {
    deltaEl.hidden = rows.length === 0;
    deltaEl.textContent = "資金変動: 0";
    deltaEl.className = "pill delta-zero";
    deltaEl.title = "買値のみ支持度補正・売値は手数料10%控除後";
  }
  setTradeError("");
  if (elements.tradeFunds) elements.tradeFunds.textContent = String(state.funds);
  recalcTradeDelta();
}

/** 現在の在庫と単価で予定数量を集計し、全品目の取引後条件を検証する。 */
function collectTrade(eventTrade = false) {
  const settlement = eventTrade ? null : getCurrentSettlement();
  const root = eventTrade ? elements.eventTradeTableBody : elements.tradeTableBody;
  const buys = {}, sells = {};
  let fundsDelta = 0, quantityDelta = 0, baitDelta = 0, error = "";
  const isBaitTrade = getEventTradeSource() === "bait";
  root?.querySelectorAll('input').forEach(input => {
    refreshQuantity(input);
    const id = input.dataset.id;
    const value = Number(input.value);
    if (!input.value || !Number.isSafeInteger(value) || input.validity.badInput) {
      error = "数量は整数で入力してください。";
      return;
    }
    const deal = currentEventTrade?.deals?.find(item => item.id === id);
    const dir = eventTrade ? deal?.direction ?? "buy" : "buy";
    const stock = eventTrade ? (dir === "sell" ? deal?.have ?? 0 : deal?.stock ?? 0) : settlement?.stock?.[id] ?? 0;
    const have = eventTrade ? 0 : state.supplies?.[id] ?? 0;
    if (value > stock || value < -have) {
      error = "在庫・所持数の範囲で入力してください。";
      return;
    }
    if (!value) return;
    const price = eventTrade ? deal.price : calcSupplyPrice(id, settlement.demand?.[id] ?? 10, {
      factionId: settlement.factionId, settlementId: settlement.id, mode: value > 0 ? "buy" : "sell",
    });
    if (dir === "sell") sells[id] = value;
    else if (value > 0) buys[id] = value;
    else sells[id] = -value;
    fundsDelta += dir === "sell" ? value * price : -value * price;
    if (dir !== "sell") {
      if (isBaitTrade) baitDelta += value;
      else quantityDelta += value;
    }
  });
  const after = totalSupplies(state.supplies) + quantityDelta;
  const cap = calcSupplyCap(state.fleet);
  const shortages = [];
  if (state.funds + fundsDelta < 0) shortages.push(`資金が${-(state.funds + fundsDelta)}不足しています。`);
  if (!isBaitTrade && after > cap) shortages.push(`物資上限を${after - cap}個超えています。`);
  error ||= shortages.join(" ");
  return { buys, sells, fundsDelta, after, cap, error, empty: !Object.keys(buys).length && !Object.keys(sells).length, isBaitTrade, baitDelta };
}

/** 既存の資金・エラー表示を更新し、取引後の積載と確定可否を表示する。 */
function updateTradePreview(eventTrade = false) {
  const result = collectTrade(eventTrade);
  const delta = eventTrade ? elements.eventTradeDelta : elements.tradeDelta;
  const button = eventTrade ? elements.eventTradeConfirm : elements.tradeConfirm;
  const setError = eventTrade ? setEventTradeError : setTradeError;
  setError(result.error);
  if (button) button.disabled = !!result.error || result.empty;
  if (delta) {
    delta.hidden = false;
    if (result.isBaitTrade) {
      delta.textContent = `資金変動: ${result.fundsDelta > 0 ? "+" : ""}${result.fundsDelta} ／ 餌購入: +${result.baitDelta}個`;
    } else {
      delta.textContent = `資金変動: ${result.fundsDelta > 0 ? "+" : ""}${result.fundsDelta} ／ 取引後物資: ${result.after}/${result.cap}`;
    }
    delta.className = "pill " + (result.fundsDelta > 0 ? "delta-pos" : result.fundsDelta < 0 ? "delta-neg" : "delta-zero");
  }
  return result;
}

/** 拠点取引の予告を更新する。 */
function recalcTradeDelta() { return updateTradePreview(); }

/** イベント取引の予告を更新する。 */
function recalcEventTradeDelta() { return updateTradePreview(true); }

let currentEventTrade = null;

/**
 * 現在のイベント取引の種別を取得する（DOMから）。
 * @returns {"bait"|"fishing"|"smuggle"|""}
 */
function getEventTradeSource() {
  return elements.eventTradeModal?.dataset.tradeSource || "";
}

/**
 * イベント取引モーダルを閉じ、状態をリセットする。
 */
function closeEventTradeModal() {
  if (elements.eventTradeModal) {
    elements.eventTradeModal.dataset.tradeSource = "";
  }
  currentEventTrade = null;
  state.eventTrade = null;
}

/**
 * イベント取引用のモーダルを描画する。
 * @param {{title:string,note?:string,deals:Array<{id:string,name:string,price:number,stock:number}>}} trade
 */
export function renderEventTradeModal(trade) {
  currentEventTrade = trade;
  if (elements.eventTradeModal) {
    elements.eventTradeModal.dataset.tradeSource = trade?.source || "";
  }
  const body = elements.eventTradeTableBody;
  if (!body) return;
  const hasSell = (trade?.deals || []).some((d) => d.direction === "sell");
  body.innerHTML = (trade?.deals || [])
    .map(
      (d) => {
        const sell = d.direction === "sell";
        const max = sell ? d.have ?? 0 : d.stock ?? 0;
        return `
        <tr${sell ? ' data-direction="sell"' : ""}>
          <td class="ta-center">${resourceIcon(d.id)}</td>
          <td>${d.name}</td>
          <td class="ta-center">${sell ? "売" : "買"} ${d.price}</td>
          <td class="ta-center">${sell ? d.have ?? 0 : d.stock ?? 0}</td>
          <td class="ta-center">
            ${quantityControl(`<input type="number" min="0" max="${max}" step="1" value="0" aria-label="${d.name}の${sell ? "売却" : "購入"}数量" data-id="${d.id}" class="event-trade-buy">`, true)}
          </td>
        </tr>`;
      }
    )
    .join("");
  const stockHead = document.getElementById("eventTradeStockHead");
  const buyHead = document.getElementById("eventTradeBuyHead");
  if (stockHead) stockHead.textContent = hasSell ? "所持" : "在庫";
  if (buyHead) buyHead.textContent = hasSell ? "売却" : "購入";
  if (elements.eventTradeTitle) elements.eventTradeTitle.textContent = trade?.title || "取引";
  if (elements.eventTradeNote) {
    elements.eventTradeNote.textContent = trade?.note || "";
    elements.eventTradeNote.hidden = !trade?.note;
  }
  if (elements.eventTradeSellAll) elements.eventTradeSellAll.hidden = !hasSell;
  if (elements.eventTradeFunds) elements.eventTradeFunds.textContent = String(state.funds);
  if (elements.eventTradeDelta) {
    elements.eventTradeDelta.hidden = false;
    elements.eventTradeDelta.textContent = "資金変動: 0";
    elements.eventTradeDelta.className = "pill delta-zero";
  }
  recalcEventTradeDelta();
}

/**
 * イベント取引を確定する。
 * @param {Function} closeModal
 * @param {Function} syncUI
 */
function confirmEventTrade(closeModal, syncUI) {
  if (!currentEventTrade?.deals?.length) {
    closeModal?.(elements.eventTradeModal);
    state.eventTrade = null;
    return;
  }
  const { buys, sells, fundsDelta, error, empty } = recalcEventTradeDelta();
  if (error || empty) return;
  if (!state.supplies) state.supplies = {};
  const isBait = getEventTradeSource() === "bait";
  Object.entries(buys).forEach(([id, qty]) => {
    if (isBait) {
      const data = state.expansion.fishing;
      data.bait[id] = (data.bait[id] || 0) + qty;
    } else {
      state.supplies[id] = (state.supplies[id] || 0) + qty;
    }
  });
  Object.entries(sells).forEach(([id, qty]) => {
    const deal = currentEventTrade?.deals?.find((item) => item.id === id);
    if (deal?.direction === "sell") {
      if (getEventTradeSource() === "fishing") sellCatch(state, id, qty);
      else state.supplies[id] = Math.max(0, (state.supplies[id] ?? 0) - qty);
    }
  });
  state.funds += fundsDelta;
  if (getEventTradeSource() === "smuggle") {
    const sid = currentEventTrade?.settlementId;
    const fid = currentEventTrade?.factionId;
    if (sid && fid) adjustSupport(sid, fid, -2);
  }
  const dealName = (id) =>
    currentEventTrade?.deals?.find((d) => d.id === id)?.name ??
    SUPPLY_ITEMS.find((i) => i.id === id)?.name ??
    id;
  const buySummary = Object.entries(buys).map(([id, q]) => `${dealName(id)} x${q}`).join(" / ");
  const sellSummary = Object.entries(sells).map(([id, q]) => `${dealName(id)} x${q}`).join(" / ");
  pushLog(currentEventTrade.title || "取引", `資金${fundsDelta} / 入手: ${buySummary || "なし"} / 売却: ${sellSummary || "なし"}`, "-");
  pushToast(currentEventTrade.title || "取引", `資金${fundsDelta}`, fundsDelta <= 0 ? "info" : "good");
  if ((getEventTradeSource() === "fishing" || isBait) && typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("fishing-panel-update"));
  }
  closeEventTradeModal();
  closeModal?.(elements.eventTradeModal);
  setEventTradeError("");
  recalcEventTradeDelta();
  syncUI?.();
}



/**
 * 物資/船取引モーダルのイベントを設定する。
 * @param {{openModal:Function,closeModal:Function,bindModal:Function,syncUI:Function,clearActionMessage:Function}} param0
 */
export function wireMarketModals({ openModal, closeModal, bindModal, syncUI, clearActionMessage }) {
  bindModal?.(elements.tradeModal, elements.tradeModalClose);
  bindModal?.(elements.eventTradeModal, elements.eventTradeModalClose);
  // イベント取引モーダル専用の閉じる処理（dataset.tradeSource もリセット）
  elements.eventTradeModalClose?.addEventListener("click", closeEventTradeModal);
  elements.eventTradeModal?.addEventListener("click", (e) => {
    if (e.target === elements.eventTradeModal) closeEventTradeModal();
  });

  elements.tradeBtn?.addEventListener("click", () => {
    renderTradeSelects();
    openModal?.(elements.tradeModal);
  });

  wireQuantityControls(elements.tradeTableBody);
  wireQuantityControls(elements.eventTradeTableBody);
  elements.tradeTableBody?.addEventListener("input", recalcTradeDelta);

  elements.tradeConfirm?.addEventListener("click", () => {
    const settlement = getCurrentSettlement();
    if (!settlement) return;
    const { buys, sells, fundsDelta, error, empty } = recalcTradeDelta();
    if (error || empty) return;
    const allIds = new Set([...Object.keys(buys), ...Object.keys(sells)]);
    for (const id of allIds) {
      const buy = buys[id] ?? 0;
      const sell = sells[id] ?? 0;
      settlement.stock[id] = (settlement.stock?.[id] ?? 0) - buy + sell;
      state.supplies[id] = Math.max(0, (state.supplies[id] ?? 0) + buy - sell);
    }
    state.funds += fundsDelta;
    if (elements.tradeFunds) elements.tradeFunds.textContent = String(state.funds);
    const buySummary = Object.entries(buys)
      .map(([id, q]) => `${SUPPLY_ITEMS.find((i) => i.id === id)?.name ?? id} x${q}`)
      .join(" / ");
    const sellSummary = Object.entries(sells)
      .map(([id, q]) => `${SUPPLY_ITEMS.find((i) => i.id === id)?.name ?? id} x${q}`)
      .join(" / ");
    pushLog(
      "取引",
      `購入: ${buySummary || "なし"} / 売却: ${sellSummary || "なし"} / 資金変動: ${fundsDelta}`,
      "-"
    );
    closeModal?.(elements.tradeModal);
    clearActionMessage?.();
    setTradeError("");
    syncUI?.();
  });


  elements.eventTradeTableBody?.addEventListener("input", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("event-trade-buy")) return;
    recalcEventTradeDelta();
  });

  elements.eventTradeSellAll?.addEventListener("click", () => {
    elements.eventTradeTableBody?.querySelectorAll("input.event-trade-buy").forEach((input) => {
      const deal = currentEventTrade?.deals?.find((d) => d.id === input.dataset.id);
      if (deal?.direction === "sell") input.value = input.max || "0";
    });
    recalcEventTradeDelta();
  });

  elements.eventTradeConfirm?.addEventListener("click", () => {
    confirmEventTrade(closeModal, syncUI);
  });
}

/**
 * イベント取引を開く（state.eventTradeを参照）。
 * @param {Function} openModal
 * @returns {void}
 */
export function openEventTrade(openModal) {
  if (!state.eventTrade || !state.eventTrade.deals?.length) return;
  renderEventTradeModal(state.eventTrade);
  openModal?.(elements.eventTradeModal);
}
