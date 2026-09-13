import { state } from "./state.js";
import { MODE_LABEL } from "./constants.js";
import { OUTFITTING_CONFIG, OUTFITTING_ITEMS } from "./expansionConfig.js";
import { getCurrentSettlement } from "./actions.js";
import { changeOutfitting, getOutfittingEffects, snapshotOutfitting } from "./outfitting.js";
import { calcSupplyCap, totalSupplies } from "./supplies.js";
import { calcTroopCap, totalTroops } from "./troops.js";
import { fleetMetrics, fleetDetails } from "./fleetUI.js";
import { renderShipTrade, resetShipTrade } from "./shipyardUI.js";
import { confirmAction, pushToast, pushLog } from "./dom.js";
import { saveGameToStorage } from "./storage.js";
import { escapeHtml } from "./util.js";
import { resourceIcon } from "./resourceUI.js";

let selectedSlot = 0;
let selectedItem = "harpoon";
let selectedCategory = "attack";
let isOpen = false;
let showDetails = false;
let showTrade = false;

/** @returns {boolean} 街で艤装を変更できるか。 */
function canChange() {
  return state.modeLabel === MODE_LABEL.IN_TOWN && getCurrentSettlement()?.kind === "town" &&
    !state.pendingEncounter?.active && !state.expansion.exploration.pending && !state.expansion.charts.pending;
}

/** @param {object} item 設備定義。 @returns {string} 設定値に連動する効果の説明。 */
function description(item) {
  if (item.attack) return `${item.attack.interval}tickごとに敵1部隊${item.attack.destroy ? "を確実に壊滅" : `へ威力${item.attack.power}の射撃（DEFで軽減）`}。射程無限。`;
  const names = { atk: "全兵員ATK", def: "全兵員DEF", meleeAtk: "近接ATK", meleeDef: "近接DEF", rangedAtk: "遠隔ATK", rangedDef: "遠隔DEF", supplyCap: "物資上限", troopCap: "兵員上限", foodReduction: "食料消費", upkeepReduction: "兵員維持費", shipUpkeepReduction: "船維持費", medics: "衛生兵効果", scouts: "斥候効果" };
  return Object.entries(item.effects).map(([key, n]) => `${names[key]} ${key.endsWith("Reduction") ? "−" : "+"}${n}${["medics", "scouts"].includes(key) ? "人分（最大10人分）" : "%"}`).join(" / ");
}

/** @param {object} equipment 艤装。 @returns {object} 比較と実消費が共有する数値。 */
function metrics(equipment) {
  return fleetMetrics({ ...state, expansion: { ...state.expansion, outfitting: equipment } });
}

/** @param {string|null} id 設備または取り外し。 @returns {object} 選択枠だけ交換した比較用状態。 */
function projectedEquipment(id) {
  const next = structuredClone(state.expansion.outfitting);
  if (id && !next.owned.includes(id)) next.owned.push(id);
  next.equipped[selectedSlot] = id;
  return next;
}

/** @param {object} equipment 艤装。 @returns {string} 射撃設備の比較表示。 */
function attackSummary(equipment) {
  return getOutfittingEffects(equipment, state.fleet).attacks.map(a => `${OUTFITTING_ITEMS[a.id].name}（${a.interval}tickごと${a.destroy ? "・確定壊滅" : `・威力${a.power}`}）`).join(" / ") || "なし";
}

/** @param {object} next 変更後。 @returns {string} 全所持数と変更後超過量。 */
function capacityNotice(next) {
  const supplies = totalSupplies(); const troops = totalTroops();
  const supplyCap = calcSupplyCap(state.fleet, next); const troopCap = calcTroopCap(state.fleet, next);
  const excess = supplies > supplyCap || troops > troopCap;
  return `物資 ${supplies}/${supplyCap} / 兵員 ${troops}/${troopCap}${excess ? `。物資${Math.max(0, supplies - supplyCap)}・兵員${Math.max(0, troops - troopCap)}が超過します。変更できますが、移動前に売却・破棄・解雇が必要です。` : "（超過なし）"}`;
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
  const body = action === "equip" ? capacityNotice(projectedEquipment(id)) : `${price}資金を支払います。${action === "buy" ? "購入した設備は保管されます。装備する際は改めて付け替えてください。" : "空の装備枠を1つ増やします。"}`;
  confirmAction({ title, body, confirmText: "確定", onConfirm: () => {
    if (!canChange() || before !== JSON.stringify({ funds: state.funds, fleet: state.fleet, equipment: state.expansion.outfitting, troops: state.troops, supplies: state.supplies })) { pushToast("再確認してください", "状況が変わったため、変更内容をもう一度確認してください。", "warn"); return; }
    const funds = state.funds; const equipment = state.expansion.outfitting;
    if (!changeOutfitting(state, action, id, slot)) return;
    if (!saveGameToStorage()) { state.funds = funds; state.expansion.outfitting = equipment; pushToast("保存できません", "変更を取り消しました。", "warn"); return; }
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
  const supportNotice = item.effects?.medics && support.medics === 10 ? "衛生兵効果は既に上限のため増分なし。" : item.effects?.scouts && support.scouts === 10 ? "斥候効果は既に上限のため増分なし。" : "";
  const equipped = data.equipped.includes(selectedItem); const owned = data.owned.includes(selectedItem);
  body.innerHTML = `<p class="tiny">船団共通・陸戦でも有効。購入した設備は保管され、付け替えは無料です。</p>
    <div class="outfitting-slot-control"><label for="outfittingSlot">交換する枠</label><div class="outfitting-slot-actions"><select id="outfittingSlot">${data.equipped.map((id, i) => `<option value="${i}" ${i === selectedSlot ? "selected" : ""}>枠${i + 1}: ${id ? escapeHtml(OUTFITTING_ITEMS[id].name) : "空き"}</option>`).join("")}</select><button class="btn" id="outfittingRemove" ${data.equipped[selectedSlot] ? "" : "disabled"}>この枠を空ける</button></div></div>
    <p>${resourceIcon("funds")}所持資金 ${state.funds} / 装備枠 ${data.slots}/${OUTFITTING_CONFIG.maxSlots} ${data.slots < OUTFITTING_CONFIG.maxSlots ? `<button class="btn" id="outfittingExpand" ${state.funds < OUTFITTING_CONFIG.unlockPrices[data.slots + 1] ? "disabled" : ""}>次の枠を開放（${OUTFITTING_CONFIG.unlockPrices[data.slots + 1]}資金）</button>` : ""}</p>
    <div class="outfitting-categories" aria-label="設備の種類">${[["attack", "支援射撃"], ["buff", "兵員の強化"], ["logistics", "兵站・補助"]].map(([id, name]) => `<button class="btn ${id === selectedCategory ? "primary" : "ghost"}" data-category="${id}" aria-pressed="${id === selectedCategory}">${name}</button>`).join("")}</div>
    <div class="outfitting-layout"><div class="outfitting-catalog">${Object.entries(OUTFITTING_ITEMS).filter(([, v]) => v.category === selectedCategory).map(([id, v]) => `<button class="btn outfitting-item ${selectedItem === id ? "primary" : ""}" data-id="${id}" aria-pressed="${selectedItem === id}"><b>${escapeHtml(v.name)}</b><span>${data.equipped.includes(id) ? "装備中" : data.owned.includes(id) ? "保管中" : `${v.price.toLocaleString()}資金`}</span></button>`).join("")}</div>
    <div class="outfitting-comparison"><h3>${escapeHtml(item.name)}</h3><p>${description(item)}</p><p class="tiny">枠${selectedSlot + 1}をこの設備に交換した場合${equipped ? "（すでに装備中のため追加装備はできません）" : ""}</p><p class="tiny">${supportNotice}</p>${equipped ? "" : `<p class="tiny">支援射撃: ${attackSummary(data)} → ${attackSummary(next)}</p>`}
    ${equipped ? `<p class="outfitting-notice">枠${data.equipped.indexOf(selectedItem) + 1}に装備中です。取り外す場合は、上の交換枠でこの枠を選んでください。</p>` : `${comparisonTable(current, after, true)}<p class="tiny">${capacityNotice(next)}</p><button class="btn primary" id="outfittingCommit" ${!owned && state.funds < item.price ? "disabled" : ""}>${owned ? "選択枠に装備" : `${item.price.toLocaleString()}資金で購入・保管`}</button>`}</div></div>`;
  body.querySelectorAll("[data-category]").forEach(button => { button.onclick = () => { selectedCategory = button.dataset.category; selectedItem = Object.keys(OUTFITTING_ITEMS).find(id => OUTFITTING_ITEMS[id].category === selectedCategory); renderOutfitting(syncUI); }; });
  body.querySelector(".outfitting-catalog").scrollTop = catalogScroll;
  body.querySelector("#outfittingSlot").onchange = e => { selectedSlot = Number(e.target.value); renderOutfitting(syncUI); };
  body.querySelectorAll(".outfitting-item").forEach(button => { button.onclick = () => { selectedItem = button.dataset.id; renderOutfitting(syncUI); }; });
  body.querySelector("#outfittingRemove").onclick = () => requestChange("equip", null, syncUI);
  const expand = body.querySelector("#outfittingExpand"); if (expand) expand.onclick = () => requestChange("expand", null, syncUI);
  const commit = body.querySelector("#outfittingCommit"); if (commit) commit.onclick = () => requestChange(owned ? "equip" : "buy", selectedItem, syncUI);
}

/** @param {HTMLElement} body 表示先。 @param {object} data 現在の艤装。 @returns {void} 現在の全数値と各装備の効果を表示する。 */
function renderOutfittingDetails(body, data) {
  body.innerHTML = `<div class="outfitting-details"><h3>船団の現在値</h3><p class="tiny">陸戦・海戦共通。能力倍率は地形補正前の値です。</p><table class="outfitting-metrics"><tbody>${Object.entries(metrics(data)).map(([label, value]) => `<tr><th>${label}</th><td>${value.toLocaleString()}</td></tr>`).join("")}</tbody></table>${fleetDetails(state)}<h3>支援射撃の実効値</h3><p class="tiny">${attackSummary(data)}</p><h3>装備中の艤装と効果</h3>${data.equipped.map((id, i) => `<div class="outfitting-equipped"><b>枠${i + 1}：${id ? escapeHtml(OUTFITTING_ITEMS[id].name) : "空き"}</b>${id ? `<p>${description(OUTFITTING_ITEMS[id])}</p>` : ""}</div>`).join("")}<p class="tiny">衛生兵・斥候の効果は保有兵員と設備を合わせて最大10人分です。</p></div>`;
}

/** @param {object} current 現在値。 @param {object} after 変更後。 @param {boolean} changed 変化する項目を表示するか。 @returns {string} 差分を優先して表示する比較表。 */
function comparisonTable(current, after, changed) {
  const rows = Object.entries(current).filter(([key, value]) => (value !== after[key]) === changed);
  if (!rows.length) return "";
  return `<table class="outfitting-metrics"><thead><tr><th>効果</th><th>現在</th><th>変更後</th></tr></thead><tbody>${rows.map(([key, value]) => `<tr><td>${key}</td><td>${value}</td><td><b>${after[key]}</b></td></tr>`).join("")}</tbody></table>`;
}

/** @param {boolean} open 開閉状態。 @returns {void} 戦闘画面を優先し、地図と艤装画面を切り替える。 */
function setOutfittingOpen(open) {
  const battleVisible = !document.getElementById("battleBlock").hidden;
  isOpen = open && !battleVisible;
  document.getElementById("outfittingPanel").hidden = !isOpen;
  document.getElementById("mapBlock").hidden = isOpen || battleVisible;
}

/** @param {Function} syncUI 表示同期。 @returns {void} 街の艤装操作を中央カードに接続し、街を離れた際には閉じる。 */
export function renderOutfittingControl(syncUI) {
  const button = document.getElementById("outfittingOpenBtn");
  button.hidden = !canChange();
  if (isOpen) { setOutfittingOpen(!button.hidden); if (isOpen) renderOutfitting(syncUI); }
  button.onclick = () => { if (!canChange()) return; showDetails = false; showTrade = false; resetShipTrade(); renderOutfitting(syncUI); setOutfittingOpen(true); if (isOpen) document.getElementById("outfittingTitle").focus(); };
  document.getElementById("outfittingDetails").onclick = () => { showDetails = true; showTrade = false; renderOutfitting(syncUI); };
  document.getElementById("outfittingEdit").onclick = () => { showDetails = false; showTrade = false; renderOutfitting(syncUI); };
  document.getElementById("outfittingTrade").onclick = () => { showDetails = false; showTrade = true; renderOutfitting(syncUI); };
  document.getElementById("outfittingClose").onclick = () => { setOutfittingOpen(false); button.focus(); };
}
