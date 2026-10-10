import { shipIcon } from "../src/fleet/shipArt.js?v=20261010-maritime-ui";
import { SHIP_TYPES } from "../src/fleet/shipConfig.js";
import { tideStageIcon } from "../src/faith/tideScene.js?v=20261010-maritime-ui";
import { TIDE_STAGES } from "../src/faith/tideAlliance.js";
import { codexSilhouette } from "../src/fishing/fishingCodexArt.js?v=20261011-fish-restored";
import { renderGameTime } from "../src/core/gameTime.js?v=20261010-maritime-ui";
import { escapeHtml, SEASONS } from "../src/core/util.js";
import { FACTIONS } from "../src/world/lore.js?v=20261011-heraldry";

const resources = [
  ["ship", "船"], ["troops", "部隊"], ["faith", "信仰"], ["supplies", "物資"], ["funds", "資金"], ["fame", "名声"],
  ["food", "食料"], ["wood", "木材"], ["stone", "石材"], ["iron", "鉄"], ["fiber", "繊維"], ["salt", "塩"],
  ["spice", "香辛料"], ["arms", "武具"], ["textile", "織物"], ["brew", "酒"], ["leather", "革"], ["chart", "海図"],
  ["illegal-drug", "違法薬物"], ["illicit-brew", "密造酒"], ["stolen-craft", "盗品工芸品"], ["stolen-arms", "盗品武具"],
  ["identity", "所属・身分"],
  ["action-fish", "釣り"], ["action-quest", "依頼"], ["action-wait", "待機"], ["action-shield", "防衛"],
  ["action-blockade", "封鎖"], ["action-surrender", "降伏"], ["action-exit", "退出・退却"],
  ["action-bounty", "賞金首"], ["action-crime", "裏の行動"], ["action-audience", "謁見"], ["action-office", "窓口交渉"],
  ["action-fishing-hut", "釣り小屋"], ["action-fish-codex", "魚図鑑"], ["action-final-voyage", "最終航海"],
  ["action-explore", "探索"], ["action-grand-battle", "大会戦"], ["action-sea-event", "海域の出来事"],
  ["action-rescue", "救助"], ["action-shipyard", "造船所・艤装"], ["action-trade", "交易"],
];

/**
 * 同じ図柄を小さい表示と拡大表示で並べ、名前を添える。
 * @param {string} target 表示先のID。
 * @param {string} label 図柄名。
 * @param {string} html 本番と同じ図柄のHTML。
 * @param {number} [smallSize=20] 小さい表示の幅。
 * @param {number} [largeSize=48] 拡大表示の幅。
 * @returns {void}
 */
function addSample(target, label, html, smallSize = 20, largeSize = 48) {
  const card = document.createElement("figure"); card.className = "ui-art-card";
  card.innerHTML = `<div class="ui-art-samples"><div class="ui-art-sample is-small">${html}<small>${smallSize}px</small></div><div class="ui-art-sample">${html}<small>${largeSize}px</small></div></div><figcaption>${escapeHtml(label)}</figcaption>`;
  document.getElementById(target).append(card);
}

/** @returns {void} 資源・行動・四季・勢力・人物・船・施設・魚図鑑を漏れなく並べる。 */
function renderPreview() {
  for (const [file, label] of resources) addSample("uiResources", label, `<img src="./image/ui/${file}.svg?v=20261011-wheat-coins" alt="">`);
  for (let season = 0; season < SEASONS.length; season++) {
    const card = document.createElement("figure"); card.className = "ui-art-card";
    const date = document.createElement("div"); date.className = "ui-art-date";
    renderGameTime(date, { year: 1000, season, day: 1 });
    card.append(date); document.getElementById("uiSeasons").append(card);
  }
  const portraits = new Set();
  for (const faction of FACTIONS) {
    addSample("uiFactions", faction.name, `<img src="${faction.sigil}" alt="">`);
    for (const noble of faction.nobles) {
      if (portraits.has(noble.img) || noble.img === faction.sigil) continue;
      portraits.add(noble.img);
      addSample("uiFactions", noble.title, `<img src="${noble.img}" alt="">`);
    }
  }
  for (const [id, ship] of Object.entries(SHIP_TYPES)) addSample("uiShips", ship.name, shipIcon(id), 32, 64);
  for (const stage of TIDE_STAGES) addSample("uiTides", stage.name, tideStageIcon(stage), 32, 64);
  for (const [id, label] of [["common", "通常種"], ["big", "大物種"], ["giant", "巨大種"], [null, "未発見"]]) {
    addSample("uiFish", label, codexSilhouette(id), 32, 64);
  }
  document.getElementById("uiArtStatus").textContent = `資源・禁制品・行動${resources.length}種、四季4種、勢力・人物10種、船11種、施設5段階、魚図鑑4種。合計${resources.length + 34}種。`;
}

renderPreview();
