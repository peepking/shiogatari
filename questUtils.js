import { SUPPLY_ITEMS, SUPPLY_TYPES } from "./supplies.js";
import { mapData } from "./map.js";

/** @type {number} 1季節あたりの日数 */
export const DAY_PER_SEASON = 30;
/** @type {number} 1年あたりの季節数 */
export const SEASONS_PER_YEAR = 4;
/** @type {number} 1年あたりの日数 */
export const DAY_PER_YEAR = DAY_PER_SEASON * SEASONS_PER_YEAR;

/** 敵人数計算用アンカー（通常） */
export const NORMAL_ANCHORS = [
  { fame: 0, min: 3, max: 5 },
  { fame: 100, min: 7, max: 8 },
  { fame: 500, min: 35, max: 40 },
  { fame: 1000, min: 70, max: 80 },
];

/** 敵人数計算用アンカー（強編成） */
export const STRONG_ANCHORS = [
  { fame: 100, min: 8, max: 9 },
  { fame: 500, min: 40, max: 45 },
  { fame: 1000, min: 80, max: 90 },
];

/**
 * 指定範囲の整数乱数を返す。
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
/**
 * 指定の面数でダイスを振る。
 * @param {number} sides
 * @param {number} count
 * @returns {number}
 */
export const rollDice = (sides, count) =>
  Array.from({ length: count }, () => randInt(1, sides)).reduce((a, b) => a + b, 0);
/**
 * 絶対日数（年/季節/日を通算）を返す。
 * @param {{year:number,season:number,day:number}} param0
 * @returns {number}
 */
export const absDay = ({ year, season, day }) => year * DAY_PER_YEAR + season * DAY_PER_SEASON + day;
/**
 * マンハッタン距離を計算する。
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @returns {number}
 */
export const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * 名声アンカーから補間した人数レンジを返す。
 * @param {number} fame 名声
 * @param {Array<{fame:number,min:number,max:number}>} anchors アンカー配列
 * @returns {{min:number,max:number}}
 */
export function pickAnchorRange(fame, anchors) {
  const list = [...anchors].sort((a, b) => a.fame - b.fame);
  if (fame <= list[0].fame) return { min: list[0].min, max: list[0].max };
  if (fame >= list[list.length - 1].fame) return { min: list[list.length - 1].min, max: list[list.length - 1].max };
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i];
    const b = list[i + 1];
    if (fame >= a.fame && fame <= b.fame) {
      const t = (fame - a.fame) / Math.max(1, b.fame - a.fame);
      const lerp = (x, y) => Math.round(x + (y - x) * t);
      return { min: lerp(a.min, b.min), max: lerp(a.max, b.max) };
    }
  }
  return { min: list[0].min, max: list[0].max };
}

/**
 * 加工品から重複なしで指定数を選ぶ。
 * @param {number} [count=2]
 * @returns {Array}
 */
export function pickRandomProcessed(count = 2) {
  const processed = SUPPLY_ITEMS.filter((i) => i.type === SUPPLY_TYPES.processed);
  const picks = [];
  const pool = [...processed];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = randInt(0, pool.length - 1);
    picks.push(pool.splice(idx, 1)[0]);
  }
  return picks;
}

/**
 * 現在地から一定距離の海/浅瀬を探索して選ぶ。
 * @param {{x:number,y:number}} origin
 * @returns {{x:number,y:number}}
 */
export function randomSeaTarget(origin) {
  const candidates = [];
  const minDist = 10;
  const maxDist = 15;
  for (let y = 0; y < mapData.length; y++) {
    for (let x = 0; x < mapData[0].length; x++) {
      const cell = mapData[y][x];
      if (cell.terrain !== "sea" && cell.terrain !== "shoal") continue;
      const d = manhattan(origin, { x, y });
      if (d >= minDist && d <= maxDist) {
        candidates.push({ x, y });
      }
    }
  }
  // 条件に合う座標が無い場合は範囲を広げて再探索する。
  if (!candidates.length) {
    for (let y = 0; y < mapData.length; y++) {
      for (let x = 0; x < mapData[0].length; x++) {
        const cell = mapData[y][x];
        if (cell.terrain !== "sea" && cell.terrain !== "shoal") continue;
        const d = manhattan(origin, { x, y });
        if (d >= 10 && d <= 40) candidates.push({ x, y });
      }
    }
  }
  if (!candidates.length) return origin;
  return candidates[randInt(0, candidates.length - 1)];
}

/**
 * 現在地から一定距離の非拠点マスを探索して選ぶ（討伐用）。
 * @param {{x:number,y:number}} origin
 * @param {number} [minDist=3]
 * @param {number} [maxDist=7]
 * @param {Array<{x:number,y:number}>} [avoid=[]]
 * @returns {{x:number,y:number}}
 */
export function randomHuntTarget(origin, minDist = 3, maxDist = 7, avoid = []) {
  const avoidSet = new Set((avoid || []).map((p) => `${p.x},${p.y}`));
  const pickFrom = (lo, hi) => {
    const list = [];
    for (let y = 0; y < mapData.length; y++) {
      for (let x = 0; x < mapData[0].length; x++) {
        const cell = mapData[y][x];
        const d = manhattan(origin, { x, y });
        if (d < lo || d > hi) continue;
        if (cell?.building === "village" || cell?.building === "town" || cell?.settlement) continue;
        const key = `${x},${y}`;
        if (avoidSet.has(key)) continue;
        list.push({ x, y });
      }
    }
    return list;
  };

  let candidates = pickFrom(minDist, maxDist);
  if (!candidates.length) candidates = pickFrom(2, maxDist + 5);
  if (!candidates.length) candidates = pickFrom(1, Math.max(mapData.length, mapData[0].length));
  if (!candidates.length) return origin;
  return candidates[randInt(0, candidates.length - 1)];
}
