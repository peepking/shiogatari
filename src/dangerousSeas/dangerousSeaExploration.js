import { rollExplorationReward } from "../exploration/exploration.js";
import { dangerousWreckPending, settleDangerousWreckStage, validateDangerousWreckPending } from "./dangerousWreck.js";

/** 危険海域専用探索の初期調整値。通常探索の枠や出現率とは独立させる。 */
const EXPLORATION = Object.freeze({ drift: { limit: 2, chance: 0.05 }, wreck: { limit: 1, chance: 1 / 60 }, lifetime: 120 });
/** 生成済み報酬プロフィールは版ごとに保持し、設定変更で過去の途中報酬を失わない。 */
const PROFILES = Object.freeze({ danger_outer: { multiplier: 2, danger: [0.5, 0.75] }, danger_core: { multiplier: 3, danger: [0.75, 1] } });

/**
 * 両端を含む範囲から整数を均等抽選する。
 * @param {number} length 候補数。
 * @param {Function} random 乱数源。
 * @returns {number} 候補番号。
 */
function dangerousExplorationIndex(length, random) { return Math.min(length - 1, Math.floor(random() * length)); }

/**
 * 予約と両海域の既存地点を避け、海域内の全候補から一様に地点を選ぶ。
 * 段階・報酬版・危険度・期限を生成時に固定し、核心不足を外縁優遇の抽選で補わない。
 * @param {object} data 危険海域の全状態。
 * @param {string} regionId 海域ID。
 * @param {string} kind 漂流物か難破船。
 * @param {object} positions 海域別の候補座標。
 * @param {number} now 絶対日。
 * @param {Set<string>} blocked 予約座標。
 * @param {Function} random 乱数源。
 * @returns {object|null} 新しい地点。
 */
function spawnDangerousExploration(data, regionId, kind, positions, now, blocked, random) {
  const occupied = new Set(blocked);
  for (const region of Object.values(data.regions)) for (const site of region.sites) occupied.add(`${site.position.x},${site.position.y}`);
  const candidates = (positions[regionId] || []).filter(point => !occupied.has(`${point.x},${point.y}`));
  if (!candidates.length) return null;
  const point = candidates[dangerousExplorationIndex(candidates.length, random)], profile = `danger_${point.level}`, settings = PROFILES[profile];
  if (!settings) return null;
  const site = { id: data.nextSiteId++, regionId, kind, position: { x: point.x, y: point.y }, level: point.level,
    profile, version: 1, spawnedAbs: now, expiresAbs: now + EXPLORATION.lifetime,
    danger: settings.danger[dangerousExplorationIndex(settings.danger.length, random)] };
  data.regions[regionId].sites.push(site);
  return site;
}

/**
 * 各海域に漂流物・難破船を各1件だけ初期配置し、候補不足も含めて生成済みを記録する。
 * @param {object} data 危険海域の全状態。
 * @param {object} positions 海域別の候補座標。
 * @param {number} now 絶対日。
 * @param {Set<string>} [blocked] 予約座標。
 * @param {Function} [random] 乱数源。
 * @returns {void}
 */
export function initializeDangerousExploration(data, positions, now, blocked = new Set(), random = Math.random) {
  for (const regionId of ["sw", "se"]) {
    const region = data.regions[regionId];
    if (region.initialized) continue;
    for (const kind of ["drift", "wreck"]) spawnDangerousExploration(data, regionId, kind, positions, now, blocked, random);
    region.initialized = true;
    region.lastTickAbs = now;
  }
}

/**
 * 期限切れを先に除き、漂流物2件・難破船1件まで海域ごとに一日一回独立抽選する。
 * 途中探索は期限から保護し、同日再実行と画面表示では乱数を消費しない。
 * @param {object} data 危険海域の全状態。
 * @param {object} positions 海域別の候補座標。
 * @param {number} now 絶対日。
 * @param {Set<string>} [blocked] 予約座標。
 * @param {Function} [random] 乱数源。
 * @returns {void}
 */
export function tickDangerousExploration(data, positions, now, blocked = new Set(), random = Math.random) {
  initializeDangerousExploration(data, positions, now, blocked, random);
  for (const regionId of ["sw", "se"]) {
    const region = data.regions[regionId];
    if (region.lastTickAbs >= now) continue;
    region.lastTickAbs = now;
    region.sites = region.sites.filter(site => (data.explorationPending?.regionId === regionId && data.explorationPending.siteId === site.id) || now < site.expiresAbs);
    for (const kind of ["drift", "wreck"]) {
      const settings = EXPLORATION[kind];
      if (region.sites.filter(site => site.kind === kind).length < settings.limit && random() < settings.chance) spawnDangerousExploration(data, regionId, kind, positions, now, blocked, random);
    }
  }
}

/**
 * 通常の固定報酬抽選を共用し、資金・高級品だけ生成時の外縁2倍・核心3倍を適用する。
 * 救助兵員・通常船の当落・断片率は増やさず、名声や警戒度による追加倍率も設けない。
 * @param {object} site 確定地点。
 * @param {string[]} goods 高級品ID。
 * @param {string[]} troopTypes 救助兵種ID。
 * @param {Function} [random] 乱数源。
 * @returns {object} 固定報酬。
 */
export function rollDangerousExplorationReward(site, goods, troopTypes, random = Math.random) {
  const multiplier = PROFILES[site.profile].multiplier;
  const reward = rollExplorationReward(site.kind, goods, troopTypes, random);
  reward.funds *= multiplier;
  for (const id of Object.keys(reward.supplies)) reward.supplies[id] *= multiplier;
  return reward;
}

/**
 * 専用地点と途中探索を一度だけ消費し、成功した場合だけ固定報酬を返す。
 * @param {object} data 危険海域の全状態。
 * @param {boolean} success 勝利または非戦闘の成功か。
 * @returns {object|null} 固定報酬。
 */
export function consumeDangerousExploration(data, success) {
  if (dangerousWreckPending(data)) return settleDangerousWreckStage(data, success)?.reward || null;
  const pending = data.explorationPending;
  if (!pending) return null;
  const region = data.regions[pending.regionId];
  region.sites = region.sites.filter(site => site.id !== pending.siteId);
  data.explorationPending = null;
  return success ? pending.reward : null;
}

/**
 * 数量表の全数量が非負の安全な整数か検査する。
 * @param {*} amounts 数量表。
 * @param {number} maximum 数量上限。
 * @returns {boolean} 有効か。
 */
function validDangerousAmounts(amounts, maximum) {
  return !!amounts && typeof amounts === "object" && !Array.isArray(amounts) && Object.values(amounts).every(quantity => Number.isSafeInteger(quantity) && quantity >= 0 && quantity <= maximum);
}

/**
 * 専用探索の座標・重複・生成版と途中報酬を検証し、通常報酬の1100上限を流用しない。
 * 生成時のプロフィールで上限を求め、地域の再計算では途中結果を変更しない。
 * @param {object} data 型補完済みの危険海域状態。
 * @returns {object} 検証済みの同じ状態。
 */
export function validateDangerousExploration(data) {
  const seen = new Set(), coordinates = new Set();
  for (const regionId of ["sw", "se"]) {
    const region = data.regions[regionId];
    region.sites = (region.sites || []).filter(site => {
      const settings = PROFILES[site?.profile], position = site?.position;
      if (!settings || site.version !== 1 || site.regionId !== regionId || !["drift", "wreck"].includes(site.kind) || site.profile !== `danger_${site.level}`
        || !Number.isSafeInteger(site.id) || site.id < 1 || seen.has(site.id) || !position || !Number.isInteger(position.x) || !Number.isInteger(position.y)
        || position.x < 0 || position.y < 0 || position.x >= 50 || position.y >= 50 || !Number.isSafeInteger(site.spawnedAbs)
        || site.expiresAbs !== site.spawnedAbs + EXPLORATION.lifetime || !settings.danger.includes(site.danger)) return false;
      const key = `${position.x},${position.y}`;
      if (coordinates.has(key)) return false;
      seen.add(site.id); coordinates.add(key);
      return true;
    });
  }
  let pending = data.explorationPending;
  const site = ["sw", "se"].includes(pending?.regionId) ? data.regions[pending.regionId].sites.find(candidate => candidate.id === pending.siteId) : null;
  const reward = pending?.reward;
  const multiplier = site && PROFILES[site.profile].multiplier;
  if (pending?.wreck) {
    if (!validateDangerousWreckPending(pending, site)) pending = null;
  } else if (!site || typeof pending.dayApplied !== "boolean" || !reward || !Number.isSafeInteger(reward.funds) || reward.funds < 0
    || reward.funds > (site.kind === "wreck" ? 1100 : 550) * multiplier || ![0, 1].includes(reward.ships)
    || !validDangerousAmounts(reward.supplies, site.kind === "wreck" ? 24 : 12) || !validDangerousAmounts(reward.troops, 5)) pending = null;
  if (pending?.encounter && (!pending.encounter.active || pending.encounter.dangerousExplorationId !== site.id || pending.encounter.dangerousRegionId !== site.regionId
    || !Array.isArray(pending.encounter.enemyFormation) || !pending.encounter.enemyFormation.length)) pending = null;
  data.explorationPending = pending;
  data.nextSiteId = Math.max(Number.isSafeInteger(data.nextSiteId) ? data.nextSiteId : 1, 1, ...[...seen].map(id => id + 1));
  return data;
}
