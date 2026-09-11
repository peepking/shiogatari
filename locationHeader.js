import { FACTIONS } from "./lore.js";
import { MODE_LABEL } from "./constants.js";

/**
 * 現在地を行動の見出しとして表示する。勢力は近隣ではなく現在の拠点から取得する。
 * @param {object|null} settlement 現在地の拠点。 @param {string} mode 内部状態。 @param {string} terrain 地形ID。
 * @returns {void}
 */
export function renderLocationHeader(settlement, mode, terrain) {
  const title = document.getElementById("locationLabel");
  const status = document.getElementById("locationStatus");
  const factionRow = document.getElementById("locationFaction");
  if (!title || !status || !factionRow) return;
  const inside = [MODE_LABEL.IN_TOWN, MODE_LABEL.IN_VILLAGE, MODE_LABEL.AUDIENCE].includes(mode);
  const sea = ["sea", "shoal"].includes(terrain);
  title.textContent = settlement?.name || (sea ? "航海中" : "陸路を移動中");
  status.textContent = settlement ? `${settlement.kind === "town" ? "街" : "村"} · ${inside ? "滞在中" : "入口"}` : "現在地";
  const faction = settlement && FACTIONS.find(f => f.id === settlement.factionId);
  factionRow.hidden = !faction;
  const icon = document.getElementById("locationFactionIcon");
  if (faction) {
    icon.src = faction.sigil;
    document.getElementById("locationFactionName").textContent = faction.name;
  } else {
    icon.removeAttribute("src");
    document.getElementById("locationFactionName").textContent = "";
  }
}
