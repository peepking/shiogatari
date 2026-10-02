const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @returns {void} 閲覧に不要な画面・操作の代替。 */
function unused() {}

/** @returns {Promise<void>} 実設定の網羅、非公開情報、現在数と過去記録を検証する。 */
async function main() {
  const context = vm.createContext({});
  const cache = new Map();
  const mocks = {
    "state.js": { state: {} },
    "quantityUI.js": { quantityControl: unused, wireQuantityControls: unused, refreshQuantity: unused },
    "dom.js": { confirmAction: unused, pushLog: unused, pushToast: unused },
    "upkeep.js": { renderUpkeepForecast: unused },
    "outfitting.js": { getOutfittingEffects: unused, applyCapacityBonus: unused },
    "fleet.js": { fleetEffects: unused },
    "voyageStats.js": { recordTroopLoss: unused },
    "faith.js": { faithEffects: unused },
    "faction.js": { getPlayerFactionId: unused, getSupportLabel: unused, getWarEntry: unused, getWarScoreLabel: unused },
    "resourceUI.js": { resourceIcon: unused },
  };
  /** @param {string} specifier 依存名。 @returns {vm.Module} 実モジュールまたは画面の代替。 */
  function get(specifier) {
    const name = specifier.replace(/^\.\//, "");
    if (!cache.has(name)) {
      const exports = mocks[name];
      const module = exports ? new vm.SyntheticModule(Object.keys(exports),
        /** @returns {void} 代替の公開値を設定する。 */
        function initialize() { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context })
        : new vm.SourceTextModule(readSource(name), { context, identifier: name });
      cache.set(name, module);
    }
    return cache.get(name);
  }
  const root = get("assetCatalog.js");
  await root.link(get); await root.evaluate();
  const { assetCatalog, filterAssetCatalog } = root.namespace;
  const { collectAssetCodex, normalizeAssetCodex } = cache.get("assetCodex.js").namespace;
  const { TROOP_STATS } = cache.get("troops.js").namespace;
  const { SHIP_TYPES } = cache.get("shipConfig.js").namespace;
  const { OUTFITTING_ITEMS } = cache.get("expansionConfig.js").namespace;
  const { VARIANT_SHIPS } = cache.get("variantShips.js").namespace;
  const state = { troops: { infantry: { 1: 3, 4: 2 }, seaArcher: 4, shield: { 1: 0 } },
    fleet: { counts: { cog: 2 }, variants: [{ id: 1, variantId: "gull", sourceName: "取得時の船長", acquiredAbs: 120001 }] },
    expansion: { outfitting: { owned: ["cannon"], equipped: ["cannon"] } } };
  const before = JSON.stringify(state);
  const history = collectAssetCodex(state);
  assert.equal(JSON.stringify(state), before, "閲覧・候補作成では保存状態を変更しない");
  assert.equal(history.partial, true);
  assert.ok(history.troops.includes("seaArcher"));
  assert.ok(!history.troops.includes("shield"));
  assert.ok(history.ships.includes("caravel"), "固有船も基本船種の取得記録に含める");
  assert.equal(normalizeAssetCodex({ troops: ["infantry", "infantry", null, "<script>"] }).troops.length, 1);
  const troops = assetCatalog("troops", state);
  assert.equal(troops.length, Object.keys(TROOP_STATS).length);
  assert.equal(troops.find(entry => entry.id === "infantry").current, 5);
  assert.equal(troops.find(entry => entry.id === "shield").recorded, false);
  for (const entry of troops) {
    assert.ok(entry.description && entry.hint);
    assert.equal(entry.metrics["雇用費／人"], TROOP_STATS[entry.id].hire);
    assert.equal(entry.metrics["攻撃力"], TROOP_STATS[entry.id].atk);
    assert.equal(Object.keys(entry.terrain).length, 6);
  }
  const ships = assetCatalog("ships", state);
  assert.equal(ships.length, Object.keys(SHIP_TYPES).length, "海賊王討伐前は報酬船を除き、聖船を加える");
  assert.ok(!ships.some(entry => entry.id === "viking_ship"));
  assert.equal(filterAssetCatalog(ships, SHIP_TYPES.viking_ship.name, "all").length, 0, "討伐前は船名で検索しても公開しない");
  assert.ok(!assetCatalog("ships", { ...state, fleet: { counts: { viking_ship: 1 } } }).some(entry => entry.id === "viking_ship"), "手動で所持しても討伐完了までは公開しない");
  const completed = { ...state, pirateKingStory: { completed: true }, fleet: { counts: { viking_ship: 1 }, variants: [] } };
  const revealed = assetCatalog("ships", completed);
  assert.equal(revealed.length, Object.keys(SHIP_TYPES).length + 1);
  const rewardShip = revealed.find(entry => entry.id === "viking_ship");
  assert.equal(rewardShip.name, SHIP_TYPES.viking_ship.name);
  assert.equal(rewardShip.known, true);
  assert.equal(rewardShip.metrics["物資容量加算"], 100);
  assert.equal(rewardShip.metrics["兵員容量加算"], 50);
  assert.ok(rewardShip.metrics["固有効果"].includes("HP＋20%"));
  completed.assetCodex = collectAssetCodex(completed);
  completed.fleet.counts.viking_ship = 0;
  const soldReward = assetCatalog("ships", completed).find(entry => entry.id === "viking_ship");
  assert.equal(soldReward.current, 0);
  assert.equal(soldReward.recorded, true, "討伐後は売却しても公開・取得記録を維持する");
  assert.ok(!assetCatalog("ships", {}).some(entry => entry.id === "viking_ship"), "新しい旅では再び非公開");
  assert.equal(ships.find(entry => entry.id === "caravel").current, 1);
  assert.equal(ships.find(entry => entry.id === "sacred").metrics["物資基本容量"], cache.get("supplies.js").namespace.BASE_SUPPLY_CAP);
  const equipment = assetCatalog("equipment", state);
  assert.equal(equipment.length, Object.keys(OUTFITTING_ITEMS).length);
  assert.equal(equipment.find(entry => entry.id === "cannon").equipped, true);
  assert.equal(equipment.find(entry => entry.id === "fire_ballista").metrics["威力"], 180);
  assert.equal(equipment.find(entry => entry.id === "cannon").metrics["威力"], 300);
  for (const entry of equipment) {
    assert.ok(entry.description && entry.hint);
    assert.equal(entry.metrics["購入価格"], OUTFITTING_ITEMS[entry.id].price);
    assert.ok(!entry.metrics["効果"].includes("undefined"));
  }
  assert.equal(filterAssetCatalog(troops, "海賊 射撃", "all")[0].id, "pirate_archer");
  assert.equal(filterAssetCatalog(troops, "存在しない兵", "all").length, 0);
  assert.ok(filterAssetCatalog(equipment, "", "troops").some(entry => entry.id === "expanded_hold"));
  const variants = assetCatalog("variants", state);
  assert.equal(variants.length, Object.keys(VARIANT_SHIPS).length);
  const hidden = variants.find(entry => entry.id === "red_sail");
  assert.equal(hidden.known, false);
  assert.equal(Object.keys(hidden.metrics).length, 0);
  assert.equal(hidden.records, undefined);
  assert.equal(filterAssetCatalog(variants, VARIANT_SHIPS.red_sail.name, "all").length, 0, "未発見船は隠した名前で検索できない");

  // 保存が確定した後は、売却・喪失・解雇で現在数がゼロになっても記録を残す。
  state.assetCodex = history;
  state.troops = {}; state.fleet = { counts: {}, variants: [] };
  state.expansion.outfitting = { owned: [], equipped: [] };
  const lost = assetCatalog("variants", state).find(entry => entry.id === "gull");
  assert.equal(lost.known, true); assert.equal(lost.current, 0);
  assert.equal(lost.records[0].sourceName, "取得時の船長");
  assert.equal(lost.records[0].acquiredAbs, 120001);
  assert.equal(assetCatalog("troops", state).find(entry => entry.id === "seaArcher").recorded, true);
  assert.equal(assetCatalog("equipment", state).find(entry => entry.id === "cannon").recorded, true);
  state.fleet.variants.push({ id: 1, variantId: "gull", sourceName: "買取時の別名", acquiredAbs: 120002 });
  const again = collectAssetCodex(state);
  assert.equal(again.variants.length, 1);
  assert.equal(again.variants[0].sourceName, "取得時の船長");
  again.variants[0].sourceName = "候補の変更";
  assert.equal(state.assetCodex.variants[0].sourceName, "取得時の船長", "候補と確定した記録を共有しない");
  console.log("兵・船・艤装の図鑑: 網羅・海賊王討伐前の秘匿と討伐後の公開・取得記録・検索の検証成功");
}

/** @param {Error} error 検証失敗。 @returns {void} 失敗を報告する。 */
function reportFailure(error) { console.error(error); process.exitCode = 1; }
main().catch(reportFailure);
