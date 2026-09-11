import { OUTFITTING_CONFIG, OUTFITTING_ITEMS } from "./expansionConfig.js";
import { normalizeOutfitting } from "./expansionState.js";

/**
 * 装備中の効果を枠順で集計する。割合は加算し、射撃は独立して発動させる。
 * 船数・陸海・再描画の回数による倍率は付けない。
 * @param {object} outfitting 艤装状態。
 * @returns {object} 比較表示と実効果で共有する集計値。
 */
export function getOutfittingEffects(outfitting) {
  const result = { atk: 0, def: 0, meleeAtk: 0, meleeDef: 0, rangedAtk: 0, rangedDef: 0,
    supplyCap: 0, troopCap: 0, foodReduction: 0, upkeepReduction: 0, medics: 0, scouts: 0, attacks: [] };
  for (const id of normalizeOutfitting(outfitting).equipped) {
    if (!id) continue;
    const item = OUTFITTING_ITEMS[id];
    for (const [key, value] of Object.entries(item.effects || {})) result[key] += value;
    if (item.attack) result.attacks.push({ id, ...item.attack });
  }
  return result;
}

/**
 * 元の上限に割合増加を一度だけ適用し、最後に切り捨てる。
 * @param {number} base 元の上限。
 * @param {number} percent 増加率の合計。
 * @returns {number} 変更後の上限。
 */
export function applyCapacityBonus(base, percent) {
  return Math.floor(base * (100 + percent) / 100);
}

/**
 * 合計した消費額に割合軽減を一度だけ適用し、最後に切り捨てる。
 * 兵種・部隊ごとに丸めず、軽減率は0～100%に制限する。
 * @param {number} total 軽減前の必要量合計。
 * @param {number} percent 軽減率。
 * @returns {number} 軽減後の必要量。
 */
export function applyConsumptionReduction(total, percent) {
  return Math.floor(total * (100 - Math.min(100, Math.max(0, percent))) / 100);
}

/**
 * 実兵員と設備の仮想人数を合算し、最大10人分で打ち止めにする。
 * 実際の保有人数・維持費・食料消費は変更しない。
 * @param {number} troops 実兵員数。
 * @param {number} equipment 設備の加算人数。
 * @returns {number} 効果人数。
 */
export function effectiveSupportCount(troops, equipment) {
  return Math.min(OUTFITTING_CONFIG.supportLimit, Math.max(0, troops) + Math.max(0, equipment));
}

/** @param {object} troops 保有兵。 @param {string} type 兵種。 @returns {number} 待機兵を含む人数。 */
export function supportTroopCount(troops, type) {
  const levels = troops?.[type];
  return typeof levels === "number" ? levels : Object.values(levels || {}).reduce((sum, n) => sum + Number(n || 0), 0);
}

/** @param {object} state 状態。 @returns {object} 戦闘開始時に固定する設備・補助兵効果。 */
export function snapshotOutfitting(state) {
  const effects = getOutfittingEffects(state.expansion?.outfitting);
  return { effects, medics: effectiveSupportCount(supportTroopCount(state.troops, "medic"), effects.medics),
    scouts: effectiveSupportCount(supportTroopCount(state.troops, "scout"), effects.scouts),
    equipped: normalizeOutfitting(state.expansion?.outfitting).equipped.filter(Boolean) };
}

/** @param {number} power 威力。 @param {number} def 有効DEF。 @returns {number} 通常攻撃と共通の軽減後ダメージ。 */
export function defendedDamage(power, def) { return Math.max(1, Math.round(power * 100 / (100 + def))); }

/**
 * 撃破された味方だけへ戦闘開始時の衛生兵効果を適用し、部隊ごとの損耗を四捨五入する。
 * @param {Array} units 結果部隊。 @param {number} medics 固定済み効果人数。 @returns {object} 損耗と損耗率。
 */
export function outfittingBattleLosses(units, medics) {
  const lossProb = Math.max(0, 0.5 * (1 - Math.min(10, medics) / 10));
  const losses = {};
  for (const unit of units.filter(u => u.side === "ally" && u.hp <= 0)) {
    const lost = Math.round((unit.count || 0) * lossProb);
    if (lost > 0) losses[unit.type] = (losses[unit.type] || 0) + lost;
  }
  return { losses, lossProb };
}

/** @param {number} base 補正前能力。 @param {number} range 射程。 @param {string} ability 能力。 @param {object} effects 設備効果。 @returns {number} 加算倍率を一度だけ適用した能力。 */
export function outfittedStat(base, range, ability, effects) {
  const key = `${range > 1 ? "ranged" : "melee"}${ability === "atk" ? "Atk" : "Def"}`;
  return Math.max(1, Math.floor(base * (100 + effects[ability] + effects[key]) / 100));
}

/**
 * 枠順に支援射撃し、発射ごとに生存敵から均等抽選する。通常行動で決着済みなら発射しない。
 * @param {number} tick ティック。 @param {Array} units 戦闘部隊。 @param {Array} attacks 設備。
 * @param {Function} defense 有効DEF計算。 @param {Function} [random] 乱数源。 @returns {Array} 発射結果。
 */
export function fireOutfitting(tick, units, attacks, defense, random = Math.random) {
  const shots = [];
  if (!units.some(u => u.side === "ally" && u.hp > 0)) return shots;
  for (const attack of attacks) {
    if (tick <= 0 || tick % attack.interval) continue;
    const enemies = units.filter(u => u.side === "enemy" && u.hp > 0);
    if (!enemies.length) break;
    const target = enemies[Math.floor(random() * enemies.length)];
    const damage = attack.destroy ? target.hp : defendedDamage(attack.power, defense(target));
    target.hp = Math.max(0, target.hp - damage);
    shots.push({ id: attack.id, target, damage });
  }
  return shots;
}

/**
 * 購入・拡張・付け替えを検証して反映する。重複購入と装備を拒否し、購入だけでは装備しない。
 * @param {object} state 状態。 @param {string} action 操作。 @param {string|null} id 設備。 @param {number} [slot] 対象枠。
 * @returns {boolean} 反映したか。街などの操作場所は呼び出し側が検証する。
 */
export function changeOutfitting(state, action, id, slot = 0) {
  const data = normalizeOutfitting(state.expansion.outfitting);
  const item = Object.hasOwn(OUTFITTING_ITEMS, id) ? OUTFITTING_ITEMS[id] : null;
  if (action === "buy") {
    if (!item || data.owned.includes(id) || state.funds < item.price) return false;
    state.funds -= item.price; data.owned.push(id);
  } else if (action === "expand") {
    const price = OUTFITTING_CONFIG.unlockPrices[data.slots + 1];
    if (!price || state.funds < price) return false;
    state.funds -= price; data.slots++; data.equipped.push(null);
  } else if (action === "equip") {
    if (!Number.isInteger(slot) || slot < 0 || slot >= data.slots || (id !== null && (!data.owned.includes(id) || data.equipped.includes(id)))) return false;
    data.equipped[slot] = id;
  } else return false;
  state.expansion.outfitting = data;
  return true;
}
