import { state } from "../core/state.js";
import { MODE_LABEL } from "../core/constants.js";
import { totalTroops, TROOP_STATS } from "../resources/troops.js";
import { focusMapPosition } from "../world/map.js";
import { saveGameToStorage } from "../core/storage.js";
import { escapeHtml } from "../core/util.js";
import { pushToast } from "../ui/dom.js";
import { resourceIcon } from "../ui/resourceUI.js";
import { PIRATE_LORDS, PIRATE_KING, pirateStoryTarget } from "./pirateKingConfig.js";
import { pirateStoryEncounter } from "./pirateKingStory.js";
import { VARIANT_SHIPS, variantBonusText } from "../fleet/variantShips.js";

/** @returns {object|null} 現在地で任意討伐できる物語対象。 */
export function pirateStoryAt() {
  const site = state.pirateKingStory?.active;
  return site?.position.x === state.position.x && site.position.y === state.position.y ? site : null;
}

/** 先に保存可否を確認し、準備の保存失敗時は現在の旅へ戻す。 @param {Function} sync 表示同期。 @returns {boolean} 開始したか。 */
export function beginPirateStoryBattle(sync) {
  if (!pirateStoryAt() || state.modeLabel !== MODE_LABEL.NORMAL || state.pendingEncounter?.active || state.eventQueue?.length || totalTroops() <= 0 || state.expansion?.exploration?.pending || state.expansion?.charts?.pending || state.expansion?.fishing?.pending) return false;
  if (!saveGameToStorage()) { pushToast("保存できません", "討伐準備は開始していません。", "warn"); return false; }
  state.pendingEncounter = pirateStoryEncounter(state.pirateKingStory);
  state.modeLabel = MODE_LABEL.PREP;
  if (!saveGameToStorage()) {
    state.pendingEncounter = { active: false }; state.modeLabel = MODE_LABEL.NORMAL;
    pushToast("保存できません", "討伐準備は開始していません。", "warn"); sync(); return false;
  }
  document.dispatchEvent(new CustomEvent("auto-move-stop")); sync(); return true;
}

/** @param {Array} formation 編成。 @returns {string} 兵種別人数とレベル。 */
function formationText(formation) {
  const counts = {};
  for (const u of formation || []) counts[u.type] = (counts[u.type] || 0) + u.count;
  return Object.entries(counts).map(([id, n]) => `${escapeHtml(TROOP_STATS[id]?.name || id)} ${n}人`).join(" / ");
}

/** 現地の対象と固定部隊・報酬を表示し、戦闘はボタンで任意に開始する。 @param {Function} sync 表示同期。 @returns {void} */
function openPirateStoryModal(sync) {
  const site = pirateStoryAt(), modal = document.getElementById("pirateStoryModal"), body = document.getElementById("pirateStoryBody");
  if (!site || !modal || !body || state.modeLabel !== MODE_LABEL.NORMAL || state.pendingEncounter?.active) return;
  const target = pirateStoryTarget(site.id), king = site.id === PIRATE_KING.id, previous = document.activeElement;
  const close = () => { modal.hidden = true; previous?.focus(); };
  const closeButton = document.getElementById("pirateStoryClose");
  closeButton.onclick = close;
  modal.onclick = e => { if (e.target === modal) close(); };
  modal.onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.getElementById("pirateStoryTitle").textContent = target.name;
  body.innerHTML = `<article class="bounty-card"><h3>${escapeHtml(target.name)}</h3><p>${king ? "海図が示した海に、王の旗が静かに揺れている。二つの戦いを越えた先に、その旗の答えがある。" : escapeHtml(target.rumor)}</p>
    <p>${king ? "2連戦：1戦目200人 / 2戦目は前衛200人＋予備隊100人。戦いの間に編成を変更できます。敗北・引き分け・離脱後は1戦目から再挑戦します。" : `200人 / Lv${site.formation[0].level} / 討伐報酬：海賊王の海図の破片1枚`}</p>
    <details><summary>部隊と報酬</summary><p>前衛：${formationText(site.formation)}</p>${king ? `<p>2戦目の前衛：${formationText(site.finalFormation)}</p><p>2戦目の予備隊：${formationText(site.reserve)}</p><p>ヴァイキングシップ1隻：人数容量＋50 / 物資容量＋100 / 全兵員HP＋20%（1隻分まで）</p>` : `<p>${VARIANT_SHIPS[target.variantId].name}1隻：${variantBonusText(target.variantId)}</p>`}<p>期限はありません。再挑戦時の敵は全快します。</p></details>
    <button class="btn good" id="pirateStoryFight" ${totalTroops() <= 0 ? "disabled" : ""}>討伐の準備</button>${totalTroops() <= 0 ? '<p class="tiny">部隊員が必要です。</p>' : ""}</article>`;
  document.getElementById("pirateStoryFight").onclick = () => { if (beginPirateStoryBattle(sync)) close(); };
  modal.hidden = false; closeButton.focus();
}

/** 専用海図は通常海図の枠・達成統計から独立し、取得済みの船長を読み返せる。
 * @param {Function} sync 表示同期。 @returns {void}
 */
export function renderPirateStoryControls(sync) {
  const data = state.pirateKingStory, panel = document.getElementById("pirateStoryPanel"), visit = document.getElementById("pirateStoryVisitBtn");
  const locked = state.pendingEncounter?.active || state.modeLabel !== MODE_LABEL.NORMAL || state.eventQueue?.length || state.expansion?.exploration?.pending || state.expansion?.charts?.pending || state.expansion?.fishing?.pending;
  if (visit) {
    const site = pirateStoryAt(); visit.hidden = !site || !!locked;
    visit.textContent = site ? `${pirateStoryTarget(site.id).name}を確認` : "海賊五列強を確認";
    visit.onclick = () => openPirateStoryModal(sync);
  }
  if (!panel || !data) return;
  panel.hidden = !data.active && !data.waitingId && !data.defeated.length && !data.completed;
  if (panel.hidden) { panel.innerHTML = ""; return; }
  const target = data.active ? pirateStoryTarget(data.active.id) : null;
  const status = data.completed ? "海賊王を討伐・海没神話への航路が開かれた" : target ? `${target.name}を討伐する` : data.waitingId ? "船影の位置を待っている" : "次の船長の噂を探す";
  panel.innerHTML = `<article class="chart-card quest-progress-card"><div class="chart-heading">${resourceIcon("chart")}<b>海賊王の海図</b><span>${data.defeated.length}/6枚</span></div><div class="tiny">${status}</div><progress max="6" value="${data.defeated.length}" aria-label="海賊王の海図 取得${data.defeated.length}枚"></progress>
    ${target ? '<button class="btn chart-location" id="pirateStoryLocation">対象を地図で確認</button>' : ""}
    <details class="quest-description"><summary>海賊五列強と海図の記録</summary>${PIRATE_LORDS.map(lord => `<p>${data.defeated.includes(lord.id) ? "討伐済み" : data.active?.id === lord.id ? "発見済み" : "未発見"}：${escapeHtml(lord.name)}</p>`).join("")}<p class="tiny">海賊五列強と呼ばれる六人が、それぞれ海図の破片を持っています。期限はありません。この海図は通常の海図達成数に含まれません。</p></details></article>`;
  const location = document.getElementById("pirateStoryLocation");
  if (location) location.onclick = () => { if (state.pirateKingStory?.active) focusMapPosition(state.pirateKingStory.active.position); };
}
