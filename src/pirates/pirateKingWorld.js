import { state } from "../core/state.js";
import { mapData } from "../world/map.js";
import { bountySeaPositions } from "../bounty/bounty.js";
import { PIRATE_KING_CONFIG, PIRATE_KING, pirateStoryTarget } from "./pirateKingConfig.js";
import { createStorySite, rollPirateStoryRumor } from "./pirateKingStory.js";
import { enqueueEvent } from "../app/events.js";
import { pushLog } from "../ui/dom.js";
import { scheduleGameSave } from "../core/storage.js";
import { dangerousSeaReservedPositions } from "../dangerousSeas/dangerousSeaReservations.js";

/** 未公開海図や受注前の討伐地点も予約し、物語の配置と重ねない。 @param {object} game 状態。 @returns {Set} 予約座標。 */
export function pirateStoryBlockedPositions(game) {
  const positions = [...(game.bounties?.active || []), ...(game.expansion?.exploration?.sites || [])].map(site => site.position);
  positions.push(...dangerousSeaReservedPositions(game));
  for (const chart of game.expansion?.charts?.active || []) positions.push(chart.destination, chart.rumor);
  const quests = [...(game.quests?.active || []), ...Object.values(game.quests?.availableBySettlement || {}).flat(), ...Object.values(game.nobleQuests?.availableByNoble || {}).flat()];
  for (const quest of quests) positions.push(quest.target, ...(quest.fights || []).map(fight => fight.target));
  return new Set(positions.filter(Boolean).map(p => `${p.x},${p.y}`));
}

/** 到達可能な海だけを候補とし、五列強は距離帯から均等抽選、王は中央に最も近い座標を選ぶ。
 * 王の同距離候補は行・列の順で固定し、配置結果は以後保存値を使う。候補不足は当選を保持する。
 * @param {object} data 物語。 @param {Array} map 地図。 @param {object} origin 現在地。
 * @param {Set} blocked 予約。 @param {Function} random 乱数。 @returns {object|null} 新しい出現個体。
 */
export function placePirateStory(data, map, origin, blocked = new Set(), random = Math.random) {
  if (!map.length || data.completed || data.active || !data.waitingId) return null;
  const target = pirateStoryTarget(data.waitingId);
  if (!target) return null;
  let pool = bountySeaPositions(map, origin).filter(p => map[p.y]?.[p.x]?.terrain === "sea" && !blocked.has(`${p.x},${p.y}`));
  if (!pool.length) return null;
  let position;
  if (target.id === PIRATE_KING.id) {
    const center = { x: (map[0].length - 1) / 2, y: (map.length - 1) / 2 };
    const distance = p => Math.abs(p.x - center.x) + Math.abs(p.y - center.y);
    pool.sort((a, b) => distance(a) - distance(b) || a.y - b.y || a.x - b.x);
    position = pool[0];
  } else {
    const source = data.rumorOrigin || origin, [min, max] = PIRATE_KING_CONFIG.rumorDistance;
    const nearby = pool.filter(p => { const d = Math.abs(p.x - source.x) + Math.abs(p.y - source.y); return d >= min && d <= max; });
    if (nearby.length) pool = nearby;
    position = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  }
  data.active = createStorySite(target, position); data.waitingId = null;
  return data.active;
}

/** 世界の準備後に配置待ちだけを再試行し、発見を通常のイベントキューへ通知する。 @returns {void} */
export function updatePirateKingWorld() {
  const data = state.pirateKingStory;
  if (!data || !mapData.length) return;
  const site = data.active;
  if (site && mapData[site.position.y]?.[site.position.x]?.terrain !== "sea") {
    data.waitingId = site.id; data.active = null; data.kingPhase = 1;
  }
  const placed = placePirateStory(data, mapData, state.position, pirateStoryBlockedPositions(state));
  if (!placed) return;
  const target = pirateStoryTarget(placed.id), king = placed.id === PIRATE_KING.id;
  const location = `(${placed.position.x + 1}, ${placed.position.y + 1})`;
  enqueueEvent({ title: king ? "海賊王の海図が示す海" : "海賊五列強の噂", body: `${king ? "つなぎ合わせた海図の航路が、海の中央へ続いている。その先に、海賊王オーラヴの旗が現れた。" : target.rumor} ${target.name}が${location}に現れました。依頼欄の海賊王の海図から場所を確認できます。期限はありません。` });
  pushLog(king ? "海賊王発見" : "海賊五列強の噂", `${target.name} / ${location}`, "-");
  scheduleGameSave();
}

/** 実入場の抽選結果と配置待ちを保存し、他の入場イベントと共存させる。 @param {object} settlement 入場先。 @returns {void} */
export function onPirateStoryEntry(settlement) {
  const target = rollPirateStoryRumor(state, settlement);
  if (target) {
    updatePirateKingWorld();
    if (state.pirateKingStory.waitingId) enqueueEvent({ title: "海賊五列強の噂", body: `${target.rumor} 船影の位置はまだ分かりません。海の様子が変わるのを待ちましょう。` });
  } else if (state.pirateKingStory?.waitingId) updatePirateKingWorld();
  scheduleGameSave();
}
