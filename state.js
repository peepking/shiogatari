import { FACTIONS } from "./lore.js";

/**
 * ゲームの初期状態を生成する。
 * @returns {object}
 */
const createState = () => ({
  ships: 0,
  troops: { marine: { 1: 4, 2: 1 } },
  faith: 0,
  supplies: { food: 10 },
  funds: 1000,
  fame: 0,
  silence: 0,
  lastRoll: null,
  lastResultText: "",
  modeLabel: "通常",
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

/** @type {object} ゲームの進行状態 */
export const state = createState();
/** @type {object} 行動決定の一時状態 */
export const pending = createPending();

/**
 * 状態を初期化する。
 */
export function resetState() {
  Object.assign(state, createState());
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
