import { DANGEROUS_BOUNTY_CONFIG as CONFIG, DANGEROUS_BOUNTY_TEMPLATES as TEMPLATES } from "./dangerousBountyConfig.js";
import { rollBountyName } from "../bounty/bounty.js";
import { VARIANT_SHIPS } from "../fleet/variantShips.js";

/** @param {object} position 座標。 @returns {boolean} 非負の安全な整数座標か。 */
function validPosition(position) {
  return Number.isSafeInteger(position?.x) && position.x >= 0 && Number.isSafeInteger(position?.y) && position.y >= 0;
}

/** @param {object} site 個体。 @returns {string} 位置の予約キー。 */
function positionKey(site) { return `${site.x},${site.y}`; }

/**
 * 専用九種・各海域二人・個体とテンプレートの全体一意性を検査する。保存済みの有効な編成・賞金は変更しない。
 * @param {unknown} value 保存値。 @returns {object} 独立した専用賞金首状態。
 */
export function normalizeDangerousBounties(value) {
  const seen = new Set(), used = new Set(), positions = new Set(), counts = { sw: 0, se: 0 }, active = [];
  for (const site of Array.isArray(value?.active) ? value.active : []) {
    const template = TEMPLATES.find(row => row.id === site?.templateId);
    if (!template || !template.regions.includes(site.regionId) || counts[site.regionId] >= CONFIG.perRegion
      || !Number.isSafeInteger(site.id) || site.id < 1 || seen.has(site.id) || used.has(site.templateId)
      || !validPosition(site.position) || positions.has(positionKey(site.position))
      || typeof site.name !== "string" || !site.name || typeof site.epithet !== "string"
      || !Number.isSafeInteger(site.reward) || site.reward < 0
      || !Number.isSafeInteger(site.spawnedAbs) || site.spawnedAbs < 1 || !Number.isSafeInteger(site.expiresAbs) || site.expiresAbs <= site.spawnedAbs
      || !Array.isArray(site.formation) || !site.formation.length || site.formation.length > 20
      || !site.formation.every(unit => Object.hasOwn(template.troops, unit?.type) && Number.isInteger(unit.count) && unit.count >= 1 && unit.count <= 10 && Number.isInteger(unit.level) && unit.level >= 1 && unit.level <= 5)) continue;
    seen.add(site.id); used.add(site.templateId); positions.add(positionKey(site.position)); counts[site.regionId]++;
    const variant = VARIANT_SHIPS[template.id];
    active.push({ id: site.id, templateId: template.id, regionId: site.regionId, name: site.name, epithet: site.epithet,
      factionId: "pirates", description: typeof site.description === "string" ? site.description : template.description,
      position: { ...site.position }, formation: site.formation.map(unit => ({ type: unit.type, count: unit.count, level: unit.level })),
      total: site.formation.reduce((sum, unit) => sum + unit.count, 0), reward: site.reward, spawnedAbs: site.spawnedAbs, expiresAbs: site.expiresAbs,
      ship: variant.base, flagship: variant.name });
  }
  const history = [];
  const defeated = new Set((Array.isArray(value?.defeatedTemplateIds) ? value.defeatedTemplateIds : []).filter(id => TEMPLATES.some(template => template.id === id)));
  for (const site of Array.isArray(value?.history) ? value.history : []) {
    if (!TEMPLATES.some(template => template.id === site?.templateId) || !Number.isSafeInteger(site.id) || site.id < 1
      || !["sw", "se"].includes(site.regionId) || typeof site.name !== "string" || typeof site.epithet !== "string"
      || !Number.isSafeInteger(site.reward) || site.reward < 0 || !Number.isSafeInteger(site.defeatedAbs) || site.defeatedAbs < 1) continue;
    defeated.add(site.templateId); history.push({ ...site });
  }
  return { version: 1, initialized: value?.initialized === true, lastSeason: Number.isSafeInteger(value?.lastSeason) ? value.lastSeason : null,
    nextId: Math.max(1, Number.isSafeInteger(value?.nextId) ? value.nextId : 1, ...active.map(site => site.id + 1), ...history.map(site => site.id + 1)),
    active, history: history.slice(0, CONFIG.historyLimit), defeatedTemplateIds: [...defeated] };
}

/**
 * 期限を先に処理し、初回・新季節だけ補充する。未討伐種類を優先し、核心の空きから均等抽選する。
 * 全九種の討伐までは討伐済み種類を再登場させず、候補不足は空き枠として保持する。
 * @param {object} data 専用状態。 @param {object} candidates 海域ごとの候補。 @param {number} now 絶対日。
 * @param {number} season 季節番号。 @param {Set} blocked 予約座標。 @param {number|null} protectedId 交戦中の個体。
 * @param {Function} random 乱数。 @returns {void}
 */
export function tickDangerousBounties(data, candidates, now, season, blocked = new Set(), protectedId = null, random = Math.random) {
  data.active = data.active.filter(site => site.id === protectedId || now < site.expiresAbs);
  if (data.initialized && data.lastSeason === season) return;
  data.initialized = true; data.lastSeason = season;
  const occupied = new Set([...blocked, ...data.active.map(site => positionKey(site.position))]);
  const defeated = new Set(data.defeatedTemplateIds), complete = TEMPLATES.every(template => defeated.has(template.id));
  for (const regionId of ["sw", "se"]) {
    let pool = (candidates[regionId] || []).filter(position => validPosition(position) && !occupied.has(positionKey(position)));
    while (pool.length && data.active.filter(site => site.regionId === regionId).length < CONFIG.perRegion) {
      const templates = TEMPLATES.filter(template => template.regions.includes(regionId) && !data.active.some(site => site.templateId === template.id) && (complete || !defeated.has(template.id)));
      if (!templates.length || !Number.isSafeInteger(data.nextId + 1)) break;
      const template = templates[Math.min(templates.length - 1, Math.floor(random() * templates.length))];
      const core = pool.filter(position => position.level === "core");
      const choices = core.length ? core : pool;
      const position = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
      const formation = Object.entries(template.troops).flatMap(([type, count]) => Array.from({ length: count / 10 }, () => ({ type, count: 10, level: template.level })));
      const variant = VARIANT_SHIPS[template.id];
      data.active.push({ id: data.nextId++, templateId: template.id, regionId, epithet: template.epithet, name: rollBountyName("pirates", random), factionId: "pirates",
        description: template.description, formation, total: formation.reduce((sum, unit) => sum + unit.count, 0), reward: template.reward,
        position: { x: position.x, y: position.y }, spawnedAbs: now, expiresAbs: now + CONFIG.lifetime, ship: variant.base, flagship: variant.name });
      occupied.add(positionKey(position)); pool = pool.filter(candidate => !occupied.has(positionKey(candidate)));
    }
  }
}

/** 勝利個体だけを一度履歴へ移し、全種類の討伐記録は履歴上限と分離して保持する。
 * @param {object} data 専用状態。 @param {number} id 個体ID。 @param {number} now 討伐日。 @returns {object|null} 討伐個体。
 */
export function claimDangerousBounty(data, id, now) {
  const index = data?.active.findIndex(site => site.id === id) ?? -1;
  if (index < 0) return null;
  const [site] = data.active.splice(index, 1);
  data.history.unshift({ id: site.id, templateId: site.templateId, regionId: site.regionId, name: site.name, epithet: site.epithet, factionId: "pirates", reward: site.reward,
    spawnedAbs: site.spawnedAbs, defeatedAbs: now, flagship: site.flagship });
  data.history.length = Math.min(data.history.length, CONFIG.historyLimit);
  if (!data.defeatedTemplateIds.includes(site.templateId)) data.defeatedTemplateIds.push(site.templateId);
  return site;
}

/** 専用参照を持つ固定戦闘準備を作り、通常賞金首や海賊王と取り違えない。
 * @param {object} site 個体。 @returns {object} 戦闘準備情報。
 */
export function buildDangerousBountyEncounter(site) {
  return { active: true, dangerousBountyId: site.id, dangerousRegionId: site.regionId, enemyName: `${site.epithet}${site.name}`,
    enemyFormation: structuredClone(site.formation), enemyTotal: site.total, enemyFactionId: "pirates", strength: "elite", terrain: "sea", eventTag: "dangerous_bounty" };
}
