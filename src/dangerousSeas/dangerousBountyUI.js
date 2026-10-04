import { state } from "../core/state.js";
import { MODE_LABEL } from "../core/constants.js";
import { escapeHtml } from "../core/util.js";
import { TROOP_STATS, totalTroops } from "../resources/troops.js";
import { resourceIcon } from "../ui/resourceUI.js";
import { focusMapPosition } from "../world/map.js";
import { saveGameToStorage } from "../core/storage.js";
import { pushToast } from "../ui/dom.js";
import { SHIP_TYPES } from "../fleet/shipConfig.js";
import { variantBonusText } from "../fleet/variantShips.js";
import { getDangerousBountyAt } from "./dangerousBountyWorld.js";
import { buildDangerousBountyEncounter } from "./dangerousBounty.js";
import { dangerousSeaName } from "./dangerousSeaConfig.js";

/** @param {object} site 専用個体。 @returns {string} 討伐を開始できない理由。 */
export function dangerousBountyRestriction(site) {
  if (!site) return "この賞金首はすでに姿を消しています。";
  if ((state.honorFactions || []).includes("pirates")) return "名誉家臣として所属勢力の賞金首は討伐できません。";
  if (totalTroops() <= 0) return "討伐には部隊員が必要です。";
  return "";
}

/** @param {object} site 専用個体。 @returns {string} 既存の賞金首カードと共通の詳細表示。 */
function dangerousBountyCard(site) {
  const troops = {};
  for (const unit of site.formation) troops[unit.type] = (troops[unit.type] || 0) + unit.count;
  const reason = dangerousBountyRestriction(site), name = `${site.epithet}${site.name}`;
  const here = getDangerousBountyAt(state.position)?.id === site.id;
  return `<article class="bounty-card"><div class="bounty-heading"><h3>${escapeHtml(name)}</h3><strong>${resourceIcon("funds")}${site.reward.toLocaleString()}</strong></div>
    <div class="bounty-affiliation"><img class="resource-icon" src="./image/factions/pirates.svg" alt="">外洋海賊 / ${dangerousSeaName(site.regionId)}</div>
    <p>${escapeHtml(site.description)}</p><div class="bounty-meta">${site.total}人・${site.formation.length}部隊 / Lv${site.formation[0].level} / (${site.position.x + 1}, ${site.position.y + 1})</div>
    <details><summary>編成・討伐の影響</summary><p>${Object.entries(troops).map(([id, count]) => `${escapeHtml(TROOP_STATS[id]?.name || id)} ${count}人`).join(" / ")}</p>
    <p>黒ひげ −3 / その他の勢力の貴族全員 ＋1</p><p>賞金に加えて通常の戦闘報酬を獲得します。</p>
    <p>${escapeHtml(site.flagship)}：${escapeHtml(SHIP_TYPES[site.ship].name)} 1隻<br>${variantBonusText(site.templateId)}</p></details>
    ${reason ? `<p class="tiny">${escapeHtml(reason)}</p>` : ""}<div class="row"><button class="btn" data-dangerous-bounty-map="${site.id}">地図で確認</button>
    ${here ? `<button class="btn good" data-dangerous-bounty-fight="${site.id}" ${reason ? "disabled" : ""}>討伐の準備</button>` : ""}</div></article>`;
}

/** 確定準備を保存してから画面を切り替え、保存失敗では開始前へ戻す。
 * @param {number} id 専用個体ID。 @param {Function} sync 表示同期。 @returns {boolean} 準備を開始できたか。
 */
export function beginDangerousBounty(id, sync) {
  const site = getDangerousBountyAt(state.position);
  if (site?.id !== id || dangerousBountyRestriction(site) || state.modeLabel !== MODE_LABEL.NORMAL || state.pendingEncounter?.active
    || state.expansion?.exploration?.pending || state.expansion?.charts?.pending || state.expansion?.fishing?.pending || state.wanted?.detention
    || state.eventQueue?.length || (state.dangerousSeas?.pendingHazard && state.dangerousSeas.pendingHazard.stage !== "watch") || state.dangerousSeas?.action || state.dangerousSeas?.explorationPending || state.dangerousSeas?.events?.pending) return false;
  if (!saveGameToStorage()) { pushToast("保存できません", "保存容量を確認してから再度お試しください。", "warn"); return false; }
  const previous = state.pendingEncounter;
  state.pendingEncounter = buildDangerousBountyEncounter(site); state.modeLabel = MODE_LABEL.PREP;
  if (!saveGameToStorage()) {
    state.pendingEncounter = previous; state.modeLabel = MODE_LABEL.NORMAL;
    pushToast("保存できません", "討伐準備は開始していません。", "warn"); sync?.(); return false;
  }
  document.dispatchEvent(new CustomEvent("auto-move-stop")); sync?.(); return true;
}

/** 既存の一覧モーダルへ独立枠を追加し、専用個体IDだけを操作する。
 * @param {HTMLElement} container 表示先。 @param {Function} sync 表示同期。 @param {object|null} [site=null] 現地だけの表示対象。
 * @returns {void}
 */
export function renderDangerousBountyList(container, sync, site = null) {
  const section = document.createElement("section"), active = site ? [site] : state.dangerousSeas?.bounties?.active || [];
  section.innerHTML = `<h3>危険海域の賞金首</h3><p class="tiny">各海域2人まで。通常の賞金首とは別枠です。</p><div class="bounty-list">${active.map(dangerousBountyCard).join("") || "<p>現在、活動中の賞金首はいません。</p>"}</div>`;
  container.append(section);
  const modal = document.getElementById("bountyModal");
  section.querySelectorAll("[data-dangerous-bounty-map]").forEach(button => {
    button.onclick = () => {
      const target = state.dangerousSeas.bounties.active.find(row => row.id === Number(button.dataset.dangerousBountyMap));
      if (target) { if (modal) modal.hidden = true; focusMapPosition(target.position); }
    };
  });
  section.querySelectorAll("[data-dangerous-bounty-fight]").forEach(button => {
    button.onclick = () => { if (beginDangerousBounty(Number(button.dataset.dangerousBountyFight), sync) && modal) modal.hidden = true; };
  });
}

/** 既存の詳細モーダルを用いて現地個体を表示する。 @param {Function} sync 表示同期。 @returns {void} */
function openDangerousBounty(sync) {
  const site = getDangerousBountyAt(state.position), modal = document.getElementById("bountyModal"), body = document.getElementById("bountyBody");
  if (!site || !modal || !body) return;
  const previous = document.activeElement;
  /** @returns {void} 詳細を閉じて元の操作へ戻す。 */
  function close() { modal.hidden = true; previous?.focus(); }
  document.getElementById("bountyCloseBtn").onclick = close;
  modal.onclick = event => { if (event.target === modal) close(); };
  modal.onkeydown = event => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
  body.innerHTML = ""; renderDangerousBountyList(body, sync, site);
  modal.hidden = false; document.getElementById("bountyCloseBtn").focus();
}

/** 通常賞金首の操作を残し、専用の現地確認ボタンを更新する。 @param {Function} sync 表示同期。 @returns {void} */
export function renderDangerousBountyControls(sync) {
  let button = document.getElementById("dangerousBountyVisitBtn");
  if (!button) {
    const existing = document.getElementById("bountyVisitBtn");
    if (!existing) return;
    button = document.createElement("button"); button.id = "dangerousBountyVisitBtn"; button.className = "btn"; existing.after(button);
  }
  const site = getDangerousBountyAt(state.position);
  button.hidden = !site || state.modeLabel !== MODE_LABEL.NORMAL || state.pendingEncounter?.active || state.expansion?.fishing?.pending
    || state.dangerousSeas?.explorationPending || (state.dangerousSeas?.pendingHazard && state.dangerousSeas.pendingHazard.stage !== "watch") || state.dangerousSeas?.action || state.dangerousSeas?.events?.pending
    || state.expansion?.exploration?.pending || state.expansion?.charts?.pending || state.eventQueue?.length;
  button.textContent = site ? `${site.epithet}${site.name}を確認` : "危険海域の賞金首を確認";
  button.onclick = () => openDangerousBounty(sync);
}
