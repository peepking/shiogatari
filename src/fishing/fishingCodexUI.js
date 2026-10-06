import { state } from "../core/state.js";
import { elements } from "../ui/dom.js";
import { SEASONS, escapeHtml } from "../core/util.js";
import { FISH_REGIONS, FISH_CATEGORIES, BAIT_DEFS, FISH_SPECIES, DEPTH_NAMES } from "./fishingConfig.js";
import { fishingRegionAt, matchesCodexFilters, codexCompletion, codexRevealState, codexDetailReveal } from "./fishing.js";
import { fishingRewards } from "./fishingRewards.js";
import { codexSilhouette } from "./fishingCodexArt.js";

/** 図鑑の検索・絞り込みと閲覧位置を保持する。保存データには含めない。 */
const codexView = {
  filters: { categories: new Set(), regions: new Set(), seasons: new Set() },
  searchText: "", searchComposing: false, selectedId: null, listScroll: 0, returnId: null, filtersOpen: false,
};
/** 公開済み情報を絞り込む三つの項目。項目内はOR、項目間はANDで判定する。 */
const FILTER_GROUPS = [
  { id: "category", field: "categories", label: "分類", values: FISH_CATEGORIES },
  { id: "region", field: "regions", label: "海域", values: FISH_REGIONS },
  { id: "season", field: "seasons", label: "季節", values: SEASONS },
];
/** 図鑑の操作を重複して配線しないための印。 */
let codexWired = false;

/**
 * 餌の表示名一覧を返す。
 * @param {object} s 種定義。
 * @returns {string} 餌名の連結。
 */
function baitLabel(s) {
  return Object.entries(s.baits)
    .filter(([, w]) => w > 0)
    .map(([id]) => BAIT_DEFS[id]?.name)
    .join("・");
}

/**
 * 生息域の省略表示を返す。全4海域なら「全海域」に集約する。
 * @param {object} s 種定義。
 * @returns {string} 一覧用の海域表示。
 */
function regionShortLabel(s) {
  if ((s.regions || []).length >= Object.keys(FISH_REGIONS).length) return "全海域";
  return s.regions.map((r) => FISH_REGIONS[r]).join("・");
}

/**
 * 季節の省略表示を返す。4季節すべてなら「通年」、連続範囲（年跨ぎ含む）なら
 * 「春〜秋」形式、それ以外は「・」連結で表す。
 * @param {number[]} list 季節インデックスの配列。
 * @returns {string} 一覧用の季節表示。
 */
function seasonShortLabel(list) {
  const n = Object.keys(SEASONS).length;
  if (list.length >= n) return "通年";
  const sorted = [...list].sort((a, b) => a - b);
  for (let start = 0; start < n; start++) {
    const seq = sorted.map((_, k) => (start + k) % n);
    if (seq.every((v, k) => v === sorted[k])) {
      return `${SEASONS[seq[0]]}〜${SEASONS[seq[seq.length - 1]]}`;
    }
  }
  return sorted.map((i) => SEASONS[i]).join("・");
}

/**
 * 水深の表示名を返す。config の並び順（浅瀬→海）に従ってソートして連結する。
 * @param {object} s 種定義。
 * @returns {string} 水深名の連結。
 */
function depthLabel(s) {
  const order = Object.keys(DEPTH_NAMES);
  return [...s.depth]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((d) => DEPTH_NAMES[d] || d)
    .join("・");
}

/**
 * 絶対日数をゲーム内の年月日に変換する。
 * @param {number} abs 絶対日数。
 * @returns {string} 「年 季節 日」形式の表示。
 */
function absToGameDate(abs) {
  const year = Math.floor(abs / 120);
  const rem = abs % 120;
  const season = Math.floor(rem / 30);
  const day = rem % 30 + 1;
  return `${year}年 ${SEASONS[season]}${day}日`;
}

/**
 * 図鑑の一覧を描画する。
 * 図鑑No.順のカードへ、魚名・分類・最大記録と公開済みの手がかりをまとめる。
 * 未発見魚は魚名等を非公開としつつ、図鑑完成率に応じて公開済みの海域・季節だけを表示する。
 * @param {HTMLElement} body 描画先。
 * @returns {void}
 */
function renderCodexList(body) {
  const data = state.expansion.fishing;
  const completion = codexCompletion(data.codex);
  const filterable = FISH_SPECIES.filter((s) => {
    const caught = (data.codex[s.id]?.count || 0) > 0;
    return matchesCodexFilters(
      s,
      codexView.filters,
      { caught, seasonsRevealed: completion.ratio >= 0.25, search: codexView.searchText }
    );
  }).sort((a, b) => a.number - b.number);
  const rows = filterable.map(s => {
    const entry = data.codex[s.id];
    const caught = (entry?.count || 0) > 0;
    const reveal = codexRevealState(completion.ratio);
    const category = caught ? s.category : "unknown";
    const no = `No.${String(s.number).padStart(3, "0")}`;
    return `<button type="button" class="codex-card is-${category}" data-codex="${s.id}">
      <span class="codex-card-top"><span class="codex-number">${no}</span><span class="codex-category">${caught ? FISH_CATEGORIES[s.category] : "未発見"}</span></span>
      <span class="codex-card-main">${codexSilhouette(caught ? s.category : null)}
        <span><strong class="codex-card-name">${caught ? escapeHtml(s.name) : "？？？"}</strong>
          <span class="codex-card-record">${caught ? `最大 <b>${entry.maxSize}</b> cm` : "海に残された手がかり"}</span></span></span>
      <span class="codex-card-hints"><span>${regionShortLabel(s)}</span><span>${caught || reveal.seasons ? seasonShortLabel(s.seasons) : "季節はまだ不明"}</span></span>
    </button>`;
  }).join("");
  const result = document.getElementById("codexResultCount");
  if (result) result.textContent = filterable.length + "件を表示";
  body.innerHTML = '<div class="codex-cards">' + (rows || '<div class="codex-empty"><p>該当する魚はいません。検索や絞り込みを変更してください。</p><button type="button" class="btn ghost" data-codex-clear>すべての条件を解除</button></div>') + '</div>';
}

/**
 * 図鑑の魚詳細を描画する。一覧の行クリックから遷移する。
 * 上部に図鑑No.・魚名・学名・分類をひとまとまりで表示し、続けて説明文、
 * その下に最大記録と生態・釣り情報を縦方向へ並べる。
 * 未発見の魚では正体（魚名・学名・説明文・記録・カテゴリ）を出さずに「？？？」とし、
 * 図鑑完成率に応じて公開済みの生息域・季節・水深・有効な餌だけを表示する（段階公開）。
 * 一度でも釣った発見済みの魚は完成率に関係なく全項目を公開する。
 * @param {HTMLElement} body 描画先。
 * @returns {void}
 */
function renderCodexDetail(body) {
  const data = state.expansion.fishing;
  const s = FISH_SPECIES.find((item) => item.id === codexView.selectedId);
  if (!s) {
    codexView.selectedId = null;
    renderCodexList(body);
    return;
  }
  const entry = data.codex[s.id];
  const discovered = (entry?.count || 0) > 0;
  const completion = codexCompletion(data.codex);
  const reveal = codexDetailReveal(discovered, completion.ratio);
  const record =
    entry != null && entry.maxSizeAbs != null && entry.maxSizePos
      ? `${absToGameDate(entry.maxSizeAbs)}\u3000${FISH_REGIONS[fishingRegionAt(entry.maxSizePos.x, entry.maxSizePos.y)] || "?"}`
      : "不明";
  const maxSize = entry != null && entry.maxSize > 0 ? `${entry.maxSize}cm` : "未記録";
  const category = FISH_CATEGORIES[s.category] || s.category;
  const no = `No.${String(s.number).padStart(3, "0")}`;
  const topInfo = discovered
    ? `<div class="codex-number">${no}</div>
      <h3>${escapeHtml(s.name)}</h3>
      ${s.scientificName ? `<div class="codex-scientific">${escapeHtml(s.scientificName)}</div>` : ""}
      <div class="tiny">${category}</div>`
    : `<div class="codex-number">${no}</div>
      <h3>？？？</h3>
      <div class="tiny">未発見</div>`;
  const description = discovered && s.description ? `<p class="codex-desc">${escapeHtml(s.description)}</p>` : !discovered ? '<p class="codex-desc">まだ出会っていない魚。公開された手がかりを頼りに、航海の途中で探してみましょう。</p>' : "";
  const recordBlock = discovered
    ? `<div class="codex-record">
      <span class="codex-record-label">最大記録</span>
      <strong>${maxSize}</strong>
      <div class="codex-record-note">${record}</div>
    </div>`
    : "";
  const ecology = `<dl class="two codex-ecology">
      <div><dt>生息域</dt><dd>${regionShortLabel(s)}</dd></div>
      <div><dt>季節</dt><dd>${reveal.seasons ? seasonShortLabel(s.seasons) : "？？？"}</dd></div>
      <div><dt>水深</dt><dd>${reveal.depth ? depthLabel(s) : "？？？"}</dd></div>
      <div><dt>有効な餌</dt><dd>${reveal.baits ? baitLabel(s) || "なし" : "？？？"}</dd></div>
    </dl>`;
  body.innerHTML = `<div class="codex-detail">
    <div class="row gap-12 mt-6"><button class="btn" id="codexBackBtn">一覧に戻る</button></div>
    <div class="codex-detail-head is-${discovered ? s.category : "unknown"}">
      ${codexSilhouette(discovered ? s.category : null)}
      <div>${topInfo}</div>
    </div>
    ${description}
    ${recordBlock}
    ${ecology}
  </div>`;
}

/**
 * 図鑑の進捗と報酬を更新する。折りたたみ要素は作り直さず、閲覧中の開閉状態を保つ。
 * @param {object} completion 発見数と完成率。
 * @returns {void}
 */
function renderCodexProgress(completion) {
  const text = document.getElementById("codexProgressText");
  const bar = document.getElementById("codexProgressBar");
  if (text) text.textContent = "発見 " + completion.caught + " / " + completion.total + "種";
  if (bar) {
    bar.max = completion.total;
    bar.value = completion.caught;
  }
  const rewards = document.getElementById("codexRewards");
  if (rewards) {
    const unlocked = fishingRewards(state).unlocked;
    const labels = ["釣り仲間の伝手：海兵系の雇用枠", "漁師の伝手：漁船の購入", "鮮度を保つ知恵：魚売値＋20%", "海を知る者：毎季節信仰＋5"];
    rewards.innerHTML = labels.map((label, i) => '<p class="tiny">' + (i + 1) * 25 + "%・" + (unlocked[i] ? "解放済み" : "未解放") + "：" + label + "</p>").join("");
  }
}

/**
 * 項目名から定義を返す。
 * @param {string} group 項目ID。
 * @returns {object|undefined} 項目定義。
 */
function filterGroup(group) {
  return FILTER_GROUPS.find(item => item.id === group);
}

/**
 * 季節は数値、分類と海域はIDとして選択値を扱う。
 * @param {string} group 項目ID。
 * @param {string} key 選択値。
 * @returns {string|number} 内部の選択値。
 */
function filterValue(group, key) {
  return group === "season" ? Number(key) : key;
}

/**
 * 海域の表示名を短縮する。
 * @param {object} group 項目定義。
 * @param {string} key 選択値。
 * @returns {string} 表示名。
 */
function filterLabel(group, key) {
  const label = group.values[key];
  return group.id === "region" ? label.replace(/海域$/, "") : label;
}

/**
 * フィルタのボタンを初回だけ生成する。操作時は同じ要素を更新し、フォーカスを保持する。
 * @returns {void}
 */
function createCodexFilters() {
  const wrap = elements.codexFilterWrap;
  if (!wrap) return;
  for (const group of FILTER_GROUPS) {
    const box = wrap.querySelector('[data-group="' + group.id + '"]');
    if (!box) continue;
    for (const key of Object.keys(group.values)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.dataset.codexFilter = "";
      button.dataset.group = group.id;
      button.dataset.key = key;
      button.setAttribute("aria-pressed", "false");
      const label = document.createElement("span");
      label.textContent = filterLabel(group, key);
      button.appendChild(label);
      if (group.id === "category") {
        const progress = document.createElement("small");
        progress.className = "codex-filter-progress";
        button.appendChild(progress);
      }
      box.appendChild(button);
    }
  }
}

/**
 * 選択中の条件を表示用の配列にする。検索も個別解除と全解除の対象にする。
 * @returns {object[]} 条件の項目・値・表示名。
 */
function activeCodexFilters() {
  const active = [];
  if (codexView.searchText.trim()) active.push({ group: "search", key: "", label: "検索：" + codexView.searchText.trim() });
  for (const group of FILTER_GROUPS) {
    for (const key of Object.keys(group.values)) {
      if (codexView.filters[group.field].has(filterValue(group.id, key))) {
        active.push({ group: group.id, key, label: group.label + "：" + filterLabel(group, key) });
      }
    }
  }
  return active;
}

/**
 * 選択条件を差分更新する。既存の解除ボタンを残し、ほかの条件を変更してもフォーカスを保つ。
 * @returns {void}
 */
function renderActiveCodexFilters() {
  const active = activeCodexFilters();
  const area = document.getElementById("codexActiveFilters");
  const chips = document.getElementById("codexFilterChips");
  if (area) area.hidden = active.length === 0;
  if (!chips) return;
  const previous = Array.from(chips.children);
  for (const item of active) {
    let chip = previous.find(button => button.dataset.group === item.group && button.dataset.key === item.key);
    if (!chip) {
      chip = document.createElement("button");
      chip.type = "button";
      chip.className = "btn ghost codex-filter-chip";
      chip.dataset.codexRemove = "";
      chip.dataset.group = item.group;
      chip.dataset.key = item.key;
      chips.appendChild(chip);
    }
    chip.textContent = item.label + " ×";
    chip.setAttribute("aria-label", item.label + "の条件を解除");
  }
  for (const chip of previous) {
    if (!active.some(item => item.group === chip.dataset.group && item.key === chip.dataset.key)) chip.remove();
  }
}

/**
 * 条件・件数・公開範囲の説明を同期する。未公開の魚の情報は条件候補にも含めない。
 * @param {object} completion 発見数と完成率。
 * @returns {void}
 */
function renderCodexTools(completion) {
  const tools = elements.codexModal?.querySelector(".codex-tools");
  if (tools) tools.hidden = !!codexView.selectedId;
  const panel = document.getElementById("codexFilterPanel");
  const toggle = document.getElementById("codexFilterToggle");
  if (panel) panel.hidden = !codexView.filtersOpen;
  if (toggle) toggle.setAttribute("aria-expanded", String(codexView.filtersOpen));
  const count = Object.values(codexView.filters).reduce((total, selected) => total + selected.size, 0);
  const counter = document.getElementById("codexFilterCount");
  if (counter) counter.textContent = count ? "（" + count + "）" : "";
  if (!codexView.searchComposing && elements.codexSearch && elements.codexSearch.value !== codexView.searchText) {
    elements.codexSearch.value = codexView.searchText;
  }
  for (const button of elements.codexFilterWrap?.querySelectorAll("[data-codex-filter]") || []) {
    const group = filterGroup(button.dataset.group);
    const selected = codexView.filters[group.field].has(filterValue(group.id, button.dataset.key));
    button.classList.toggle("primary", selected);
    button.setAttribute("aria-pressed", String(selected));
    const progress = button.querySelector(".codex-filter-progress");
    if (progress) {
      const species = FISH_SPECIES.filter(item => item.category === button.dataset.key);
      const found = species.filter(item => (state.expansion.fishing.codex[item.id]?.count || 0) > 0).length;
      progress.textContent = found + "/" + species.length;
      button.setAttribute("aria-label", filterLabel(group, button.dataset.key) + "、発見 " + found + " / " + species.length + "種");
    }
  }
  const notice = document.getElementById("codexFilterNotice");
  if (notice) {
    const reasons = [];
    if (codexView.searchText.trim()) reasons.push("魚名検索は発見済みの魚のみ。");
    if (codexView.filters.categories.size) reasons.push("分類指定中は未発見魚を除きます。");
    if (codexView.filters.seasons.size && completion.ratio < 0.25) reasons.push("未発見魚の季節検索は図鑑25%で解放。");
    notice.textContent = reasons.join(" ");
    notice.hidden = reasons.length === 0;
  }
  renderActiveCodexFilters();
}

/**
 * 図鑑の一覧または詳細を描画し、進捗と条件を同期する。
 * @returns {void}
 */
function renderCodexModal() {
  const body = elements.codexBody;
  if (!body) return;
  if (codexView.selectedId && !FISH_SPECIES.some(item => item.id === codexView.selectedId)) codexView.selectedId = null;
  const completion = codexCompletion(state.expansion.fishing.codex);
  renderCodexProgress(completion);
  renderCodexTools(completion);
  if (codexView.selectedId) renderCodexDetail(body);
  else renderCodexList(body);
}

/**
 * 条件を変更して一覧の先頭を表示する。
 * @returns {void}
 */
function refreshCodexFilters() {
  renderCodexModal();
  elements.codexBody?.closest(".codex-list")?.scrollTo(0, 0);
}

/**
 * 図鑑を開く。検索と条件は保持し、一覧の先頭から閲覧する。
 * @returns {void}
 */
export function openCodexModal() {
  wireCodexModal();
  codexView.selectedId = null;
  codexView.listScroll = 0;
  renderCodexModal();
  elements.codexBody?.closest(".codex-list")?.scrollTo(0, 0);
  if (elements.codexModal) elements.codexModal.hidden = false;
}

/**
 * 図鑑を閉じる。
 * @returns {void}
 */
function closeCodexModal() {
  if (elements.codexModal) elements.codexModal.hidden = true;
}

/**
 * 分類・海域・季節の選択を切り替える。未知の項目や値は無視する。
 * @param {string} groupId 項目ID。
 * @param {string} key 選択値。
 * @returns {void}
 */
function toggleCodexFilter(groupId, key) {
  const group = filterGroup(groupId);
  if (!group || !Object.hasOwn(group.values, key)) return;
  const selected = codexView.filters[group.field];
  const value = filterValue(groupId, key);
  if (selected.has(value)) selected.delete(value);
  else selected.add(value);
  refreshCodexFilters();
}

/**
 * 検索と全項目の選択を解除する。
 * @returns {void}
 */
function clearCodexFilters() {
  codexView.searchText = "";
  codexView.searchComposing = false;
  for (const selected of Object.values(codexView.filters)) selected.clear();
  refreshCodexFilters();
  elements.codexSearch?.focus({ preventScroll: true });
}

/**
 * 条件を一つだけ解除し、残る条件または検索欄へフォーカスを移す。
 * @param {HTMLElement} chip 操作した条件ボタン。
 * @returns {void}
 */
function removeCodexFilter(chip) {
  const chips = document.getElementById("codexFilterChips");
  const index = Array.from(chips.children).indexOf(chip);
  if (chip.dataset.group === "search") codexView.searchText = "";
  else {
    const group = filterGroup(chip.dataset.group);
    if (!group) return;
    codexView.filters[group.field].delete(filterValue(group.id, chip.dataset.key));
  }
  refreshCodexFilters();
  const next = chips.children[Math.min(index, chips.children.length - 1)];
  (next || elements.codexSearch)?.focus({ preventScroll: true });
}

/**
 * 図鑑の操作を一か所で受け取り、同じボタン要素を保ったまま表示を更新する。
 * @param {MouseEvent} event クリック操作。
 * @returns {void}
 */
function handleCodexClick(event) {
  if (event.target === elements.codexModal || event.target.closest("#codexModalClose")) {
    closeCodexModal();
    return;
  }
  if (event.target.closest("#codexFilterToggle")) {
    codexView.filtersOpen = !codexView.filtersOpen;
    renderCodexTools(codexCompletion(state.expansion.fishing.codex));
    return;
  }
  if (event.target.closest("#codexClearFilters, [data-codex-clear]")) {
    clearCodexFilters();
    return;
  }
  const chip = event.target.closest("[data-codex-remove]");
  if (chip) {
    removeCodexFilter(chip);
    return;
  }
  const filter = event.target.closest("[data-codex-filter]");
  if (filter) {
    toggleCodexFilter(filter.dataset.group, filter.dataset.key);
    return;
  }
  const list = elements.codexBody?.closest(".codex-list");
  const card = event.target.closest("[data-codex]");
  if (card && list) {
    codexView.listScroll = list.scrollTop;
    codexView.returnId = card.dataset.codex;
    codexView.selectedId = card.dataset.codex;
    renderCodexModal();
    list.scrollTop = 0;
    document.getElementById("codexBackBtn")?.focus({ preventScroll: true });
  } else if (event.target.closest("#codexBackBtn") && list) {
    codexView.selectedId = null;
    renderCodexModal();
    list.scrollTop = codexView.listScroll;
    elements.codexBody.querySelector('[data-codex="' + codexView.returnId + '"]')?.focus({ preventScroll: true });
  }
}

/**
 * 確定した検索文字列を反映する。日本語入力の変換中は入力欄を更新しない。
 * @param {InputEvent|CompositionEvent} event 検索入力。
 * @returns {void}
 */
function handleCodexSearch(event) {
  codexView.searchComposing = !!event.isComposing;
  if (codexView.searchComposing) return;
  codexView.searchText = event.target.value;
  refreshCodexFilters();
}

/**
 * 図鑑の入口から呼ばれる初期化。イベントは一度だけ配線し、ボタンを再生成しない。
 * @returns {void}
 */
export function wireCodexModal() {
  if (codexWired || !elements.codexModal || typeof document === "undefined") return;
  codexWired = true;
  createCodexFilters();
  elements.codexModal.addEventListener("click", handleCodexClick);
  elements.codexSearch?.addEventListener("input", handleCodexSearch);
  elements.codexSearch?.addEventListener("compositionend", handleCodexSearch);
  document.addEventListener("fishing-panel-update", () => {
    if (!elements.codexModal.hidden) renderCodexModal();
  });
}
