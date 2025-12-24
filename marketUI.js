import { elements, setOutput, pushLog, confirmAction } from "./dom.js";
import { state } from "./state.js";
import { MODE_LABEL } from "./constants.js";
import { SUPPLY_ITEMS, calcSupplyPrice, calcSupplyCap, totalSupplies } from "./supplies.js";
import { getCurrentSettlement } from "./actions.js";

// 船の単価は固定（1隻=5000資金）。
const SHIP_PRICE = 5000;
const SUPPLY_ICONS = {
  food: "\u{1F35E}",
  wood: "\u{1FAB5}",
  stone: "\u{1FAA8}",
  iron: "\u26CF\uFE0F",
  fiber: "\u{1F9F6}",
  salt: "\u{1F9C2}",
  spice: "\u{1F336}\uFE0F",
  arms: "\u{1F6E1}\uFE0F",
  textile: "\u{1F458}",
  brew: "\u{1F376}",
  leather: "\u{1F45E}",
};

/**
 * モーダル内のエラーメッセージ表示を更新する。
 * @param {HTMLElement|null} el
 * @param {string} msg
 */
function setInlineMessage(el, msg) {
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.textContent = msg;
  el.hidden = false;
}

/**
 * 物資取引モーダルのエラー表示を更新する。
 * @param {string} msg
 */
function setTradeError(msg) {
  setInlineMessage(elements.tradeError, msg);
}

/**
 * 船取引モーダルのエラー表示を更新する。
 * @param {string} msg
 */
function setShipTradeError(msg) {
  setInlineMessage(elements.shipTradeError, msg);
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
    const townQty = stock[i.id] ?? 0;
    const haveQty = state.supplies?.[i.id] ?? 0;
    return {
      id: i.id,
      name: i.name,
      price,
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
          <td class="ta-center">${SUPPLY_ICONS[r.id] || "・"}</td>
          <td>${r.name}</td>
          <td class="ta-center">${r.price}</td>
          <td class="ta-center">${r.townQty}</td>
          <td class="ta-center">${r.haveQty}</td>
          <td class="ta-center"><input type="number" min="0" value="0" data-id="${r.id}" data-stock="${r.townQty}" data-have="${r.haveQty}" class="trade-buy input-70"></td>
          <td class="ta-center"><input type="number" min="0" value="0" data-id="${r.id}" data-stock="${r.townQty}" data-have="${r.haveQty}" class="trade-sell input-70"></td>
        </tr>`
    )
    .join("");
  const deltaEl = elements.tradeDelta;
  if (deltaEl) {
    deltaEl.hidden = rows.length === 0;
    deltaEl.textContent = "資金変動: 0";
    deltaEl.className = "pill delta-zero";
    deltaEl.title = "買値のみ支持度補正（売値は補正なし）";
  }
  setTradeError("");
  if (elements.tradeFunds) elements.tradeFunds.textContent = String(state.funds);
}

/**
 * 物資取引の資金変動を再計算する。
 */
function recalcTradeDelta() {
  const settlement = getCurrentSettlement();
  if (!settlement) return;
  const demand = settlement.demand || {};
  setTradeError("");
  let delta = 0;
  const buyInputs = elements.tradeTableBody?.querySelectorAll(".trade-buy") || [];
  buyInputs.forEach((inp) => {
    const id = inp.getAttribute("data-id");
    const max = Math.max(0, Number(inp.getAttribute("data-stock")) || 0);
    let v = Math.max(0, Number(inp.value) || 0);
    if (v > max) {
      v = max;
      inp.value = String(v);
    }
    const price = calcSupplyPrice(id, demand[id] ?? 10, {
      factionId: settlement.factionId,
      settlementId: settlement.id,
      mode: "buy",
    }) ?? 0;
    delta -= v * price;
  });
  const sellInputs = elements.tradeTableBody?.querySelectorAll(".trade-sell") || [];
  sellInputs.forEach((inp) => {
    const id = inp.getAttribute("data-id");
    const max = Math.max(0, Number(inp.getAttribute("data-have")) || 0);
    let v = Math.max(0, Number(inp.value) || 0);
    if (v > max) {
      v = max;
      inp.value = String(v);
    }
    const price = calcSupplyPrice(id, demand[id] ?? 10, {
      factionId: settlement.factionId,
      settlementId: settlement.id,
      mode: "sell",
    }) ?? 0;
    delta += v * price;
  });
  const el = elements.tradeDelta;
  if (!el) return;
  el.hidden = false;
  el.textContent = `資金変動: ${delta > 0 ? "+" : ""}${delta}`;
  el.className = "pill " + (delta > 0 ? "delta-pos" : delta < 0 ? "delta-neg" : "delta-zero");
}

/**
 * 船取引モーダルを描画する。
 */
function renderShipTradeModal() {
  const body = elements.shipTradeTableBody;
  if (!body) return;
  body.innerHTML = `
    <tr>
      <td>船</td>
      <td class="ta-center">${SHIP_PRICE}</td>
      <td class="ta-center">${state.ships}</td>
      <td class="ta-center">
        <input type="number" min="0" value="0" class="ship-buy input-70">
      </td>
      <td class="ta-center">
        <input type="number" min="0" max="${state.ships}" value="0" class="ship-sell input-70">
      </td>
    </tr>
  `;
  setShipTradeError("");
  if (elements.shipTradeFunds) elements.shipTradeFunds.textContent = String(state.funds);
  if (elements.shipTradeDelta) {
    elements.shipTradeDelta.hidden = false;
    elements.shipTradeDelta.textContent = "資金変動: 0";
    elements.shipTradeDelta.className = "pill delta-zero";
  }
}

/**
 * 船取引の資金変動を再計算する。
 */
function updateShipTradeDelta() {
  const buyInput = elements.shipTradeModal?.querySelector(".ship-buy");
  const sellInput = elements.shipTradeModal?.querySelector(".ship-sell");
  const buyQty = Math.max(0, Number(buyInput?.value) || 0);
  const sellQty = Math.max(0, Number(sellInput?.value) || 0);
  const fundsDelta = (sellQty - buyQty) * SHIP_PRICE;
  if (elements.shipTradeFunds) elements.shipTradeFunds.textContent = String(state.funds);
  const deltaEl = elements.shipTradeDelta;
  if (!deltaEl) return;
  deltaEl.hidden = false;
  deltaEl.textContent = `資金変動: ${fundsDelta >= 0 ? "+" : ""}${fundsDelta}`;
  if (fundsDelta > 0) deltaEl.className = "pill delta-pos";
  else if (fundsDelta < 0) deltaEl.className = "pill delta-neg";
  else deltaEl.className = "pill delta-zero";
}

/**
 * 物資/船取引モーダルのイベントを設定する。
 * @param {{openModal:Function,closeModal:Function,bindModal:Function,syncUI:Function,clearActionMessage:Function}} param0
 */
export function wireMarketModals({ openModal, closeModal, bindModal, syncUI, clearActionMessage }) {
  bindModal?.(elements.tradeModal, elements.tradeModalClose);
  bindModal?.(elements.shipTradeModal, elements.shipTradeModalClose);

  elements.tradeBtn?.addEventListener("click", () => {
    renderTradeSelects();
    openModal?.(elements.tradeModal);
  });
  elements.shipTradeBtn?.addEventListener("click", () => {
    const settlement = getCurrentSettlement();
    if (!settlement || state.modeLabel !== MODE_LABEL.IN_TOWN) {
      setOutput("船取引不可", "街の中でのみ船取引ができます。", [
        { text: "船取引", kind: "warn" },
        { text: "街のみ", kind: "warn" },
      ]);
      return;
    }
    renderShipTradeModal();
    openModal?.(elements.shipTradeModal);
  });

  elements.tradeTableBody?.addEventListener("input", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    const id = target.getAttribute("data-id");
    if (!id) return;
    const isBuy = target.classList.contains("trade-buy");
    const isSell = target.classList.contains("trade-sell");
    if (!isBuy && !isSell) return;
    const maxAttr = isBuy ? "data-stock" : "data-have";
    const max = Math.max(0, Number(target.getAttribute(maxAttr)) || 0);
    let v = Math.max(0, Number(target.value) || 0);
    if (v > max) v = max;
    target.value = String(v);
    // 購入/売却は同一品目で排他的に扱う（片方入力で反対は0）。
    const counterpartClass = isBuy ? ".trade-sell" : ".trade-buy";
    const counterpart = elements.tradeTableBody?.querySelector(`${counterpartClass}[data-id=\"${id}\"]`);
    if (counterpart) counterpart.value = "0";
    recalcTradeDelta();
  });

  elements.tradeConfirm?.addEventListener("click", () => {
    const settlement = getCurrentSettlement();
    if (!settlement) return;
    const demand = settlement.demand || {};
    const stock = settlement.stock || {};
    const buys = {};
    const sells = {};
    let fundsDelta = 0;
    const buyInputs = elements.tradeTableBody?.querySelectorAll(".trade-buy") || [];
    buyInputs.forEach((inp) => {
      const id = inp.getAttribute("data-id");
      const max = Math.max(0, Number(inp.getAttribute("data-stock")) || 0);
      let v = Math.max(0, Number(inp.value) || 0);
      if (v > max) v = max;
      inp.value = String(v);
      if (v > 0) buys[id] = v;
      const price = calcSupplyPrice(id, demand[id] ?? 10, {
        factionId: settlement.factionId,
        settlementId: settlement.id,
        mode: "buy",
      }) ?? 0;
      fundsDelta -= v * price;
    });
    const sellInputs = elements.tradeTableBody?.querySelectorAll(".trade-sell") || [];
    sellInputs.forEach((inp) => {
      const id = inp.getAttribute("data-id");
      const max = Math.max(0, Number(inp.getAttribute("data-have")) || 0);
      let v = Math.max(0, Number(inp.value) || 0);
      if (v > max) v = max;
      inp.value = String(v);
      if (v > 0) sells[id] = v;
      const price = calcSupplyPrice(id, demand[id] ?? 10, {
        factionId: settlement.factionId,
        settlementId: settlement.id,
        mode: "sell",
      }) ?? 0;
      fundsDelta += v * price;
    });
    const allIds = new Set([...Object.keys(buys), ...Object.keys(sells)]);
    if (!allIds.size) {
      setTradeError("購入・売却数量を入力してください。");
      return;
    }
    for (const id of Object.keys(buys)) {
      if ((stock[id] ?? 0) < buys[id]) {
        setTradeError("在庫が不足しています。");
        return;
      }
    }
    for (const id of Object.keys(sells)) {
      if ((state.supplies?.[id] ?? 0) < sells[id]) {
        setTradeError("売却する在庫が不足しています。");
        return;
      }
    }
    const totalBefore = totalSupplies(state.supplies);
    const buyTotal = Object.values(buys).reduce((a, b) => a + b, 0);
    const sellTotal = Object.values(sells).reduce((a, b) => a + b, 0);
    const cap = calcSupplyCap(state.ships);
    if (totalBefore + buyTotal - sellTotal > cap) {
      setTradeError(`物資上限(${cap})を超えるため購入できません。`);
      return;
    }
    if (fundsDelta < 0 && state.funds < -fundsDelta) {
      setTradeError("資金が不足しています。");
      return;
    }
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

  elements.shipTradeModal?.addEventListener("input", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("ship-buy") && !target.classList.contains("ship-sell")) return;
    const buyInput = elements.shipTradeModal?.querySelector(".ship-buy");
    const sellInput = elements.shipTradeModal?.querySelector(".ship-sell");
    if (target.classList.contains("ship-sell")) {
      const max = Math.max(0, Number(target.getAttribute("max")) || 0);
      let v = Math.max(0, Number(target.value) || 0);
      if (v > max) v = max;
      target.value = String(v);
      if (buyInput) buyInput.value = "0";
    } else {
      target.value = String(Math.max(0, Number(target.value) || 0));
      if (sellInput) sellInput.value = "0";
    }
    updateShipTradeDelta();
  });

  elements.shipTradeConfirm?.addEventListener("click", () => {
    const buyInput = elements.shipTradeModal?.querySelector(".ship-buy");
    const sellInput = elements.shipTradeModal?.querySelector(".ship-sell");
    const buyQty = Math.max(0, Number(buyInput?.value) || 0);
    const sellQty = Math.max(0, Number(sellInput?.value) || 0);
    if (!buyQty && !sellQty) {
      setShipTradeError("取引する数を入力してください。");
      return;
    }
    if (sellQty > state.ships) {
      setShipTradeError("売却数が所持数を超えています。");
      return;
    }
    const cost = buyQty * SHIP_PRICE;
    const revenue = sellQty * SHIP_PRICE;
    if (state.funds + revenue < cost) {
      setShipTradeError("資金が不足しています。");
      return;
    }
    setShipTradeError("");
    const summary = `購入: ${buyQty || 0} / 売却: ${sellQty || 0}`;
    // 取引確定前に必ず確認を挟む。
    confirmAction({
      title: "船取引の確認",
      body: `${summary}\n資金変動: ${revenue - cost}`,
      confirmText: "取引する",
      onConfirm: () => {
        state.ships = Math.max(0, state.ships + buyQty - sellQty);
        state.funds += revenue - cost;
        pushLog("船取引", `${summary} / 資金変動: ${revenue - cost}`, "-");
        closeModal?.(elements.shipTradeModal);
        syncUI?.();
      },
    });
  });
}
