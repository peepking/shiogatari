import { FISH_SPECIES } from "../fishing/fishingConfig.js";
import { DANGEROUS_SEA_EVENT_CONFIG as CONFIG, DANGEROUS_SEA_EVENT_DEFS as DEFS, dangerousEventScoutRules } from "./dangerousSeaEventConfig.js";

/** 検証する兵種は既存の編成と救助対象に限る。 */
const troopIds = new Set(["infantry", "halberd", "medic", "marine", "archer", "scout", "cavalry", "cavalier", "crossbow", "shield", "seaArcher"]);
/** 敵編成には既存海賊兵も含め、救助候補とは分けて検査する。 */
const enemyIds = new Set([...troopIds, "pirate_shield", "pirate_spear", "pirate_archer", "raider_cavalry", "pirate_axe", "pirate_assault"]);
/** 報酬に使う既存物資。 */
const supplyIds = new Set(["food", "wood", "stone", "iron", "fiber", "salt", "spice", "arms", "textile", "brew", "leather"]);
/** 回遊で優遇できる既存の超大物。希少魚の指定とは別の演出対象である。 */
const giantIds = new Set(FISH_SPECIES.filter(fish => fish.category === "giant").map(fish => fish.id));

/** @param {*} value 値。 @returns {boolean} 非負の安全な整数か。 */
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }

/** @param {*} value 座標。 @returns {boolean} 世界内の整数座標か。 */
function positionValid(value) { return integer(value?.x) && value.x < 50 && integer(value?.y) && value.y < 50; }

/** @returns {object} 両海域で共有参照を持たない限定イベント領域。 */
export function createDangerousSeaEvents() {
  return { version: 1, nextId: 1, lastTickAbs: null, lastWaveAbs: { sw: null, se: null }, active: { sw: null, se: null }, pending: null, history: [] };
}

/** 固定報酬の既存IDと安全な数量を検証し、版変更でも有効な確定値を維持する。 @param {*} raw 保存値。 @returns {object|null} 報酬。 */
function normalizeReward(raw) {
  if (!raw || !integer(raw.funds) || !raw.supplies || !raw.troops) return null;
  for (const [group, ids] of [[raw.supplies, supplyIds], [raw.troops, troopIds]]) {
    if (typeof group !== "object" || Array.isArray(group) || Object.entries(group).some(([id, qty]) => !ids.has(id) || !integer(qty))) return null;
  }
  return { funds: raw.funds, supplies: { ...raw.supplies }, troops: { ...raw.troops } };
}

/** 既存編成の上限と専用参照だけを復元し、物語や他の賞金首の参照を持ち込まない。 @param {*} raw 保存値。 @param {object} event 地点。 @returns {object|null} 固定遭遇。 */
function normalizeEncounter(raw, event) {
  if (!raw) return null;
  const units = raw.enemyFormation;
  if (!Array.isArray(units) || !units.length || units.length > 20 || units.some(unit => !enemyIds.has(unit?.type)
    || !Number.isInteger(unit.count) || unit.count < 1 || unit.count > 10 || !Number.isInteger(unit.level) || unit.level < 1 || unit.level > 3)) return null;
  return { active: true, enemyFormation: units.map(unit => ({ type: unit.type, count: unit.count, level: unit.level })),
    enemyTotal: units.reduce((sum, unit) => sum + unit.count, 0), strength: "elite", enemyFactionId: "pirates", terrain: "sea",
    eventTag: "dangerous_event", dangerousEventId: event.id, dangerousRegionId: event.regionId };
}

/** 地点の正体・乱数・期限・報酬・進行を復元する。南西には鐘を配置しない。 @param {*} raw 保存値。 @param {string} regionId 海域。 @returns {object|null} 有効な地点。 */
function normalizeEvent(raw, regionId) {
  const def = DEFS[raw?.kind];
  if (!def?.regions.includes(regionId) || raw.regionId !== regionId || !integer(raw.id) || raw.id < 1 || !positionValid(raw.position)
    || !integer(raw.spawnedAbs) || !integer(raw.expiresAbs) || raw.expiresAbs <= raw.spawnedAbs
    || !Number.isFinite(raw.accidentRoll) || raw.accidentRoll < 0 || raw.accidentRoll >= 1) return null;
  const event = { id: raw.id, kind: raw.kind, regionId, position: { ...raw.position }, level: raw.level === "core" ? "core" : "outer",
    spawnedAbs: raw.spawnedAbs, expiresAbs: raw.expiresAbs, accidentRoll: raw.accidentRoll,
    discovered: raw.discovered === true, hintTier: [0, 1, 5, 10].includes(raw.hintTier) ? raw.hintTier : 0,
    progress: Math.min(3, integer(raw.progress) ? raw.progress : 0), completed: raw.completed === true,
    choices: Array.isArray(raw.choices) ? raw.choices.filter(row => row && typeof row.choice === "string" && integer(row.day)).map(row => ({ ...row })) : [], rewards: {} };
  if (event.kind === "fog_light") {
    if (!["rescue", "trap", "empty"].includes(raw.variant)) return null;
    event.variant = raw.variant;
  }
  for (const id of Object.keys(def.rewards)) {
    const reward = normalizeReward(raw.rewards?.[id]);
    if (!reward) return null;
    event.rewards[id] = reward;
  }
  event.fishIds = [...new Set((Array.isArray(raw.fishIds) ? raw.fishIds : []).filter(id => giantIds.has(id)))].slice(0, 3);
  if (event.kind === "fish_migration" && !event.fishIds.length) return null;
  event.encounter = normalizeEncounter(raw.encounter, event);
  if (event.kind === "fog_light" && event.variant === "trap" && !event.encounter) return null;
  return event;
}

/**
 * 有効な正体・報酬・段階を保ち、同海域一件と全海域のID一意性を検証する。壊れた参照は活動を停止させず除外する。
 * @param {*} raw 保存値。 @returns {object} 正規化した限定イベント状態。
 */
export function normalizeDangerousSeaEvents(raw) {
  const data = createDangerousSeaEvents(), used = new Set();
  data.nextId = integer(raw?.nextId) ? Math.max(1, raw.nextId) : 1;
  data.lastTickAbs = integer(raw?.lastTickAbs) ? raw.lastTickAbs : null;
  for (const regionId of ["sw", "se"]) {
    data.lastWaveAbs[regionId] = integer(raw?.lastWaveAbs?.[regionId]) ? raw.lastWaveAbs[regionId] : null;
    const event = normalizeEvent(raw?.active?.[regionId], regionId);
    if (event && !used.has(event.id)) { data.active[regionId] = event; used.add(event.id); data.nextId = Math.max(data.nextId, event.id + 1); }
  }
  data.history = (Array.isArray(raw?.history) ? raw.history : []).filter(row => integer(row?.id) && row.id > 0 && DEFS[row.kind]
    && DEFS[row.kind].regions.includes(row.regionId) && integer(row.finishedAbs)).map(row => ({ ...row }));
  for (const row of data.history) data.nextId = Math.max(data.nextId, row.id + 1);
  const pending = raw?.pending, event = pending && data.active[pending.regionId];
  if (event && pending && event.id === pending.eventId && ["choice", "action", "battle", "result"].includes(pending.stage)) {
    const reward = pending.reward == null ? null : normalizeReward(pending.reward);
    const encounter = pending.encounter == null ? null : normalizeEncounter(pending.encounter, event);
    if ((pending.reward == null || reward) && (pending.encounter == null || encounter) && (!pending.applied || pending.stage === "result")) {
      data.pending = { eventId: event.id, regionId: event.regionId, stage: pending.stage, choice: typeof pending.choice === "string" ? pending.choice : null,
        dayApplied: pending.dayApplied === true, scoutTier: [0, 1, 5, 10].includes(pending.scoutTier) ? pending.scoutTier : 0,
        pausedForHazard: pending.pausedForHazard === true, reward, encounter, applied: pending.applied === true,
        complete: pending.complete === true, accident: pending.accident === true,
        resultText: typeof pending.resultText === "string" ? pending.resultText : "" };
    }
  }
  return data;
}

/**
 * 空枠へ固定結果の地点を生成する。種類内の位置と灯火の正体は均等、回遊は既存超大物から重複なしで三種選ぶ。
 * @param {object} data 限定イベント領域。 @param {string} regionId 海域。 @param {string} kind 種類。
 * @param {object[]} positions 予約除外済み座標と移動日数。 @param {number} now 通算日。
 * @param {Function} createEnemy 既存の敵編成生成。 @param {Function} [random=Math.random] 乱数。
 * @returns {object|null} 生成地点。
 */
export function spawnDangerousSeaEvent(data, regionId, kind, positions, now, createEnemy, random = Math.random) {
  const def = DEFS[kind];
  if (data.active[regionId] || !def?.regions.includes(regionId) || !positions.length) return null;
  const point = positions[Math.min(positions.length - 1, Math.floor(random() * positions.length))];
  const event = { id: data.nextId++, kind, regionId, position: { x: point.x, y: point.y }, level: point.level,
    spawnedAbs: now, expiresAbs: now + point.travelDays + def.days + CONFIG.marginDays,
    accidentRoll: random(), discovered: false, hintTier: 0, progress: 0, completed: false, choices: [], rewards: structuredClone(def.rewards), fishIds: [], encounter: null };
  if (kind === "fog_light") {
    event.variant = ["rescue", "trap", "empty"][Math.min(2, Math.floor(random() * 3))];
    if (event.variant === "trap") {
      const enemy = createEnemy(event.position, event.level);
      event.encounter = normalizeEncounter({ enemyFormation: enemy.formation }, event);
      if (!event.encounter) return null;
    }
  }
  if (kind === "fish_migration") {
    const pool = [...giantIds];
    while (event.fishIds.length < 3 && pool.length) event.fishIds.push(pool.splice(Math.min(pool.length - 1, Math.floor(random() * pool.length)), 1)[0]);
  }
  data.active[regionId] = event;
  return event;
}

/** 地点を履歴へ一度移し、別の出来事を置けるようにする。 @param {object} data 限定状態。 @param {number} id 地点ID。 @param {number} now 通算日。 @param {string} reason 完了理由。 @returns {boolean} 移動できたか。 */
export function closeDangerousSeaEvent(data, id, now, reason = "complete") {
  const event = Object.values(data.active).find(site => site?.id === id);
  if (!event) return false;
  data.history.push({ ...structuredClone(event), finishedAbs: now, reason });
  data.active[event.regionId] = null;
  return true;
}

/**
 * 固定乱数と選択時の斥候から結果を一度確定する。積荷と救助は排他的、事故では資金・物資を半減し兵を減らさない。
 * 鐘は聞く・調べる・応えるの順で一日ずつ進み、最後だけ報酬を得る。
 * @param {object} event 地点。 @param {string} choice 選択。 @param {number} scouts 斥候段階。
 * @returns {object|null} 保存する固定結果。
 */
export function dangerousSeaEventOutcome(event, choice, scouts) {
  const def = DEFS[event.kind];
  if (!Object.hasOwn(def.choices, choice)) return null;
  if (event.kind === "seabed_bell" && choice !== ["listen", "descend", "answer"][event.progress]) return null;
  const rewardId = event.kind === "fog_light" ? event.variant : choice;
  const reward = structuredClone(event.rewards[rewardId]);
  const accident = event.accidentRoll < def.accident * dangerousEventScoutRules(scouts).accidentMultiplier;
  if (accident) {
    reward.funds = Math.floor(reward.funds / 2);
    for (const id of Object.keys(reward.supplies)) reward.supplies[id] = Math.floor(reward.supplies[id] / 2);
  }
  const complete = event.kind !== "seabed_bell" || event.progress >= 2;
  const bellText = ["鐘の音は波ではなく、沈んだ聖堂から届いていた。潮が引けば入口を探せそうだ。",
    "聖堂の壁には、帰らぬ船を導くために鐘を鳴らした人々の名が刻まれていた。最後の一音が船を待っている。",
    "船の鐘で応えると、海底の音が静まった。浮かび上がった箱には、かつての航海者が託した品が残っていた。"][event.progress];
  return { reward, encounter: event.variant === "trap" ? structuredClone(event.encounter) : null, complete, accident,
    resultText: event.kind === "seabed_bell" ? bellText : event.kind === "fog_light"
      ? { rescue: "灯火は遭難した船の合図だった。乗員を救助した。", trap: "灯火は海賊の罠だった。敵を退け、積荷を回収した。", empty: "灯火の主は無人の船だった。残された積荷を回収した。" }[event.variant]
      : event.kind === "sinking_treasure" ? choice === "rescue" ? "積荷を諦め、沈む船から乗員を救助した。" : "救助を諦め、沈む船から積荷を運び出した。"
        : "嵐が運んだ漂着物から、使える積荷を回収した。" };
}

/** 期限内の回遊種だけを返し、釣り抽選枠の確率は変更しない。 @param {object} game ゲーム状態。 @param {string} regionId 海域。 @param {number} today 通算日。 @returns {string[]} 餌重みを優遇する既存魚ID。 */
export function migrationFishIds(game, regionId, today) {
  const event = game.dangerousSeas?.events?.active?.[regionId];
  return event?.kind === "fish_migration" && today < event.expiresAbs ? [...event.fishIds] : [];
}
