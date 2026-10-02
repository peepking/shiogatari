import { state } from "../core/state.js";
import { escapeHtml, SEASONS } from "../core/util.js";
import { troopImage } from "../pirates/pirateConfig.js";
import { shipIcon } from "../fleet/fleetUI.js";
import { assetCatalog, filterAssetCatalog, CODEX_LABELS } from "./assetCatalog.js";
import { collectAssetCodex } from "./assetCodex.js";

let tab = "troops";
let selected = null;
let comparison = [];
let opener = null;
let ready = false;

/** @returns {HTMLElement|null} 図鑑の閲覧ダイアログ。 */
function modal() { return document.getElementById("assetCodexModal"); }

/** @param {*} value 表示値。 @returns {string} 安全な数値・文言。 */
function display(value) { return escapeHtml(typeof value === "number" ? value.toLocaleString() : value); }

/** @param {object} entry 図鑑項目。 @returns {string} 既存の絵や船の線画を使う見出し画像。 */
function entryImage(entry) {
  if (entry.tab === "troops") return `<img class="asset-codex-portrait" src="${troopImage(entry.id)}" alt="">`;
  if (entry.tab === "equipment") return '<img class="asset-codex-symbol" src="./image/ui/ship.svg" alt="">';
  if (!entry.known) return '<span class="asset-codex-unknown" aria-hidden="true">?</span>';
  return shipIcon(entry.id === "sacred" ? "caravel" : entry.base || entry.id);
}

/** @param {object} entry 図鑑項目。 @returns {string} 現在の数量と過去の記録を区別した表示。 */
function entryStatus(entry) {
  if (!entry.known) return "未発見";
  if (entry.tab === "equipment") return `${entry.equipped ? "装備中" : entry.current ? "保管中" : "未所持"} / ${entry.recorded ? "取得記録あり" : "取得記録なし"}`;
  return `現在 ${entry.current}${entry.tab === "troops" ? "人" : "隻"} / ${entry.recorded ? entry.tab === "troops" ? "在籍記録あり" : "取得記録あり" : "記録なし"}`;
}

/** @param {number} day 通算日。 @returns {string} 記録された獲得日。 */
function recordDate(day) {
  if (!day) return "獲得日不明";
  const index = day - 1;
  return `神歴${Math.floor(index / 120)}年 ${SEASONS[Math.floor(index % 120 / 30)]} ${index % 30 + 1}日`;
}

/** @param {object} values 表示値。 @returns {string} 公開値の見やすい一覧。 */
function metricList(values) {
  return `<dl class="asset-codex-metrics">${Object.entries(values).map(([name, value]) => `<div><dt>${escapeHtml(name)}</dt><dd>${display(value)}</dd></div>`).join("")}</dl>`;
}

/** @param {object[]} entries 名簿。 @returns {void} 選択された2項目を同じ基準で比較する。 */
function renderComparison(entries) {
  const area = document.getElementById("assetCodexComparison");
  const rows = comparison.map(id => entries.find(entry => entry.id === id && entry.known)).filter(Boolean).map(entry => ({ ...entry,
    metrics: { ...entry.metrics, ...Object.fromEntries(Object.entries(entry.terrain || {}).map(([name, value]) => [`地形適性：${name}`, value])) } }));
  area.hidden = rows.length === 0;
  const keys = [...new Set(rows.flatMap(entry => Object.keys(entry.metrics)))];
  area.innerHTML = `<div class="row justify-between"><b>比較 ${rows.length}/2</b><button class="btn ghost" data-codex-clear>比較を解除</button></div>${rows.length === 1 ? '<p class="tiny">もう1件を「比較に追加」で選ぶと、違いを並べて確認できます。</p>' : ""}<div class="asset-codex-compare-scroll" tabindex="0" role="region" aria-label="図鑑の比較表"><table class="outfitting-metrics"><thead><tr><th>項目</th>${rows.map(entry => `<th>${escapeHtml(entry.name)}</th>`).join("")}</tr></thead><tbody>${keys.map(key => `<tr><th>${escapeHtml(key)}</th>${rows.map(entry => `<td>${display(entry.metrics[key] ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

/** @param {object[]} entries 名簿。 @returns {void} 個別紹介・能力・運用・取得来歴を描画する。 */
function renderDetail(entries) {
  const body = document.getElementById("assetCodexDetail");
  const entry = entries.find(item => item.id === selected);
  if (!entry) { body.innerHTML = '<p class="asset-codex-empty">一覧から項目を選ぶと、特徴・能力・費用を読めます。</p>'; return; }
  const records = entry.records || [];
  body.innerHTML = `<button class="btn ghost asset-codex-back" data-codex-back>一覧に戻る</button><div class="asset-codex-detail-heading">${entryImage(entry)}<div><span class="tiny">${escapeHtml(entry.tag)}</span><h3 id="assetCodexEntryTitle" tabindex="-1">${escapeHtml(entry.name)}</h3><p class="tiny">${escapeHtml(entryStatus(entry))}</p></div></div><p>${escapeHtml(entry.description)}</p>${entry.known ? `<h4>能力・費用</h4>${metricList(entry.metrics)}${entry.terrain ? `<h4>地形適性</h4>${metricList(entry.terrain)}` : ""}<h4>運用のヒント</h4><p>${escapeHtml(entry.hint)}</p><p class="tiny">${escapeHtml(entry.note)}</p><button class="btn ghost" data-codex-compare="${entry.id}" aria-pressed="${comparison.includes(entry.id)}" ${comparison.length === 2 && !comparison.includes(entry.id) ? 'disabled' : ''}>${comparison.includes(entry.id) ? "比較から外す" : "比較に追加"}</button>` : ""}${records.length ? `<h4>取得した船の来歴（${records.length}隻）</h4><p class="tiny">現在手放している船も含めた記録です。</p><ul class="asset-codex-history">${records.slice(-20).reverse().map(record => `<li><b>${escapeHtml(record.sourceName)}の船 #${record.id}</b><span>${recordDate(record.acquiredAbs)}</span></li>`).join("")}</ul>${records.length > 20 ? '<p class="tiny">最近20隻の来歴を表示しています。</p>' : ""}` : ""}`;
}

/** @returns {void} 検索入力を保持し、一覧・現在数・比較・詳細だけを更新する。 */
export function refreshAssetCodex() {
  if (!modal() || modal().hidden) return;
  const entries = assetCatalog(tab, state);
  comparison = comparison.filter(id => entries.some(entry => entry.id === id && entry.known));
  const filtered = filterAssetCatalog(entries, document.getElementById("assetCodexSearch").value, document.getElementById("assetCodexFilter").value);
  const list = document.getElementById("assetCodexList");
  const scroll = list.scrollTop;
  list.innerHTML = filtered.map(entry => `<article class="asset-codex-card ${selected === entry.id ? "is-selected" : ""}"><button class="asset-codex-choice" data-codex-entry="${entry.id}" aria-pressed="${selected === entry.id}">${entryImage(entry)}<span><b>${escapeHtml(entry.name)}</b><span>${escapeHtml(entry.tag)}</span><span class="tiny">${escapeHtml(entryStatus(entry))}</span></span></button>${entry.known ? `<button class="btn ghost asset-codex-compare" data-codex-compare="${entry.id}" aria-label="${escapeHtml(entry.name)}を${comparison.includes(entry.id) ? "比較から外す" : "比較に追加"}" aria-pressed="${comparison.includes(entry.id)}" ${comparison.length === 2 && !comparison.includes(entry.id) ? 'disabled title="比較は2件までです"' : ''}>${comparison.includes(entry.id) ? "比較から外す" : "比較に追加"}</button>` : ""}</article>`).join("") || '<p class="asset-codex-empty">該当する項目はありません。検索や絞り込みを変更してください。</p>';
  list.scrollTop = scroll;
  const count = entries.filter(entry => entry.recorded).length;
  document.getElementById("assetCodexCount").textContent = `${filtered.length}件を表示 / ${tab === "variants" ? "発見" : "記録"} ${count}/${entries.length}`;
  document.getElementById("assetCodexHistoryNote").hidden = !collectAssetCodex(state).partial;
  renderDetail(entries);
  renderComparison(entries);
}

/** @param {string} nextTab 分類。 @returns {void} 種類を切り替え、絞り込みと比較を初期化する。 */
function changeTab(nextTab) {
  tab = nextTab; selected = null; comparison = [];
  document.getElementById("assetCodexTitle").textContent = tab === "troops" ? "兵の図鑑" : "船・艤装の図鑑";
  const tabs = document.getElementById("assetCodexTabs");
  tabs.hidden = tab === "troops";
  tabs.querySelectorAll("[data-codex-tab]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.codexTab === tab));
    button.classList.toggle("primary", button.dataset.codexTab === tab);
  });
  const categories = [...new Set(assetCatalog(tab, state).flatMap(entry => entry.categories || [entry.category]))];
  document.getElementById("assetCodexFilter").innerHTML = ["all", ...categories].map(id => `<option value="${id}">${CODEX_LABELS[id]}</option>`).join("");
  document.getElementById("assetCodexSearch").value = "";
  document.getElementById("assetCodexLayout").dataset.detail = "false";
  document.getElementById("assetCodexList").scrollTop = 0;
  refreshAssetCodex();
}

/** @returns {void} 図鑑を閉じ、雇用や造船所などの開いた場所へ戻る。 */
function closeCodex() {
  modal().hidden = true;
  if (opener?.isConnected) opener.focus();
}

/** @param {Event} event 閲覧操作。 @returns {void} 動的に追加された雇用・造船所の入口も共通の図鑑へ接続する。 */
function handleCodexClick(event) {
  const launch = event.target.closest("[data-asset-codex]");
  if (launch) {
    opener = launch;
    modal().hidden = false;
    changeTab(launch.dataset.assetCodex);
    if (launch.dataset.codexId) {
      selected = launch.dataset.codexId;
      document.getElementById("assetCodexLayout").dataset.detail = "true";
      refreshAssetCodex();
      document.getElementById("assetCodexEntryTitle")?.focus();
    } else document.getElementById("assetCodexSearch").focus();
    return;
  }
  if (modal().hidden || !modal().contains(event.target)) return;
  const action = event.target.closest("button");
  if (event.target === modal() || action?.id === "assetCodexClose") { closeCodex(); return; }
  if (!action) return;
  if (action.dataset.codexTab) changeTab(action.dataset.codexTab);
  else if (action.dataset.codexEntry) {
    selected = action.dataset.codexEntry;
    document.getElementById("assetCodexLayout").dataset.detail = "true";
    refreshAssetCodex();
    document.getElementById("assetCodexDetail").scrollTop = 0;
    document.getElementById("assetCodexEntryTitle")?.focus();
  } else if (action.hasAttribute("data-codex-back")) {
    document.getElementById("assetCodexLayout").dataset.detail = "false";
    document.getElementById("assetCodexList").querySelector(`[data-codex-entry="${selected}"]`)?.focus();
  } else if (action.hasAttribute("data-codex-clear")) {
    comparison = []; refreshAssetCodex(); document.getElementById("assetCodexSearch").focus();
  } else if (action.dataset.codexCompare) {
    const id = action.dataset.codexCompare;
    if (comparison.includes(id)) comparison = comparison.filter(key => key !== id);
    else if (comparison.length < 2) comparison.push(id);
    const inDetail = document.getElementById("assetCodexDetail").contains(action);
    refreshAssetCodex();
    const parent = document.getElementById(inDetail ? "assetCodexDetail" : "assetCodexList");
    parent.querySelector(`[data-codex-compare="${id}"]`)?.focus();
  }
}

/** @param {KeyboardEvent} event キー操作。 @returns {void} 図鑑の中でフォーカスを保ち、Escapeで戻る。 */
function handleCodexKey(event) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeCodex(); return; }
  if (event.key !== "Tab") return;
  const controls = [...modal().querySelectorAll('button:not(:disabled), input, select, [tabindex="0"]')].filter(element => element.getClientRects().length);
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

/** @returns {void} 図鑑の入口と閲覧操作を一度だけ設定する。 */
export function wireAssetCodex() {
  if (ready || !modal()) return;
  ready = true;
  document.addEventListener("click", handleCodexClick);
  modal().addEventListener("keydown", handleCodexKey);
  document.getElementById("assetCodexSearch").addEventListener("input", refreshAssetCodex);
  document.getElementById("assetCodexFilter").addEventListener("change", refreshAssetCodex);
  document.addEventListener("game-reset", closeCodex);
}
