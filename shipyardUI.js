import { state } from "./state.js";
import { getCurrentSettlement } from "./actions.js";
import { SHIP_TYPES, SHIP_UPKEEP_RATE } from "./shipConfig.js";
import { normalizeFleet } from "./fleet.js";
import { refreshShipyard, shipyardSeason, shipTradePrice, quoteShipTrade, tradeShip } from "./shipyard.js";
import { shipIcon, shipEffectText, fleetMetrics } from "./fleetUI.js";
import { totalSupplies } from "./supplies.js";
import { totalTroops } from "./troops.js";
import { confirmAction, pushToast, pushLog } from "./dom.js";
import { saveGameToStorage } from "./storage.js";

let mode = "buy";
let selected = null;
let quantity = 1;

/** @returns {void} 造船所への再入場時は購入モードに戻す。 */
export function resetShipTrade() { mode = "buy"; selected = null; quantity = 1; }

/** @param {object} settlement 街。 @returns {string} 確認中の船団・在庫・資産変更を検出する値。 */
function tradeSignature(settlement) {
  return JSON.stringify([settlement.id, settlement.shipyard, state.fleet, state.funds, state.troops, state.supplies, state.expansion.outfitting]);
}

/** @param {object} after 変更後の表示値。 @returns {string} 自動削除を行わない容量超過の案内。 */
function excessText(after) {
  const supplies = Math.max(0, totalSupplies() - after["物資上限"]);
  const troops = Math.max(0, totalTroops() - after["兵員上限"]);
  return supplies || troops ? `変更後は物資${supplies}・兵員${troops}が上限超過します。売却可能ですが、移動前に売却・破棄・解雇で整理してください。` : "変更後の容量超過なし";
}

/**
 * 街・資産を確認直前と照合し、一度だけ取引する。保存失敗時は資金・船団・在庫を戻す。
 * @param {object} settlement 街。 @param {Function} canChange 操作可否。 @param {Function} syncUI 更新。
 * @returns {void}
 */
function requestTrade(settlement, canChange, syncUI) {
  const type = selected; const direction = mode; const count = quantity;
  const quote = quoteShipTrade(state, settlement, type, direction, count);
  if (quote.error || !canChange()) return;
  const signature = tradeSignature(settlement);
  const after = fleetMetrics({ ...state, fleet: quote.fleet });
  let handled = false;
  confirmAction({ title: `${SHIP_TYPES[type].name}を${direction === "buy" ? "購入" : "売却"}`,
    body: `${count}隻 / ${quote.amount.toLocaleString()}資金${direction === "buy" ? "を支払います" : "を受け取ります"}。\n${excessText(after)}`,
    confirmText: "取引する", onConfirm: () => {
      if (handled) return;
      handled = true;
      if (!canChange() || getCurrentSettlement() !== settlement || signature !== tradeSignature(settlement)) {
        pushToast("再確認してください", "状況が変わりました。取引内容を確認してください。", "warn"); syncUI(); return;
      }
      const before = { fleet: state.fleet, funds: state.funds, stock: settlement.shipyard.stock };
      const result = tradeShip(state, settlement, type, direction, count);
      if (result.error) { pushToast("取引できません", result.error, "warn"); return; }
      if (!saveGameToStorage()) {
        state.fleet = before.fleet; state.funds = before.funds; settlement.shipyard.stock = before.stock;
        pushToast("保存できません", "取引を取り消しました。", "warn"); syncUI(); return;
      }
      pushLog("造船所", `${SHIP_TYPES[type].name} ${count}隻を${direction === "buy" ? "購入" : "売却"} / ${result.amount}資金`, "-");
      quantity = 1;
      syncUI();
    } });
}

/** @param {HTMLElement} body 表示先。 @param {Function} canChange 操作可否。 @param {Function} syncUI 更新。 @returns {void} 在庫一覧と選択船の取引詳細を描画する。 */
export function renderShipTrade(body, canChange, syncUI) {
  const settlement = getCurrentSettlement();
  if (!canChange()) { body.innerHTML = '<p>船取引は街の造船所で行えます。</p>'; return; }
  const yard = refreshShipyard(settlement, shipyardSeason(state));
  const counts = normalizeFleet(state.fleet).counts;
  const list = Object.keys(SHIP_TYPES).filter(id => mode === "buy"
    ? yard.regular.some(r => r.type === id) || yard.stock[id] > 0 : counts[id] > 0);
  if (!list.includes(selected)) { selected = list[0] || null; quantity = 1; }
  body.innerHTML = `<div class="ship-trade-bar"><div class="row"><button class="btn ${mode === "buy" ? "primary" : "ghost"}" data-ship-mode="buy" aria-pressed="${mode === "buy"}">購入</button><button class="btn ${mode === "sell" ? "primary" : "ghost"}" data-ship-mode="sell" aria-pressed="${mode === "sell"}">売却</button></div><span>所持資金 ${state.funds.toLocaleString()}</span></div><p class="tiny">定番4種は毎季節1日に補充。買取在庫は売り切れるまで販売します。</p><div class="outfitting-layout ship-trade-layout"><div class="outfitting-catalog">${list.map(id => {
    const ship = SHIP_TYPES[id];
    return `<button class="btn outfitting-item ship-choice ${selected === id ? "primary" : ""}" data-ship="${id}" aria-pressed="${selected === id}">${shipIcon(id)}<b>${ship.name}</b><span>${shipTradePrice(id, mode).toLocaleString()}資金 / 隻</span><span>在庫 ${yard.stock[id] || 0} / 所持 ${counts[id]}</span><span>物資＋${ship.supplies} / 兵員＋${ship.troops}</span>${mode === "buy" ? `<span>${yard.regular.some(r => r.type === id) ? yard.stock[id] ? "定番" : "売り切れ" : "買取在庫"}</span>` : ""}</button>`;
  }).join("") || '<p class="tiny">売却できる船はありません。</p>'}</div><div class="outfitting-comparison" id="shipTradeDetail"></div></div>`;
  body.querySelectorAll("[data-ship-mode]").forEach(button => { button.onclick = () => { mode = button.dataset.shipMode; quantity = 1; renderShipTrade(body, canChange, syncUI); }; });
  body.querySelectorAll("[data-ship]").forEach(button => { button.onclick = () => { selected = button.dataset.ship; quantity = 1; renderShipTrade(body, canChange, syncUI); }; });
  const detail = body.querySelector("#shipTradeDetail");
  if (!selected) { detail.innerHTML = '<p>船を購入すると、ここから売却できます。</p>'; return; }
  const ship = SHIP_TYPES[selected];
  const max = mode === "buy" ? Math.min(yard.stock[selected] || 0, Math.floor(state.funds / ship.price)) : counts[selected];
  detail.innerHTML = `<div class="ship-detail-heading">${shipIcon(selected)}<div><h3>${ship.name}</h3><p>${shipTradePrice(selected, mode).toLocaleString()}資金 / 隻</p></div></div><p>1隻あたり 物資上限＋${ship.supplies} / 部隊上限＋${ship.troops}</p><p>船維持費（軽減前）${ship.price * SHIP_UPKEEP_RATE}資金／隻・季節</p><p>${shipEffectText(selected)}</p>${ship.limit && counts[selected] >= ship.limit ? '<p class="outfitting-notice">固有バフは上限到達済みです。追加購入で固定容量は増えます。</p>' : ""}<label class="ship-quantity">${mode === "buy" ? "購入" : "売却"}数<input id="shipQuantity" type="number" min="1" max="${max}" step="1" value="${quantity}" ${max ? "" : "disabled"}></label><div id="shipTradePreview" aria-live="polite"></div><button class="btn primary ship-commit" id="shipCommit"></button>`;
  /** @returns {void} 入力を維持しながら数値予告と可否を更新する。 */
  function updatePreview() {
    const result = quoteShipTrade(state, settlement, selected, mode, quantity);
    const commit = detail.querySelector("#shipCommit");
    commit.disabled = !!result.error || !canChange();
    commit.textContent = result.error ? mode === "buy" ? "購入できません" : "売却できません" : `${result.amount.toLocaleString()}資金で${mode === "buy" ? "購入" : "売却"}`;
    const preview = detail.querySelector("#shipTradePreview");
    if (result.error) { preview.textContent = result.error; return; }
    const current = fleetMetrics(state); const after = fleetMetrics({ ...state, fleet: result.fleet });
    const keys = Object.keys(current).filter((key, index) => index < 5 || current[key] !== after[key]);
    preview.innerHTML = `<p>所持 ${counts[selected]} → ${result.fleet.counts[selected]}隻 / 資金 ${state.funds.toLocaleString()} → ${result.funds.toLocaleString()}</p><table class="outfitting-metrics"><thead><tr><th>効果</th><th>現在</th><th>取引後</th></tr></thead><tbody>${keys.map(key => `<tr><td>${key}</td><td>${current[key]}</td><td><b>${after[key]}</b></td></tr>`).join("")}</tbody></table><p class="tiny">${excessText(after)}</p>`;
  }
  detail.querySelector("#shipQuantity").oninput = event => { quantity = Number(event.target.value); updatePreview(); };
  detail.querySelector("#shipCommit").onclick = () => requestTrade(settlement, canChange, syncUI);
  updatePreview();
}
