import { state } from "../core/state.js";
import { MODE_LABEL } from "../core/constants.js";
import { FACTIONS } from "../world/lore.js";
import { TROOP_STATS, totalTroops } from "../resources/troops.js";
import { bountyName, bountyFameBonus } from "./bounty.js";
import { bountyAt } from "./bountyWorld.js";
import { focusMapPosition, getTerrainAt } from "../world/map.js";
import { escapeHtml, SEASONS } from "../core/util.js";
import { CRIME_LABELS, CRIME_HISTORY_LIMIT } from "./bountyConfig.js";
import { DAY_PER_YEAR, DAY_PER_SEASON } from "../quests/questUtils.js";
import { resourceIcon } from "../ui/resourceUI.js";
import { SHIP_TYPES } from "../fleet/shipConfig.js";
import { variantBonusText } from "../fleet/variantShips.js";
import { saveGameToStorage } from "../core/storage.js";
import { pushToast } from "../ui/dom.js";
import { totalWanted, WANTED_FACTIONS, expireWanted } from "../wanted/playerWanted.js";
import { absDay } from "../quests/questUtils.js";
import { BOUNTY_CONFIG } from "./bountyConfig.js";
import { wantedSettlement } from "../wanted/wantedUI.js";
import { renderDangerousBountyList } from "../dangerousSeas/dangerousBountyUI.js";


/** @param {object} site 個体。 @returns {string} 討伐不可理由。 */
export function bountyRestriction(site) {
  if (!site) return "この賞金首はすでに姿を消しています。";
  if ((state.honorFactions || []).includes(site.factionId)) return "名誉家臣として所属勢力の賞金首は討伐できません。";
  if (totalTroops() <= 0) return "討伐には部隊員が必要です。";
  return "";
}

/** @param {string} id 勢力ID。 @returns {string} 勢力名と装飾アイコン。 */
function factionLabel(id) {
  const f = FACTIONS.find(f => f.id === id);
  return `<img class="resource-icon" src="${f?.sigil || `./image/factions/${id}.svg?v=20261011-heraldry`}" alt="">${escapeHtml(f?.name || id)}`;
}

/** @param {object} s 個体。 @returns {string} 一覧カード。 */
function bountyCard(s) {
  const troops = {};
  for (const u of s.formation) troops[u.type] = (troops[u.type] || 0) + u.count;
  const reason = bountyRestriction(s);
  return `<article class="bounty-card"><div class="bounty-heading"><h3>${escapeHtml(bountyName(s))}</h3><strong>${resourceIcon("funds")}${s.reward.toLocaleString()}</strong></div>
    <div class="bounty-affiliation">${factionLabel(s.factionId)}</div>
    <div class="bounty-meta">${s.total}人・${s.formation.length}部隊 / Lv${s.formation[0].level} / (${s.position.x + 1}, ${s.position.y + 1})</div>
    ${s.ship ? `<p class="bounty-reward">追加報酬：${escapeHtml(s.flagship)}（${escapeHtml(SHIP_TYPES[s.ship]?.name || "船")}）1隻</p>` : ""}
    <p class="bounty-reward">討伐ボーナス：${resourceIcon("fame")}名声 ＋${bountyFameBonus(s)}</p>
    <p class="bounty-impact">${s.factionId === "pirates" ? "黒ひげ" : "所属勢力の貴族全員"}の好感度 −3</p>
    <details><summary>人物・編成・報酬の詳細</summary><p>${escapeHtml(s.description)}</p><p>${Object.entries(troops).map(([id, n]) => `${escapeHtml(TROOP_STATS[id]?.name || id)} ${n}人`).join(" / ")}</p><p>その他の勢力の貴族全員の好感度 ＋1</p><p>通常の戦闘報酬も獲得します。</p>${s.ship ? `<p>${variantBonusText(s.templateId)}</p>` : ""}</details>
    ${reason ? `<p class="tiny">${escapeHtml(reason)}</p>` : ""}<div class="row"><button class="btn" data-bounty-map="${s.id}">地図で確認</button>${bountyAt(state.position)?.id === s.id ? `<button class="btn good" data-bounty-fight="${s.id}" ${reason ? "disabled" : ""}>討伐の準備</button>` : ""}</div></article>`;
}

/** 罪状は新しい順に表示し、長い履歴は内部でスクロールできる折りたたみにまとめる。 @param {object} wanted 手配状態。 @returns {string} 罪状欄。 */
function wantedCrimesHtml(wanted) {
  const history = wanted.history || [];
  const rows = history.map(row => {
    const index = row.day - 1;
    const year = Math.floor(index / DAY_PER_YEAR);
    const season = Math.floor((index % DAY_PER_YEAR) / DAY_PER_SEASON);
    const day = index % DAY_PER_SEASON + 1;
    const faction = row.factionId ? factionLabel(row.factionId) : "旧記録・対象勢力不明";
    return `<li><span class="tiny">神歴${year}年 ${SEASONS[season]} ${day}日</span><span>${escapeHtml(CRIME_LABELS[row.kind] || "不明な罪状")}</span><span>${faction}${row.amount ? ` / ＋${row.amount.toLocaleString()}` : ""}</span></li>`;
  }).join("");
  return `<details class="bounty-crimes"><summary>主な罪状${history.length ? `（${history.length}件）` : ""}</summary>
    ${history.length ? `<p class="tiny">過去の記録を含む直近${CRIME_HISTORY_LIMIT}件を表示しています。</p><div class="bounty-crime-scroll" tabindex="0" role="region" aria-label="過去の犯罪歴"><ul>${rows}</ul></div>` : '<p class="tiny">詳細な罪状の記録は残っていません。</p>'}</details>`;
}

/** 一覧と現地詳細を共通モーダルで表示し、閉じた後のフォーカスを戻す。 @param {Function} sync 表示同期。 @param {object|null} site 現地個体。 @returns {void} */
function openBounties(sync, site = null) {
  const modal = document.getElementById("bountyModal"), body = document.getElementById("bountyBody");
  if (!modal) return;
  const previous = document.activeElement;
  const close = () => { modal.hidden = true; previous?.focus(); };
  document.getElementById("bountyCloseBtn").onclick = close;
  modal.onclick = e => { if (e.target === modal) close(); };
  modal.onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const list = site ? [site] : state.bounties?.active || [];
  expireWanted(state.wanted, absDay(state));
  body.innerHTML = `${!site ? `<article class="bounty-card"><h3>あなた</h3><strong>${resourceIcon("funds")}合計賞金 ${totalWanted(state.wanted).toLocaleString()}</strong>${WANTED_FACTIONS.map(id => {
    const record = state.wanted?.byFaction?.[id];
    return `<p>${factionLabel(id)}：${(record?.amount || 0).toLocaleString()}${record?.amount ? ` / 自然解除まであと${Math.max(0, record.lastCrimeAbs + BOUNTY_CONFIG.lifetime - absDay(state))}日` : " / 手配なし"}</p>`;
  }).join("")}<p class="tiny">各勢力への最後の犯罪から600日で、その勢力の手配だけが解除されます。</p>${wantedCrimesHtml(state.wanted || {})}</article>` : ""}
    <div class="bounty-list${site ? " bounty-list-single" : ""}">${list.map(bountyCard).join("") || '<p>現在、活動中の賞金首はいません。</p>'}</div>`;
  body.querySelectorAll("[data-bounty-map]").forEach(button => { button.onclick = () => {
    const target = state.bounties.active.find(s => s.id === Number(button.dataset.bountyMap));
    if (target) { close(); focusMapPosition(target.position); }
  }; });
  body.querySelectorAll("[data-bounty-fight]").forEach(button => { button.onclick = () => {
    const target = bountyAt(state.position);
    if (target?.id !== Number(button.dataset.bountyFight) || bountyRestriction(target) || state.modeLabel !== MODE_LABEL.NORMAL || state.pendingEncounter?.active
      || state.eventQueue?.length || state.expansion?.fishing?.pending || state.expansion?.exploration?.pending || state.expansion?.charts?.pending
      || (state.dangerousSeas?.pendingHazard && state.dangerousSeas.pendingHazard.stage !== "watch") || state.dangerousSeas?.action || state.dangerousSeas?.explorationPending || state.dangerousSeas?.events?.pending) return;
    if (!saveGameToStorage()) { pushToast("保存できません", "保存容量を確認してから再度お試しください。", "warn"); return; }
    close();
    state.pendingEncounter = { active: true, bountyId: target.id, enemyName: bountyName(target), enemyFormation: structuredClone(target.formation), enemyTotal: target.total, enemyFactionId: target.factionId, strength: "elite", terrain: getTerrainAt(target.position.x, target.position.y), eventTag: "world_bounty" };
    state.modeLabel = MODE_LABEL.PREP;
    if (!saveGameToStorage()) {
      state.pendingEncounter = { active: false }; state.modeLabel = MODE_LABEL.NORMAL;
      pushToast("保存できません", "討伐準備は開始していません。", "warn"); sync(); return;
    }
    document.dispatchEvent(new CustomEvent("auto-move-stop")); sync();
  }; });
  if (!site) renderDangerousBountyList(body, sync);
  if (!site && state.bounties?.history.length) {
    const history = document.createElement("details");
    history.innerHTML = `<summary>討伐の記録（直近100件）</summary>${state.bounties.history.map(s => `<p>${escapeHtml(bountyName(s))} / 賞金 ${s.reward.toLocaleString()}${s.flagship ? ` / ${escapeHtml(s.flagship)}` : ""}</p>`).join("")}`;
    body.append(history);
  }
  modal.hidden = false; document.getElementById("bountyCloseBtn").focus();
}

/** 拠点の一覧と現地の任意討伐ボタンを表示する。 @param {Function} sync 表示同期。 @returns {void} */
export function renderBountyControls(sync) {
  const list = document.getElementById("bountyOpenBtn"), visit = document.getElementById("bountyVisitBtn");
  if (!list || !visit) return;
  const locked = state.pendingEncounter?.active || state.modeLabel === MODE_LABEL.BATTLE || state.eventQueue?.length
    || state.expansion?.fishing?.pending || state.expansion?.exploration?.pending || state.expansion?.charts?.pending
    || (state.dangerousSeas?.pendingHazard && state.dangerousSeas.pendingHazard.stage !== "watch") || state.dangerousSeas?.action || state.dangerousSeas?.explorationPending || state.dangerousSeas?.events?.pending;
  list.hidden = locked || !wantedSettlement();
  list.textContent = "賞金首";
  list.onclick = () => openBounties(sync);
  const site = bountyAt(state.position);
  visit.hidden = locked || !site || state.modeLabel !== MODE_LABEL.NORMAL;
  visit.textContent = site ? `${bountyName(site)}を確認` : "賞金首を確認";
  visit.onclick = () => { if (bountyAt(state.position)) openBounties(sync, bountyAt(state.position)); };
}
