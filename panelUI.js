import { elements, pushToast } from "./dom.js";
import {
  getNobleFavor,
  getPlayerFactionId,
  getRelation,
  getSupportLabel,
  getWarEntry,
  getWarScoreLabel,
  isHonorFaction,
  removeHonorFaction,
} from "./faction.js";
import { ASSETS, FACTIONS } from "./lore.js";
import { getSettlementsByNoble, nobleHome, refreshMapInfo, settlements } from "./map.js";
import { state } from "./state.js";
import { formatSupplyDisplay, SUPPLY_ITEMS } from "./supplies.js";
import { formatTroopDisplay, TROOP_STATS } from "./troops.js";
import { displayRelationLabel, displayWarLabel } from "./util.js";

/**
 * 勢力IDから名称を取得する。
 * @param {string} id
 * @returns {string}
 */
const factionName = (id) => FACTIONS.find((f) => f.id === id)?.name || id;

/**
 * 勢力の状態ラベル（態度＋戦争中フラグ）を返す。
 * @param {string} fid
 * @returns {string}
 */
function factionStatusText(fid) {
  const pf = getPlayerFactionId();
  const rel = getRelation(pf, fid);
  const relLabel = displayRelationLabel(rel === "war" ? "cold" : rel === "ally" ? "ally" : "wary");
  const war = state.factionState?.[fid]?.warFlags?.active ? " / 戦争中" : "";
  return `${relLabel}${war}`;
}

/**
 * 資産カードの表示を更新する。
 */
export function renderAssets() {
  const troopDisplay = formatTroopDisplay();
  const supplyDisplay = formatSupplyDisplay();
  const defs = [
    { key: "ships", card: "ships", sub: "聖船+", valueText: String(state.ships), img: ASSETS.ships },
    { key: "troops", card: "companions", sub: "", valueHtml: troopDisplay.html, img: ASSETS.companions },
    { key: "faith", card: "faith", sub: "", valueText: String(state.faith), img: ASSETS.faith },
    { key: "supplies", card: "supplies", sub: "上限", valueHtml: supplyDisplay.html, img: ASSETS.supplies },
    { key: "funds", card: "funds", sub: "", valueText: String(state.funds), img: ASSETS.funds },
    { key: "fame", card: "fame", sub: "", valueText: String(state.fame), img: ASSETS.fame },
  ];
  defs.forEach((d) => {
    const cardKey = d.card || d.key;
    const valEl = document.querySelector(`#asset-${cardKey} .asset-value b`);
    const subEl = document.querySelector(`#asset-${cardKey} .asset-value .sub`);
    if (valEl) {
      if (d.valueHtml != null) valEl.innerHTML = d.valueHtml;
      else valEl.textContent = d.valueText ?? "";
    }
    if (subEl && d.sub != null) subEl.textContent = d.sub;
    if (elements.assetImgs[d.key]) elements.assetImgs[d.key].src = d.img;
  });
}

/**
 * 勢力カード一覧を描画する。
 */
export function renderFactions() {
  if (!elements.factionListEl) return;
  elements.factionListEl.innerHTML = FACTIONS.map((f) => {
    const attText = factionStatusText(f.id);
    const rel = getRelation(getPlayerFactionId(), f.id);
    const warEntry = rel === "war" && f.id !== "pirates" ? getWarEntry(getPlayerFactionId(), f.id) : null;
    const orientedScore = warEntry
      ? warEntry.factions?.[0] === getPlayerFactionId()
        ? warEntry.score
        : -warEntry.score
      : 0;
    const warLabel = warEntry ? displayWarLabel(getWarScoreLabel(orientedScore)) : "-";
    const honor = isHonorFaction(f.id);
    return `
      <div class="faction-card" data-fid="${f.id}" data-fcolor="${f.color}">
        <div class="faction-flag">
          <img src="${f.sigil}" alt="${f.name}">
        </div>
        <div class="faction-body">
          <div class="f-name">${f.name}</div>
          <div class="f-tagline">${f.tagline}</div>
          <div class="f-attitude">${attText}${honor ? " / 名誉家臣" : ""}</div>
          <div class="f-war">戦況: ${warLabel}</div>
        </div>
      </div>
    `;
  }).join("");
  elements.factionListEl.querySelectorAll(".faction-card").forEach((card) => {
    const color = card.dataset.fcolor;
    if (color) card.style.setProperty("--fc", color);
  });
}

/**
 * 指定勢力の貴族一覧を描画する。
 * @param {string} fid
 */
export function renderNobles(fid) {
  const f = FACTIONS.find((x) => x.id === fid);
  if (!f) return;
  elements.noblePanel.hidden = false;
  elements.nobleFactionName.textContent = f.name;
  const allies = FACTIONS.filter((x) => x.id !== f.id && x.id !== "pirates" && getRelation(f.id, x.id) === "ally");
  const wars = FACTIONS.filter((x) => x.id !== f.id && x.id !== "pirates" && getRelation(f.id, x.id) === "war");
  const allianceCard = `
    <div class="sideBlock mb-8" style="grid-column: span 2;">
      <div class="sbTitle">関係</div>
      <div class="tiny">同盟: ${allies.length ? allies.map((a) => a.name).join(" / ") : "-"}</div>
      <div class="tiny">戦争: ${wars.length ? wars.map((w) => w.name).join(" / ") : "-"}</div>
    </div>
  `;
  const homeMap = new Map(nobleHome.entries());
  const getStay = (nid) => {
    const hid = homeMap.get(nid);
    if (!hid) return "滞在中: -";
    const set = settlements.find((s) => s.id === hid);
    if (!set) return "滞在中: -";
    return `滞在中: ${set.name} (${set.coords.x + 1}, ${set.coords.y + 1})`;
  };
  const favorLabel = (nid) => {
    const fv = getNobleFavor(nid);
    if (fv >= 50) return "厚遇";
    if (fv >= 10) return "好意";
    if (fv > -10) return "中立";
    if (fv > -50) return "警戒";
    return "敵対";
  };
  const nobleCards = f.nobles
    .map((n) => {
      const stayText = getStay(n.id);
      const favorText = `好感度: ${favorLabel(n.id)}`;
      return `
      <div class="noble-card" data-nid="${n.id}">
        <img src="${n.img}" alt="${n.name}">
        <div class="n-body">
          <div class="n-name">${n.name}</div>
          <div class="n-title">${n.title}</div>
          <div class="n-title">${stayText}</div>
          <div class="n-title">${favorText}</div>
        </div>
      </div>`;
    })
    .join("");
  elements.nobleListEl.innerHTML = allianceCard + nobleCards;
  if (elements.nobleDetail) elements.nobleDetail.innerHTML = "";
}

/**
 * 貴族の保有拠点情報を描画する。
 * @param {string} nobleId
 */
export function renderNobleDetail(nobleId) {
  if (!elements.nobleDetail) return;
  const owned = getSettlementsByNoble(nobleId);
  if (!owned.length) {
    elements.nobleDetail.textContent = "保有する街や村はありません。";
    return;
  }
  const supplyLabel = (id) => SUPPLY_ITEMS.find((i) => i.id === id)?.name || id || "なし";
  elements.nobleDetail.innerHTML = owned
    .map(
      (s) =>
        `<div class="noble-settlement">
          <div><b>${s.name}</b>・${s.kind === "town" ? "街" : "村"}</div>
          <div class="tiny">座標 (${s.coords.x + 1}, ${s.coords.y + 1}) / 勢力 ${factionName(
            s.factionId
          )}</div>
          <div class="tiny">支持: ${getSupportLabel(s.id, s.factionId)} / 戦況: ${
            getWarEntry(s.factionId, getPlayerFactionId())
              ? displayWarLabel(getWarScoreLabel(getWarEntry(s.factionId, getPlayerFactionId()).score || 0))
              : "-"
          } / ${state.warLedger?.entries?.some((e) => (e.activeFronts || []).some((f) => f.settlementId === s.id))
            ? "防衛中"
            : "平時"} </div>
          <div class="tiny">雇用可能: ${
            (s.recruitSlots || [])
              .map((slot) => TROOP_STATS[slot.type]?.name || slot.type)
              .join("・") || "なし"
          } / 特産: ${supplyLabel(s.specialty)}</div>
        </div>`
    )
    .join("");
}

/**
 * 勢力/貴族パネルのイベントを設定する。
 */
export function wireFactionPanel() {
  if (elements.factionListEl) {
    elements.factionListEl.addEventListener("click", (e) => {
      const card = e.target.closest(".faction-card");
      if (!card) return;
      const leaveBtn = e.target.closest(".honor-leave");
      if (leaveBtn) {
        const fid = leaveBtn.dataset.fid;
        removeHonorFaction(fid);
        pushToast("離脱", "名誉家臣をやめました。", "info");
        renderFactions();
        renderNobles(fid);
        refreshMapInfo();
        return;
      }
      const fid = card.dataset.fid;
      renderNobles(fid);
    });
  }
  elements.nobleListEl?.addEventListener("click", (e) => {
    const card = e.target.closest(".noble-card");
    if (!card) return;
    const nid = card.dataset.nid;
    renderNobleDetail(nid);
  });
  elements.closeNoblesBtn?.addEventListener("click", () => {
    elements.noblePanel.hidden = true;
  });
}

/**
 * マップ表示切り替えのイベントを設定する。
 * @param {Function} renderMap
 */
export function wireMapToggle(renderMap) {
  elements.mapToggle?.addEventListener("click", () => {
    state.mapMode = state.mapMode === "full" ? "zoom" : "full";
    renderMap?.();
    refreshMapInfo();
  });
  elements.mapPinsToggle?.addEventListener("click", () => {
    state.mapPinsVisible = !state.mapPinsVisible;
    renderMap?.();
    refreshMapInfo();
  });
}
