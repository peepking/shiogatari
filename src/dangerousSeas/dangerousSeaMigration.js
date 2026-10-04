import { buildDangerousSeaGeometry } from "./dangerousSeaGeometry.js";
import { worldReservedPositions } from "./dangerousSeaReservations.js";

/** 円形への移行済み地点を、次の読み込みで再配置しないための版。 */
export const DANGEROUS_SEA_PLACEMENT_VERSION = 1;

/** @param {object} position 座標。 @returns {string} 予約と候補の共通キー。 */
function placementKey(position) { return `${position.x},${position.y}`; }

/**
 * 生成済み段階を優先し、段階を保存しない賞金首は旧核心の条件から推定する。
 * @param {object} site 専用地点。 @param {Array} settlements 補給拠点。 @returns {string} 元の段階。
 */
function savedPlacementLevel(site, settlements) {
  if (["outer", "core"].includes(site.level)) return site.level;
  const position = site.position;
  const corner = position.y >= 45 && (site.regionId === "sw" ? position.x <= 4 : position.x >= 45);
  const supply = settlements.filter(port => port?.coords && (port.kind === "town" || port.kind === "village" || port.pirateHaven));
  return corner && supply.every(port => Math.abs(port.coords.x - position.x) + Math.abs(port.coords.y - position.y) >= 5) ? "core" : "outer";
}

/**
 * 途中探索・段階イベント・専用戦闘の参照を保護する。危険の保留中は現在地の地点も動かさない。
 * @param {object} game ゲーム状態。 @param {string} kind 地点種別。 @param {object} site 地点。
 * @returns {boolean} 固定位置のまま続行する地点か。
 */
function placementInProgress(game, kind, site) {
  const data = game.dangerousSeas, encounter = game.pendingEncounter?.active ? game.pendingEncounter : null;
  if (kind === "exploration" && (data.explorationPending?.siteId === site.id || encounter?.dangerousExplorationId === site.id)) return true;
  if (kind === "bounty" && encounter?.dangerousBountyId === site.id) return true;
  if (kind === "event" && (data.events?.pending?.eventId === site.id || encounter?.dangerousEventId === site.id
    || site.progress > 0 || site.choices?.length || site.completed)) return true;
  return !!(data.pendingHazard && game.position && placementKey(game.position) === placementKey(site.position));
}

/**
 * 読み込み時だけ、未着手の専用地点を同じ海域の円内へ移す。乱数・期限・報酬・編成は更新しない。
 * 海域、探索・賞金首・イベント、個体IDの順に処理し、同段階、直線距離、上・左の順で移設先を決める。
 * 他の全地点と途中行動の現在地を予約し、候補不足は旧位置を保持して次の読み込みでのみ再試行する。
 * 円外で進行中の地点も未完了として保持し、進行終了後の読み込みでのみ移す。全地点の処理後に版を確定する。
 * @param {object} game 正規化済みゲーム状態。 @param {object} world 復元後の世界スナップショット。
 * @returns {{changed:boolean,moved:number,unplaced:number,deferred:number,complete:boolean}} 移行結果。
 */
export function migrateDangerousSeaPlacements(game, world) {
  const data = game.dangerousSeas, result = { changed: false, moved: 0, unplaced: 0, deferred: 0, complete: false };
  if (!data) return result;
  if (data.placementVersion >= DANGEROUS_SEA_PLACEMENT_VERSION) return { ...result, complete: true };
  if (!Array.isArray(world?.cells) || !world.cells.length || !Array.isArray(world.settlements)) return result;
  const geometry = buildDangerousSeaGeometry(world.cells, world.settlements);
  const settlements = new Set(world.settlements.filter(port => port?.coords).map(port => placementKey(port.coords)));
  const occupied = worldReservedPositions(game);
  if (game.position && (game.pendingEncounter?.active || data.pendingHazard || data.action || data.explorationPending || data.events?.pending)) {
    occupied.add(placementKey(game.position));
  }
  for (const regionId of ["sw", "se"]) {
    const positions = geometry.positions[regionId].filter(point => !settlements.has(placementKey(point)) && !world.cells[point.y][point.x].settlementId);
    const inside = new Set(positions.map(placementKey));
    const groups = [
      ["exploration", data.regions?.[regionId]?.sites || []],
      ["bounty", (data.bounties?.active || []).filter(site => site.regionId === regionId)],
      ["event", [data.events?.active?.[regionId], data.events?.stormAftermath?.[regionId]].filter(Boolean)],
    ];
    for (const [kind, sites] of groups) for (const site of [...sites].sort((a, b) => a.id - b.id)) {
      if (!site.position || inside.has(placementKey(site.position))) continue;
      if (placementInProgress(game, kind, site)) { result.deferred += 1; continue; }
      const level = savedPlacementLevel(site, world.settlements), origin = site.position;
      const choices = positions.filter(point => !occupied.has(placementKey(point)));
      choices.sort((a, b) => (a.level !== level) - (b.level !== level)
        || ((a.x - origin.x) ** 2 + (a.y - origin.y) ** 2) - ((b.x - origin.x) ** 2 + (b.y - origin.y) ** 2)
        || a.y - b.y || a.x - b.x);
      if (!choices.length) { result.unplaced += 1; continue; }
      site.position = { ...origin, x: choices[0].x, y: choices[0].y };
      occupied.add(placementKey(site.position)); result.moved += 1; result.changed = true;
    }
  }
  result.complete = result.unplaced === 0 && result.deferred === 0;
  if (result.complete) { data.placementVersion = DANGEROUS_SEA_PLACEMENT_VERSION; result.changed = true; }
  return result;
}
