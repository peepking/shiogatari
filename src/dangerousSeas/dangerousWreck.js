/** @param {object} value 保存可能な値。 @returns {object} 参照を共有しない値。 */
function copy(value) { return JSON.parse(JSON.stringify(value)); }

/** @param {number} scouts 設備を含む有効斥候人数。 @returns {number} 四段階の情報・事故軽減段階。 */
export function dangerousWreckScoutTier(scouts) { return scouts >= 10 ? 3 : scouts >= 5 ? 2 : scouts >= 1 ? 1 : 0; }

/** @param {object} data 危険海域状態。 @returns {object|null} 新しい段階探索だけを取得する。 */
export function dangerousWreckPending(data) { return data?.explorationPending?.wreck?.version === 1 ? data.explorationPending : null; }

/** @returns {object} 追加枝の空報酬。 */
function emptyReward() { return { funds: 0, supplies: {}, troops: {}, ships: 0, shipTypes: {}, fragment: false }; }

/**
 * 甲板・積荷・救助の全結果を開始時に固定する。追加枝は排他で各一日、斥候は新しい枝だけを最大15ポイント軽減する。
 * 追加戦闘率は外縁25/15%、核心35/25%、最低5%。事故率は外縁35%、核心50%。
 * 積荷は元の資金・高級品の半分、高級品の配分端数は最後の種類へ寄せる。浸水事故では追加分の四分の一を失う。
 * 救助は25%で海図断片、それ以外は元の救助兵をLv2/3で救う。
 * @param {object} site 難破船地点。 @param {object} reward 従来の固定報酬。 @param {object|null} encounter 甲板の固定敵。
 * @param {number} scouts 有効斥候人数。 @param {Function} createEnemy 追加枝の固定敵生成。 @param {Function} [random=Math.random] 乱数源。
 * @returns {object} 保存用の段階探索。
 */
export function createDangerousWreckPending(site, reward, encounter, scouts, createEnemy, random = Math.random) {
  const count = Math.max(0, Math.min(10, Math.floor(Number(scouts) || 0))), tier = dangerousWreckScoutTier(count), reduction = tier * 0.05;
  const core = site.level === "core", deck = copy(reward), cargo = emptyReward(), rescue = emptyReward();
  deck.troops = {}; deck.shipTypes ||= {};
  cargo.funds = Math.floor(reward.funds / 2);
  const goods = Object.entries(reward.supplies);
  let remainingGoods = Math.floor(goods.reduce((sum, [, quantity]) => sum + quantity, 0) / 2);
  goods.forEach(([id, quantity], index) => {
    const amount = index === goods.length - 1 ? remainingGoods : Math.floor(quantity / 2);
    if (amount) cargo.supplies[id] = amount;
    remainingGoods -= amount;
  });
  rescue.troopLevel = random() < 0.5 ? 2 : 3;
  rescue.fragment = random() < 0.25;
  if (!rescue.fragment) rescue.troops = copy(reward.troops);
  const branches = { deck: { reward: deck, encounter: encounter && copy(encounter), accident: null, losses: {}, appliedDays: 0, settled: false } };
  for (const [id, branchReward] of [["cargo", cargo], ["rescue", rescue]]) {
    const combatChance = Math.max(0.05, (id === "cargo" ? core ? 0.35 : 0.25 : core ? 0.25 : 0.15) - reduction);
    const branchEnemy = random() < combatChance ? createEnemy(id) : null;
    const accident = random() < (core ? 0.5 : 0.35) - reduction;
    if (accident && id === "cargo") {
      branchReward.funds -= Math.floor(branchReward.funds / 4);
      for (const key of Object.keys(branchReward.supplies)) branchReward.supplies[key] -= Math.floor(branchReward.supplies[key] / 4);
    }
    branches[id] = { reward: branchReward, encounter: branchEnemy && copy(branchEnemy), accident: accident ? id === "cargo" ? "flood" : "rescue" : null,
      losses: accident && id === "rescue" ? { wood: 1, food: 2 } : {}, appliedDays: 0, settled: false };
  }
  return { siteId: site.id, regionId: site.regionId, dayApplied: false, reward: deck, encounter: branches.deck.encounter, pausedForHazard: false,
    wreck: { version: 1, stage: "deck", choice: null, scouts: count, tier, deckClaimed: false, branches } };
}

/** @param {object} pending 段階探索。 @returns {string} 固定斥候情報。 */
export function dangerousWreckHints(pending) {
  const wreck = pending.wreck;
  if (!wreck.tier) return "斥候の事前情報はありません。船倉には待伏せや浸水の恐れがあります。";
  const cargo = wreck.branches.cargo, rescue = wreck.branches.rescue;
  const hints = ["斥候が船倉への進路を調べています。"];
  if (wreck.tier >= 1) hints.push(cargo.encounter || rescue.encounter ? "奥から人影や武器の音を認めました。" : "目立つ待伏せの兆候はありません。警戒は必要です。");
  if (wreck.tier >= 2) hints.push(cargo.accident ? "積荷の区画に浸水の兆候があります。" : "積荷の区画は比較的安定しています。", rescue.reward.fragment ? "生存者が航路の手掛かりを持っているようです。" : "船倉から生存者の声が聞こえます。");
  if (wreck.tier >= 3) hints.push(rescue.accident ? "救助用の足場が傷んでいます。資材の損失に備えてください。" : "救助用の足場と退避経路を確認しました。", "積荷と救助はそれぞれ追加1日。どちらか一方だけを選べます。");
  return hints.join("\n");
}

/** @param {object} pending 途中探索。 @param {string} choice 積荷または救助。 @returns {boolean} 排他的な選択を固定できたか。 */
export function chooseDangerousWreckStage(pending, choice) {
  if (!pending?.wreck || pending.wreck.stage !== "choice" || pending.wreck.choice || !["cargo", "rescue"].includes(choice)) return false;
  pending.wreck.choice = choice; pending.wreck.stage = choice;
  const branch = pending.wreck.branches[choice];
  pending.reward = branch.reward; pending.encounter = branch.encounter; pending.dayApplied = branch.appliedDays === 1;
  return true;
}

/** @param {object} data 危険海域状態。 @returns {void} 最終段階・失敗・引き上げで地点を一度消す。 */
export function closeDangerousWreck(data) {
  const pending = dangerousWreckPending(data);
  if (!pending) return;
  data.regions[pending.regionId].sites = data.regions[pending.regionId].sites.filter(site => site.id !== pending.siteId);
  data.explorationPending = null;
}

/** @param {object} data 危険海域状態。 @param {boolean} success 現在枝の成功。 @returns {object|null} 一度だけ付与する固定報酬・事故。 */
export function settleDangerousWreckStage(data, success) {
  const pending = dangerousWreckPending(data), wreck = pending?.wreck;
  const branch = wreck?.branches[wreck.stage];
  if (!branch || branch.settled || !pending.dayApplied) return null;
  branch.settled = true;
  if (!success) { closeDangerousWreck(data); return null; }
  const result = { reward: branch.reward, losses: branch.losses, accident: branch.accident, stage: wreck.stage, complete: wreck.stage !== "deck" };
  if (wreck.stage === "deck") { wreck.deckClaimed = true; wreck.stage = "choice"; pending.encounter = null; }
  else closeDangerousWreck(data);
  return result;
}

/** @param {object} values 数量表。 @param {number} limit 各値の上限。 @returns {boolean} 保存値が安全か。 */
function validAmounts(values, limit) {
  return !!values && typeof values === "object" && !Array.isArray(values) && Object.values(values).every(n => Number.isSafeInteger(n) && n >= 0 && n <= limit);
}

/** 固定済みの各枝を検証し、旧一段探索へ新仕様を遡及しない。
 * @param {object} pending 保存途中値。 @param {object} site 対応地点。 @returns {boolean} 段階探索として有効か。
 */
export function validateDangerousWreckPending(pending, site) {
  const wreck = pending?.wreck, multiplier = site?.level === "core" ? 3 : 2;
  if (!site || site.kind !== "wreck" || wreck?.version !== 1 || !["deck", "choice", "cargo", "rescue"].includes(wreck.stage)
    || !Number.isInteger(wreck.scouts) || wreck.scouts < 0 || wreck.scouts > 10 || wreck.tier !== dangerousWreckScoutTier(wreck.scouts)
    || typeof wreck.deckClaimed !== "boolean" || typeof pending.pausedForHazard !== "boolean" || typeof pending.dayApplied !== "boolean") return false;
  if (wreck.stage === "deck" ? wreck.choice !== null || wreck.deckClaimed : !wreck.deckClaimed) return false;
  if (wreck.stage === "choice" ? wreck.choice !== null : ["cargo", "rescue"].includes(wreck.stage) && wreck.choice !== wreck.stage) return false;
  for (const id of ["deck", "cargo", "rescue"]) {
    const branch = wreck.branches?.[id], reward = branch?.reward;
    const maximum = id === "deck" ? 1100 * multiplier : id === "cargo" ? 550 * multiplier : 0;
    if (!branch || !reward || !Number.isSafeInteger(reward.funds) || reward.funds < 0 || reward.funds > maximum
      || !validAmounts(reward.supplies, id === "deck" ? 8 * multiplier : id === "cargo" ? 4 * multiplier : 0)
      || !validAmounts(reward.troops, id === "rescue" ? 5 : 0) || ![0, 1].includes(reward.ships) || (id !== "deck" && reward.ships !== 0)
      || typeof reward.fragment !== "boolean" || (id === "rescue" && ![2, 3].includes(reward.troopLevel))
      || ![0, 1].includes(branch.appliedDays) || typeof branch.settled !== "boolean" || ![null, "flood", "rescue"].includes(branch.accident)
      || !validAmounts(branch.losses, 2)) return false;
    if (Object.values(reward.supplies).reduce((sum, n) => sum + n, 0) > (id === "deck" ? 8 * multiplier : id === "cargo" ? 4 * multiplier : 0)
      || Object.values(reward.troops).reduce((sum, n) => sum + n, 0) > (id === "rescue" && !reward.fragment ? 5 : 0)
      || (id !== "rescue" && Object.keys(branch.losses).length) || Object.keys(branch.losses).some(key => !["wood", "food"].includes(key))
      || (id === "deck" && branch.accident !== null) || (id === "cargo" && ![null, "flood"].includes(branch.accident)) || (id === "rescue" && ![null, "rescue"].includes(branch.accident))) return false;
    if (branch.encounter && (!branch.encounter.active || branch.encounter.dangerousExplorationId !== site.id || branch.encounter.dangerousRegionId !== site.regionId
      || !Array.isArray(branch.encounter.enemyFormation) || !branch.encounter.enemyFormation.length || branch.encounter.enemyFormation.length > 20
      || !branch.encounter.enemyFormation.every(unit => typeof unit.type === "string" && Number.isInteger(unit.count) && unit.count >= 1 && unit.count <= 10 && Number.isInteger(unit.level) && unit.level >= 1 && unit.level <= 5))) return false;
    if (id !== "deck" && (wreck.stage === "deck" || wreck.stage === "choice" || wreck.stage !== id) && (branch.appliedDays || branch.settled)) return false;
  }
  if (wreck.branches.deck.settled !== wreck.deckClaimed || (wreck.deckClaimed && wreck.branches.deck.appliedDays !== 1)) return false;
  if (wreck.stage === "choice" && pending.dayApplied !== true) return false;
  const current = wreck.branches[wreck.stage === "choice" ? "deck" : wreck.stage];
  if (wreck.stage !== "choice" && (current.settled || pending.dayApplied !== (current.appliedDays === 1))) return false;
  pending.reward = current.reward;
  pending.encounter = wreck.stage === "choice" ? null : current.encounter;
  return true;
}
