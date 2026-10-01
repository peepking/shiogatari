import { state, pending } from "../core/state.js";
import { settlements } from "../world/map.js";
import { ENDINGS } from "./endingConfig.js";
import { updateFinalVoyage, recordEnding, voyageSnapshot, canOpenFinalVoyage } from "./endings.js";
import { saveGameToStorage } from "../core/storage.js";
import { escapeHtml } from "../core/util.js";
import { statNumber } from "../core/voyageStats.js";
import { openWorldResetDialog } from "../ui/worldResetUI.js";
import { pushToast } from "../ui/dom.js";
import { DAY_PER_YEAR, DAY_PER_SEASON } from "../core/calendar.js";

let selected = null;
let currentStats = false;
let saved = true;

/** 絶対日を表示用の暦へ変換する。 @param {number} day 絶対日。 @returns {string} 日付。 */
function dateText(day) {
  const value = Math.max(1, statNumber(day)) - 1;
  return `神歴${Math.floor(value / DAY_PER_YEAR)}年 ${["春", "夏", "秋", "冬"][Math.floor(value % DAY_PER_YEAR / DAY_PER_SEASON)]} ${value % DAY_PER_SEASON + 1}日`;
}

/** 統計の数値を桁区切りにする。 @param {*} value 数値。 @returns {string} 表示値。 */
function number(value) { return statNumber(value).toLocaleString("ja-JP"); }

/** 独立した統計を表示し、当時の記録を現在値から切り離す。 @param {object} stats 統計。 @returns {string} 表示HTML。 */
export function renderVoyageStatistics(stats) {
  /** 原因別の数値を安全な整数の上限内で合算する。 @param {object} values 内訳。 @returns {number} 合計。 */
  const sum = values => Object.values(values || {}).reduce((n, value) => Math.min(Number.MAX_SAFE_INTEGER, n + statNumber(value)), 0);
  const groups = [
    ["旅と戦い", [
      ["航海期間", `${number(Math.floor(stats.elapsed / DAY_PER_YEAR))}年 ${number(stats.elapsed % DAY_PER_YEAR)}日`],
      ["訪問拠点", `村 ${number(stats.visitCounts?.village)} / 街 ${number(stats.visitCounts?.town)} / 無法港 ${number(stats.visitCounts?.haven)}`],
      ["海図の達成数", `${number(stats.chartsCompleted)}件（報酬回収済み）`],
      ["戦闘", `勝利 ${number(stats.battles?.win)} / 敗北 ${number(stats.battles?.lose)} / 引き分け ${number(stats.battles?.draw)}`],
      ["撃破した敵兵", `${number(stats.enemyDefeated)}人（戦闘不能）`],
      ["累計兵士損耗", `${number(sum(stats.losses))}人`],
      ["損耗の内訳", `戦闘 ${number(stats.losses?.battle)} / 食料不足 ${number(stats.losses?.food)} / 維持費不足 ${number(stats.losses?.upkeep)} / 災い ${number(stats.losses?.calamity)} / その他 ${number(stats.losses?.other)}`],
      ["賞金首討伐", `${number(stats.bountiesDefeated)}件`],
    ]],
    ["資産", [
      ["累計収入", number(stats.income)], ["累計支出", number(sum(stats.expenses))],
      ["支出の内訳", `取引 ${number(stats.expenses?.trade)} / 雇用 ${number(stats.expenses?.hire)} / 維持費 ${number(stats.expenses?.upkeep)} / 支援 ${number(stats.expenses?.support)} / その他 ${number(stats.expenses?.other)}`],
      ["累計手配賞金", number(stats.wantedEarned)], ["累計獲得信仰", number(stats.faithEarned)],
      ["固有船", `累計獲得 ${number(stats.variantsAcquired)}隻 / 記録時の保有 ${number(stats.variantsOwned)}隻`],
      ["最高規模", `船団 ${number(stats.peaks?.ships)}隻 / 部隊 ${number(stats.peaks?.troops)}人 / 名声 ${number(stats.peaks?.fame)}`],
    ]],
    ["人々への支援", [
      ["救助した難民", `${number(stats.refugeesRescued)}人`], ["潮盟へ送り出した担い手", `${number(stats.tidePeople)}人`], ["潮盟への資金支援", number(stats.tideFunds)],
    ]],
    ["釣り", [
      ["魚図鑑", `${number(stats.fishSpecies)} / ${number(stats.fishTotal)}種（${stats.fishTotal ? Math.floor(stats.fishSpecies / stats.fishTotal * 100) : 0}%）`],
      ["釣り上げた魚", `${number(stats.fishCaught)}匹`],
      ["最大の魚", stats.largestFish ? `${stats.largestFish.name} ${stats.largestFish.size}cm / ${dateText(stats.largestFish.day)}` : "まだ記録がありません"],
    ]],
  ];
  return `${stats.partial ? `<p class="note">累計・最高値・訪問記録は${dateText(stats.measuredAbs)}から計測しています。図鑑と航海期間は引き継いでいます。</p>` : ""}${groups.map(([title, rows]) => `<section class="ending-stat-group"><h3>${title}</h3><dl>${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></section>`).join("")}`;
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
  body.innerHTML = `<article class="ending-story"><h2>${ending.name}</h2><p>${ending.body}</p><p class="tiny">神話の記録日：${dateText(record.day)}。この結末は旅を語り継ぐ物語です。続行しても船や部隊は失われません。</p></article><div class="row flex-wrap"><button class="btn ghost" type="button" data-ending-back>他の結末を選ぶ</button><button class="btn" type="button" data-ending-stats>${currentStats ? "記録時の統計を見る" : "現在の統計を見る"}</button></div><h2>${currentStats ? "現在の航海" : "この神話を記録した時点の航海統計"}</h2>${renderVoyageStatistics(stats)}${saved ? "" : '<p class="note" role="alert">記録を保存できませんでした。現在の航海は維持されています。</p><button class="btn" type="button" data-ending-save>保存を再試行</button>'}`;
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

/** 結末選択・統計切替・保存再試行を処理する。 @param {MouseEvent} event クリック。 */
function bodyClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.ending) choose(button.dataset.ending);
  else if (button.hasAttribute("data-ending-back")) { selected = null; renderDialog(); }
  else if (button.hasAttribute("data-ending-stats")) { currentStats = !currentStats; renderDialog(); }
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
