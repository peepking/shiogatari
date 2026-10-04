import { state } from "../core/state.js";
import { absDay } from "../core/calendar.js";
import { settlements } from "../world/map.js";
import { buildDangerousEnemyFormation } from "../app/actions.js";
import { snapshotOutfitting } from "../fleet/outfitting.js";
import { getDangerousSeaPositions, dangerousSeaAt } from "./dangerousSeaWorld.js";
import { worldReservedPositions } from "./dangerousSeaReservations.js";
import { DANGEROUS_SEA_EVENT_CONFIG as CONFIG, DANGEROUS_SEA_EVENT_DEFS as DEFS, dangerousEventScoutRules } from "./dangerousSeaEventConfig.js";
import { createDangerousSeaEvents, activeDangerousSeaEvents, spawnDangerousSeaEvent, closeDangerousSeaEvent } from "./dangerousSeaEventState.js";

/** @returns {object|null} 生成済み危険海域に限定イベント領域を補完する。 */
function data() { return state.dangerousSeas ? state.dangerousSeas.events ||= createDangerousSeaEvents() : null; }

/**
 * 現行の上下左右・全地形移動に合わせ、海域側の無法港からの最短移動日数を求める。
 * 未使用の海タイルだけを候補にし、核心不足でも港・陸・浅瀬へ地点を移さない。
 * @param {string} regionId 海域。 @returns {object[]} 座標・段階・移動日数。
 */
function candidates(regionId) {
  const blocked = worldReservedPositions(state);
  const ports = settlements.filter(port => port.pirateHaven && port.coords.y >= 25 && (regionId === "sw" ? port.coords.x < 25 : port.coords.x >= 25));
  if (!ports.length) return [];
  return getDangerousSeaPositions(regionId).filter(point => !blocked.has(`${point.x},${point.y}`)).map(point => ({ ...point,
    level: dangerousSeaAt(point).level, travelDays: Math.min(...ports.map(port => Math.abs(port.coords.x - point.x) + Math.abs(port.coords.y - point.y))) }));
}

/**
 * 新しい荒波の後、専用の空枠にだけ置き土産を置く。他の限定イベントの有無には左右されない。
 * 専用枠が埋まっていれば追加・上書き・予約をせず、同じ波の再同期・域外からの復帰で再生成しない。
 * @param {string} regionId 海域。 @returns {object|null} 生成地点。
 */
export function afterDangerousSeaWave(regionId) {
  const current = data(), now = absDay(state), wave = state.dangerousSeas?.regions?.[regionId]?.lastWaveAbs;
  if (!current || wave == null || current.lastWaveAbs[regionId] === wave) return null;
  current.lastWaveAbs[regionId] = wave;
  if (now - wave > 2 || current.stormAftermath[regionId]) return null;
  return spawnDangerousSeaEvent(current, regionId, "storm_aftermath", candidates(regionId), now, buildDangerousEnemyFormation);
}

/**
 * 日付変更時だけ両枠の期限・出現を更新する。途中選択・戦闘・報酬確認は対応枠を保持し、再読込で日次抽選を繰り返さない。
 * 他の限定イベントは置き土産の有無にかかわらず各通常空枠で一日5%、適合する種類から均等に選ぶ。
 * 置き土産は荒波後に専用枠へ生成する。双方とも予約済みの位置は避ける。
 * @param {boolean} [daily=false] 新しい日を処理するか。 @returns {void}
 */
export function updateDangerousSeaEvents(daily = false) {
  const current = data();
  if (!current) return;
  const now = absDay(state);
  if (daily && (current.lastTickAbs == null || now > current.lastTickAbs)) {
    current.lastTickAbs = now;
    for (const regionId of ["sw", "se"]) {
      for (const event of activeDangerousSeaEvents(current).filter(site => site.regionId === regionId)) {
        if (now >= event.expiresAbs && current.pending?.eventId !== event.id) closeDangerousSeaEvent(current, event.id, now, "expired");
      }
      afterDangerousSeaWave(regionId);
      if (!current.active[regionId] && Math.random() < CONFIG.dailyChance) {
        const kinds = Object.keys(DEFS).filter(kind => kind !== "storm_aftermath" && DEFS[kind].regions.includes(regionId));
        const kind = kinds[Math.min(kinds.length - 1, Math.floor(Math.random() * kinds.length))];
        spawnDangerousSeaEvent(current, regionId, kind, candidates(regionId), now, buildDangerousEnemyFormation);
      }
    }
  } else if (current.lastTickAbs == null) current.lastTickAbs = now;
  discoverDangerousSeaEvents();
}

/** 斥候の人数に応じて早く発見し、獲得済みの手掛かりは減員後も保持する。 @returns {void} */
function discoverDangerousSeaEvents() {
  const current = data();
  if (!current || state.wanted?.detention) return;
  const rule = dangerousEventScoutRules(snapshotOutfitting(state).scouts);
  for (const event of activeDangerousSeaEvents(current)) {
    const distance = Math.abs(event.position.x - state.position.x) + Math.abs(event.position.y - state.position.y);
    if (distance <= rule.radius) { event.discovered = true; event.hintTier = Math.max(event.hintTier, rule.min); }
  }
}

/** @returns {object[]} 発見済み地点。斥候ゼロでは現地へ到達するまで正体や座標を公開しない。 */
export function visibleDangerousSeaEvents() { return activeDangerousSeaEvents(state.dangerousSeas?.events).filter(event => event.discovered); }

/** @param {{x:number,y:number}} position 位置。 @returns {object|null} 現在地の限定イベント。 */
export function getDangerousSeaEventAt(position) {
  return activeDangerousSeaEvents(state.dangerousSeas?.events).find(event => event.position.x === position.x && event.position.y === position.y) || null;
}
