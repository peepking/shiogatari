/** 部隊陣形の百分率。通常攻撃・支援射撃・士気・表示で共有する。 */
export const UNIT_FORMATIONS = Object.freeze({
  line: Object.freeze({ name: "横陣", mark: "横", attack: 100, defense: 100, morale: 100 }),
  shieldWall: Object.freeze({ name: "盾壁", mark: "盾", attack: 60, defense: 70, morale: 100 }),
  circle: Object.freeze({ name: "円陣", mark: "円", attack: 70, defense: 90, morale: 70 }),
  spread: Object.freeze({ name: "散開", mark: "散", attack: 90, defense: 100, melee: 120, ranged: 80, morale: 100 }),
  charge: Object.freeze({ name: "突撃", mark: "突", attack: 130, defense: 140, morale: 100 }),
});

/** 新規編成・指示未保存の旧編成に共通する初期指示。 */
export const DEFAULT_FORMATION_ORDER = "auto";

/** 兵種別自動判断の初期閾値。時間切れを理由に変更しない。 */
export const UNIT_FORMATION_RULES = Object.freeze({ holdTicks: 3, lowHp: 0.3, morale: 45, pressure: 2,
  finishHp: 0.4, rangedHp: 0.6, shockRange: 2,
  shields: Object.freeze(["shield", "pirate_shield"]),
  attackers: Object.freeze(["cavalry", "cavalier", "raider_cavalry", "pirate_axe", "pirate_assault"]) });

/** @param {string} order 指示。 @returns {string} 正規化した指示。 */
export function normalizeFormationOrder(order) {
  return order === "auto" || Object.hasOwn(UNIT_FORMATIONS, order) ? order : "line";
}

/** @param {object} unit 部隊。 @returns {object} 現在の陣形定義。 */
export function unitFormation(unit) {
  return Object.hasOwn(UNIT_FORMATIONS, unit?.formationId) ? UNIT_FORMATIONS[unit.formationId] : UNIT_FORMATIONS.line;
}

/**
 * 既存の整数ダメージへ陣形の百分率を一括乗算し、切り捨て後も最低1を保証する。
 * 支援射撃は攻撃側を省略する。散開は通常攻撃の役割または明示した射撃分類で判定する。
 * @param {number} damage 従来ダメージ。 @param {object|null} attacker 攻撃側。
 * @param {object} target 防御側。 @param {string} [kind] 攻撃分類。 @returns {number} 最終ダメージ。
 */
export function formationDamage(damage, attacker, target, kind = attacker?.role === "ranged" ? "ranged" : "melee") {
  const defense = unitFormation(target);
  const percent = defense[kind] ?? defense.defense;
  return Math.max(1, Math.floor(damage * (attacker ? unitFormation(attacker).attack : 100) * percent / 10000));
}

/** @param {object} unit 部隊。 @param {string} order 初期指示。 @param {number} tick 初回変更可能tick。 @returns {void} */
export function initializeUnitFormation(unit, order = DEFAULT_FORMATION_ORDER, tick = 1) {
  unit.formationOrder = normalizeFormationOrder(order ?? DEFAULT_FORMATION_ORDER);
  unit.formationId = unit.formationOrder === "auto" ? "line" : unit.formationOrder;
  unit.pendingFormationOrder = null;
  unit.formationChangeAt = tick;
  unit.formationReason = "";
}

/**
 * 兵種別の優先順位で陣形と理由を返す。近接は低HP防御を優先し、射撃・支援は脅威を再評価する。
 * 盤面の集計と標的選択は呼出側の共通計算を使い、乱数・部隊状態を変更しない。
 * @param {object} unit 部隊。 @param {object} facts 開始時の圧力・脅威・標的。 @returns {object} 陣形と理由。
 */
export function chooseUnitFormation(unit, { pressure = 0, shock = false, adjacentMelee = false,
  rangedThreat = false, target = null, canAttack = false } = {}) {
  const rules = UNIT_FORMATION_RULES;
  const hp = unit.hp / Math.max(1, unit.maxHp);
  const morale = unit.morale ?? 100;
  const melee = unit.role !== "ranged" && unit.role !== "support";
  if (melee && hp <= rules.lowHp) return { id: "shieldWall", reason: "HPが30%以下" };
  if (morale <= rules.morale && (pressure > 0 || shock)) return { id: "circle", reason: "低士気で圧力・近隣衝撃あり" };
  if (!melee || rules.shields.includes(unit.type)) {
    if (adjacentMelee) return { id: "shieldWall", reason: "敵近接兵が隣接" };
    if (rangedThreat && !rules.shields.includes(unit.type)) return { id: "spread", reason: "敵射撃兵の射程内" };
    if (unit.role === "ranged" && canAttack && hp > rules.rangedHp && morale > rules.morale)
      return { id: "charge", reason: "安全な射撃位置から攻撃可能" };
  } else {
    if (pressure >= rules.pressure) return { id: "circle", reason: "局所圧力が2以上" };
    if (rules.attackers.includes(unit.type) && canAttack && target
      && target.hp / Math.max(1, target.maxHp) <= rules.finishHp && morale > rules.morale)
      return { id: "charge", reason: "HP40%以下の敵へ攻撃可能" };
    if (rangedThreat && !adjacentMelee) return { id: "spread", reason: "敵射撃兵の射程内" };
  }
  return { id: "line", reason: "基本形で対応" };
}

/**
 * 開始時の指示を確定する。同じ実陣形は待ち時間を延長せず、切替後は3tick維持する。
 * 手動予約を先に適用し、おまかせの候補は適用時の共通盤面から取得する。
 * @param {object} unit 部隊。 @param {number} tick 当tick。 @param {Function} decide 自動判断。
 * @returns {boolean} 実陣形が変わったか。
 */
export function resolveUnitFormation(unit, tick, decide) {
  if (unit.hp <= 0 || ["routing", "destroyed", "escaped"].includes(unit.status)) {
    unit.pendingFormationOrder = null;
    return false;
  }
  if (unit.status === "reserve" || tick < (unit.formationChangeAt ?? 1)) return false;
  if (unit.pendingFormationOrder != null) {
    unit.formationOrder = normalizeFormationOrder(unit.pendingFormationOrder);
    unit.pendingFormationOrder = null;
  }
  const order = normalizeFormationOrder(unit.formationOrder);
  const decision = order === "auto" ? decide(unit) : { id: order, reason: "" };
  const changed = (unit.formationId || "line") !== decision.id;
  unit.formationOrder = order;
  if (changed) {
    unit.formationId = decision.id;
    unit.formationChangeAt = tick + UNIT_FORMATION_RULES.holdTicks;
    unit.formationReason = decision.reason;
  } else if (order !== "auto" || !unit.formationReason) unit.formationReason = decision.reason;
  return changed;
}

/** @param {object} unit 部隊。 @param {string} order 指示。 @returns {boolean} 受付可能か。 */
export function queueUnitFormation(unit, order) {
  if (!unit || unit.hp <= 0 || ["routing", "escaped", "destroyed"].includes(unit.status)) return false;
  if (unit.status === "reserve") initializeUnitFormation(unit, order);
  else unit.pendingFormationOrder = normalizeFormationOrder(order);
  return true;
}

/**
 * 編成部隊に独立した識別子と指示を付ける。既存IDを保持し、欠落・重複は乱数なしで補完する。
 * @param {Array} entries 前衛・予備隊をまとめた編成。 @returns {void}
 */
export function normalizeFormationRoster(entries) {
  const used = new Set(entries.map(entry => entry.rosterUnitId).filter(id => typeof id === "string" && /^roster-\d+$/.test(id)));
  const seen = new Set();
  let next = 1;
  for (const entry of entries) {
    if (!used.has(entry.rosterUnitId) || seen.has(entry.rosterUnitId)) {
      while (used.has(`roster-${next}`)) next++;
      entry.rosterUnitId = `roster-${next++}`;
      used.add(entry.rosterUnitId);
    }
    seen.add(entry.rosterUnitId);
    entry.formationOrder = normalizeFormationOrder(entry.formationOrder ?? DEFAULT_FORMATION_ORDER);
  }
}

/** @param {object} unit 部隊。 @returns {string} 共有定義に基づく攻防補正の説明。 */
export function unitFormationDescription(unit) {
  const def = unitFormation(unit);
  return `与ダメージ×${def.attack / 100} / 被ダメージ${def.melee ? ` 近接×${def.melee / 100}・射撃×${def.ranged / 100}` : `×${def.defense / 100}`}`
    + (def.morale < 100 ? " / 敵の圧力・味方の撃破・敗走による士気低下を30%軽減" : "");
}
