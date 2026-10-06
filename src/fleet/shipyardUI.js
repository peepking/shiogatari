import { state } from "../core/state.js";
import { getCurrentSettlement } from "../app/actions.js";
import { SHIP_TYPES, SHIP_UPKEEP_RATE } from "./shipConfig.js";
import { normalizeFleet, fleetCounts } from "./fleet.js";
import { VARIANT_SHIPS } from "./variantShips.js";
import { fishingShipyard, shipTradePrice, quoteShipTrade, tradeShip } from "./shipyard.js";
import { shipIcon, shipEffectText, fleetMetrics, fleetMetricLabel, variantShipDetails } from "./fleetUI.js";
import { totalSupplies } from "../resources/supplies.js";
import { totalTroops } from "../resources/troops.js";
import { confirmAction, pushToast, pushLog } from "../ui/dom.js";
import { saveGameToStorage } from "../core/storage.js";
import { escapeHtml } from "../core/util.js";

let mode = "buy";
let selected = null;
let quantity = 1;

/** @param {string} key 選択キー。 @param {object} yard 在庫。 @returns {object} 通常船または個体の表示情報。 */
function tradeSelection(key, yard) {
  const record = [...normalizeFleet(state.fleet).variants, ...(yard.variants || [])].find(v => `variant:${v.id}` === key);
  const variant = record && VARIANT_SHIPS[record.variantId], base = variant?.base || key;
  return { ...SHIP_TYPES[base], base, record, name: variant?.name || SHIP_TYPES[base]?.name,
    supplies: (SHIP_TYPES[base]?.supplies || 0) + (variant?.supplies || 0), troops: (SHIP_TYPES[base]?.troops || 0) + (variant?.troops || 0) };
}

/** @returns {void} 造船所への再入場時は購入モードに戻す。 */
export function resetShipTrade() { mode = "buy"; selected = null; quantity = 1; }

/** @param {object} settlement 街。 @returns {string} 確認中の船団・在庫・資産変更を検出する値。 */
function tradeSignature(settlement) {
  return JSON.stringify([settlement.id, settlement.shipyard, state.fleet, state.funds, state.troops, state.supplies, state.expansion.outfitting]);
}

/** @param {object} after 変更後の表示値。 @returns {string} 自動削除を行わない容量超過の案内。 */
function excessText(after) {
  const supplies = Math.max(0, totalSupplies() - after.supplyCap);
  const troops = Math.max(0, totalTroops() - after.troopCap);
  const excess = [["物資", supplies], ["兵員", troops]].filter(([, count]) => count > 0);
  return excess.length ? `${excess.map(([name, count]) => `${name}${count}`).join("・")}が上限を超えます。整理するまで移動できません。` : "";
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
  const ship = tradeSelection(type, settlement.shipyard);
  const signature = tradeSignature(settlement);
  const after = fleetMetrics({ ...state, fleet: quote.fleet });
  let handled = false;
  const warning = excessText(after);
  confirmAction({ title: `${ship.name}を${direction === "buy" ? "購入" : "売却"}`,
    body: `${count}隻を${direction === "buy" ? "購入" : "売却"}します。`,
    sections: [{ title: direction === "buy" ? "支払う資金" : "受け取る資金", items: [`${quote.amount.toLocaleString()}資金`] }, ...(warning ? [{ title: "容量超過", items: [warning] }] : [])],
    guideTopic: "guide-ships",
    confirmText: "取引する", onConfirm: () => {
      if (handled) return;
      handled = true;
      if (!canChange() || getCurrentSettlement() !== settlement || signature !== tradeSignature(settlement)) {
        pushToast("再確認してください", "状況が変わりました。取引内容を確認してください。", "warn"); syncUI(); return;
      }
      const before = { fleet: state.fleet, funds: state.funds, stock: settlement.shipyard.stock, variants: settlement.shipyard.variants, stats: structuredClone(state.voyageStats) };
      const result = tradeShip(state, settlement, type, direction, count);
      if (result.error) { pushToast("取引できません", result.error, "warn"); return; }
      if (!saveGameToStorage()) {
        state.fleet = before.fleet; state.funds = before.funds; settlement.shipyard.stock = before.stock;
        state.voyageStats = before.stats;
        settlement.shipyard.variants = before.variants;
        pushToast("保存できません", "取引を取り消しました。", "warn"); syncUI(); return;
      }
      pushLog("造船所", `${ship.name} ${count}隻を${direction === "buy" ? "購入" : "売却"} / ${result.amount}資金`, "-");
      quantity = 1;
      syncUI();
    } });
}

/** @param {HTMLElement} body 表示先。 @param {Function} canChange 操作可否。 @param {Function} syncUI 更新。 @returns {void} 在庫一覧と選択船の取引詳細を描画する。 */
export function renderShipTrade(body, canChange, syncUI) {
  const settlement = getCurrentSettlement();
  if (!canChange()) { body.innerHTML = '<p>船取引は街の造船所で行えます。</p>'; return; }
  const yard = fishingShipyard(state, settlement);
  const counts = normalizeFleet(state.fleet).counts;
  const owned = normalizeFleet(state.fleet).variants;
  const stock = { ...yard.stock };
  for (const v of owned) counts[`variant:${v.id}`] = 1;
  for (const v of yard.variants) stock[`variant:${v.id}`] = 1;
  const list = Object.keys(SHIP_TYPES).filter(id => mode === "buy"
    ? yard.regular.some(r => r.type === id) || yard.stock[id] > 0 || (id === "fishing_boat" && yard.fishingSeason != null) : counts[id] > 0);
  list.push(...(mode === "buy" ? yard.variants : owned).map(v => `variant:${v.id}`));
  if (!list.includes(selected)) { selected = list[0] || null; quantity = 1; }
  body.innerHTML = `<div class="ship-trade-bar"><div class="row"><button class="btn ${mode === "buy" ? "primary" : "ghost"}" data-ship-mode="buy" aria-pressed="${mode === "buy"}">購入</button><button class="btn ${mode === "sell" ? "primary" : "ghost"}" data-ship-mode="sell" aria-pressed="${mode === "sell"}">売却</button></div><span>所持資金 ${state.funds.toLocaleString()}</span><button class="btn ghost" data-guide-dialog="troubleModal" data-guide-topic="guide-ships">船取引の案内</button></div><div class="outfitting-layout ship-trade-layout"><div class="outfitting-catalog">${list.map(id => {
    const ship = tradeSelection(id, yard);
    const fishingLabel = id === "fishing_boat" ? `<span>漁師の伝手・${yard.stock[id] ? "季節補充枠" : "売り切れ"}</span>` : "";
    return `<button class="btn outfitting-item ship-choice ${selected === id ? "primary" : ""}" data-ship="${id}" aria-pressed="${selected === id}">${shipIcon(ship.base)}<b>${ship.name}</b><span>${shipTradePrice(ship.base, mode).toLocaleString()}資金 / 隻・${mode === "buy" ? `在庫 ${stock[id] || 0}` : `所持 ${counts[id] || 0}`}</span>${fishingLabel || (ship.record ? `<span>${escapeHtml(ship.record.sourceName)}の船</span>` : mode === "buy" ? `<span>${yard.regular.some(r => r.type === id) ? yard.stock[id] ? "定番" : "売り切れ" : "買取在庫"}</span>` : "")}</button>`;
  }).join("") || '<p class="tiny">売却できる船はありません。</p>'}</div><div class="outfitting-comparison" id="shipTradeDetail"></div></div>`;
  body.querySelectorAll("[data-ship-mode]").forEach(button => { button.onclick = () => { mode = button.dataset.shipMode; quantity = 1; renderShipTrade(body, canChange, syncUI); }; });
  body.querySelectorAll("[data-ship]").forEach(button => { button.onclick = () => { selected = button.dataset.ship; quantity = 1; renderShipTrade(body, canChange, syncUI); }; });
  const detail = body.querySelector("#shipTradeDetail");
  if (!selected) { detail.innerHTML = '<p>船を購入すると、ここから売却できます。</p>'; return; }
  const ship = tradeSelection(selected, yard);
  const max = mode === "buy" ? Math.min(stock[selected] || 0, Math.floor(state.funds / ship.price)) : counts[selected];
  const limitNotice = ship.limit && fleetCounts(state.fleet)[ship.base] >= ship.limit ? `<p class="outfitting-notice">固有効果は上限到達済みです。${mode === "buy" ? "容量は追加されます。" : ""}</p>` : "";
  detail.innerHTML = `<div class="ship-detail-heading">${shipIcon(ship.base)}<div><h3>${ship.name}</h3><p>${shipTradePrice(ship.base, mode).toLocaleString()}資金 / 隻</p></div></div><button class="btn ghost" data-asset-codex="${ship.record ? "variants" : "ships"}" data-codex-id="${ship.record ? ship.record.variantId : ship.base}">図鑑で見る</button><p>${shipEffectText(ship.base)}</p>${limitNotice}<label class="ship-quantity">${mode === "buy" ? "購入" : "売却"}数<input id="shipQuantity" type="number" min="1" max="${max}" step="1" value="${quantity}" ${max && !ship.record ? "" : "disabled"}></label><div id="shipTradePreview" aria-live="polite"></div><button class="btn primary ship-commit" id="shipCommit"></button><details class="fleet-disclosure"><summary>1隻の性能${ship.record ? "・来歴" : ""}</summary><p>物資容量＋${ship.supplies} / 兵員容量＋${ship.troops}</p><p>船維持費 ${ship.price * SHIP_UPKEEP_RATE}資金／季節（軽減前）</p>${ship.record ? variantShipDetails(ship.record) : ""}</details>`;
  /** @returns {void} 入力を維持しながら数値予告と可否を更新する。 */
  function updatePreview() {
    const result = quoteShipTrade(state, settlement, selected, mode, quantity);
    const commit = detail.querySelector("#shipCommit");
    commit.disabled = !!result.error || !canChange();
    commit.textContent = result.error ? mode === "buy" ? "購入できません" : "売却できません" : `${result.amount.toLocaleString()}資金で${mode === "buy" ? "購入" : "売却"}`;
    const preview = detail.querySelector("#shipTradePreview");
    if (result.error) { preview.textContent = result.error; return; }
    const current = fleetMetrics(state); const after = fleetMetrics({ ...state, fleet: result.fleet });
    const primary = ["supplyCap", "troopCap", "funds"];
    const costs = ["troopFunds", "shipFunds"];
    const keys = Object.keys(current).filter(key => primary.includes(key) || !costs.includes(key) && current[key] !== after[key]);
    const afterCount = ship.record ? Number(result.fleet.variants.some(v => v.id === ship.record.id)) : result.fleet.counts[selected];
    const warning = excessText(after);
    const costDetailsOpen = preview.querySelector("details")?.open;
    preview.innerHTML = `<p>所持 ${counts[selected] || 0} → ${afterCount}隻 / 資金 ${state.funds.toLocaleString()} → ${result.funds.toLocaleString()}</p><table class="outfitting-metrics"><thead><tr><th>効果</th><th>現在</th><th>取引後</th></tr></thead><tbody>${keys.map(key => `<tr><td>${escapeHtml(fleetMetricLabel(key))}</td><td>${current[key]}</td><td><b>${after[key]}</b></td></tr>`).join("")}</tbody></table>${warning ? `<p class="outfitting-notice">${warning}</p>` : ""}<details class="fleet-disclosure" ${costDetailsOpen ? "open" : ""}><summary>維持費の内訳</summary><table class="outfitting-metrics"><thead><tr><th>維持費</th><th>現在</th><th>取引後</th></tr></thead><tbody>${costs.map(key => `<tr><td>${escapeHtml(fleetMetricLabel(key))}</td><td>${current[key]}</td><td>${after[key]}</td></tr>`).join("")}</tbody></table></details>`;
  }
  detail.querySelector("#shipQuantity").oninput = event => { quantity = Number(event.target.value); updatePreview(); };
  detail.querySelector("#shipCommit").onclick = () => requestTrade(settlement, canChange, syncUI);
  updatePreview();
}
