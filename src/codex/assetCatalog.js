import { TROOP_STATS, BASE_TROOP_CAP } from "../resources/troops.js";
import { BASE_SUPPLY_CAP } from "../resources/supplies.js";
import { SHIP_TYPES, SHIP_UPKEEP_RATE } from "../fleet/shipConfig.js";
import { VARIANT_SHIPS } from "../fleet/variantShips.js";
import { OUTFITTING_ITEMS, OUTFITTING_CONFIG } from "../core/expansionConfig.js";
import { codexTroopCount, collectAssetCodex } from "./assetCodex.js";
import { TROOP_GUIDES, SHIP_GUIDES, EQUIPMENT_GUIDES } from "./assetDescriptions.js";

export const CODEX_LABELS = { all: "すべて", melee: "近接", ranged: "射撃", support: "支援", cargo: "物資輸送", troops: "兵員輸送",
  upkeep: "維持費軽減", attack: "攻撃支援", defense: "防御", fishing: "釣り", sacred: "聖船", firepower: "火力", food: "食料節約", rescue: "救護", escape: "逃走補助", known: "発見済み", unknown: "未発見" };
const TERRAIN_LABELS = { plain: "平原", deck: "甲板", forest: "森", mountain: "山岳", shoal: "浅瀬", sea: "海" };

/** @param {object} stat 兵種。 @returns {string} 数式や内部判定を含まない兵種特性。 */
function troopTraits(stat) {
  const traits = [];
  if (stat.traits.includes("steadfast")) traits.push("士気を失いにくい");
  if (stat.traits.includes("antiCavalry")) traits.push("騎乗兵への攻撃が得意");
  if (stat.traits.includes("mounted")) traits.push("騎乗兵（槍兵に注意）");
  if (stat.role === "ranged") traits.push("敵の近接兵に隣接されると火力低下");
  return traits.join(" / ") || "兵種の役割を活かす基本の兵";
}

/** @param {object} item 設備。 @returns {string} 現在の公開設定に基づく効果。 */
export function codexEquipmentEffect(item) {
  if (item.attack) return "支援射撃";
  const names = { atk: "全兵員の攻撃力", def: "全兵員の防御力", meleeAtk: "近接兵の攻撃力", meleeDef: "近接兵の防御力", rangedAtk: "射撃兵の攻撃力", rangedDef: "射撃兵の防御力", supplyCap: "物資上限", troopCap: "兵員上限", foodReduction: "食料消費", upkeepReduction: "部隊維持費", shipUpkeepReduction: "船維持費", medics: "衛生兵効果", scouts: "斥候効果" };
  return Object.entries(item.effects).map(([key, value]) => `${names[key]}${key.endsWith("Reduction") ? "−" : "＋"}${value}${["medics", "scouts"].includes(key) ? `人分（兵員と合わせて最大${OUTFITTING_CONFIG.supportLimit}人分）` : "%"}`).join(" / ");
}

/** @param {object} ship 船種。 @returns {string} 固有効果と有効隻数の上限。 */
function shipEffect(ship) {
  const names = { upkeepReduction: "部隊維持費", shipUpkeepReduction: "船維持費", supplyCap: "物資上限", troopCap: "兵員上限", atk: "全兵員の攻撃力", def: "全兵員の防御力", hp: "全兵員のHP", supportPower: "支援射撃威力", baitSaving: "餌を消費しない確率" };
  const effects = Object.entries(ship.effects).map(([key, value]) => `${names[key]}${key.endsWith("Reduction") ? "−" : "＋"}${value}%／隻`);
  return effects.length ? `${effects.join(" / ")}（${ship.limit}隻まで有効）` : "固有効果なし・容量を重視した船";
}

/** @param {object} ship 船種。 @returns {object} 船を1隻追加する場合の公開値。 */
function shipMetrics(ship) {
  return { "購入価格": ship.price, "物資容量加算": ship.supplies, "兵員容量加算": ship.troops,
    "船維持費／隻・季節（軽減前）": ship.price * SHIP_UPKEEP_RATE, "固有効果": shipEffect(ship) };
}

/**
 * 現在の設定値と保有・取得記録から閲覧用の名簿を作る。未発見の固有船は名前・性能・来歴を返さない。
 * 海賊王の報酬船は討伐完了まで項目自体を返さず、検索・比較・個別表示でも情報を公開しない。
 * @param {string} tab 図鑑の分類。
 * @param {object} state 現在の状態。
 * @returns {object[]} 閲覧と比較に使う項目。
 */
export function assetCatalog(tab, state) {
  const history = collectAssetCodex(state);
  if (tab === "troops") return Object.entries(TROOP_STATS).sort(([a], [b]) => Number(a.startsWith("pirate_") || a === "raider_cavalry") - Number(b.startsWith("pirate_") || b === "raider_cavalry")).map(([id, stat]) => {
    const [role, description, hint] = TROOP_GUIDES[id];
    const suitability = Object.fromEntries(Object.entries(TERRAIN_LABELS).map(([key, name]) => [name, `${stat.terrain[key] ?? (key === "deck" ? stat.terrain.plain : undefined) ?? 100}%`]));
    return { id, tab, name: stat.name, category: stat.role, tag: role, description, hint, known: true,
      current: codexTroopCount(state.troops?.[id]), recorded: history.troops.includes(id),
      metrics: { "雇用費／人": stat.hire, "部隊維持費／人・季節（軽減前）": stat.upkeep, "基礎HP": stat.hp, "攻撃力": stat.atk, "防御力": stat.def,
        "攻撃間隔": `${stat.spd}カウント`, "射程": `${stat.range}マス`, "移動力": `${stat.move}マス`, "特性": troopTraits(stat) },
      terrain: suitability, note: "能力は兵種の基礎値です。" };
  });
  if (tab === "equipment") return Object.entries(OUTFITTING_ITEMS).map(([id, item]) => {
    const [category, description, hint] = EQUIPMENT_GUIDES[id];
    return { id, tab, name: item.name, category, categories: id === "expanded_hold" ? ["cargo", "troops"] : [category], tag: CODEX_LABELS[category], description, hint, known: true,
      current: state.expansion?.outfitting?.owned?.includes(id) ? 1 : 0, equipped: state.expansion?.outfitting?.equipped?.includes(id), recorded: history.equipment.includes(id),
      metrics: { "購入価格": item.price, "効果": codexEquipmentEffect(item), ...(item.attack ? { "発射間隔": `${item.attack.interval}カウント`, "威力": item.attack.power, "対象": item.attack.allEnemies ? "敵全部隊" : "敵1部隊" } : {}) },
      note: "装備すると効果が出ます。" };
  });
  if (tab === "variants") return Object.values(VARIANT_SHIPS).map((variant, index) => {
    const records = history.variants.filter(record => record.variantId === variant.id);
    const known = records.length > 0;
    if (!known) return { id: variant.id, tab, name: "未発見の固有船", category: "unknown", tag: `No.${String(index + 1).padStart(2, "0")}`, known: false, current: 0, recorded: false,
      description: "賞金首を討伐して固有船を入手すると、このページに名前・性能・来歴が記録されます。", metrics: {} };
    const ship = SHIP_TYPES[variant.base];
    return { id: variant.id, tab, base: variant.base, name: variant.name, category: "known", tag: `${ship.name}の固有船`, known: true, recorded: true,
      current: (state.fleet?.variants || []).filter(record => record.variantId === variant.id).length, records,
      description: "賞金首の船長から拿捕した一隻。通常船の特徴に加え、人や荷を運ぶ余裕を持つ。",
      hint: SHIP_GUIDES[variant.base][2], metrics: { ...shipMetrics(ship), "物資容量加算": ship.supplies + variant.supplies, "兵員容量加算": ship.troops + variant.troops },
      note: "通常船と固有効果の上限を共有します。" };
  });
  const ships = Object.entries(SHIP_TYPES).filter(([id]) => id !== "viking_ship" || state.pirateKingStory?.completed === true).map(([id, ship]) => {
    const [category, description, hint] = SHIP_GUIDES[id];
    const variants = (state.fleet?.variants || []).filter(record => VARIANT_SHIPS[record.variantId]?.base === id).length;
    return { id, tab: "ships", name: ship.name, category, categories: id === "carrack" ? ["cargo", "troops"] : [category], tag: CODEX_LABELS[category], known: true, description, hint,
      current: (state.fleet?.counts?.[id] || 0) + variants, recorded: history.ships.includes(id), metrics: shipMetrics(ship),
      note: "価格・容量・維持費は通常船1隻の値です。" };
  });
  return [{ id: "sacred", tab: "ships", name: "聖船", category: "sacred", tag: "旅のはじまり", known: true, current: 1, recorded: true,
    description: "潮語りの旅を支える、沈まぬ象徴。人と荷を抱え、航海録のはじまりから共にある。", hint: "通常船を持たないときも、聖船の基本容量で旅を始められます。",
    metrics: { "物資基本容量": BASE_SUPPLY_CAP, "兵員基本容量": BASE_TROOP_CAP, "船維持費": 0, "売買": "できません" }, note: "初めから旅を支える船です。" }, ...ships];
}

/** @param {object[]} entries 名簿。 @param {string} query 検索語。 @param {string} category 用途。 @returns {object[]} 名前・役割・用途に一致する項目。 */
export function filterAssetCatalog(entries, query, category) {
  const words = query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter(entry => (category === "all" || (entry.categories || [entry.category]).includes(category)) && words.every(word =>
    `${entry.name} ${entry.tag} ${(entry.categories || [entry.category]).map(id => CODEX_LABELS[id] || "").join(" ")}`.normalize("NFKC").toLocaleLowerCase().includes(word)));
}
