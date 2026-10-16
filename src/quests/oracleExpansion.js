import { absDay } from "../core/calendar.js";
import { MODE_LABEL } from "../core/constants.js";
import { receiveFaith } from "../core/voyageStats.js";
import { tideOracleReward } from "../faith/tideAlliance.js";
import { FISH_SPECIES, FISH_CATEGORIES } from "../fishing/fishingConfig.js";
import { fishSalePrice, fishingRegionAt } from "../fishing/fishing.js";

/** 追加神託の初期値。距離は縦横の合計、期限は受領日からの日数。 */
export const ORACLE_CONFIG = Object.freeze({ radius: 15, days: 90, common: 5, big: 2, food: 10, funds: 2000, people: 1 });
/** 追加神託の名称。魚の要求分類は同じ種類の中で抽選する。 */
export const EXPANDED_ORACLES = Object.freeze({ oracle_fish: "海の恵みを捧げよ", oracle_share: "分かち与えよ",
  oracle_pilgrimage: "祈りを巡らせよ", oracle_explore: "沈みしものを拾え", oracle_support: "祈りを支えよ" });

/** @param {object} q 依頼。 @returns {boolean} 追加神託か。 */
export function isExpandedOracle(q) { return Object.hasOwn(EXPANDED_ORACLES, q?.type || ""); }

/** @param {object} state 共有状態。 @param {object} snapshot 更新前の複製。 @returns {void} 今回追加されたキーも含めて保存失敗前へ戻す。 */
export function restoreOracleState(state, snapshot) {
  for (const key of Object.keys(state)) if (!Object.hasOwn(snapshot, key)) delete state[key];
  Object.assign(state, snapshot);
}

/** @param {object} a 座標。 @param {object} b 座標。 @returns {number} 縦横の距離。 */
function distance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

/** @param {*} pos 座標。 @returns {boolean} 保存可能な地図内の整数座標か。 */
function validPosition(pos) { return Number.isInteger(pos?.x) && Number.isInteger(pos?.y) && pos.x >= 0 && pos.y >= 0 && pos.x < 50 && pos.y < 50; }

/**
 * 要求分類の釣果を安い売却単価順に割り当てる。同額は内部ID順とし、乱数を使わない。
 * 必要数に満たない場合も在庫を変更せず、不足と確認用の内訳を返す。
 * @param {object} state 状態。 @param {object} q 神託。 @returns {object} 所持数・奉納内訳・達成可否。
 */
export function fishOffering(state, q) {
  const counts = state.expansion?.fishing?.counts || {};
  const species = FISH_SPECIES.filter(s => s.category === q.fishCategory && Number.isSafeInteger(counts[s.id]) && counts[s.id] > 0)
    .map(s => ({ id: s.id, name: s.name, price: fishSalePrice(state, s), owned: counts[s.id] }))
    .sort((a, b) => a.price - b.price || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const owned = species.reduce((sum, s) => sum + s.owned, 0), items = [];
  let left = q.qty;
  for (const s of species) {
    const qty = Math.min(left, s.owned);
    if (qty > 0) items.push({ id: s.id, name: s.name, price: s.price, qty });
    left -= qty;
    if (left <= 0) break;
  }
  return { owned, items, ready: Number.isSafeInteger(q.qty) && q.qty > 0 && left === 0 };
}

/**
 * 危険海域を通らず上下左右に移動できるセルを列挙する。地形による移動禁止は現行仕様にない。
 * 現在地が危険海域でもそこから退避できる経路は許し、目的地の危険セルは候補にしない。
 * @param {Array} map 地図。 @param {object} origin 現在地。 @param {Function} isDangerous 危険判定。 @returns {Set<string>} 到達可能な座標。
 */
function reachablePositions(map, origin, isDangerous) {
  const seen = new Set(), queue = [origin];
  for (let i = 0; i < queue.length; i++) {
    const pos = queue[i], key = `${pos.x},${pos.y}`;
    if (seen.has(key) || !map[pos.y]?.[pos.x]) continue;
    if (i !== 0 && isDangerous(pos)) continue;
    seen.add(key);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: pos.x + dx, y: pos.y + dy };
      if (map[next.y]?.[next.x] && !seen.has(`${next.x},${next.y}`)) queue.push(next);
    }
  }
  return seen;
}

/**
 * 新種類ごとの有効候補を先に列挙する。距離は受領時の現在地から15以下、巡礼は拠点間も15以下。
 * 魚は季節をまたいでも釣れる分類を対象とし、探索は神託期限まで残る既存漂流物だけを指定する。
 * @param {object} state 状態。 @param {Array} settlements 拠点。 @param {Array} map 地図。
 * @param {{canEnter:Function,isDangerous:Function}} rules 世界の制限。 @returns {object} 種類別の候補。
 */
export function expandedOracleChoices(state, settlements, map, { canEnter, isDangerous }) {
  const origin = state.position, now = absDay(state), radius = ORACLE_CONFIG.radius;
  const reachable = reachablePositions(map, origin, isDangerous);
  const nearby = settlements.filter(s => ["town", "village"].includes(s.kind) && !s.pirateHaven && validPosition(s.coords)
    && distance(origin, s.coords) <= radius && !isDangerous(s.coords) && reachable.has(`${s.coords.x},${s.coords.y}`));
  const accessible = nearby.filter(canEnter);
  const ports = nearby.filter(s => distance(origin, s.coords) > 0), pairs = [];
  for (let i = 0; i < ports.length; i++) for (let j = i + 1; j < ports.length; j++) {
    if (distance(ports[i].coords, ports[j].coords) <= radius) pairs.push([ports[i], ports[j]]);
  }
  const habitats = new Set();
  for (const key of reachable) {
    const [x, y] = key.split(",").map(Number), cell = map[y][x];
    if (["sea", "shoal"].includes(cell.terrain) && !cell.settlement && !isDangerous({ x, y })) habitats.add(`${fishingRegionAt(x, y)}:${cell.terrain}`);
  }
  const fish = state.expansion?.fishing;
  const categories = fish?.rodId ? ["common", "big"].filter(category => {
    if (fishOffering(state, { fishCategory: category, qty: ORACLE_CONFIG[category] }).ready) return true;
    return [0, 1, 2, 3].every(season => FISH_SPECIES.some(s => s.category === category && s.seasons.includes(season)
      && s.regions.some(region => s.depth.some(depth => habitats.has(`${region}:${depth}`))) && Object.values(s.baits).some(weight => weight > 0)));
  }) : [];
  return {
    oracle_fish: categories,
    oracle_share: nearby.filter(s => s.kind === "village"),
    oracle_pilgrimage: pairs,
    oracle_explore: (state.expansion?.exploration?.sites || []).filter(s => s.kind === "drift" && s.id !== state.expansion.exploration.pending?.siteId
      && validPosition(s.position) && distance(origin, s.position) <= radius && !isDangerous(s.position)
      && reachable.has(`${s.position.x},${s.position.y}`) && s.expiresAbs > now + ORACLE_CONFIG.days),
    oracle_support: accessible.filter(s => Object.hasOwn(state.tideAlliance?.sites || {}, s.id)),
  };
}

/**
 * 選ばれた種類の候補を等確率で1つ選び、報酬の5面ダイス4個も受領時に固定する。
 * 種類の抽選は呼出側で行い、候補数や魚の形式数によって種類自体の出現率を変えない。
 * @param {string} type 種類。 @param {Array} choices 有効候補。 @param {number} now 受領日。
 * @param {Function} random 0以上1未満の乱数。 @returns {object|null} ID付与前の神託。
 */
export function makeExpandedOracle(type, choices, now, random = Math.random) {
  if (!Object.hasOwn(EXPANDED_ORACLES, type) || !choices?.length) return null;
  const chosen = choices[Math.floor(random() * choices.length)];
  const q = { type, title: `神託: ${EXPANDED_ORACLES[type]}`, rewardFaith: 0, reward: 0, acceptedAbs: now, deadlineAbs: now + ORACLE_CONFIG.days };
  for (let n = 0; n < 4; n++) q.rewardFaith += 1 + Math.floor(random() * 5);
  if (type === "oracle_fish") {
    Object.assign(q, { fishCategory: chosen, qty: ORACLE_CONFIG[chosen] });
    q.desc = `${FISH_CATEGORIES[chosen]}を${q.qty}匹捧げよ。魚種は問わない。売値の安い釣果から奉納する。`;
  } else if (type === "oracle_pilgrimage") {
    q.visits = chosen.map(s => ({ id: s.id, name: s.name, target: { ...s.coords }, done: false }));
    q.desc = `${chosen.map(s => s.name).join("と")}へ到着し、祈りを巡らせよ。順序は問わない。拠点のマスへの到着で達成でき、入場は不要。`;
  } else if (type === "oracle_explore") {
    Object.assign(q, { siteId: chosen.id, target: { ...chosen.position }, danger: chosen.danger });
    q.desc = `指定地点の漂流物を探索せよ。戦闘確率${chosen.danger * 100}%。敗北・逃走・引き分けでは失敗。`;
  } else {
    Object.assign(q, { targetId: chosen.id, target: { ...chosen.coords } });
    if (type === "oracle_share") {
      Object.assign(q, { itemId: "food", qty: ORACLE_CONFIG.food });
      q.desc = `${chosen.name}へ食料${q.qty}を分かち与えよ。村のマスで納品でき、入場は不要。`;
    } else {
      Object.assign(q, { requiredFunds: ORACLE_CONFIG.funds, requiredPeople: ORACLE_CONFIG.people, supportedFunds: 0, supportedPeople: 0 });
      q.desc = `${chosen.name}の潮盟へ、受領後に資金${q.requiredFunds}または担い手${q.requiredPeople}人を支援せよ。複数回の支援も合算する。`;
    }
  }
  return q;
}

/**
 * 新種類の保存値と固定対象を検証する。不正値を乱数で補完せず、理由を返す。
 * 地点の期限は探索開始で1日進めた後も途中探索として保護されるため、探索中の同一IDは有効とする。
 * @param {object} q 神託。 @param {object} state 状態。 @param {Array} settlements 拠点。 @returns {string} 不正理由、正常なら空文字。
 */
export function expandedOracleError(q, state, settlements) {
  if (!isExpandedOracle(q)) return "";
  if (!Number.isSafeInteger(q.id) || q.id < 1 || !Number.isSafeInteger(q.acceptedAbs) || q.deadlineAbs !== q.acceptedAbs + ORACLE_CONFIG.days
    || !Number.isSafeInteger(q.rewardFaith) || q.rewardFaith < 4 || q.rewardFaith > 20) return "神託の保存内容が不正です。";
  if (q.type === "oracle_fish") return ["common", "big"].includes(q.fishCategory) && q.qty === ORACLE_CONFIG[q.fishCategory] ? "" : "奉納条件が不正です。";
  if (q.type === "oracle_pilgrimage") {
    if (!Array.isArray(q.visits) || q.visits.length !== 2 || q.visits[0]?.id === q.visits[1]?.id) return "巡礼先が不正です。";
    return q.visits.every(v => typeof v?.done === "boolean" && validPosition(v.target) && settlements.some(s => s.id === v.id && validPosition(s.coords) && distance(s.coords, v.target) === 0)) ? "" : "巡礼先を確認できません。";
  }
  if (!validPosition(q.target)) return "目的地が不正です。";
  if (q.type === "oracle_explore") {
    const site = state.expansion?.exploration?.sites?.find(s => s.id === q.siteId && s.kind === "drift" && validPosition(s.position) && distance(s.position, q.target) === 0 && s.danger === q.danger);
    return site && (site.expiresAbs > absDay(state) || state.expansion.exploration.pending?.siteId === q.siteId) ? "" : "指定の漂流物がなくなりました。";
  }
  const settlement = settlements.find(s => s.id === q.targetId && validPosition(s.coords) && distance(s.coords, q.target) === 0);
  if (!settlement) return "指定の拠点を確認できません。";
  if (q.type === "oracle_share") return settlement.kind === "village" && q.itemId === "food" && q.qty === ORACLE_CONFIG.food ? "" : "施しの条件が不正です。";
  return Object.hasOwn(state.tideAlliance?.sites || {}, q.targetId) && q.requiredFunds === ORACLE_CONFIG.funds && q.requiredPeople === ORACLE_CONFIG.people
    && [q.supportedFunds, q.supportedPeople].every(n => Number.isSafeInteger(n) && n >= 0) ? "" : "潮盟への支援条件を確認できません。";
}

/** @param {object} state 状態。 @param {object} q 神託。 @param {Array} settlements 拠点。 @returns {boolean} 手動完了できるか。 */
export function canCompleteExpandedOracle(state, q, settlements) {
  if (!isExpandedOracle(q) || expandedOracleError(q, state, settlements) || absDay(state) > q.deadlineAbs || state.pendingEncounter?.active
    || [MODE_LABEL.PREP, MODE_LABEL.BATTLE].includes(state.modeLabel) || state.expansion?.exploration?.pending || state.expansion?.charts?.pending) return false;
  if (q.type === "oracle_fish") return fishOffering(state, q).ready;
  return q.type === "oracle_share" && distance(state.position, q.target) === 0 && (state.supplies?.food || 0) >= q.qty;
}

/**
 * 完了・失敗を一度だけ確定する。報酬は確定日の潮盟補正を適用し、失敗では資産を消費しない。
 * @param {object} state 状態。 @param {object} q 神託。 @param {boolean} success 成功か。 @param {string} reason 理由。 @returns {object|null} 表示用の結果。
 */
export function settleExpandedOracle(state, q, success, reason = "") {
  const index = state.quests?.active?.indexOf(q) ?? -1;
  if (index < 0) return null;
  const faith = success ? tideOracleReward(state, q) : 0;
  if (faith) receiveFaith(state, faith);
  state.quests.active.splice(index, 1);
  return { title: success ? "神託達成" : "神託失敗", body: `${q.title}${reason ? ` / ${reason}` : ""}`, faith, success };
}

/** @param {object} state 状態。 @param {object} q 神託。 @param {Array} settlements 拠点。 @returns {object|null} 奉納・施しの結果。保存は呼出側で一括確定する。 */
export function completeExpandedOracle(state, q, settlements) {
  if (!state.quests?.active?.includes(q) || !canCompleteExpandedOracle(state, q, settlements)) return null;
  if (q.type === "oracle_fish") {
    for (const item of fishOffering(state, q).items) {
      state.expansion.fishing.counts[item.id] -= item.qty;
      if (!state.expansion.fishing.counts[item.id]) delete state.expansion.fishing.counts[item.id];
    }
  } else state.supplies.food -= q.qty;
  return settleExpandedOracle(state, q, true);
}

/**
 * 成功した移動の到着・支援・探索の確定処理へ接続する。到着の再適用は無視し、支援は確定した実数だけを加算する。
 * @param {object} state 状態。 @param {object} event 行動結果。 @param {Array} settlements 拠点。 @returns {object} 変更の有無と完了結果。
 */
export function advanceExpandedOracle(state, event, settlements) {
  let changed = false;
  const outcomes = [];
  for (const q of [...(state.quests?.active || [])]) {
    if (!isExpandedOracle(q) || absDay(state) > q.deadlineAbs || expandedOracleError(q, state, settlements)) continue;
    let complete = false;
    if (q.type === "oracle_pilgrimage" && event.kind === "arrival") {
      const visit = q.visits.find(v => v.id === event.settlementId && !v.done && distance(state.position, v.target) === 0);
      if (visit) { visit.done = true; changed = true; complete = q.visits.every(v => v.done); }
    } else if (q.type === "oracle_support" && event.kind === "support" && q.targetId === event.settlementId) {
      if (![event.funds, event.people].every(n => Number.isSafeInteger(n) && n >= 0)) continue;
      q.supportedFunds = Math.min(q.requiredFunds, q.supportedFunds + event.funds);
      q.supportedPeople = Math.min(q.requiredPeople, q.supportedPeople + event.people);
      changed ||= event.funds > 0 || event.people > 0;
      complete = q.supportedFunds >= q.requiredFunds || q.supportedPeople >= q.requiredPeople;
    } else if (q.type === "oracle_explore" && event.kind === "explore" && q.siteId === event.siteId) {
      outcomes.push(settleExpandedOracle(state, q, event.success, event.success ? "" : "探索に失敗しました。"));
      changed = true;
    }
    if (complete) outcomes.push(settleExpandedOracle(state, q, true));
  }
  return { changed, outcomes: outcomes.filter(Boolean) };
}

/** @param {object} state 状態。 @param {Array} settlements 拠点。 @returns {Array} 不正・消滅対象の失敗結果。旧種類は変更しない。 */
export function reconcileExpandedOracles(state, settlements) {
  const outcomes = [];
  for (const q of [...(state.quests?.active || [])]) {
    if (!isExpandedOracle(q)) continue;
    const reason = expandedOracleError(q, state, settlements);
    if (reason) outcomes.push(settleExpandedOracle(state, q, false, reason));
  }
  return outcomes.filter(Boolean);
}
