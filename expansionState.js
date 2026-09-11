import { OUTFITTING_CONFIG, OUTFITTING_ITEMS } from "./expansionConfig.js";
import { validateExploration } from "./exploration.js";
import { normalizeCharts } from "./charts.js";

/**
 * 探索・海図・艤装の空の保存領域を生成する。地点生成は地図準備後に別途実行する。
 * @returns {object} 共有参照を持たない初期状態。
 */
export function createExpansionState() {
  return {
    version: 1,
    exploration: { initialized: false, nextId: 1, sites: [], pending: null, lastTickAbs: null },
    charts: { nextId: 1, active: [], rumorSeasons: {}, pending: null },
    outfitting: { slots: OUTFITTING_CONFIG.initialSlots, owned: [], equipped: [null] },
  };
}

/**
 * 配列以外のデータオブジェクトか判定する。
 * @param {*} value 対象。
 * @returns {boolean} データオブジェクトか。
 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 艤装保存値を補完する。不明設備・未購入設備・重複装備は枠順で除外する。
 * 購入済み設備は装備を外しても保管し、購入資金の再徴収はしない。
 * @param {*} value 保存値。
 * @returns {object} 有効な艤装状態。
 */
export function normalizeOutfitting(value) {
  const source = isRecord(value) ? value : {};
  const slots = Number.isInteger(source.slots) ? Math.max(1, Math.min(OUTFITTING_CONFIG.maxSlots, source.slots)) : OUTFITTING_CONFIG.initialSlots;
  const owned = [...new Set(Array.isArray(source.owned) ? source.owned : [])]
    .filter(id => typeof id === "string" && Object.hasOwn(OUTFITTING_ITEMS, id));
  const used = new Set();
  const equipped = [];
  for (let slot = 0; slot < slots; slot++) {
    const id = Array.isArray(source.equipped) ? source.equipped[slot] : null;
    if (owned.includes(id) && !used.has(id)) {
      used.add(id);
      equipped.push(id);
    } else equipped.push(null);
  }
  return { slots, owned, equipped };
}

/**
 * 旧セーブへ新領域を追加し、保存領域の欠損を補う。既存資産や依頼には触れない。
 * 探索と海図の地点・途中処理を検証する。依頼予約は全状態の復元後に参照から再構成する。
 * @param {*} value 保存値。
 * @returns {object} 補完済みの新機能領域。
 */
export function normalizeExpansionState(value) {
  const result = createExpansionState();
  if (!isRecord(value)) return result;
  const exploration = isRecord(value.exploration) ? value.exploration : {};
  const charts = isRecord(value.charts) ? value.charts : {};
  result.exploration = {
    ...result.exploration,
    initialized: exploration.initialized === true,
    nextId: Number.isSafeInteger(exploration.nextId) && exploration.nextId > 0 ? exploration.nextId : 1,
    sites: Array.isArray(exploration.sites) ? exploration.sites : [],
    pending: isRecord(exploration.pending) ? exploration.pending : null,
    lastTickAbs: Number.isSafeInteger(exploration.lastTickAbs) ? exploration.lastTickAbs : null,
  };
  result.exploration = validateExploration(result.exploration);
  result.charts = normalizeCharts(charts);
  result.outfitting = normalizeOutfitting(value.outfitting);
  return result;
}
