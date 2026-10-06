import { receiveFunds, recordVoyage } from "../core/voyageStats.js";
import { state } from "../core/state.js";
import { mapData } from "../world/map.js";
import { absDay } from "../quests/questUtils.js";
import { bountySeaPositions, normalizeBounties, tickBounties, claimBounty, bountyName, bountyFameBonus } from "./bounty.js";
import { BOUNTY_CONFIG } from "./bountyConfig.js";
import { FACTIONS } from "../world/lore.js";
import { adjustNobleFavor } from "../factions/faction.js";
import { addVariantShip } from "../fleet/fleet.js";
import { VARIANT_SHIPS, variantBonusText } from "../fleet/variantShips.js";
import { SHIP_TYPES } from "../fleet/shipConfig.js";
import { pushLog } from "../ui/dom.js";
import { expireWanted } from "../wanted/playerWanted.js";
import { dangerousSeaReservedPositions } from "../dangerousSeas/dangerousSeaReservations.js";

/** 保存済みの地点や未公開の海図目的地も配置候補から除く。 @returns {Set} 予約座標。 */
function occupiedPositions() {
  const positions = [...(state.expansion?.exploration?.sites || []).map(s => s.position)];
  for (const c of state.expansion?.charts?.active || []) positions.push(c.destination, c.rumor);
  positions.push(state.pirateKingStory?.active?.position);
  positions.push(...dangerousSeaReservedPositions(state));
  const quests = [...(state.quests?.active || []), ...Object.values(state.quests?.availableBySettlement || {}).flat(), ...Object.values(state.nobleQuests?.availableByNoble || {}).flat()];
  for (const q of quests) positions.push(q.target, ...(q.fights || []).map(f => f.target));
  return new Set(positions.filter(Boolean).map(p => `${p.x},${p.y}`));
}

/** 日次は期限を処理し、初回と季節変更時だけ到達候補を計算して補充する。 @returns {void} */
export function updateBountyWorld() {
  if (expireWanted(state.wanted, absDay(state))) pushLog("手配解除", "最後の犯罪から600日が経過した勢力の手配が解除されました。他勢力の手配は継続します。", "-");
  if (!mapData.length) return;
  state.bounties ||= normalizeBounties();
  const data = state.bounties, season = state.year * 4 + state.season;
  const candidates = !data.initialized || data.lastSeason !== season ? bountySeaPositions(mapData, state.position) : [];
  tickBounties(data, candidates, absDay(state), season, occupiedPositions(), state.pendingEncounter?.active ? state.pendingEncounter.bountyId : null);
}

/** @param {object} position 座標。 @returns {object|undefined} 現地の賞金首。 */
export function bountyAt(position) { return state.bounties?.active.find(s => s.position.x === position.x && s.position.y === position.y); }

/** 討伐済みにしてから賞金・レベル別の追加名声と専用の関係変化を一度だけ適用する。 @param {number} id 個体ID。 @returns {Array} 戦果表示。 */
export function finishBounty(id) {
  const site = claimBounty(state.bounties, id, absDay(state));
  if (!site) return [];
  const fameBonus = bountyFameBonus(site);
  state.fame = (state.fame || 0) + fameBonus;
  receiveFunds(state, site.reward);
  recordVoyage(state, "bountiesDefeated", 1);
  const summary = [{ text: `${bountyName(site)} 討伐賞金 +${site.reward}`, icon: "funds" }];
  if (fameBonus) summary.push({ text: `賞金首討伐ボーナス 名声 +${fameBonus}`, icon: "fame" });
  const variant = VARIANT_SHIPS[site.templateId];
  if (variant) {
    addVariantShip(state, variant.id, bountyName(site), absDay(state));
    summary.push({ text: `${variant.name}：${SHIP_TYPES[variant.base].name} +1隻（${variantBonusText(variant.id)}）`, icon: "ships" });
  }
  for (const faction of FACTIONS) {
    const delta = faction.id === site.factionId ? BOUNTY_CONFIG.ownFavor : BOUNTY_CONFIG.otherFavor;
    for (const noble of faction.nobles || []) adjustNobleFavor(noble.id, delta);
  }
  summary.push(`関係の変化：所属勢力の貴族全員 ${BOUNTY_CONFIG.ownFavor} / その他の勢力の貴族全員 +${BOUNTY_CONFIG.otherFavor}`);
  pushLog("賞金首討伐", `${bountyName(site)} / 賞金 +${site.reward} / 討伐ボーナス 名声 +${fameBonus}`, "-");
  return summary;
}
