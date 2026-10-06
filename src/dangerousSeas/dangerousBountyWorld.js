import { state } from "../core/state.js";
import { mapData } from "../world/map.js";
import { absDay } from "../core/calendar.js";
import { receiveFunds, recordVoyage } from "../core/voyageStats.js";
import { FACTIONS } from "../world/lore.js";
import { adjustNobleFavor } from "../factions/faction.js";
import { addVariantShip } from "../fleet/fleet.js";
import { VARIANT_SHIPS, variantBonusText } from "../fleet/variantShips.js";
import { SHIP_TYPES } from "../fleet/shipConfig.js";
import { bountyFameBonus } from "../bounty/bounty.js";
import { pushLog } from "../ui/dom.js";
import { getDangerousSeaPositions } from "./dangerousSeaWorld.js";
import { dangerousSeaReservedPositions } from "./dangerousSeaReservations.js";
import { DANGEROUS_BOUNTY_CONFIG as CONFIG } from "./dangerousBountyConfig.js";
import { normalizeDangerousBounties, tickDangerousBounties, claimDangerousBounty } from "./dangerousBounty.js";

/** 未公開の海図や未受注依頼も含めて全地点を予約する。 @returns {Set} 使用済みの座標。 */
function dangerousBountyOccupiedPositions() {
  const positions = [...(state.expansion?.exploration?.sites || []), ...(state.bounties?.active || [])].map(site => site.position);
  positions.push(...dangerousSeaReservedPositions(state));
  positions.push(state.pirateKingStory?.active?.position);
  for (const chart of state.expansion?.charts?.active || []) positions.push(chart.destination, chart.rumor);
  const quests = [...(state.quests?.active || []), ...Object.values(state.quests?.availableBySettlement || {}).flat(), ...Object.values(state.nobleQuests?.availableByNoble || {}).flat()];
  for (const quest of quests) positions.push(quest.target, ...(quest.fights || []).map(fight => fight.target));
  return new Set(positions.filter(Boolean).map(position => `${position.x},${position.y}`));
}

/** 日次の寿命更新と初回・季節ごとの専用枠補充を処理する。 @returns {void} */
export function updateDangerousBountyWorld() {
  if (!mapData.length || !state.dangerousSeas) return;
  state.dangerousSeas.bounties ||= normalizeDangerousBounties();
  const data = state.dangerousSeas.bounties, season = state.year * 4 + state.season;
  const candidates = { sw: [], se: [] };
  if (!data.initialized || data.lastSeason !== season) {
    for (const regionId of ["sw", "se"]) {
      const core = new Set(getDangerousSeaPositions(regionId, "core").map(position => `${position.x},${position.y}`));
      candidates[regionId] = getDangerousSeaPositions(regionId).map(position => ({ ...position, level: core.has(`${position.x},${position.y}`) ? "core" : "outer" }));
    }
  }
  tickDangerousBounties(data, candidates, absDay(state), season, dangerousBountyOccupiedPositions(),
    state.pendingEncounter?.active ? state.pendingEncounter.dangerousBountyId : null);
}

/** @param {{x:number,y:number}} position 現在地。 @returns {object|undefined} 現地の専用賞金首。 */
export function getDangerousBountyAt(position) {
  return state.dangerousSeas?.bounties?.active.find(site => site.position.x === position.x && site.position.y === position.y);
}

/** 勝利時だけ固定賞金・レベル別の追加名声・固有船・専用関係変化を一度確定し、通常海賊戦と物語の進行へ混ぜない。
 * @param {number} id 専用個体ID。 @param {boolean} [won=true] 勝利したか。 @returns {Array} 戦果表示。
 */
export function finishDangerousBounty(id, won = true) {
  if (!won) return [];
  const site = claimDangerousBounty(state.dangerousSeas?.bounties, id, absDay(state));
  if (!site) return [];
  const name = `${site.epithet}${site.name}`, variant = VARIANT_SHIPS[site.templateId];
  const fameBonus = bountyFameBonus(site);
  state.fame = (state.fame || 0) + fameBonus;
  receiveFunds(state, site.reward); recordVoyage(state, "bountiesDefeated", 1);
  addVariantShip(state, variant.id, name, absDay(state));
  for (const faction of FACTIONS) {
    for (const noble of faction.nobles || []) adjustNobleFavor(noble.id, faction.id === "pirates" ? CONFIG.ownFavor : CONFIG.otherFavor);
  }
  pushLog("危険海域の賞金首討伐", `${name} / 賞金 +${site.reward} / 討伐ボーナス 名声 +${fameBonus} / ${variant.name}`, "-");
  return [{ text: `${name} 討伐賞金 +${site.reward}`, icon: "funds" },
    { text: `賞金首討伐ボーナス 名声 +${fameBonus}`, icon: "fame" },
    { text: `${variant.name}：${SHIP_TYPES[variant.base].name} +1隻（${variantBonusText(variant.id)}）`, icon: "ships" },
    `関係の変化：黒ひげ ${CONFIG.ownFavor} / その他の勢力の貴族全員 +${CONFIG.otherFavor}`];
}
