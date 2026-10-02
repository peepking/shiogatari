import { PIRATE_KING_CONFIG, PIRATE_LORDS, PIRATE_KING, storyFormation } from "./pirateKingConfig.js";
import { addVariantShip, addShips } from "../fleet/fleet.js";

/** @param {*} p 座標。 @returns {boolean} 非負の整数座標か。 */
function validPosition(p) { return Number.isSafeInteger(p?.x) && Number.isSafeInteger(p?.y) && p.x >= 0 && p.y >= 0; }

/** @param {object} target 対象定義。 @param {object} position 座標。 @returns {object} 保存する固定個体。 */
export function createStorySite(target, position) {
  return { id: target.id, position: { ...position }, formation: storyFormation(target.troops, target.level),
    ...(target.id === PIRATE_KING.id ? { finalFormation: storyFormation(target.finalTroops, target.finalLevel), reserve: storyFormation(target.reserves, target.finalLevel) } : {}) };
}

/** 保存済みの順序を連続した討伐履歴に制限し、固定敵の人数・兵種・レベルを検証する。
 * 五列強は旧保存のLv3も現在の指定レベルへ揃え、海賊王の保存済みレベルは維持する。
 * @param {*} value 保存値。 @returns {object} 正規化した物語。
 */
export function normalizePirateKingStory(value) {
  const defeated = [];
  for (const lord of PIRATE_LORDS) {
    if (!Array.isArray(value?.defeated) || value.defeated[defeated.length] !== lord.id) break;
    defeated.push(lord.id);
  }
  const completed = defeated.length === PIRATE_LORDS.length && value?.completed === true;
  const expected = defeated.length === PIRATE_LORDS.length ? PIRATE_KING : PIRATE_LORDS[defeated.length];
  const site = value?.active;
  let active = null;
  if (!completed && site?.id === expected.id && validPosition(site.position)) {
    active = createStorySite(expected, site.position);
    for (const key of ["formation", "finalFormation", "reserve"]) {
      if (!active[key]) continue;
      const saved = site[key], canonical = active[key];
      if (Array.isArray(saved) && saved.length === canonical.length && saved.every((u, i) => u?.type === canonical[i].type && u.count === 10 && Number.isInteger(u.level) && u.level >= 1 && u.level <= 5)) {
        active[key] = saved.map(u => ({ type: u.type, count: u.count, level: expected.id === PIRATE_KING.id ? u.level : expected.level }));
      }
    }
  }
  const rumorSeasons = Object.fromEntries(Object.entries(value?.rumorSeasons || {}).filter(([id, season]) => id.length < 100 && Number.isSafeInteger(season) && season >= 0));
  return { version: 1, defeated, active, completed, rumorSeasons,
    waitingId: !completed && !active && (value?.waitingId === expected.id || defeated.length === PIRATE_LORDS.length) ? expected.id : null,
    rumorOrigin: validPosition(value?.rumorOrigin) ? { ...value.rumorOrigin } : null,
    kingPhase: active?.id === PIRATE_KING.id && value?.kingPhase === 2 ? 2 : 1 };
}

/** 拠点の季節初回だけ設定確率で抽選し、不発も記録する。出現中・名声未達の入場は消費しない。
 * @param {object} state 状態。 @param {object} settlement 入場した拠点。 @param {Function} random 乱数。
 * @param {object} config 調整値。 @returns {object|null} 当選した対象。
 */
export function rollPirateStoryRumor(state, settlement, random = Math.random, config = PIRATE_KING_CONFIG) {
  const data = state.pirateKingStory ||= normalizePirateKingStory();
  if (!settlement || !["town", "village"].includes(settlement.kind) || !(state.fame > config.fameThreshold) || data.completed || data.active || data.waitingId || data.defeated.length >= PIRATE_LORDS.length) return null;
  const season = state.year * 4 + state.season;
  if (data.rumorSeasons[settlement.id] === season) return null;
  data.rumorSeasons[settlement.id] = season;
  if (random() >= config.rumorChance) return null;
  const target = PIRATE_LORDS[data.defeated.length];
  data.waitingId = target.id; data.rumorOrigin = { ...settlement.coords };
  return target;
}

/** 前衛と予備隊は別々の固定編成から取り、連戦段階も結果照合用に保存する。
 * @param {object} data 物語。 @returns {object|null} 戦闘準備の遭遇。
 */
export function pirateStoryEncounter(data) {
  const site = data?.active;
  if (!site || data.completed) return null;
  const target = site.id === PIRATE_KING.id ? PIRATE_KING : PIRATE_LORDS.find(lord => lord.id === site.id);
  if (!target) return null;
  const grand = site.id === PIRATE_KING.id && data.kingPhase === 2;
  return { active: true, storyId: site.id, storyPhase: site.id === PIRATE_KING.id ? data.kingPhase : 1,
    enemyName: `${target.name}${site.id === PIRATE_KING.id ? `（${data.kingPhase}戦目）` : ""}`,
    enemyFormation: structuredClone(grand ? site.finalFormation : site.formation), enemyReserve: structuredClone(grand ? site.reserve : []),
    enemyTotal: grand ? 300 : 200, enemyFactionId: "pirates", strength: "elite", terrain: "sea", battleKind: grand ? "grand" : "normal", eventTag: "pirate_story" };
}

/** @param {object} state 状態。 @param {object} encounter 遭遇。 @returns {boolean} 現在の対象・連戦段階と一致するか。 */
export function currentPirateStoryEncounter(state, encounter) {
  const data = state.pirateKingStory;
  return !!encounter?.storyId && !data?.completed && data?.active?.id === encounter.storyId
    && encounter.storyPhase === (encounter.storyId === PIRATE_KING.id ? data.kingPhase : 1);
}

/** 勝利だけ進行し、固有船の付与と討伐記録を同じ確定処理で更新する。非勝利の連戦は最初へ戻す。
 * @param {object} state 状態。 @param {object} encounter 遭遇。 @param {string} result 勝敗ID。
 * @param {number} now 絶対日。 @returns {object|null} 物語の戦果。
 */
export function finishPirateStoryBattle(state, encounter, result, now) {
  if (!currentPirateStoryEncounter(state, encounter)) return null;
  const data = state.pirateKingStory, king = encounter.storyId === PIRATE_KING.id;
  if (result !== "win") { if (king) data.kingPhase = 1; return { defeated: false, king, continuation: false }; }
  if (king && data.kingPhase === 1) { data.kingPhase = 2; return { defeated: false, king, continuation: true }; }
  if (king) {
    addShips(state, { viking_ship: 1 }); data.completed = true; data.kingPhase = 1; data.active = null;
    return { defeated: true, king, continuation: false, name: PIRATE_KING.name };
  }
  const lord = PIRATE_LORDS[data.defeated.length];
  if (lord?.id !== encounter.storyId) return null;
  addVariantShip(state, lord.variantId, lord.name, now);
  data.defeated.push(lord.id); data.active = null;
  if (data.defeated.length === PIRATE_LORDS.length) data.waitingId = PIRATE_KING.id;
  return { defeated: true, king, continuation: false, name: lord.name, variantId: lord.variantId, fragments: data.defeated.length };
}

/** @param {object} data 物語。 @returns {void} 連戦からの任意離脱は最初の戦へ戻す。 */
export function abandonPirateStory(data) { if (data) data.kingPhase = 1; }
