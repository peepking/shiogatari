import { state } from "./state.js";
import { mapData } from "./map.js";
import { absDay } from "./questUtils.js";
import { bountySeaPositions, normalizeBounties, tickBounties, claimBounty, bountyName } from "./bounty.js";
import { BOUNTY_CONFIG } from "./bountyConfig.js";
import { FACTIONS } from "./lore.js";
import { adjustNobleFavor } from "./faction.js";
import { addShips } from "./fleet.js";
import { SHIP_TYPES } from "./shipConfig.js";
import { pushLog } from "./dom.js";
import { expireWanted } from "./playerWanted.js";

/** 保存済みの地点や未公開の海図目的地も配置候補から除く。 @returns {Set} 予約座標。 */
function occupiedPositions() {
  const positions = [...(state.expansion?.exploration?.sites || []).map(s => s.position)];
  for (const c of state.expansion?.charts?.active || []) positions.push(c.destination, c.rumor);
  const quests = [...(state.quests?.active || []), ...Object.values(state.quests?.availableBySettlement || {}).flat(), ...Object.values(state.nobleQuests?.availableByNoble || {}).flat()];
  for (const q of quests) positions.push(q.target, ...(q.fights || []).map(f => f.target));
  return new Set(positions.filter(Boolean).map(p => `${p.x},${p.y}`));
}

/** 日次は期限を処理し、初回と季節変更時だけ到達候補を計算して補充する。 @returns {void} */
export function updateBountyWorld() {
  if (expireWanted(state.wanted, absDay(state))) pushLog("手配解除", "5年間新たな犯罪がなく、あなたへの手配が解除されました。", "-");
  if (!mapData.length) return;
  state.bounties ||= normalizeBounties();
  const data = state.bounties, season = state.year * 4 + state.season;
  const candidates = !data.initialized || data.lastSeason !== season ? bountySeaPositions(mapData, state.position) : [];
  tickBounties(data, candidates, absDay(state), season, occupiedPositions(), state.pendingEncounter?.active ? state.pendingEncounter.bountyId : null);
}

/** @param {object} position 座標。 @returns {object|undefined} 現地の賞金首。 */
export function bountyAt(position) { return state.bounties?.active.find(s => s.position.x === position.x && s.position.y === position.y); }

/** 討伐済みにしてから固定報酬と専用の関係変化を一度だけ適用する。 @param {number} id 個体ID。 @returns {Array} 戦果表示。 */
export function finishBounty(id) {
  const site = claimBounty(state.bounties, id, absDay(state));
  if (!site) return [];
  state.funds += site.reward;
  const summary = [{ text: `${bountyName(site)} 討伐賞金 +${site.reward}`, icon: "funds" }];
  if (site.ship && SHIP_TYPES[site.ship]) {
    addShips(state, { [site.ship]: 1 });
    summary.push({ text: `${site.flagship}：${SHIP_TYPES[site.ship].name} +1隻`, icon: "ships" });
  }
  for (const faction of FACTIONS) {
    const delta = faction.id === site.factionId ? BOUNTY_CONFIG.ownFavor : BOUNTY_CONFIG.otherFavor;
    for (const noble of faction.nobles || []) adjustNobleFavor(noble.id, delta);
  }
  summary.push(`関係の変化：所属勢力の貴族全員 ${BOUNTY_CONFIG.ownFavor} / その他の勢力の貴族全員 +${BOUNTY_CONFIG.otherFavor}`);
  pushLog("賞金首討伐", `${bountyName(site)} / 賞金 +${site.reward}`, "-");
  return summary;
}
