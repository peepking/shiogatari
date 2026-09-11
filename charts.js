import { CHART_CONFIG as CONFIG } from "./expansionConfig.js";

/** @param {Array} values 候補。 @param {Function} random 乱数源。 @returns {*} 均等抽選した候補。 */
function pick(values, random) { return values[Math.floor(random() * values.length)]; }

/** @param {object} chart 海図。 @returns {number} 未予約の断片枠。 */
export function chartRoom(chart) {
  return chart.size - chart.fragments - chart.questIds.length - (chart.rumor ? 1 : 0);
}

/**
 * 収集中の既存海図を優先し、なければ空きサイズ・種類の組から均等抽選する。
 * 噂では回収済み・予約済みの噂を持つ海図を対象外にする。
 * @param {object} data 海図状態。 @param {boolean} rumor 噂か。
 * @param {Function} [random] 乱数源。 @param {string|null} [merchant] 購入元。 @returns {object|null} 割当候補。
 */
export function chooseChart(data, rumor = false, random = Math.random, merchant = null) {
  const existing = data.active.filter(c => chartRoom(c) > 0 && (!rumor || (!c.rumor && !c.rumorFragmentClaimed)) && (!merchant || !c.merchantClaims?.includes(merchant)));
  if (existing.length) {
    const c = pick(existing, random);
    return { chartId: c.id, size: c.size, kind: c.kind };
  }
  const sizes = CONFIG.sizes.filter(size => !data.active.some(c => c.size === size));
  return sizes.length ? { chartId: null, size: pick(sizes, random), kind: pick(Object.keys(CONFIG.rewards), random) } : null;
}

/**
 * 表示時の種類・サイズ・既存IDを維持して割当可否を判定する。
 * @param {object} data 状態。 @param {object} offer 予告。 @returns {boolean} 割当可能か。
 */
export function canAssignChart(data, offer) {
  if (!offer || !CONFIG.sizes.includes(offer.size) || !Object.hasOwn(CONFIG.rewards, offer.kind)) return false;
  const chart = data.active.find(c => c.size === offer.size);
  if (!chart) return offer.chartId == null;
  return chart.kind === offer.kind && (offer.chartId == null || chart.id === offer.chartId) && chartRoom(chart) > 0;
}

/**
 * 既存海図を取得するか、事前に選んだ完成地点で新規海図を割り当てる。
 * @param {object} data 状態。 @param {object} offer 予告。 @param {object|null} destination 完成地点。
 * @returns {object|null} 割当先。
 */
export function assignChart(data, offer, destination) {
  if (!canAssignChart(data, offer)) return null;
  const current = data.active.find(c => c.size === offer.size);
  if (current) return current;
  if (!destination) return null;
  const chart = { id: data.nextId++, kind: offer.kind, size: offer.size, fragments: 0, questIds: [],
    rumor: null, rumorFragmentClaimed: false, merchantClaims: [], destination };
  data.active.push(chart);
  return chart;
}

/**
 * 依頼・噂は対応予約だけを消費し、戦闘・探索・購入は未予約枠だけを埋める。購入元ごとに海図1枚まで。
 * @param {object} chart 海図。 @param {string} source 入手元。 @param {*} [questId] 依頼ID。
 * @returns {boolean} 取得できたか。
 */
export function claimFragment(chart, source, questId = null) {
  if (!chart || chart.fragments >= chart.size) return false;
  if (source === "quest") {
    if (!chart.questIds.includes(questId)) return false;
    chart.questIds = chart.questIds.filter(id => id !== questId);
  } else if (source === "rumor") {
    if (!chart.rumor || chart.rumorFragmentClaimed) return false;
    chart.rumor = null;
    chart.rumorFragmentClaimed = true;
  } else {
    const merchant = Object.hasOwn(CONFIG.merchants, source);
    if ((!merchant && !["battle", "exploration"].includes(source)) || chartRoom(chart) < 1) return false;
    if (merchant) {
      if (chart.merchantClaims?.includes(source)) return false;
      chart.merchantClaims = [...(chart.merchantClaims || []), source];
    }
  }
  chart.fragments++;
  return true;
}

/**
 * 受注中依頼の参照から予約を再構成する。失敗・期限切れの予約と空の仮海図は解放する。
 * @param {object} data 海図状態。 @param {Array} quests 受注中依頼。 @returns {void}
 */
export function reconcileCharts(data, quests) {
  for (const chart of data.active) {
    const room = chart.size - chart.fragments - (chart.rumor ? 1 : 0);
    chart.questIds = [...new Set(quests.filter(q => q.rewardFragment?.chartId === chart.id &&
      q.rewardFragment.size === chart.size && q.rewardFragment.kind === chart.kind).map(q => q.id))].slice(0, Math.max(0, room));
  }
  data.active = data.active.filter(c => c.fragments || c.questIds.length || c.rumor || data.pending?.chartId === c.id);
}

/**
 * 完成報酬を固定幅で抽選する。高級品は全種類へ1個ずつ配り、残りを均等抽選する。
 * @param {object} chart 海図。 @param {string[]} goods 高級品ID。 @param {Function} [random] 乱数源。
 * @returns {object} 固定報酬。
 */
export function rollChartReward(chart, goods, random = Math.random) {
  const settings = CONFIG.rewards[chart.kind][chart.size];
  /** @param {number[]} range 範囲。 @returns {number} 範囲内の整数を均等抽選する。 */
  const integer = range => range[0] + Math.floor(random() * (range[1] - range[0] + 1));
  const reward = { funds: settings.funds || 0, ships: settings.ships || 0,
    faith: settings.faith ? integer(settings.faith) : 0, fame: integer(CONFIG.fame[chart.size]), supplies: {} };
  if (settings.goods && goods.length) {
    for (const id of goods) reward.supplies[id] = 1;
    for (let n = goods.length; n < settings.goods; n++) reward.supplies[pick(goods, random)]++;
  }
  return reward;
}

/** @param {*} pos 座標。 @returns {boolean} 地図範囲内か。 */
function validPosition(pos) {
  return pos && Number.isInteger(pos.x) && Number.isInteger(pos.y) && pos.x >= 0 && pos.y >= 0 && pos.x < 50 && pos.y < 50;
}

/**
 * 既知の種別・サイズと範囲内の地点を復元する。重複枠・ID・地点は先の有効レコードを優先する。
 * 依頼参照は全状態の復元後に別途再構成する。
 * @param {object} source 保存値。 @returns {object} 補完済み状態。
 */
export function normalizeCharts(source = {}) {
  const sizes = new Set(); const ids = new Set(); const coords = new Set(); const active = [];
  for (const c of Array.isArray(source.active) ? source.active : []) {
    if (!c || !Number.isSafeInteger(c.id) || c.id < 1 || ids.has(c.id) || sizes.has(c.size) || !CONFIG.sizes.includes(c.size) || !Object.hasOwn(CONFIG.rewards, c.kind)) continue;
    if (!validPosition(c.destination) || !Number.isInteger(c.fragments) || c.fragments < 0 || c.fragments > c.size) continue;
    const key = `${c.destination.x},${c.destination.y}`;
    if (coords.has(key)) continue;
    coords.add(key); sizes.add(c.size); ids.add(c.id);
    const rumorKey = c.rumor && `${c.rumor.x},${c.rumor.y}`;
    const rumor = validPosition(c.rumor) && !coords.has(rumorKey) && !c.rumorFragmentClaimed && c.fragments < c.size ? c.rumor : null;
    if (rumor) coords.add(rumorKey);
    active.push({ id: c.id, kind: c.kind, size: c.size, destination: c.destination, fragments: c.fragments,
      rumor, rumorFragmentClaimed: c.rumorFragmentClaimed === true, merchantClaims: Object.keys(CONFIG.merchants).filter(id => Array.isArray(c.merchantClaims) && c.merchantClaims.includes(id)), questIds: [] });
  }
  let pending = source.pending;
  const chart = active.find(c => c.id === pending?.chartId);
  if (!chart || typeof pending.dayApplied !== "boolean" || !["rumor", "destination"].includes(pending.kind) ||
    (pending.kind === "rumor" ? !chart.rumor : chart.fragments !== chart.size)) pending = null;
  if (pending?.kind === "destination") {
    const r = pending.reward;
    if (!r || ![r.funds, r.ships, r.faith, r.fame].every(n => Number.isSafeInteger(n) && n >= 0) ||
      !r.supplies || typeof r.supplies !== "object" || Array.isArray(r.supplies) || !Object.values(r.supplies).every(n => Number.isInteger(n) && n >= 0 && n <= 100)) pending = null;
  }
  const rumorSeasons = Object.fromEntries(Object.entries(source.rumorSeasons || {}).filter(([key, value]) => key.length < 100 && Number.isSafeInteger(value)));
  const merchantSeasons = Object.fromEntries(Object.entries(source.merchantSeasons || {}).filter(([key, value]) => key.length < 100 && Number.isSafeInteger(value)));
  return { nextId: Math.max(Number.isSafeInteger(source.nextId) ? source.nextId : 1, 1, ...active.map(c => c.id + 1)), active, rumorSeasons, merchantSeasons, pending };
}

/** @param {object} data 海図状態。 @returns {Array} 公開中の無期限探索地点。 */
export function visibleChartSites(data) {
  return (data?.active || []).flatMap(c => [
    ...(c.rumor ? [{ chartId: c.id, kind: "rumor", position: c.rumor }] : []),
    ...(c.fragments === c.size ? [{ chartId: c.id, kind: c.kind, position: c.destination }] : []),
  ]);
}
