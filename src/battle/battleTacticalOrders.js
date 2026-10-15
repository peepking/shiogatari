/** 部隊行動・標的・区域の指示。既定はすべておまかせとする。 */
export const TACTICAL_ORDERS = Object.freeze({
  actionOrder: Object.freeze({ auto: "おまかせ", advance: "進軍", hold: "待機", regroup: "立て直し" }),
  targetOrder: Object.freeze({ auto: "おまかせ", close: "近い敵", hp: "HP優先", rear: "後衛優先", strong: "強敵優先", focus: "敵を指定" }),
  targetAreaOrder: Object.freeze({ auto: "おまかせ", all: "全域", upper: "上側", middle: "中央", lower: "下側" }),
});

/** 戦闘tickで管理するAIの閾値。描画速度や停止時間に依存させない。 */
export const TACTICAL_ORDER_RULES = Object.freeze({ holdTicks: 2, cavalryWait: 4, lowHp: 0.3,
  lowMorale: 35, urgentMorale: 20, recoverMorale: 55, safeTicks: 3, regroupLock: 6, reliefDistance: 2,
  opportunityHp: 0.4, opportunityMorale: 35 });

/** @param {object} a 座標。 @param {object} b 座標。 @returns {number} 四方向距離。 */
export function tacticalDistance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

/** @param {number} y 縦座標。 @param {number} size 盤面幅。 @returns {string} 上中下の帯。 */
export function tacticalArea(y, size) { return ["upper", "middle", "lower"][Math.max(0, Math.min(2, Math.floor(3 * y / size)))]; }

/** @param {string} field 項目。 @param {string} value 指示。 @returns {string} 有効な指示。 */
export function normalizeTacticalOrder(field, value) {
  return Object.hasOwn(TACTICAL_ORDERS, field) && Object.hasOwn(TACTICAL_ORDERS[field], value) ? value : "auto";
}

/** @param {object} item 部隊または編成。 @param {string} legacy 旧全軍方針。 @returns {object} 補完済みの入力。 */
export function normalizeTacticalOrders(item, legacy = "auto") {
  for (const field of Object.keys(TACTICAL_ORDERS))
    item[field] = normalizeTacticalOrder(field, item[field] ?? (field === "targetOrder" ? legacy : "auto"));
  if (item.targetOrder !== "focus" || typeof item.focusEnemyId !== "string" || !item.focusEnemyId) {
    if (item.targetOrder === "focus") item.targetOrder = "auto";
    item.focusEnemyId = null;
  }
  return item;
}

/** @param {object} unit 部隊。 @param {object} entry 準備指示。 @returns {void} 戦闘開始時の履歴を初期化する。 */
export function initializeTacticalOrders(unit, entry = unit) {
  const orders = normalizeTacticalOrders({ ...entry });
  for (const field of Object.keys(TACTICAL_ORDERS)) unit[field] = orders[field];
  unit.focusEnemyId = orders.focusEnemyId;
  unit.tacticalState = unit.actionOrder === "regroup" ? "withdrawing" : "advance";
  unit.tacticalReason = "戦闘開始時に判断";
  unit.tacticalChangeAt = 0;
  unit.tacticalTargetMode = "close";
  unit.tacticalTargetArea = "all";
  unit.cavalryWaitStarted = null;
  unit.cavalryReleased = false;
  unit.regroupGoal = null;
  unit.regroupSafeTicks = 0;
  unit.regroupComplete = false;
  unit.regroupLockUntil = 0;
  unit.previousDamage = 0;
  unit.pendingTacticalOrders = {};
}

/** @param {object} item 部隊。 @returns {boolean} 個別・一括指示を受けられるか。 */
export function canOrderTactics(item) {
  return item && (item.side == null || item.side === "ally") && item.count > 0
    && (item.hp == null || item.hp > 0) && [undefined, "active", "reserve"].includes(item.status);
}

/**
 * 次tickの予約を項目別に上書きする。未投入予備隊は登場時の指示を即時更新する。
 * @param {object} unit 部隊。 @param {string} field 項目。 @param {string} value 値。
 * @param {string|null} focusEnemyId 指定敵。 @returns {boolean} 受付済みか。
 */
export function queueTacticalOrder(unit, field, value, focusEnemyId = null) {
  if (!canOrderTactics(unit) || !Object.hasOwn(TACTICAL_ORDERS, field)) return false;
  const order = normalizeTacticalOrder(field, value);
  if (field === "targetOrder" && order === "focus" && !focusEnemyId) return false;
  if (unit.status === "reserve") {
    unit[field] = order;
    if (field === "targetOrder") unit.focusEnemyId = order === "focus" ? focusEnemyId : null;
  } else {
    unit.pendingTacticalOrders ??= {};
    unit.pendingTacticalOrders[field] = { value: order, focusEnemyId };
  }
  return true;
}

/** @param {object} unit 部隊。 @param {number} tick 適用tick。 @param {number} size 盤面幅。 @returns {void} 次tick予約を反映する。 */
export function applyPendingTacticalOrders(unit, tick, size = 10) {
  const pending = unit.pendingTacticalOrders || {};
  for (const [field, order] of Object.entries(pending)) {
    if (!Object.hasOwn(TACTICAL_ORDERS, field)) continue;
    const old = unit[field];
    unit[field] = normalizeTacticalOrder(field, order.value);
    if (field === "targetOrder") unit.focusEnemyId = unit[field] === "focus" ? order.focusEnemyId : null;
    if (field !== "actionOrder") unit.switchLock = 0;
    if (field === "targetAreaOrder") unit.tacticalTargetArea = unit[field] === "auto" ? tacticalArea(unit.y, size) : unit[field];
    if (field === "actionOrder" && old !== unit[field]) {
      unit.tacticalChangeAt = tick;
      if (unit[field] === "regroup") {
        unit.tacticalState = "withdrawing"; unit.regroupGoal = null;
        unit.regroupSafeTicks = 0; unit.regroupComplete = false;
      } else if (unit[field] !== "auto" && ["withdrawing", "recovering"].includes(unit.tacticalState)) {
        unit.regroupGoal = null; unit.regroupComplete = false; unit.regroupSafeTicks = 0;
        unit.regroupLockUntil = Math.max(unit.regroupLockUntil || 0, tick + TACTICAL_ORDER_RULES.regroupLock);
        unit.tacticalState = unit[field];
      }
    }
  }
  unit.pendingTacticalOrders = {};
}

/** @param {Array} entries 編成。 @param {object|null} saved 保存状態。 @param {string} identity 現在の敵識別。 @returns {void} 旧版の指示と指定敵を移行する。 */
export function migrateTacticalRoster(entries, saved, identity) {
  const legacy = saved?.version < 4 ? normalizeTacticalOrder("targetOrder", saved?.strategy?.targetMode) : "auto";
  for (const entry of entries) {
    if (saved?.version < 4) entry.targetOrder = legacy;
    normalizeTacticalOrders(entry, legacy);
    if (entry.targetOrder === "focus" && saved?.enemyIdentity !== identity) {
      entry.targetOrder = "auto"; entry.focusEnemyId = null;
    }
  }
}

/** @param {Array} front 元の敵前衛。 @param {Array} reserve 元の予備隊。 @param {object} encounter 遭遇。 @returns {string} 指定敵復元の検証値。 */
export function tacticalEnemyIdentity(front, reserve = [], encounter = {}) {
  return JSON.stringify([encounter.kind, encounter.questId, encounter.fightKey, encounter.locationIndex,
    [front, reserve].map(entries => entries.map(entry => [entry.type, entry.count, entry.level]))]);
}
