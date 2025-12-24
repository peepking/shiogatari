import { MODE_LABEL } from "./constants.js";
import { FACTIONS } from "./lore.js";

/**
 * ゲームの初期状態を生成する。
 * @returns {object}
 */
const createState = () => ({
  ships: 0,
  troops: {
    infantry: { 1: 5 },
    archer: { 1: 5 },
  },
  faith: 0,
  supplies: { food: 10 },
  funds: 1000,
  fame: 0,
  silence: 0,
  factionState: {},
  warLedger: { entries: [] },
  encounterProgress: 0,
  encounterThreshold: 12,
  pendingEncounter: {
    active: false,
    enemyFormation: [],
    enemyTotal: 0,
    strength: "normal",
    terrain: "plain",
    questId: null,
    questType: null,
    enemyFactionId: null,
  },
  lastRoll: null,
  lastResultText: "",
  modeLabel: MODE_LABEL.NORMAL,
  mapPinsVisible: true,
  eventQueue: [],
  eventSeq: 1,
  honorFactions: [],
  honorInviteLog: {},
  playerFactionId: null,
  nobleFavor: {},
  refugeeEscort: { active: false, targetId: null, factionId: null, nobleId: null },
  eventTrade: null,
  year: 1000,
  season: 0, // 0:春 1:夏 2:秋 3:冬
  day: 1, // 1-30
  quests: {
    availableBySettlement: {},
    active: [],
    collapsed: false,
    nextId: 1,
    lastSeasonBySettlement: {},
    seeded: false,
    lastOracleSeason: null,
  },
  lastPrayerSeason: null,
  factionAttitudes: Object.fromEntries(
    FACTIONS.map((f) => [f.id, f.attitude || "neutral"])
  ),
  position: { x: 10, y: 10 },
  mapMode: "full", // "full" | "zoom" の2状態
  selectedPosition: null,
});

/**
 * 行動決定系の一時状態を生成する。
 * @returns {object}
 */
const createPending = () => ({
  kind: null, // "intensity" | "companionFate" | "mercMorph" のいずれか
  direction: null,
  forceDirection: null,
});

function initFactionState() {
  const map = {};
  (FACTIONS || []).forEach((f) => {
    map[f.id] = {
      id: f.id,
      name: f.name,
      color: f.color,
      attitude: f.attitude || "neutral",
      relations: {},
      warFlags: { active: false, startedAt: null, fronts: [] },
      supplyStatus: { morale: 0, supply: 0 },
    };
  });
  Object.keys(map).forEach((a) => {
    Object.keys(map).forEach((b) => {
      if (a === b) return;
      map[a].relations[b] = "neutral";
    });
  });
  return map;
}

/** @type {object} ゲームの進行状態 */
export const state = createState();
state.factionState = initFactionState();
/** @type {object} 行動決定の一時状態 */
export const pending = createPending();

/**
 * 状態を初期化する。
 */
export function resetState() {
  Object.assign(state, createState());
  state.factionState = initFactionState();
  state.warLedger = { entries: [] };
  Object.assign(pending, createPending());
}

/**
 * 日数を進め、季節/年の繰り上げを処理する。
 * @param {number} [days=1]
 */
export function advanceDay(days = 1) {
  let d = state.day + days;
  let s = state.season;
  let y = state.year;
  while (d > 30) {
    d -= 30;
    s = (s + 1) % 4;
    if (s === 0) y += 1;
  }
  state.day = d;
  state.season = s;
  state.year = y;
}
