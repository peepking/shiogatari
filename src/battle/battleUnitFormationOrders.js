import { initializeUnitFormation, normalizeFormationOrder, queueUnitFormation } from "./battleUnitFormation.js";

/** 一括指示用の5分類。戦闘上の兵種別判断は既存の定義を使う。 */
export const FORMATION_ORDER_GROUPS = Object.freeze({
  infantry: Object.freeze({ name: "歩兵系", types: Object.freeze(["infantry", "marine", "halberd", "pirate_spear", "pirate_axe", "pirate_assault"]) }),
  shield: Object.freeze({ name: "盾兵系", types: Object.freeze(["shield", "pirate_shield"]) }),
  cavalry: Object.freeze({ name: "騎兵系", types: Object.freeze(["cavalry", "cavalier", "raider_cavalry"]) }),
  ranged: Object.freeze({ name: "射撃兵系", types: Object.freeze(["archer", "crossbow", "seaArcher", "pirate_archer"]) }),
  support: Object.freeze({ name: "支援兵系", types: Object.freeze(["medic", "scout"]) }),
});

/** @param {object} item 編成または部隊。 @returns {string|null} 一括指示の分類。 */
export function formationOrderGroup(item) {
  const known = Object.entries(FORMATION_ORDER_GROUPS).find(([, group]) => group.types.includes(item.type));
  return known?.[0] ?? (item.role === "ranged" ? "ranged" : item.role === "support" ? "support" : item.role === "melee" ? "infantry" : null);
}

/**
 * 準備中は現在編成、戦闘中は指示可能な味方と未投入予備隊を抽出する。
 * 敵・待機兵・敗走・撃破・退出を含めず、表示と実行で同じ対象集合を使う。
 * @param {Array} items 編成または部隊。 @param {boolean} started 戦闘開始済みか。 @returns {Array} 指示可能な対象。
 */
export function formationOrderRecipients(items, started) {
  return items.filter(item => (item.side == null || item.side === "ally") && item.count > 0
    && (!started || (item.hp > 0 && [undefined, "active", "reserve"].includes(item.status))));
}

/** @param {Array} items 指示可能な対象。 @param {string} target 対象ID。 @returns {Array} 選択対象。
 */
export function selectFormationOrderRecipients(items, target) {
  if (target === "all") return items;
  if (target === "melee") return items.filter(item => ["infantry", "shield", "cavalry"].includes(formationOrderGroup(item)));
  if (target?.startsWith("group:") && Object.hasOwn(FORMATION_ORDER_GROUPS, target.slice(6)))
    return items.filter(item => formationOrderGroup(item) === target.slice(6));
  if (target?.startsWith("type:")) return items.filter(item => item.type === target.slice(5));
  return [];
}

/**
 * 対象数付きの選択肢を全体・近接・5分類・個別兵種の順に作る。0部隊の分類は表示しない。
 * @param {Array} items 指示可能な対象。 @param {Function} nameForType 兵種名の取得。 @returns {Array} 選択肢。
 */
export function formationOrderTargets(items, nameForType) {
  const groups = [{ id: "all", name: "全味方" }, { id: "melee", name: "近接兵すべて" },
    ...Object.entries(FORMATION_ORDER_GROUPS).map(([id, group]) => ({ id: `group:${id}`, name: group.name }))];
  const types = [...new Set(items.map(item => item.type))].map(type => ({ id: `type:${type}`, name: nameForType(type), individual: true }));
  return [...groups, ...types].map(option => ({ ...option, count: selectFormationOrderRecipients(items, option.id).length }))
    .filter(option => option.id === "all" || option.count > 0);
}

/**
 * 選択した現在の部隊だけへ指示する。準備中は編成と対応する部隊を更新し、戦闘中は予約する。
 * 維持期間と予備隊の扱いは個別指示の共通処理に任せ、分類の永続設定や保存を作らない。
 * @param {Array} items 選択対象。 @param {string} order 指示。
 * @param {object} context 開始状態と反映済み部隊。 @returns {number} 指示を受け付けた部隊数。
 */
export function applyFormationOrders(items, order, { started, units = [] }) {
  let count = 0;
  for (const item of formationOrderRecipients(items, started)) {
    if (started) {
      if (queueUnitFormation(item, order)) count++;
    } else {
      item.formationOrder = normalizeFormationOrder(order);
      const unit = units.find(candidate => candidate.side === "ally" && candidate.rosterUnitId === item.rosterUnitId);
      if (unit) initializeUnitFormation(unit, item.formationOrder);
      count++;
    }
  }
  return count;
}
