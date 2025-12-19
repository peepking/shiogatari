import { elements } from "./dom.js";
import { state } from "./state.js";
import { ASSETS, FACTIONS, ATTITUDE_LABELS } from "./lore.js";
import { formatTroopDisplay, TROOP_STATS } from "./troops.js";
import { formatSupplyDisplay, SUPPLY_ITEMS } from "./supplies.js";
import { getSettlementsByNoble, nobleHome } from "./map.js";

/**
 * 勢力IDから名称を取得する。
 * @param {string} id
 * @returns {string}
 */
const factionName = (id) => FACTIONS.find((f) => f.id === id)?.name || id;

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
    const attitude = state.factionAttitudes[f.id] || "neutral";
    const attText = ATTITUDE_LABELS[attitude] || attitude;
    return `
      <div class="faction-card" data-fid="${f.id}" data-fcolor="${f.color}">
        <div class="faction-flag">
          <img src="${f.sigil}" alt="${f.name}">
        </div>
        <div class="faction-body">
          <div class="f-name">${f.name}</div>
          <div class="f-tagline">${f.tagline}</div>
          <div class="f-attitude">${attText}</div>
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
  elements.nobleListEl.innerHTML = f.nobles
    .map(
      (n) => `
      <div class="noble-card" data-nid="${n.id}">
        <img src="${n.img}" alt="${n.name}">
        <div class="n-body">
          <div class="n-name">${n.name}</div>
          <div class="n-title">${n.title}</div>
        </div>
      </div>`
    )
    .join("");
  if (elements.nobleDetail) elements.nobleDetail.innerHTML = "";
}

/**
 * 貴族の保有拠点情報を描画する。
 * @param {string} nobleId
 */
export function renderNobleDetail(nobleId) {
  if (!elements.nobleDetail) return;
  const owned = getSettlementsByNoble(nobleId);
  const homeId = nobleHome.get(nobleId);
  const home = owned.find((s) => s.id === homeId) || owned[0];
  if (!owned.length) {
    elements.nobleDetail.textContent = "保有する街や村はありません。";
    return;
  }
  const stayLine = home
    ? `<div class="tiny">滞在中: ${home.name} (${home.kind === "town" ? "街" : "村"})</div>`
    : "";
  const supplyLabel = (id) => SUPPLY_ITEMS.find((i) => i.id === id)?.name || id || "なし";
  elements.nobleDetail.innerHTML =
    stayLine +
    owned
      .map(
        (s) =>
          `<div class="noble-settlement">
          <div><b>${s.name}</b>・${s.kind === "town" ? "街" : "村"}</div>
          <div class="tiny">座標 (${s.coords.x + 1}, ${s.coords.y + 1}) / 勢力 ${factionName(
            s.factionId
          )}</div>
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
  });
}
