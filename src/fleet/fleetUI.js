import { SHIP_TYPES, SHIP_UPKEEP_RATE } from "./shipConfig.js";
import { normalizeFleet, fleetEffects, fleetCounts } from "./fleet.js";
import { VARIANT_SHIPS, variantBonusText } from "./variantShips.js";
import { escapeHtml, SEASONS } from "../core/util.js";
import { getOutfittingEffects, snapshotOutfitting } from "./outfitting.js";
import { calcSupplyCap } from "../resources/supplies.js";
import { calcTroopCap, TROOP_STATS } from "../resources/troops.js";
import { getUpkeepForecast } from "../resources/upkeep.js";
import { faithEffects } from "../faith/faith.js";
import { shipIcon } from "./shipArt.js";

export { shipIcon };

const METRIC_NAMES = { supplyCap: "物資上限", troopCap: "兵員上限", funds: "次回維持費", troopFunds: "部隊維持費", shipFunds: "船維持費",
  shipUpkeepReduction: "船維持費軽減（%）", food: "次回食料消費", medics: "衛生兵効果（人分）", scouts: "斥候効果（人分）",
  meleeAtk: "近接攻撃倍率（%）", rangedAtk: "射撃攻撃倍率（%）", meleeDef: "近接防御倍率（%）", rangedDef: "射撃防御倍率（%）", hp: "全兵員HP倍率（%）" };
const ATTACK_NAMES = { harpoon: "モリ投擲", ballista: "バリスタ", fire_ballista: "ファイヤバリスタ", grape_ballista: "ブドウ弾バリスタ", fire_grape_ballista: "火炎ブドウ弾バリスタ", cannon: "砲撃支援" };

/** @param {string} id 数値の内部識別子。 @returns {string} 船団詳細と比較で共有する項目名。 */
export function fleetMetricLabel(id) {
  if (Object.hasOwn(METRIC_NAMES, id)) return METRIC_NAMES[id];
  const attack = id.match(/^(.*)(Interval|Power)$/);
  return attack && Object.hasOwn(ATTACK_NAMES, attack[1]) ? `${ATTACK_NAMES[attack[1]]}${attack[2] === "Interval" ? "間隔（カウント）" : "威力"}` : id;
}


/** @param {string} id 船種。 @returns {string} 船種設定から作る固有効果の説明。 */
export function shipEffectText(id) {
  const ship = SHIP_TYPES[id];
  if (id === "fishing_boat") return `餌を消費しない確率＋${ship.effects.baitSaving}%/隻（最大${ship.effects.baitSaving * ship.limit}%）`;
  const names = { upkeepReduction: "部隊維持費", shipUpkeepReduction: "船維持費", supplyCap: "物資上限", troopCap: "兵員上限", atk: "兵員の攻撃", def: "兵員の防御", hp: "全兵員HP", supportPower: "支援射撃威力" };
  const effects = Object.entries(ship.effects).map(([key, n]) => `${names[key]} ${key.endsWith("Reduction") ? "−" : "+"}${n}%/隻`);
  return effects.length ? `${effects.join(" / ")}（${ship.limit}隻まで有効）` : "容量を重視した船";
}

/** @param {object} state 実状態または比較用状態。 @param {boolean} includeUnequipped 比較用に未装備の射撃設備も含めるか。 @returns {object} 内部識別子を使った容量・費用・戦闘効果の共通表示値。 */
export function fleetMetrics(state, includeUnequipped = true) {
  const equipment = state.expansion?.outfitting;
  const e = getOutfittingEffects(equipment, state.fleet);
  const cost = getUpkeepForecast(state, TROOP_STATS);
  const support = snapshotOutfitting(state);
  const result = { supplyCap: calcSupplyCap(state.fleet, equipment), troopCap: calcTroopCap(state.fleet, equipment),
    funds: cost.funds, troopFunds: cost.troopFunds, shipFunds: cost.shipFunds,
    shipUpkeepReduction: e.shipUpkeepReduction + faithEffects(state).upkeep * 100, food: cost.food, medics: support.medics, scouts: support.scouts,
    meleeAtk: 100 + e.atk + e.meleeAtk, rangedAtk: 100 + e.atk + e.rangedAtk,
    meleeDef: 100 + e.def + e.meleeDef, rangedDef: 100 + e.def + e.rangedDef, hp: 100 + e.hp };
  for (const id of Object.keys(ATTACK_NAMES)) {
    const attack = e.attacks.find(a => a.id === id);
    if (!attack) {
      if (!includeUnequipped) continue;
      result[`${id}Interval`] = "未装備";
      result[`${id}Power`] = "未装備";
      continue;
    }
    result[`${id}Interval`] = attack.interval;
    result[`${id}Power`] = attack.power;
  }
  return result;
}

/** @param {object} state 状態。 @returns {string} 船種別所持数・固有効果の実効値と上限。 */
export function fleetDetails(state) {
  const fleet = normalizeFleet(state.fleet);
  const e = fleetEffects(fleet);
  const attacks = getOutfittingEffects(state.expansion?.outfitting, fleet).attacks;
  const rows = Object.entries(fleetCounts(fleet)).filter(([, n]) => n > 0).map(([id, n]) => {
    const ship = SHIP_TYPES[id];
    const variants = fleet.variants.filter(v => VARIANT_SHIPS[v.variantId].base === id);
    const supplies = ship.supplies * n + variants.reduce((sum, v) => sum + VARIANT_SHIPS[v.variantId].supplies, 0);
    const troops = ship.troops * n + variants.reduce((sum, v) => sum + VARIANT_SHIPS[v.variantId].troops, 0);
    return `<div class="outfitting-equipped ship-owned">${shipIcon(id)}<div><b>${ship.name} ${n}隻</b><button class="btn ghost" data-asset-codex="ships" data-codex-id="${id}">図鑑で見る</button>${variants.length ? `<p class="tiny">通常船 ${fleet.counts[id]}隻 / 固有船 ${variants.length}隻</p>` : ""}<p>物資容量＋${supplies} / 兵員容量＋${troops}</p><p class="tiny">船維持費 ${ship.price * SHIP_UPKEEP_RATE * n}資金／季節（軽減前）</p><p>${shipEffectText(id)}${ship.limit ? ` / 有効${Math.min(n, ship.limit)}隻分${n >= ship.limit ? "・上限到達" : ""}` : ""}</p>${variants.length ? `<details><summary>固有船と来歴（${variants.length}隻）</summary><div class="variant-ship-history">${variants.map(variantShipDetails).join("")}</div></details>` : ""}</div></div>`;
  }).join("");
  const names = { supplyCap: "物資上限", troopCap: "兵員上限", upkeepReduction: "部隊維持費", shipUpkeepReduction: "船維持費", atk: "攻撃", def: "防御", hp: "HP", supportPower: "支援射撃威力", baitSaving: "餌を消費しない確率" };
  const effects = Object.entries(names).filter(([key]) => e[key] > 0).map(([key, name]) => `${name}${key.endsWith("Reduction") ? "−" : "＋"}${e[key]}%`);
  return `${rows || '<p class="tiny">従船はありません。</p>'}${effects.length ? `<p class="tiny">船の固有効果：${effects.join(" / ")}</p>` : ""}${e.supportPower && !attacks.length ? '<p class="outfitting-notice">支援射撃を強める船があります。効果を使うには射撃設備の装備が必要です。</p>' : ""}`;
}

/** @param {object} record 所有個体。 @returns {string} 船名・容量補正・船長と獲得日。 */
export function variantShipDetails(record) {
  const v = VARIANT_SHIPS[record.variantId], day = Math.max(0, record.acquiredAbs - 1);
  const date = record.acquiredAbs ? `神歴${Math.floor(day / 120)}年 ${SEASONS[Math.floor(day % 120 / 30)]} ${day % 30 + 1}日` : "獲得日不明";
  return `<div class="variant-ship-record"><b>${escapeHtml(v.name)}</b><p>${variantBonusText(v.id)}</p><p class="tiny">${escapeHtml(record.sourceName)}の船を拿捕<br>${date}</p></div>`;
}
