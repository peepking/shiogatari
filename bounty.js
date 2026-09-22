import { BOUNTY_CONFIG as CONFIG, BOUNTY_TEMPLATES } from "./bountyConfig.js";
import { REGIONAL_NAMES } from "./name.js";
import { VARIANT_SHIPS } from "./variantShips.js";

/** @param {object} site 賞金首。 @returns {string} 保存済み表示名。 */
export function bountyName(site) { return `${site.epithet}${site.name}`; }

/** 重複文字列を除外し、海賊は全地域の全候補から等確率で選ぶ。 @param {string} factionId 所属。 @param {Function} random 乱数。 @returns {string} 名前。 */
export function rollBountyName(factionId, random = Math.random) {
  const source = factionId === "pirates" ? Object.values(REGIONAL_NAMES).flat() : REGIONAL_NAMES[factionId === "citadel" ? "WEST" : "NORTH"];
  const names = [...new Set(source)];
  return names[Math.min(names.length - 1, Math.floor(random() * names.length))];
}

/** 旧セーブには未生成状態を補完し、保存された有効な個体を再抽選しない。 @param {object} value 保存値。 @returns {object} 正規化状態。 */
export function normalizeBounties(value) {
  const templates = new Set(BOUNTY_TEMPLATES.map(t => t.id));
  const seen = new Set(), used = new Set();
  const active = (Array.isArray(value?.active) ? value.active : []).filter(s => {
    if (!s || !templates.has(s.templateId) || !Number.isSafeInteger(s.id) || s.id < 1 || seen.has(s.id) || used.has(s.templateId)
      || typeof s.name !== "string" || typeof s.epithet !== "string" || !Number.isFinite(s.expiresAbs)
      || !Number.isSafeInteger(s.position?.x) || !Number.isSafeInteger(s.position?.y) || s.position.x < 0 || s.position.y < 0
      || !["north", "archipelago", "citadel", "pirates"].includes(s.factionId)
      || !Number.isSafeInteger(s.reward) || s.reward < 0 || !Array.isArray(s.formation) || !s.formation.length || s.formation.length > 20
      || !s.formation.every(u => Object.keys(BOUNTY_TEMPLATES.find(t => t.id === s.templateId).troops).includes(u.type) && Number.isInteger(u.count) && u.count > 0 && u.count <= 10 && Number.isInteger(u.level) && u.level >= 1 && u.level <= 5)) return false;
    seen.add(s.id); used.add(s.templateId); return true;
  }).slice(0, CONFIG.count).map(s => ({ ...s, total: s.formation.reduce((n, u) => n + u.count, 0), description: typeof s.description === "string" ? s.description : "", ship: VARIANT_SHIPS[s.templateId].base, flagship: VARIANT_SHIPS[s.templateId].name }));
  const history = (Array.isArray(value?.history) ? value.history : []).filter(s => s && Number.isSafeInteger(s.id) && typeof s.name === "string" && typeof s.epithet === "string" && Number.isSafeInteger(s.reward) && s.reward >= 0).slice(0, CONFIG.historyLimit);
  return { version: 1, initialized: value?.initialized === true, nextId: Math.max(1, Number.isSafeInteger(value?.nextId) ? value.nextId : 1, ...[...active, ...history].map(s => s.id + 1)),
    lastSeason: Number.isInteger(value?.lastSeason) ? value.lastSeason : null, active, history };
}

/** 海上を優先して幅優先探索し、出発地点から船で通れる海・浅瀬だけを候補にする。 @param {Array} map 地図。 @param {object} origin 現在地。 @returns {Array} 海上座標。 */
export function bountySeaPositions(map, origin) {
  const key = p => `${p.x},${p.y}`;
  const queue = [origin], seen = new Set([key(origin)]), result = [];
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i], cell = map[p.y]?.[p.x];
    if (!cell) continue;
    if (["sea", "shoal"].includes(cell.terrain) && (!cell.building || cell.building === "none")) result.push(p);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: p.x + dx, y: p.y + dy }, c = map[next.y]?.[next.x];
      if (!c || seen.has(key(next)) || c.terrain === "mountain") continue;
      seen.add(key(next)); queue.push(next);
    }
  }
  return result;
}

/** 期限切れを先に除き、初回・新季節だけ欠員を補充する。既存点から遠い半分の候補から等確率で配置し偏在を抑える。 @param {object} data 状態。 @param {Array} candidates 到達可能位置。 @param {number} now 絶対日。 @param {number} season 季節番号。 @param {Set} blocked 予約位置。 @param {number|null} protectedId 交戦中の個体。 @param {Function} random 乱数。 @returns {void} */
export function tickBounties(data, candidates, now, season, blocked = new Set(), protectedId = null, random = Math.random) {
  data.active = data.active.filter(s => s.id === protectedId || now < s.expiresAbs);
  if (data.initialized && data.lastSeason === season) return;
  data.initialized = true; data.lastSeason = season;
  const occupied = new Set([...blocked, ...data.active.map(s => `${s.position.x},${s.position.y}`)]);
  let pool = candidates.filter(p => !occupied.has(`${p.x},${p.y}`));
  const templates = BOUNTY_TEMPLATES.filter(t => !data.active.some(s => s.templateId === t.id));
  while (pool.length && templates.length && data.active.length < CONFIG.count) {
    const template = templates.splice(Math.floor(random() * templates.length), 1)[0];
    if (data.active.length) {
      const distance = p => Math.min(...data.active.map(s => Math.abs(s.position.x - p.x) + Math.abs(s.position.y - p.y)));
      pool.sort((a, b) => distance(b) - distance(a));
    }
    const choices = data.active.length ? Math.ceil(pool.length / 2) : pool.length;
    const position = pool.splice(Math.floor(random() * choices), 1)[0];
    const formation = Object.entries(template.troops).flatMap(([type, count]) => Array.from({ length: count }, () => ({ type, count: 10, level: template.level })));
    const total = formation.reduce((n, u) => n + u.count, 0);
    data.active.push({ id: data.nextId++, templateId: template.id, epithet: template.epithet, name: rollBountyName(template.factionId, random),
      factionId: template.factionId, description: template.description, formation, total, reward: Math.floor((total * CONFIG.perTroop + CONFIG.base) * CONFIG.multiplier),
      position, spawnedAbs: now, expiresAbs: now + CONFIG.lifetime, ship: VARIANT_SHIPS[template.id].base, flagship: VARIANT_SHIPS[template.id].name });
  }
}

/** 勝利した個体を一度だけ履歴へ移し、確定報酬を返す。 @param {object} data 状態。 @param {number} id 個体ID。 @param {number} now 討伐日。 @returns {object|null} 討伐個体。 */
export function claimBounty(data, id, now) {
  const index = data.active.findIndex(s => s.id === id);
  if (index < 0) return null;
  const [site] = data.active.splice(index, 1);
  data.history.unshift({ id: site.id, name: site.name, epithet: site.epithet, factionId: site.factionId, reward: site.reward, spawnedAbs: site.spawnedAbs, defeatedAbs: now, flagship: site.flagship });
  data.history = data.history.slice(0, CONFIG.historyLimit);
  return site;
}
