import { EXPLORATION_CONFIG as CONFIG } from "./expansionConfig.js";

/** 自然探索地点の表示名。 */
export const EXPLORATION_NAMES = Object.freeze({ drift: "漂流物", battlefield: "戦場跡", wreck: "難破船" });
/** 危険度ごとの案内。 */
const DANGER_TEXT = ["安全に探索できそうです", "敵が潜んでいる可能性があります", "敵と遭遇する可能性は半々です", "敵がいる可能性が高い場所です", "探索すると必ず戦闘になります"];

/**
 * 整数の範囲から均等抽選する。
 * @param {number[]} range 両端を含む範囲。
 * @param {Function} random 乱数源。
 * @returns {number} 抽選結果。
 */
function integer(range, random) { return range[0] + Math.floor(random() * (range[1] - range[0] + 1)); }

/**
 * 既知の危険度を数値付きで説明する。
 * @param {number} danger 戦闘確率。
 * @returns {string} 案内。
 */
export function describeDanger(danger) {
  return `${DANGER_TEXT[CONFIG.dangerLevels.indexOf(danger)] || "危険度不明"}（戦闘確率${danger * 100}%）`;
}

/**
 * 非拠点かつ地形が一致する候補から均等に地点を選ぶ。既存地点と外部予約位置は除く。
 * @param {object} data 探索状態。
 * @param {Array} map 地図。
 * @param {string} kind 地点種別。
 * @param {number} now 絶対日。
 * @param {Set<string>} blocked 予約座標。
 * @param {Function} random 乱数源。
 * @returns {object|null} 作成した地点。
 */
function spawnSite(data, map, kind, now, blocked, random) {
  const candidates = [];
  const occupied = new Set([...blocked, ...data.sites.map(s => `${s.position.x},${s.position.y}`)]);
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      const cell = map[y][x];
      const sea = cell.terrain === "sea" || cell.terrain === "shoal";
      if (cell.building && cell.building !== "none") continue;
      if (sea === (kind === "battlefield") || occupied.has(`${x},${y}`)) continue;
      candidates.push({ x, y });
    }
  }
  if (!candidates.length) return null;
  const site = { id: data.nextId++, kind, position: candidates[integer([0, candidates.length - 1], random)],
    spawnedAbs: now, expiresAbs: now + CONFIG.lifetimeDays,
    danger: CONFIG.dangerLevels[integer([0, CONFIG.dangerLevels.length - 1], random)] };
  data.sites.push(site);
  return site;
}

/**
 * 初期地点を一度だけ生成する。候補不足の種別は再描画による再抽選を行わない。
 * @param {object} data 探索状態。
 * @param {Array} map 地図。
 * @param {number} now 絶対日。
 * @param {Set<string>} [blocked] 予約位置。
 * @param {Function} [random] 乱数源。
 * @returns {void}
 */
export function initializeExploration(data, map, now, blocked = new Set(), random = Math.random) {
  if (data.initialized || !map.length) return;
  for (const [kind, count] of Object.entries(CONFIG.initialCounts)) {
    for (let i = 0; i < count; i++) spawnSite(data, map, kind, now, blocked, random);
  }
  data.initialized = true;
  data.lastTickAbs = now;
}

/**
 * 期限切れを先に除去し、空きがある各枠を1日1回抽選する。探索中の地点は期限から保護する。
 * 同日の再実行では乱数を消費せず、消滅地点を再生成しない。
 * @param {object} data 探索状態。
 * @param {Array} map 地図。
 * @param {number} now 絶対日。
 * @param {Set<string>} [blocked] 予約位置。
 * @param {Function} [random] 乱数源。
 * @returns {void}
 */
export function tickExploration(data, map, now, blocked = new Set(), random = Math.random) {
  initializeExploration(data, map, now, blocked, random);
  if (data.lastTickAbs >= now) return;
  data.lastTickAbs = now;
  data.sites = data.sites.filter(s => s.id === data.pending?.siteId || now < s.expiresAbs);
  if (data.sites.filter(s => s.kind !== "wreck").length < CONFIG.commonLimit && random() < CONFIG.commonDailyChance) {
    spawnSite(data, map, random() < CONFIG.landChance ? "battlefield" : "drift", now, blocked, random);
  }
  if (data.sites.filter(s => s.kind === "wreck").length < CONFIG.wreckLimit && random() < CONFIG.wreckDailyChance) {
    spawnSite(data, map, "wreck", now, blocked, random);
  }
}

/**
 * 固定幅の報酬を抽選する。高級品2種へ最低1個ずつ配り、残りを均等抽選する。
 * 救助兵種は1人ずつ均等抽選する。敵人数や名声は参照しない。
 * @param {string} kind 種別。
 * @param {string[]} goods 高級品ID。
 * @param {string[]} troopTypes 兵種ID。
 * @param {Function} [random] 乱数源。
 * @returns {object} 固定報酬。
 */
export function rollExplorationReward(kind, goods, troopTypes, random = Math.random) {
  const settings = kind === "wreck" ? CONFIG.wreckReward : CONFIG.commonReward;
  const pool = [...goods];
  const selected = [];
  for (let i = 0; i < settings.kinds && pool.length; i++) selected.push(pool.splice(integer([0, pool.length - 1], random), 1)[0]);
  const supplies = Object.fromEntries(selected.map(id => [id, 1]));
  const quantity = integer(settings.goods, random);
  for (let n = selected.length; n < quantity && selected.length; n++) supplies[selected[integer([0, selected.length - 1], random)]]++;
  const reward = { funds: integer(settings.funds, random), supplies, troops: {}, ships: 0 };
  if (kind === "wreck") {
    const count = integer(settings.troops, random);
    for (let n = 0; n < count && troopTypes.length; n++) {
      const id = troopTypes[integer([0, troopTypes.length - 1], random)];
      reward.troops[id] = (reward.troops[id] || 0) + 1;
    }
    reward.ships = random() < settings.shipChance ? settings.ships : 0;
  }
  return reward;
}

/**
 * 探索を消費済みにし、勝利・非戦闘時だけ固定報酬を一度返す。
 * @param {object} data 探索状態。
 * @param {boolean} success 報酬を受け取れるか。
 * @returns {object|null} 報酬。
 */
export function consumeExploration(data, success) {
  const pending = data.pending;
  if (!pending) return null;
  data.sites = data.sites.filter(s => s.id !== pending.siteId);
  data.pending = null;
  return success ? pending.reward : null;
}

/**
 * 探索の保存レコードを検証する。壊れた地点は除外し、正当な予約だけを復元する。
 * IDは再利用せず、有効な最大IDより次の番号を大きくする。
 * @param {object} data 型補完済みの保存領域。
 * @returns {object} 検証済み領域。
 */
export function validateExploration(data) {
  const seen = new Set();
  const coords = new Set();
  const sites = data.sites.filter(site => {
    if (!site || !Object.hasOwn(EXPLORATION_NAMES, site.kind) || !Number.isSafeInteger(site.id) || site.id < 1 || seen.has(site.id)) return false;
    const pos = site.position;
    if (!pos || !Number.isInteger(pos.x) || !Number.isInteger(pos.y) || pos.x < 0 || pos.y < 0 || pos.x >= 50 || pos.y >= 50) return false;
    if (!Number.isSafeInteger(site.spawnedAbs) || site.expiresAbs !== site.spawnedAbs + CONFIG.lifetimeDays || !CONFIG.dangerLevels.includes(site.danger)) return false;
    const coord = `${pos.x},${pos.y}`;
    if (coords.has(coord)) return false;
    seen.add(site.id); coords.add(coord);
    return true;
  });
  let pending = data.pending;
  const site = sites.find(s => s.id === pending?.siteId);
  const reward = pending?.reward;
  /** @param {*} value 数量マップ。 @returns {boolean} 正常な数量か。 */
  const validAmounts = value => value && !Array.isArray(value) && typeof value === "object" && Object.values(value).every(n => Number.isInteger(n) && n >= 0 && n <= 10000);
  if (!site || typeof pending?.dayApplied !== "boolean" || !reward || !Number.isInteger(reward.funds) || reward.funds < 0 || reward.funds > 1100 || ![0, 1].includes(reward.ships) || !validAmounts(reward.supplies) || !validAmounts(reward.troops)) pending = null;
  if (pending?.encounter && (!pending.encounter.active || pending.encounter.explorationId !== site.id || !Array.isArray(pending.encounter.enemyFormation) || !pending.encounter.enemyFormation.length)) pending = null;
  return { ...data, sites, pending, nextId: Math.max(data.nextId, 1, ...sites.map(s => s.id + 1)) };
}
