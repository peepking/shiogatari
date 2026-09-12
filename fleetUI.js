import { SHIP_TYPES } from "./shipConfig.js";
import { normalizeFleet, fleetEffects } from "./fleet.js";
import { getOutfittingEffects, snapshotOutfitting } from "./outfitting.js";
import { calcSupplyCap } from "./supplies.js";
import { calcTroopCap, TROOP_STATS } from "./troops.js";
import { getUpkeepForecast } from "./upkeep.js";

/** @param {string} id 船種。 @returns {string} 既存の線画に合わせた船種別の帆装アイコン。 */
export function shipIcon(id) {
  const index = Object.keys(SHIP_TYPES).indexOf(id);
  const masts = index >= 5 ? [21, 35, 47] : index === 2 ? [31] : [26, 42];
  const sails = masts.map((x, i) => `<path d="M${x} ${12 + i * 4}v31"/><path d="M${x - 2} ${14 + i * 4}l-10 20h10Z" fill="currentColor" fill-opacity=".2"/>${index !== 0 && index !== 4 ? `<path d="M${x + 2} ${15 + i * 4}q12 7 10 18h-10Z" fill="currentColor" fill-opacity=".12"/>` : ""}`).join("");
  const oars = [2, 4, 6].includes(index) ? '<path d="m20 45-6 9m14-9-6 9m14-9-6 9m14-9-6 9m14-9-6 9"/>' : "";
  return `<svg class="ship-icon" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${sails}<path d="M7 40q25 9 50-2l-8 13H18Z" fill="currentColor" fill-opacity=".15"/>${index >= 5 ? '<path d="M44 40v-7h10v6M10 42v-6h9v8"/>' : ""}${oars}<path d="M6 58q6-4 13 0t13 0t13 0t13 0"/></svg>`;
}

/** @param {string} id 船種。 @returns {string} 船種設定から作る固有効果の説明。 */
export function shipEffectText(id) {
  const ship = SHIP_TYPES[id];
  const names = { upkeepReduction: "部隊維持費", supplyCap: "物資上限", troopCap: "部隊上限", atk: "部隊ATK", def: "部隊DEF", supportPower: "モリ・バリスタ威力", cannonReduction: "砲撃支援の間隔" };
  const effects = Object.entries(ship.effects).map(([key, n]) => `${names[key]} ${["upkeepReduction", "cannonReduction"].includes(key) ? "−" : "+"}${n}${key === "cannonReduction" ? "tick" : "%"}/隻`);
  return effects.length ? `${effects.join(" / ")}（${ship.limit}隻で上限）` : "固有バフなし・容量重視の船";
}

/** @param {object} state 実状態または比較用状態。 @returns {object} 先頭3項目を物資上限・兵員上限・維持費とする共通表示値。 */
export function fleetMetrics(state) {
  const equipment = state.expansion?.outfitting;
  const e = getOutfittingEffects(equipment, state.fleet);
  const cost = getUpkeepForecast(state, TROOP_STATS);
  const support = snapshotOutfitting(state);
  const result = { "物資上限": calcSupplyCap(state.fleet, equipment), "兵員上限": calcTroopCap(state.fleet, equipment),
    "次回維持費": cost.funds, "次回食料消費": cost.food, "衛生兵効果（人分）": support.medics, "斥候効果（人分）": support.scouts,
    "近接ATK倍率（%）": 100 + e.atk + e.meleeAtk, "遠隔ATK倍率（%）": 100 + e.atk + e.rangedAtk,
    "近接DEF倍率（%）": 100 + e.def + e.meleeDef, "遠隔DEF倍率（%）": 100 + e.def + e.rangedDef };
  for (const [id, name] of Object.entries({ harpoon: "モリ投擲", ballista: "バリスタ", cannon: "砲撃支援" })) {
    const attack = e.attacks.find(a => a.id === id);
    if (!attack) {
      result[`${name}間隔（tick）`] = "未装備";
      if (id !== "cannon") result[`${name}威力`] = "未装備";
      continue;
    }
    result[`${name}間隔（tick）`] = attack.interval;
    if (!attack.destroy) result[`${name}威力`] = attack.power;
  }
  return result;
}

/** @param {object} state 状態。 @returns {string} 船種別所持数・固有効果の実効値と上限。 */
export function fleetDetails(state) {
  const fleet = normalizeFleet(state.fleet);
  const e = fleetEffects(fleet);
  const attacks = getOutfittingEffects(state.expansion?.outfitting, fleet).attacks;
  const rows = Object.entries(fleet.counts).filter(([, n]) => n > 0).map(([id, n]) => {
    const ship = SHIP_TYPES[id];
    return `<div class="outfitting-equipped ship-owned">${shipIcon(id)}<div><b>${ship.name} ${n}隻</b><p>物資容量＋${ship.supplies * n} / 部隊容量＋${ship.troops * n}</p><p>${shipEffectText(id)}${ship.limit ? ` / 有効${Math.min(n, ship.limit)}隻分${n >= ship.limit ? "・上限到達" : ""}` : ""}</p></div></div>`;
  }).join("");
  return `<h3>保有船と固有効果</h3>${rows || '<p class="tiny">従船はありません。</p>'}<p class="tiny">船のバフ合計：物資上限＋${e.supplyCap}% / 部隊上限＋${e.troopCap}% / 維持費−${e.upkeepReduction}% / ATK＋${e.atk}% / DEF＋${e.def}% / モリ・バリスタ＋${e.supportPower}% / 砲撃間隔−${e.cannonReduction}tick</p>${e.supportPower && !attacks.length ? '<p class="tiny">ガレアス：対応する支援射撃艤装は未装備です。</p>' : ""}`;
}
