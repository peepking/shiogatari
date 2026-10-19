import { state, pending } from "../core/state.js";
import { settlements } from "../world/map.js";
import { ENDINGS } from "./endingConfig.js";
import { updateFinalVoyage, recordEnding, voyageSnapshot, canOpenFinalVoyage } from "./endings.js";
import { saveGameToStorage } from "../core/storage.js";
import { escapeHtml } from "../core/util.js";
import { dateText, voyageStatisticGroups, voyageMeasurementNote, formatVoyageMarkdown } from "./voyageReport.js";
import { openWorldResetDialog } from "../ui/worldResetUI.js";
import { pushToast } from "../ui/dom.js";

let selected = null;
let currentStats = false;
let saved = true;

/** 独立した統計を表示し、当時の記録を現在値から切り離す。 @param {object} stats 統計。 @returns {string} 表示HTML。 */
export function renderVoyageStatistics(stats) {
  const note = voyageMeasurementNote(stats);
  return `${note ? `<p class="note">${escapeHtml(note)}</p>` : ""}${voyageStatisticGroups(stats).map(([title, rows]) => `<section class="ending-stat-group"><h3>${title}</h3><dl>${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></section>`).join("")}`;
}

/** 他の確定処理の画面を中断せずに開けるか確認する。 @returns {boolean} 利用可能。 */
function available() {
  return canOpenFinalVoyage(state, pending) && ["battleResultModal", "eventModal", "fishingModal", "detentionModal"].every(id => document.getElementById(id)?.hidden !== false);
}

/** 解放済み結末の選択または本文を描画する。 @returns {void} */
function renderDialog() {
  const body = document.getElementById("finalVoyageBody");
  if (!body) return;
  const unlocked = ENDINGS.filter(e => state.finalVoyage?.unlocked?.[e.id]);
  const ending = unlocked.find(e => e.id === selected);
  if (!ending) {
    body.innerHTML = `<p class="note">この旅を、どの神話として記しますか。記録した後も旅を続けられます。</p><div class="ending-choices">${unlocked.map(e => `<button type="button" class="btn ending-choice" data-ending="${e.id}"><strong>${e.name}${state.finalVoyage.records[e.id] ? " · 記録済み" : ""}</strong><span>${e.description}</span></button>`).join("")}</div>`;
    return;
  }
  const record = state.finalVoyage.records[ending.id];
  const stats = currentStats ? voyageSnapshot(state, settlements) : record.snapshot;
  body.innerHTML = `<article class="ending-story"><h2>${ending.name}</h2><p>${ending.body}</p><p class="tiny">神話の記録日：${dateText(record.day)}。この結末は旅を語り継ぐ物語です。続行しても船や部隊は失われません。</p></article><div class="row flex-wrap"><button class="btn ghost" type="button" data-ending-back>他の結末を選ぶ</button><button class="btn" type="button" data-ending-stats>${currentStats ? "記録時の統計を見る" : "現在の統計を見る"}</button><button class="btn" type="button" data-ending-export>Markdownで保存</button><button class="btn" type="button" data-ending-copy>Markdownをコピー</button></div><h2>${currentStats ? "現在の航海" : "この神話を記録した時点の航海統計"}</h2>${renderVoyageStatistics(stats)}${saved ? "" : '<p class="note" role="alert">記録を保存できませんでした。現在の航海は維持されています。</p><button class="btn" type="button" data-ending-save>保存を再試行</button>'}`;
}

/** 表示中の神話と統計をUTF-8のMarkdownファイルとして保存する。 @returns {void} */
function downloadMarkdown() {
  const ending = ENDINGS.find(e => e.id === selected);
  const record = state.finalVoyage?.records?.[selected];
  if (!ending || !record) return;
  const stats = currentStats ? voyageSnapshot(state, settlements) : record.snapshot;
  let url, link;
  try {
    const blob = new Blob([formatVoyageMarkdown(ending, record, stats, currentStats)], { type: "text/markdown;charset=utf-8" });
    url = URL.createObjectURL(blob);
    link = document.createElement("a");
    link.href = url;
    link.download = `shiogatari-final-voyage-${ending.id}-${currentStats ? "current" : "record"}-${stats.day}.md`;
    document.body.append(link);
    link.click();
  } catch {
    pushToast("最終航海", "Markdownを保存できませんでした。もう一度お試しください。", "bad");
  } finally {
    link?.remove();
    /** ブラウザが読み取りを開始してから一時URLを解放する。 @returns {void} */
    const releaseURL = () => URL.revokeObjectURL(url);
    if (url) setTimeout(releaseURL, 1000);
  }
}

/** 表示中の神話と統計をMarkdownでコピーし、成否を通知する。 @returns {Promise<void>} コピー完了。 */
async function copyMarkdown() {
  const ending = ENDINGS.find(e => e.id === selected);
  const record = state.finalVoyage?.records?.[selected];
  if (!ending || !record) return;
  const stats = currentStats ? voyageSnapshot(state, settlements) : record.snapshot;
  try {
    await navigator.clipboard.writeText(formatVoyageMarkdown(ending, record, stats, currentStats));
    pushToast("最終航海", "Markdownをクリップボードにコピーしました。", "good");
  } catch {
    pushToast("最終航海", "コピーできませんでした。「Markdownで保存」をご利用ください。", "bad");
  }
}

/** 初回の結末と統計を記録して本文へ移る。 @param {string} id 結末ID。 */
function choose(id) {
  if (!recordEnding(state, id, settlements)) return;
  selected = id;
  currentStats = false;
  saved = saveGameToStorage();
  renderDialog();
  document.getElementById("finalVoyageClose")?.focus();
}

/** モーダルを閉じ、旅の行動へ戻す。 @returns {void} */
function close() {
  const modal = document.getElementById("finalVoyageModal");
  if (modal) modal.hidden = true;
  document.getElementById("finalVoyageBtn")?.focus();
}

/** 自動移動を止めて解放済みの結末を表示する。 @returns {void} */
function open() {
  if (!available()) return;
  const ids = ENDINGS.filter(e => state.finalVoyage?.unlocked?.[e.id]);
  if (!ids.length) return;
  document.dispatchEvent(new CustomEvent("auto-move-stop"));
  selected = null;
  if (ids.length === 1) choose(ids[0].id);
  else renderDialog();
  document.getElementById("finalVoyageModal").hidden = false;
  document.getElementById("finalVoyageClose")?.focus();
}

/** 結末画面から共通リセットを開き、取消時は同じ結末へ戻る。 @returns {void} */
function restart() {
  const modal = document.getElementById("finalVoyageModal");
  modal.hidden = true;
  openWorldResetDialog({ returnFocus: document.getElementById("finalVoyageRestart"),
    /** 取消時に記録画面を復帰する。 */
    onCancel() { modal.hidden = false; document.getElementById("finalVoyageRestart").focus(); } });
}

/** 結末選択・統計切替・Markdown出力とコピー・保存再試行を処理する。 @param {MouseEvent} event クリック。 @returns {Promise<void>} 操作完了。 */
async function bodyClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.ending) choose(button.dataset.ending);
  else if (button.hasAttribute("data-ending-back")) { selected = null; renderDialog(); }
  else if (button.hasAttribute("data-ending-stats")) { currentStats = !currentStats; renderDialog(); }
  else if (button.hasAttribute("data-ending-export")) downloadMarkdown();
  else if (button.hasAttribute("data-ending-copy")) await copyMarkdown();
  else if (button.hasAttribute("data-ending-save")) { saved = saveGameToStorage(); renderDialog(); }
  document.getElementById("finalVoyageClose")?.focus();
}

/** Escapeで閉じ、キーボードの焦点をダイアログ内へ保つ。 @param {KeyboardEvent} event キー操作。 */
function keydown(event) {
  if (event.key === "Escape") { event.preventDefault(); close(); return; }
  if (event.key !== "Tab") return;
  const buttons = [...document.getElementById("finalVoyageModal").querySelectorAll("button")];
  const first = buttons[0], last = buttons.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

/** 初期化時に操作を一度だけ接続する。 @returns {void} */
export function wireFinalVoyageUI() {
  const modal = document.getElementById("finalVoyageModal");
  if (!modal || modal.dataset.bound) return;
  modal.dataset.bound = "true";
  document.getElementById("finalVoyageBtn")?.addEventListener("click", open);
  document.getElementById("finalVoyageClose")?.addEventListener("click", close);
  document.getElementById("finalVoyageContinue")?.addEventListener("click", close);
  document.getElementById("finalVoyageRestart")?.addEventListener("click", restart);
  document.getElementById("finalVoyageBody")?.addEventListener("click", bodyClick);
  modal.addEventListener("keydown", keydown);
  /** 背景を押した場合だけ閉じる。 @param {MouseEvent} event クリック。 */
  modal.addEventListener("click", function backdrop(event) { if (event.target === modal) close(); });
}

/** 確定状態で解放を保存し、旅の行動へボタンを追加する。 @returns {void} */
export function renderFinalVoyageControl() {
  if (canOpenFinalVoyage(state, pending)) {
    const added = updateFinalVoyage(state, settlements);
    if (added.length) pushToast("最終航海", `${added.map(id => ENDINGS.find(e => e.id === id).name).join("・")}を記録できるようになりました。`, "good");
  }
  const button = document.getElementById("finalVoyageBtn");
  if (!button) return;
  button.hidden = !Object.keys(state.finalVoyage?.unlocked || {}).length;
  button.disabled = !available();
}
