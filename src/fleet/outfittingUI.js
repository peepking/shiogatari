import { state } from "../core/state.js";
import { wantedEntryReason } from "../wanted/wantedPolicy.js";
import { absDay } from "../core/calendar.js";
import { MODE_LABEL } from "../core/constants.js";
import { OUTFITTING_CONFIG, OUTFITTING_ITEMS } from "../core/expansionConfig.js";
import { getCurrentSettlement } from "../app/actions.js";
import { changeOutfitting, snapshotOutfitting } from "./outfitting.js";
import { calcSupplyCap, totalSupplies } from "../resources/supplies.js";
import { calcTroopCap, totalTroops } from "../resources/troops.js";
import { fleetMetrics, fleetMetricLabel, fleetDetails } from "./fleetUI.js";
import { renderShipTrade, resetShipTrade } from "./shipyardUI.js";
import { confirmAction, pushToast, pushLog } from "../ui/dom.js";
import { saveGameToStorage } from "../core/storage.js";
import { escapeHtml } from "../core/util.js";
import { resourceIcon } from "../ui/resourceUI.js";

let selectedSlot = 0;
let selectedItem = "harpoon";
let selectedCategory = "attack";
let isOpen = false;
let showDetails = false;
let showTrade = false;

/** @returns {boolean} 街で艤装を変更できるか。 */
function canChange() {
  if (wantedEntryReason(state, getCurrentSettlement(), absDay(state))) return false;
  return state.modeLabel === MODE_LABEL.IN_TOWN && getCurrentSettlement()?.kind === "town" &&
    !state.pendingEncounter?.active && !state.expansion.exploration.pending && !state.expansion.charts.pending;
}

/** @param {object} item 設備定義。 @returns {string} 設定値に連動する効果の説明。 */
function description(item) {
  if (item.attack) return `${item.attack.allEnemies ? "敵全体" : "敵1部隊"}へ支援射撃 / ${item.attack.interval}カウントごと・威力${item.attack.power}`;
  const names = { atk: "全兵員の攻撃", def: "全兵員の防御", meleeAtk: "近接兵の攻撃", meleeDef: "近接兵の防御", rangedAtk: "射撃兵の攻撃", rangedDef: "射撃兵の防御", supplyCap: "物資上限", troopCap: "兵員上限", foodReduction: "食料消費", upkeepReduction: "部隊維持費", shipUpkeepReduction: "船維持費", medics: "衛生兵効果", scouts: "斥候効果" };
  return Object.entries(item.effects).map(([key, n]) => `${names[key]} ${key.endsWith("Reduction") ? "−" : "＋"}${n}${["medics", "scouts"].includes(key) ? "人分" : "%"}`).join(" / ");
}

/** @param {object} equipment 艤装。 @param {boolean} includeUnequipped 比較用に未装備の射撃設備も含めるか。 @returns {object} 比較と実消費が共有する数値。 */
function metrics(equipment, includeUnequipped = true) {
  return fleetMetrics({ ...state, expansion: { ...state.expansion, outfitting: equipment } }, includeUnequipped);
}

/** @param {string|null} id 設備または取り外し。 @returns {object} 選択枠だけ交換した比較用状態。 */
function projectedEquipment(id) {
  const next = structuredClone(state.expansion.outfitting);
  if (id && !next.owned.includes(id)) next.owned.push(id);
  next.equipped[selectedSlot] = id;
  return next;
}

/** @param {object} next 変更後。 @returns {string} 全所持数と変更後超過量。 */
function capacityNotice(next) {
  const supplies = totalSupplies(); const troops = totalTroops();
  const supplyCap = calcSupplyCap(state.fleet, next); const troopCap = calcTroopCap(state.fleet, next);
  const excess = [["物資", supplies - supplyCap], ["兵員", troops - troopCap]].filter(([, count]) => count > 0);
  return `装備後の積載：物資 ${supplies}/${supplyCap} / 兵員 ${troops}/${troopCap}${excess.length ? `。${excess.map(([name, count]) => `${name}${count}`).join("・")}が超過します。整理するまで移動できません。` : ""}`;
}

/**
 * 確認後に場所・資産の変化を再検証する。保存失敗なら購入・変更を戻す。
 * @param {string} action 操作。 @param {string|null} id 設備。 @param {Function} syncUI 表示同期。
 * @returns {void}
 */
function requestChange(action, id, syncUI) {
  if (!canChange()) return;
  const before = JSON.stringify({ funds: state.funds, fleet: state.fleet, equipment: state.expansion.outfitting, troops: state.troops, supplies: state.supplies });
  const slot = selectedSlot;
  const price = action === "expand" ? OUTFITTING_CONFIG.unlockPrices[state.expansion.outfitting.slots + 1] : OUTFITTING_ITEMS[id]?.price;
  const title = action === "buy" ? `${OUTFITTING_ITEMS[id].name}を購入` : action === "expand" ? "装備枠を拡張" : id ? `${OUTFITTING_ITEMS[id].name}を装備` : "設備を取り外す";
  const body = action === "equip" ? `枠${slot + 1}の設備を変更します。` : action === "buy" ? "購入後、選択枠へ装備してください。" : "空の装備枠を1つ増やします。";
  const sections = [{ title: action === "equip" ? "変更後" : "費用", items: [action === "equip" ? capacityNotice(projectedEquipment(id)) : `${price.toLocaleString()}資金`] }];
  confirmAction({ title, body, sections, guideTopic: "guide-ships", confirmText: "確定", onConfirm: () => {
    if (!canChange() || before !== JSON.stringify({ funds: state.funds, fleet: state.fleet, equipment: state.expansion.outfitting, troops: state.troops, supplies: state.supplies })) { pushToast("再確認してください", "状況が変わったため、変更内容をもう一度確認してください。", "warn"); return; }
    const funds = state.funds; const equipment = state.expansion.outfitting; const stats = structuredClone(state.voyageStats);
    if (!changeOutfitting(state, action, id, slot)) return;
    if (!saveGameToStorage()) { state.funds = funds; state.expansion.outfitting = equipment; state.voyageStats = stats; pushToast("保存できません", "変更を取り消しました。", "warn"); return; }
    pushLog("船の艤装", title, "-");
    syncUI();
  } });
}

/** @param {Function} syncUI 表示同期。 @returns {void} 保管庫と選択枠の交換比較を描画する。 */
function renderOutfitting(syncUI) {
  const data = state.expansion.outfitting;
  selectedSlot = Math.min(selectedSlot, data.slots - 1);
  const body = document.getElementById("outfittingBody");
  const catalogScroll = body.dataset.category === selectedCategory ? body.querySelector(".outfitting-catalog")?.scrollTop || 0 : 0;
  body.dataset.category = selectedCategory;
  document.getElementById("outfittingDetails").setAttribute("aria-pressed", String(showDetails));
  document.getElementById("outfittingEdit").setAttribute("aria-pressed", String(!showDetails && !showTrade));
  document.getElementById("outfittingTrade").setAttribute("aria-pressed", String(showTrade));
  if (showTrade) { renderShipTrade(body, canChange, syncUI); return; }
  if (showDetails) { renderOutfittingDetails(body, data); return; }
  const item = OUTFITTING_ITEMS[selectedItem];
  const next = projectedEquipment(selectedItem);
  const current = metrics(data); const after = metrics(next);
  const support = snapshotOutfitting(state);
  const supportNotice = item.effects?.medics && support.medics === OUTFITTING_CONFIG.supportLimit ? "衛生兵効果は上限に達しています。" : item.effects?.scouts && support.scouts === OUTFITTING_CONFIG.supportLimit ? "斥候効果は上限に達しています。" : "";
  const equipped = data.equipped.includes(selectedItem); const owned = data.owned.includes(selectedItem);
  body.innerHTML = `<p class="tiny">購入した設備は保管されます。装備・付け替えは無料です。 <button class="btn ghost" data-guide-dialog="troubleModal" data-guide-topic="guide-ships">艤装の使い方</button></p>
    <div class="outfitting-slot-control"><label for="outfittingSlot">交換する枠</label><div class="outfitting-slot-actions"><select id="outfittingSlot">${data.equipped.map((id, i) => `<option value="${i}" ${i === selectedSlot ? "selected" : ""}>枠${i + 1}: ${id ? escapeHtml(OUTFITTING_ITEMS[id].name) : "空き"}</option>`).join("")}</select><button class="btn" id="outfittingRemove" ${data.equipped[selectedSlot] ? "" : "disabled"}>この枠を空ける</button></div></div>
    <p>${resourceIcon("funds")}所持資金 ${state.funds} / 装備枠 ${data.slots}/${OUTFITTING_CONFIG.maxSlots} ${data.slots < OUTFITTING_CONFIG.maxSlots ? `<button class="btn" id="outfittingExpand" ${state.funds < OUTFITTING_CONFIG.unlockPrices[data.slots + 1] ? "disabled" : ""}>次の枠を開放（${OUTFITTING_CONFIG.unlockPrices[data.slots + 1]}資金）</button>` : ""}</p>
    <div class="outfitting-categories" aria-label="設備の種類">${[["attack", "支援射撃"], ["buff", "兵員の強化"], ["logistics", "兵站・補助"]].map(([id, name]) => `<button class="btn ${id === selectedCategory ? "primary" : "ghost"}" data-category="${id}" aria-pressed="${id === selectedCategory}">${name}</button>`).join("")}</div>
    <div class="outfitting-layout"><div class="outfitting-catalog">${Object.entries(OUTFITTING_ITEMS).filter(([, v]) => v.category === selectedCategory).map(([id, v]) => `<button class="btn outfitting-item ${selectedItem === id ? "primary" : ""}" data-id="${id}" aria-pressed="${selectedItem === id}"><b>${escapeHtml(v.name)}</b><span>${data.equipped.includes(id) ? "装備中" : data.owned.includes(id) ? "保管中" : `${v.price.toLocaleString()}資金`}</span></button>`).join("")}</div>
    <div class="outfitting-comparison outfitting-equipment-detail"><div class="outfitting-item-heading"><h3>${escapeHtml(item.name)}</h3><button class="btn ghost" data-asset-codex="equipment" data-codex-id="${selectedItem}">図鑑で見る</button></div><p>${description(item)}</p>${supportNotice ? `<p class="outfitting-notice">${supportNotice}</p>` : ""}
    ${equipped ? `<p class="outfitting-notice">枠${data.equipped.indexOf(selectedItem) + 1}に装備中です。取り外すには、その枠を選んでください。</p>` : `<div class="outfitting-preview"><p class="tiny">枠${selectedSlot + 1}に装備した場合</p>${comparisonTable(current, after)}</div><p class="outfitting-notice">${capacityNotice(next)}</p><button class="btn primary" id="outfittingCommit" ${!owned && state.funds < item.price ? "disabled" : ""}>${owned ? "選択枠に装備" : `${item.price.toLocaleString()}資金で購入・保管`}</button>`}</div></div>`;
  body.querySelectorAll("[data-category]").forEach(button => { button.onclick = () => { selectedCategory = button.dataset.category; selectedItem = Object.keys(OUTFITTING_ITEMS).find(id => OUTFITTING_ITEMS[id].category === selectedCategory); renderOutfitting(syncUI); }; });
  body.querySelector(".outfitting-catalog").scrollTop = catalogScroll;
  body.querySelector("#outfittingSlot").onchange = e => { selectedSlot = Number(e.target.value); renderOutfitting(syncUI); };
  body.querySelectorAll(".outfitting-item").forEach(button => { button.onclick = () => { selectedItem = button.dataset.id; renderOutfitting(syncUI); }; });
  body.querySelector("#outfittingRemove").onclick = () => requestChange("equip", null, syncUI);
  const expand = body.querySelector("#outfittingExpand"); if (expand) expand.onclick = () => requestChange("expand", null, syncUI);
  const commit = body.querySelector("#outfittingCommit"); if (commit) commit.onclick = () => requestChange(owned ? "equip" : "buy", selectedItem, syncUI);
}

/** @param {HTMLElement} body 表示先。 @param {object} data 現在の艤装。 @returns {void} 容量と次回費用を先に示し、内訳の開閉状態を保持する。 */
function renderOutfittingDetails(body, data) {
  const opened = new Set([...body.querySelectorAll("details[data-fleet-section]")].filter(element => element.open).map(element => element.dataset.fleetSection));
  const values = metrics(data, false);
  const primary = ["supplyCap", "troopCap", "funds", "food"];
  const costs = ["troopFunds", "shipFunds", "shipUpkeepReduction"];
  const abilities = ["meleeAtk", "rangedAtk", "meleeDef", "rangedDef", "hp"];
  const combat = Object.entries(values).filter(([id, value]) => !primary.includes(id) && !costs.includes(id) && value !== (abilities.includes(id) ? 100 : 0));
  body.innerHTML = `<div class="outfitting-details"><h3>船団の現在値</h3>${metricsTable(primary.map(label => [label, values[label]]))}
    <button class="btn ghost" data-guide-dialog="troubleModal" data-guide-topic="guide-asset-values">数値の見方</button>
    <details class="fleet-disclosure" data-fleet-section="costs"><summary>維持費の内訳</summary>${metricsTable(costs.filter(label => values[label] > 0).map(label => [label, values[label]])) || '<p class="tiny">維持費はかかりません。</p>'}</details>
    <details class="fleet-disclosure" data-fleet-section="combat"><summary>戦闘への効果</summary>${combat.length ? `${metricsTable(combat)}<p class="tiny">表示のない能力倍率は100%、補助効果は0人分です。</p>` : '<p class="tiny">船・艤装・補助兵による追加効果はありません。</p>'}</details>
    <details class="fleet-disclosure" data-fleet-section="ships"><summary>保有船と固有効果</summary>${fleetDetails(state)}</details>
    <details class="fleet-disclosure" data-fleet-section="equipment"><summary>装備中の艤装</summary>${data.equipped.map((id, i) => `<div class="outfitting-equipped"><b>枠${i + 1}：${id ? escapeHtml(OUTFITTING_ITEMS[id].name) : "空き"}</b>${id ? `<p>${description(OUTFITTING_ITEMS[id])}</p>` : ""}</div>`).join("")}</details></div>`;
  body.querySelectorAll("details[data-fleet-section]").forEach(element => { element.open = opened.has(element.dataset.fleetSection); });
}

/** @param {Array} rows 内部識別子と現在値。 @returns {string} 閲覧する項目だけの数値表。 */
function metricsTable(rows) {
  return rows.length ? `<table class="outfitting-metrics"><tbody>${rows.map(([id, value]) => `<tr><th>${escapeHtml(fleetMetricLabel(id))}</th><td>${value.toLocaleString()}</td></tr>`).join("")}</tbody></table>` : "";
}

/** @param {object} current 現在値。 @param {object} after 変更後。 @returns {string} 変化する項目だけの比較表。 */
function comparisonTable(current, after) {
  const rows = Object.entries(current).filter(([key, value]) => value !== after[key]);
  if (!rows.length) return '<p class="tiny">現在の数値は変わりません。</p>';
  return `<table class="outfitting-metrics"><thead><tr><th>効果</th><th>現在</th><th>変更後</th></tr></thead><tbody>${rows.map(([key, value]) => `<tr><td>${escapeHtml(fleetMetricLabel(key))}</td><td>${value}</td><td><b>${after[key]}</b></td></tr>`).join("")}</tbody></table>`;
}

/** @param {boolean} open 開閉状態。 @returns {void} 戦闘画面を優先し、地図と艤装画面を切り替える。 */
export function setOutfittingOpen(open) {
  const battleVisible = !document.getElementById("battleBlock").hidden;
  isOpen = open && !battleVisible;
  if (isOpen) document.dispatchEvent(new CustomEvent("tide-close"));
  document.getElementById("outfittingPanel").hidden = !isOpen;
  document.getElementById("mapBlock").hidden = isOpen || battleVisible;
}

/** @param {Function} syncUI 表示同期。 @returns {void} 街の艤装操作を中央カードに接続し、街を離れた際には閉じる。 */
export function renderOutfittingControl(syncUI) {
  renderFleetDetailsControl();
  const button = document.getElementById("outfittingOpenBtn");
  button.hidden = !canChange();
  if (isOpen) { setOutfittingOpen(!button.hidden); if (isOpen) renderOutfitting(syncUI); }
  button.onclick = () => { if (!canChange()) return; showDetails = false; showTrade = false; resetShipTrade(); renderOutfitting(syncUI); setOutfittingOpen(true); if (isOpen) document.getElementById("outfittingTitle").focus(); };
  document.getElementById("outfittingDetails").onclick = () => { showDetails = true; showTrade = false; renderOutfitting(syncUI); };
  document.getElementById("outfittingEdit").onclick = () => { showDetails = false; showTrade = false; renderOutfitting(syncUI); };
  document.getElementById("outfittingTrade").onclick = () => { showDetails = false; showTrade = true; renderOutfitting(syncUI); };
  document.getElementById("outfittingClose").onclick = () => { setOutfittingOpen(false); button.focus(); };
}

/** @returns {void} ヘッダから共有の詳細だけを表示する。造船所の開閉・選択状態やゲーム状態は変更しない。 */
function renderFleetDetailsControl() {
  const trigger = document.getElementById("asset-ships");
  const modal = document.getElementById("fleetDetailsModal");
  const body = document.getElementById("fleetDetailsBody");
  const closeButton = document.getElementById("fleetDetailsClose");
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-controls", "fleetDetailsModal");
  if (!modal.hidden) renderOutfittingDetails(body, state.expansion.outfitting);
  trigger.onclick = () => {
    renderOutfittingDetails(body, state.expansion.outfitting);
    modal.hidden = false;
    closeButton.focus();
  };
  /** @returns {void} 詳細を閉じ、ヘッダの船へフォーカスを戻す。 */
  function close() { modal.hidden = true; trigger.focus(); }
  closeButton.onclick = close;
  modal.onclick = event => { if (event.target === modal) close(); };
  modal.onkeydown = event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Tab") {
      const controls = [...modal.querySelectorAll('button:not([disabled]), summary, [tabindex="0"]')].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
}
