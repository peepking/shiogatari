import { DANGEROUS_SEAS, DANGEROUS_HAZARD_RATES } from "./dangerousSeaConfig.js";
import { normalizeDangerousBounties } from "./dangerousBounty.js";
import { validateDangerousExploration } from "./dangerousSeaExploration.js";
import { dangerousScoutRules, normalizeDangerousWeather, updateDangerousWeather } from "./dangerousSeaWeather.js";
import { createDangerousSeaEvents, normalizeDangerousSeaEvents } from "./dangerousSeaEventState.js";
import { DANGEROUS_SEA_PLACEMENT_VERSION } from "./dangerousSeaMigration.js";

/** @param {*} value 値。 @param {number} [fallback=0] 既定値。 @returns {number} 非負整数。 */
function integer(value, fallback = 0) { return Number.isSafeInteger(value) && value >= 0 ? value : fallback; }

/** @returns {object} 一海域の独立した警戒・探索状態。 */
function createRegion() {
  return { alert: 0, outsideDays: 0, forecast: null, weather: null, lastWaveAbs: null, initialized: false, lastTickAbs: null, sites: [] };
}

/** @returns {object} 危険海域の初期状態。通常の拡張状態とは独立して保存する。 */
export function createDangerousSeaState() {
  return { version: 1, placementVersion: DANGEROUS_SEA_PLACEMENT_VERSION, nextActionId: 1, nextEventId: 1, nextSiteId: 1, lastProcessedAbs: null,
    tutorialSeen: false, regions: { sw: createRegion(), se: createRegion() },
    raidSafeUntil: null, events: createDangerousSeaEvents(), bounties: normalizeDangerousBounties(), action: null, pendingHazard: null, explorationPending: null };
}

/**
 * 保存済みの危険を再抽選せず、旧セーブは警戒ゼロから開始する。表示中の荒波も固定損失を引き継ぐ。
 * @param {object} [raw] 保存値。 @returns {object} 復元用状態。
 */
export function normalizeDangerousSeas(raw) {
  const data = createDangerousSeaState();
  if (!raw || typeof raw !== "object") return data;
  data.placementVersion = integer(raw.placementVersion);
  for (const key of ["nextActionId", "nextEventId", "nextSiteId"]) data[key] = Math.max(1, integer(raw[key], 1));
  data.lastProcessedAbs = Number.isSafeInteger(raw.lastProcessedAbs) ? raw.lastProcessedAbs : null;
  data.tutorialSeen = raw.tutorialSeen === true;
  data.raidSafeUntil = Number.isSafeInteger(raw.raidSafeUntil) ? raw.raidSafeUntil : null;
  for (const id of Object.keys(DANGEROUS_SEAS)) {
    const value = raw.regions?.[id] || {};
    const region = data.regions[id];
    region.alert = Math.min(12, integer(value.alert)); region.outsideDays = integer(value.outsideDays);
    if (Number.isSafeInteger(value.forecast?.day)) region.forecast = { day: value.forecast.day, avoided: value.forecast.avoided === true };
    region.weather = normalizeDangerousWeather(value.weather);
    region.lastWaveAbs = Number.isSafeInteger(value.lastWaveAbs) ? value.lastWaveAbs : null;
    region.sites = Array.isArray(value.sites) ? value.sites : [];
    region.initialized = value.initialized === true;
    region.lastTickAbs = Number.isSafeInteger(value.lastTickAbs) ? value.lastTickAbs : null;
  }
  data.bounties = normalizeDangerousBounties(raw.bounties);
  data.events = normalizeDangerousSeaEvents(raw.events);
  if (integer(raw.action?.id) && ["move", "wait", "fishing", "exploration", "chart", "event", "raid_evasion"].includes(raw.action.kind)) {
    data.action = { id: raw.action.id, kind: raw.action.kind, startedAbs: integer(raw.action.startedAbs) };
    data.nextActionId = Math.max(data.nextActionId, data.action.id + 1);
  }
  const hazard = raw.pendingHazard;
  if (integer(hazard?.id) && DANGEROUS_SEAS[hazard.regionId] && ["raid", "wave"].includes(hazard.kind)) {
    const stage = ["action_running", "ready", "displaying", "battle", "warning", "watch", "evading"].includes(hazard.stage) ? hazard.stage : "ready";
    if (hazard.kind === "wave" || (Array.isArray(hazard.encounter?.formation) && hazard.encounter.formation.length)) {
      data.pendingHazard = { ...hazard, stage, losses: hazard.losses && typeof hazard.losses === "object"
        ? Object.fromEntries(Object.entries(hazard.losses).filter(([, n]) => integer(n) > 0)) : null };
      if (hazard.kind === "raid") {
        data.pendingHazard.arrivalDay = Number.isSafeInteger(hazard.arrivalDay) ? hazard.arrivalDay : integer(hazard.day) + 1;
        const deferred = hazard.deferredWave;
        data.pendingHazard.deferredWave = DANGEROUS_SEAS[deferred?.regionId] && Number.isSafeInteger(deferred.day) ? { regionId: deferred.regionId, day: deferred.day } : null;
      }
      data.nextEventId = Math.max(data.nextEventId, hazard.id + 1);
    }
  }
  data.explorationPending = raw.explorationPending || null;
  validateDangerousExploration(data);
  return data;
}

/**
 * 現在の作用海域を離れた荒波を棄却する。襲撃後へ保留した波は当日・同海域の分だけ保持する。
 * 域内で確定した波の損失・行動・敵編成には触れず、退避や旧保存の復帰で域外へ被害を持ち越さない。
 * @param {object} data 危険海域状態。 @param {object|null} sea 共通地形判定による現在海域。
 * @param {number} today 通算日。 @returns {boolean} 無効になった波を取り除いたか。
 */
export function discardRoughWaveOutsideRegion(data, sea, today) {
  const hazard = data?.pendingHazard;
  if (!hazard) return false;
  if (hazard.kind === "wave" && hazard.regionId !== sea?.regionId) { data.pendingHazard = null; return true; }
  if (hazard.kind === "raid" && hazard.deferredWave
    && (hazard.deferredWave.regionId !== sea?.regionId || hazard.deferredWave.day !== today)) {
    hazard.deferredWave = null; return true;
  }
  return false;
}

/**
 * 日次の警戒を一度だけ更新する。荒波は独立した12～18日周期、襲撃は警戒度と斥候から抽選する。
 * 外に出ても二日間は警戒を保持し、三日目以降に二ずつ低下する。拘留日は回復だけ適用する。
 * 予報の到来日は新しい危険を抽選せず、探索などの固定戦闘がある日は追加襲撃を抑える。
 * @param {object} data 危険海域状態。 @param {object|null} sea 現在の海域属性。
 * @param {number} today 通算日。 @param {object} [options] 活動・拘留・襲撃抑制・編成生成。
 * @param {Function} [random=Math.random] 乱数源。 @returns {object|null} 新しく確定した危険。
 */
export function tickDangerousSeaDay(data, sea, today, options = {}, random = Math.random) {
  if (data.lastProcessedAbs != null && today < data.lastProcessedAbs) return null;
  const here = options.detained ? null : sea;
  discardRoughWaveOutsideRegion(data, here, today);
  if (data.lastProcessedAbs != null && today <= data.lastProcessedAbs) return null;
  data.lastProcessedAbs = today;
  const waves = updateDangerousWeather(data, today, options.scouts || 0, random);
  for (const [id, region] of Object.entries(data.regions)) {
    if (here?.regionId === id) {
      region.outsideDays = 0;
      const stationary = (options.activity || data.action?.kind || "wait") !== "move";
      region.alert = Math.min(12, region.alert + (here.level === "core" ? 2 : 1) + (stationary ? 1 : 0));
    } else {
      region.outsideDays += 1;
      if (region.outsideDays >= 3) region.alert = Math.max(0, region.alert - 2);
    }
  }
  const due = waves.find(value => value.regionId === here?.regionId);
  if (data.pendingHazard) {
    const hazard = data.pendingHazard;
    if (due && !due.avoided && hazard.kind === "raid") hazard.deferredWave = { regionId: due.regionId, day: today };
    if (hazard.stage === "watch" && today >= hazard.arrivalDay) {
      if (here?.regionId === hazard.regionId && options.suppressRaid) hazard.arrivalDay = today + 1;
      else if (here?.regionId === hazard.regionId) { hazard.stage = "action_running"; hazard.sourceActionId = data.action?.id || null; }
      else {
        data.pendingHazard = hazard.deferredWave ? { id: data.nextEventId++, kind: "wave", ...hazard.deferredWave,
          sourceActionId: data.action?.id || null, stage: "action_running", losses: null } : null;
        data.raidSafeUntil = today + 3;
      }
    }
    return null;
  }
  if (!here) return null;
  const region = data.regions[here.regionId];
  const wave = due;
  if (wave) {
    if (wave.avoided) return { kind: "wave_avoided", regionId: here.regionId, day: today };
    return data.pendingHazard = { id: data.nextEventId++, kind: "wave", regionId: here.regionId,
      day: today, sourceActionId: data.action?.id || null, stage: "action_running", losses: null };
  }
  const rates = DANGEROUS_HAZARD_RATES.find(row => region.alert <= row.max);
  const scoutRules = dangerousScoutRules(options.scouts);
  if (options.suppressRaid || today <= (data.raidSafeUntil ?? -1)) return null;
  const roll = random();
  if (roll < rates.raid * (1 - scoutRules.raidReduction)) {
    const encounter = options.createRaid?.();
    if (!encounter) return null;
    return data.pendingHazard = { id: data.nextEventId++, kind: "raid", regionId: here.regionId,
      day: today, sourceActionId: data.action?.id || null, stage: "action_running", encounter,
      detected: scoutRules.detection > 0 && random() < scoutRules.detection,
      evasionSuccess: scoutRules.evasion > 0 && random() < scoutRules.evasion, arrivalDay: today + 1 };
  }
  return null;
}

/**
 * 個体を展開せず、所持数を重みとした木構造から一匹ずつ無復元で均等抽選する。
 * 損失は総数の五％を切り捨て、魚価・希少性・図鑑登録には重みを付けない。
 * @param {object} counts 魚の在庫。 @param {Function} [random=Math.random] 乱数源。 @returns {object} 魚種別の固定損失。
 */
export function rollRoughWaveLosses(counts, random = Math.random) {
  const entries = Object.entries(counts || {}).filter(([, n]) => integer(n) > 0);
  let total = entries.reduce((sum, [, n]) => sum + n, 0);
  const amount = Math.floor(total * 0.05);
  if (!amount) return {};
  let size = 1;
  while (size < entries.length) size *= 2;
  const tree = Array(size * 2).fill(0);
  entries.forEach(([, n], i) => { tree[size + i] = n; });
  for (let i = size - 1; i > 0; i--) tree[i] = tree[i * 2] + tree[i * 2 + 1];
  const losses = {};
  for (let i = 0; i < amount; i++) {
    let pick = Math.min(total - 1, Math.floor(random() * total)), index = 1;
    while (index < size) {
      index *= 2;
      if (pick >= tree[index]) { pick -= tree[index]; index += 1; }
    }
    const id = entries[index - size][0];
    losses[id] = (losses[id] || 0) + 1;
    while (index > 0) { tree[index] -= 1; index = Math.floor(index / 2); }
    total -= 1;
  }
  return losses;
}

/**
 * 固定した荒波損失を一度だけ適用する。保護は木材・繊維各一個を同時に消費し、片方だけの支払をしない。
 * 図鑑・最大サイズ・釣果履歴は触らない。
 * @param {object} game ゲーム状態。 @param {number} eventId 危険の識別子。
 * @param {boolean} protect 材料で保護するか。 @returns {object|null} 適用結果、無効な操作ならnull。
 */
export function resolveRoughWave(game, eventId, protect) {
  const data = game.dangerousSeas, hazard = data?.pendingHazard;
  if (!hazard || hazard.id !== eventId || hazard.kind !== "wave" || hazard.stage !== "displaying") return null;
  if (protect && ((game.supplies?.wood || 0) < 1 || (game.supplies?.fiber || 0) < 1)) return null;
  if (protect) { game.supplies.wood -= 1; game.supplies.fiber -= 1; }
  else {
    const counts = game.expansion?.fishing?.counts || {};
    for (const [id, amount] of Object.entries(hazard.losses || {})) {
      const remaining = Math.max(0, (counts[id] || 0) - amount);
      if (remaining) counts[id] = remaining;
      else delete counts[id];
    }
  }
  const result = { protected: protect, lost: protect ? 0 : Object.values(hazard.losses || {}).reduce((sum, n) => sum + n, 0) };
  data.pendingHazard = null;
  return result;
}
