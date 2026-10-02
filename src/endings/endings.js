import { ENDINGS } from "./endingConfig.js";
import { absDay, DAY_PER_YEAR } from "../core/calendar.js";
import { MODE_LABEL } from "../core/constants.js";
import { normalizeFleet, totalShips } from "../fleet/fleet.js";
import { totalWanted } from "../wanted/playerWanted.js";
import { tideStage, TIDE_STAGES } from "../faith/tideAlliance.js";
import { FISH_SPECIES } from "../fishing/fishingConfig.js";
import { normalizeVoyageStats, statNumber, voyageTroops } from "../core/voyageStats.js";

/** 知られている結末の記録だけを復元する。 @param {*} value 保存値。 @returns {object} 結末記録。 */
export function normalizeFinalVoyage(value) {
  const unlocked = {}, records = {};
  for (const ending of ENDINGS) {
    const day = value?.unlocked?.[ending.id];
    if (statNumber(day) > 0) unlocked[ending.id] = statNumber(day);
    const record = value?.records?.[ending.id];
    if (unlocked[ending.id] && statNumber(record?.day) > 0 && record?.snapshot?.version === 1) {
      const raw = record.snapshot;
      const snapshot = normalizeVoyageStats(raw, { year: 1000, season: 0, day: 1 });
      for (const key of ["day", "elapsed", "fishSpecies", "fishTotal", "variantsOwned"]) snapshot[key] = statNumber(raw[key]);
      snapshot.fishSpecies = Math.min(snapshot.fishSpecies, snapshot.fishTotal);
      snapshot.visitCounts = Object.fromEntries(["village", "town", "haven"].map(key => [key, statNumber(raw.visitCounts?.[key])]));
      if (snapshot.largestFish) snapshot.largestFish.name = typeof raw.largestFish.name === "string" ? raw.largestFish.name.slice(0, 100) : "記録の魚";
      records[ending.id] = { day: statNumber(record.day), snapshot };
    }
  }
  return { version: 1, unlocked, records };
}

/** 現在の条件を同時判定し、複数成立時も定義順にすべて返す。 @param {object} state 状態。 @param {Array} settlements 世界の拠点。 @returns {Array<string>} 成立ID。 */
export function eligibleEndings(state, settlements) {
  const fleet = normalizeFleet(state.fleet), stats = state.voyageStats;
  const sites = settlements.filter(s => ["town", "village"].includes(s.kind));
  const temples = sites.filter(s => tideStage(state.tideAlliance?.sites?.[s.id]) === TIDE_STAGES.length - 1).length;
  const checks = {
    awe: totalWanted(state.wanted) > 100000 && state.fame >= 3000,
    hunt: fleet.variants.length >= 20,
    dismantling: state.funds >= 1000000 && totalShips(fleet) >= 50,
    rise: state.fame >= 5000 && voyageTroops(state.troops) >= 500,
    merging: state.faith >= 500 && temples >= 2,
    great_voyage: !!stats && absDay(state) - stats.startedAbs >= 100 * DAY_PER_YEAR,
    collection: FISH_SPECIES.length > 0 && FISH_SPECIES.every(s => state.expansion?.fishing?.codex?.[s.id]?.count > 0),
    salvation: stats?.refugeesRescued >= 300,
    exploration: sites.length > 0 && sites.every(s => stats?.visited.includes(s.id)),
    discovery: stats?.chartsCompleted >= 10,
    sea: state.pirateKingStory?.completed === true,
  };
  return ENDINGS.filter(e => checks[e.id]).map(e => e.id);
}

/** 確定した状態から最高値と初回解放を更新する。 @param {object} state 状態。 @param {Array} settlements 拠点。 @returns {Array<string>} 新規解放ID。 */
export function updateFinalVoyage(state, settlements) {
  if (!state.voyageStats) return [];
  state.finalVoyage ||= normalizeFinalVoyage();
  const peaks = state.voyageStats.peaks;
  peaks.ships = Math.max(peaks.ships, totalShips(state.fleet));
  peaks.troops = Math.max(peaks.troops, voyageTroops(state.troops));
  peaks.fame = Math.max(peaks.fame, statNumber(state.fame));
  const added = eligibleEndings(state, settlements).filter(id => !state.finalVoyage.unlocked[id]);
  for (const id of added) state.finalVoyage.unlocked[id] = absDay(state);
  return added;
}

/** 統計表示用の独立したスナップショットを作る。 @param {object} state 状態。 @param {Array} settlements 拠点。 @returns {object} 当時の統計。 */
export function voyageSnapshot(state, settlements) {
  const stats = normalizeVoyageStats(state.voyageStats, state);
  const fish = FISH_SPECIES.filter(s => state.expansion?.fishing?.codex?.[s.id]?.count > 0).length;
  const visited = settlements.filter(s => stats.visited.includes(s.id));
  return { ...stats, day: absDay(state), elapsed: Math.max(0, absDay(state) - stats.startedAbs), fishSpecies: fish, fishTotal: FISH_SPECIES.length,
    variantsOwned: normalizeFleet(state.fleet).variants.length,
    visitCounts: { village: visited.filter(s => s.kind === "village").length, town: visited.filter(s => s.kind === "town" && !s.pirateHaven).length, haven: visited.filter(s => s.pirateHaven).length },
    largestFish: stats.largestFish ? { ...stats.largestFish, name: FISH_SPECIES.find(s => s.id === stats.largestFish.id)?.name || "記録の魚" } : null };
}

/** 初回閲覧だけ記録し、再閲覧で当時の統計を変えない。 @param {object} state 状態。 @param {string} id 結末ID。 @param {Array} settlements 拠点。 @returns {object|null} 記録。 */
export function recordEnding(state, id, settlements) {
  if (!ENDINGS.some(e => e.id === id) || !state.finalVoyage?.unlocked?.[id]) return null;
  state.finalVoyage.records[id] ||= { day: absDay(state), snapshot: voyageSnapshot(state, settlements) };
  return state.finalVoyage.records[id];
}

/** 未確定処理を終えてから結末を選べるようにする。 @param {object} state 状態。 @param {object} pending 神託。 @returns {boolean} 利用可能。 */
export function canOpenFinalVoyage(state, pending = {}) {
  return [MODE_LABEL.NORMAL, MODE_LABEL.IN_TOWN, MODE_LABEL.IN_VILLAGE, MODE_LABEL.AUDIENCE, MODE_LABEL.SAILING].includes(state.modeLabel)
    && !state.pendingEncounter?.active && !pending.kind && !state.eventQueue?.length && !state.wanted?.detention
    && !state.expansion?.exploration?.pending && !state.expansion?.charts?.pending && !state.expansion?.fishing?.pending;
}
