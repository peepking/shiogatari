const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** 実際の条件・記録・統計・画面操作を、世界と保存先のみ置換して検証する。 @returns {Promise<void>} 検証完了。 */
async function main() {
  const sites = [{ id: "v", kind: "village" }, { id: "t", kind: "town" }, { id: "p", kind: "town", pirateHaven: true }];
  const nodes = new Map();
  let writes = 0, saveOK = true, resetOptions, stopped = 0;
  const document = {
    activeElement: null,
    /** @param {string} id 要素ID。 @returns {object|null} 要素。 */
    getElementById(id) { return nodes.get(id) || null; },
    /** @param {object} event 通知。 */
    dispatchEvent(event) { if (event.type === "auto-move-stop") stopped++; },
  };
  const context = vm.createContext({ structuredClone, console, document,
    CustomEvent: class { /** @param {string} type 通知名。 */ constructor(type) { this.type = type; } } });
  const cache = new Map();
  /** 同期生成の共有キャッシュへ実モジュールまたは画面の代替を登録する。 @param {string} specifier モジュール名。 @returns {vm.Module} モジュール。 */
  function get(specifier) {
    const name = specifier.replace(/^\.\//, "");
    if (cache.has(name)) return cache.get(name);
    const mocks = {
      "map.js": { settlements: sites },
      "storage.js": { saveGameToStorage: () => { writes++; return saveOK; } },
      "dom.js": { pushToast: () => {} },
      "worldResetUI.js": { openWorldResetDialog: options => { resetOptions = options; } },
    };
    const exports = mocks[name];
    const module = exports ? new vm.SyntheticModule(Object.keys(exports),
      /** 公開値を設定する。 */
      function initialize() { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context })
      : new vm.SourceTextModule(readSource(name), { context, identifier: name });
    cache.set(name, module);
    return module;
  }
  const root = get("endingUI.js");
  await root.link(get); await root.evaluate();
  const { state, pending, resetState } = cache.get("state.js").namespace;
  const stats = cache.get("voyageStats.js").namespace;
  const { eligibleEndings, updateFinalVoyage, recordEnding, normalizeFinalVoyage, canOpenFinalVoyage } = cache.get("endings.js").namespace;
  const { ENDINGS } = cache.get("endingConfig.js").namespace;
  const { MODE_LABEL } = cache.get("constants.js").namespace;
  const { FISH_SPECIES } = cache.get("fishingConfig.js").namespace;
  const { normalizeFleet, addVariantShip } = cache.get("fleet.js").namespace;
  /** @param {string} id 結末。 @returns {boolean} 現在条件の成立。 */
  const eligible = id => eligibleEndings(state, sites).includes(id);
  assert.equal(ENDINGS.length, 11);
  for (const ending of ENDINGS) { assert.ok(ending.body.length >= 200 && ending.body.length <= 300); assert.doesNotMatch(ending.body + ending.description, /\d/); }
  assert.equal(state.voyageStats.partial, false);
  assert.equal(state.assetCodex.partial, false);
  assert.ok(state.assetCodex.troops.includes("infantry"));
  assert.equal(state.voyageStats.income, 0, "初期所持金は収入に含めない");
  state.fame = 3000; state.wanted.byFaction.north.amount = 100000;
  assert.equal(eligible("awe"), false);
  state.wanted.byFaction.archipelago.amount = 1;
  assert.equal(eligible("awe"), true);
  state.fame = 2999; assert.equal(eligible("awe"), false); state.fame = 3000;
  state.wanted.byFaction.north.amount = 0; state.wanted.byFaction.archipelago.amount = 0;
  state.voyageStats.wantedEarned = 1000000; assert.equal(eligible("awe"), false, "累計賞金は解放条件へ流用しない");
  for (let i = 0; i < 19; i++) addVariantShip(state, "gull", "検証", 120001);
  assert.equal(eligible("hunt"), false); const variant = addVariantShip(state, "gull", "検証", 120001);
  assert.equal(eligible("hunt"), true, "同じ船種も個体単位で数える");
  stats.recordVariant(state, variant.id); assert.equal(state.voyageStats.variantsAcquired, 20);
  state.funds = 1000000; state.fleet.counts.cog = 29; assert.equal(eligible("dismantling"), false);
  state.fleet.counts.cog = 30; assert.equal(eligible("dismantling"), true);
  state.funds--; assert.equal(eligible("dismantling"), false); state.funds++;
  state.fame = 5000; state.troops = { infantry: { 1: 249, 3: 250 } };
  assert.equal(eligible("rise"), false); state.troops.archer = { 1: 1 }; assert.equal(eligible("rise"), true);
  state.fame--; assert.equal(eligible("rise"), false); state.fame++;
  state.faith = 500; state.tideAlliance.sites = { v: { funds: 200000, people: 50 }, missing: { funds: 200000, people: 50 } };
  assert.equal(eligible("merging"), false, "存在しない神殿は数えない");
  state.tideAlliance.sites.t = { funds: 200000, people: 49 }; assert.equal(eligible("merging"), false);
  state.tideAlliance.sites.t.people++; assert.equal(eligible("merging"), true);
  state.faith--; assert.equal(eligible("merging"), false); state.faith++;
  state.year = 1099; state.season = 3; state.day = 30; assert.equal(eligible("great_voyage"), false);
  state.year = 1100; state.season = 0; state.day = 1; assert.equal(eligible("great_voyage"), true);
  for (const fish of FISH_SPECIES) state.expansion.fishing.codex[fish.id] = { count: 1 };
  assert.equal(eligible("collection"), true); state.expansion.fishing.codex[FISH_SPECIES[0].id].count = 0;
  assert.equal(eligible("collection"), false); state.expansion.fishing.codex[FISH_SPECIES[0].id].count = 1;
  state.voyageStats.refugeesRescued = 299; assert.equal(eligible("salvation"), false);
  stats.recordVoyage(state, "refugeesRescued", 1); assert.equal(eligible("salvation"), true);
  state.voyageStats.chartsCompleted = 9; assert.equal(eligible("discovery"), false);
  stats.recordVoyage(state, "chartsCompleted", 1); assert.equal(eligible("discovery"), true);
  for (const site of sites) stats.recordVisit(state, site);
  stats.recordVisit(state, sites[0]); assert.equal(state.voyageStats.visited.length, 3);
  assert.equal(eligible("exploration"), true); assert.equal(eligibleEndings(state, []).includes("exploration"), false);
  assert.equal(eligibleEndings(state, [...sites, { id: "new", kind: "village" }]).includes("exploration"), false);
  state.wanted.byFaction.north.amount = 100001;
  assert.equal(updateFinalVoyage(state, sites).length, 10);
  assert.equal(updateFinalVoyage(state, sites).length, 0, "再描画で再解放しない");
  const record = recordEnding(state, "hunt", sites);
  const original = JSON.stringify(record);
  stats.receiveFunds(state, 100); state.fleet = normalizeFleet(); state.fame = 0; state.faith = 0; state.troops = {};
  state.voyageStats.visited = [];
  assert.equal(updateFinalVoyage(state, sites).length, 0);
  assert.equal(Object.keys(state.finalVoyage.unlocked).length, 10, "資産が減っても解放を保持する");
  assert.equal(recordEnding(state, "hunt", sites), record);
  assert.equal(JSON.stringify(record), original, "再閲覧で初回統計を変えない");
  const restored = normalizeFinalVoyage(JSON.parse(JSON.stringify(state.finalVoyage)));
  assert.equal(JSON.stringify(restored.records.hunt), original, "読込後も当時の図鑑・訪問数・統計を維持する");
  const damaged = normalizeFinalVoyage({ unlocked: { hunt: 1, unknown: 1 }, records: { hunt: { day: 1, snapshot: { version: 1, income: -1, fishSpecies: 100, fishTotal: 2, losses: { battle: -1 } } } } });
  assert.equal(damaged.records.hunt.snapshot.income, 0); assert.equal(damaged.records.hunt.snapshot.fishSpecies, 2);
  assert.equal(damaged.records.hunt.snapshot.losses.battle, 0); assert.equal(damaged.unlocked.unknown, undefined);
  const old = stats.normalizeVoyageStats(undefined, state);
  assert.equal(old.partial, true); assert.equal(old.income, 0); assert.equal(old.startedAbs, 120001);
  assert.equal(old.measuredAbs, 132001); assert.equal(old.refugeesRescued, 0);
  assert.equal(old.chartsCompleted, 0);
  const beforeChartStats = structuredClone(state.voyageStats);
  delete beforeChartStats.chartsCompleted;
  const supplemented = stats.normalizeVoyageStats(beforeChartStats, state);
  assert.equal(supplemented.chartsCompleted, 0, "既存の航海統計でも未計測の海図総数を推定しない");
  assert.equal(supplemented.income, state.voyageStats.income);
  state.modeLabel = MODE_LABEL.NORMAL;
  assert.equal(canOpenFinalVoyage(state, pending), true);
  for (const key of ["exploration", "charts", "fishing"]) { state.expansion[key].pending = {}; assert.equal(canOpenFinalVoyage(state, pending), false); state.expansion[key].pending = null; }
  state.pendingEncounter.active = true; assert.equal(canOpenFinalVoyage(state, pending), false); state.pendingEncounter.active = false;
  state.eventQueue.push({}); assert.equal(canOpenFinalVoyage(state, pending), false); state.eventQueue = [];
  pending.kind = "intensity"; assert.equal(canOpenFinalVoyage(state, pending), false); pending.kind = null;
  state.wanted.detention = {}; assert.equal(canOpenFinalVoyage(state, pending), false); state.wanted.detention = null;
  assert.equal(eligible("sea"), false);
  state.pirateKingStory.completed = true;
  state.voyageStats.chartsCompleted = 9;
  assert.equal(eligible("sea"), true);
  assert.equal(eligible("discovery"), false, "海賊王の討伐では探奥神話の件数を増やさない");
  assert.equal(updateFinalVoyage(state, sites).length, 1);
  state.pirateKingStory.completed = false;
  assert.equal(updateFinalVoyage(state, sites).length, 0);
  assert.ok(state.finalVoyage.unlocked.sea, "海没神話の解放は維持する");
  state.assetCodex.equipment.push("cannon");
  state.assetCodex.variants.push({ id: 1, variantId: "gull", sourceName: "前の旅", acquiredAbs: 120001 });
  resetState(); stats.receiveFunds(state, 150); stats.spendFunds(state, 50, "trade"); stats.spendFunds(state, 2000, "upkeep");
  assert.equal(state.assetCodex.equipment.length, 0, "新しい旅で取得記録を初期化する");
  assert.equal(state.assetCodex.variants.length, 0);
  assert.equal(state.voyageStats.income, 150); assert.equal(state.voyageStats.expenses.trade, 50);
  assert.equal(state.voyageStats.expenses.upkeep, 1100, "支払えた金額だけ記録する");
  stats.receiveFaith(state, 30); state.faith -= 5; assert.equal(state.voyageStats.faithEarned, 30);
  stats.recordTroopLoss(state, 3, "battle"); stats.recordTroopLoss(state, 2, "food"); stats.recordTroopLoss(state, 4, "upkeep");
  stats.recordTroopLoss(state, 1, "calamity"); stats.recordTroopLoss(state, 2, "unknown");
  assert.equal(Object.values(state.voyageStats.losses).reduce((a, b) => a + b, 0), 12);
  for (const invalid of [-1, 0, NaN, Infinity, 1.5]) stats.recordVoyage(state, "income", invalid);
  assert.equal(state.voyageStats.income, 150);
  stats.recordVoyageFish(state, FISH_SPECIES[0], 30); stats.recordVoyageFish(state, FISH_SPECIES[1], 30); stats.recordVoyageFish(state, FISH_SPECIES[1], 50);
  assert.equal(state.voyageStats.fishCaught, 3); assert.equal(state.voyageStats.largestFish.id, FISH_SPECIES[1].id);
  const { recordCrime, expireWanted, totalWanted } = cache.get("playerWanted.js").namespace;
  const { CRIME_REWARDS, BOUNTY_CONFIG } = cache.get("bountyConfig.js").namespace;
  const crimeKind = Object.keys(CRIME_REWARDS)[0], action = {};
  recordCrime(state, crimeKind, action, 120001, "north");
  recordCrime(state, crimeKind, action, 120001, "north");
  assert.equal(state.voyageStats.wantedEarned, CRIME_REWARDS[crimeKind], "同じ犯罪の再処理では累計賞金を増やさない");
  expireWanted(state.wanted, 120001 + BOUNTY_CONFIG.lifetime);
  assert.equal(totalWanted(state.wanted), 0); assert.equal(state.voyageStats.wantedEarned, CRIME_REWARDS[crimeKind]);
  for (const name of ["shipyard.js", "shipUpkeep.js"]) { const module = get(name); await module.link(get); await module.evaluate(); }
  const { tradeShip, shipTradePrice } = cache.get("shipyard.js").namespace;
  state.funds = 100000;
  const yard = { id: "yard", kind: "town", factionId: "north", shipyard: { stock: { cog: 4 }, variants: [] } };
  const beforeTrade = state.voyageStats.income;
  assert.equal(tradeShip(state, yard, "cog", "buy", 2).error, undefined);
  assert.equal(tradeShip(state, yard, "cog", "sell", 1).error, undefined);
  assert.equal(state.voyageStats.income, beforeTrade + shipTradePrice("cog", "sell"), "売却代金は純利益にせず収入として数える");
  const acquired = addVariantShip(state, "gull", "検証", 120001);
  assert.equal(tradeShip(state, yard, `variant:${acquired.id}`, "sell", 1).error, undefined);
  assert.equal(tradeShip(state, yard, `variant:${acquired.id}`, "buy", 1).error, undefined);
  assert.equal(state.voyageStats.variantsAcquired, 1, "固有船の実際の買い戻しでも獲得個体数を重複しない");
  state.funds = 0;
  const beforeUpkeepIncome = state.voyageStats.income, beforeUpkeepExpense = state.voyageStats.expenses.upkeep;
  const payment = cache.get("shipUpkeep.js").namespace.payShipUpkeep(state, 100);
  assert.ok(payment.sold.length > 0);
  assert.equal(state.voyageStats.income, beforeUpkeepIncome + payment.sold.reduce((sum, row) => sum + row.proceeds, 0));
  assert.equal(state.voyageStats.expenses.upkeep, beforeUpkeepExpense + 100, "自動換金の収入と支払いを別々に数える");

  /** 操作通知と焦点を持つ最低限の要素を作る。 @param {string} id 要素ID。 @returns {object} 要素。 */
  function node(id) {
    const handlers = new Map();
    const element = { hidden: true, disabled: false, dataset: {}, innerHTML: "",
      /** @param {string} type 操作名。 @param {Function} handler 処理。 */
      addEventListener(type, handler) { handlers.set(type, handler); },
      /** @param {string} type 操作名。 @param {object} extra 通知。 */
      fire(type, extra = {}) { handlers.get(type)?.({ target: element, preventDefault() {}, ...extra }); },
      /** 焦点を移す。 */ focus() { document.activeElement = element; },
      /** @returns {Array} ダイアログ内のボタン。 */ querySelectorAll() { return [nodes.get("finalVoyageClose"), nodes.get("finalVoyageContinue"), nodes.get("finalVoyageRestart")]; },
    }; nodes.set(id, element); return element;
  }
  for (const id of ["finalVoyageBtn", "finalVoyageModal", "finalVoyageBody", "finalVoyageClose", "finalVoyageContinue", "finalVoyageRestart"]) node(id);
  const ui = root.namespace;
  ui.wireFinalVoyageUI(); ui.wireFinalVoyageUI(); ui.renderFinalVoyageControl();
  assert.equal(nodes.get("finalVoyageBtn").hidden, true);
  state.fame = 5000; state.troops = { infantry: { 1: 500 } }; state.voyageStats.refugeesRescued = 300;
  ui.renderFinalVoyageControl(); assert.equal(nodes.get("finalVoyageBtn").hidden, false);
  nodes.get("finalVoyageBtn").fire("click"); assert.equal(nodes.get("finalVoyageModal").hidden, false);
  assert.match(nodes.get("finalVoyageBody").innerHTML, /data-ending="rise"/); assert.match(nodes.get("finalVoyageBody").innerHTML, /data-ending="salvation"/);
  assert.equal(Object.keys(state.finalVoyage.records).length, 0, "選択一覧を開くだけでは結末を記録しない");
  /** @param {string} action 選択操作。 @param {string} id 結末ID。 */
  function clickBody(action, id) { nodes.get("finalVoyageBody").fire("click", { target: { closest: () => ({ dataset: id ? { ending: id } : {}, hasAttribute: key => key === action }) } }); }
  saveOK = false; clickBody(null, "rise"); assert.match(nodes.get("finalVoyageBody").innerHTML, /保存を再試行/);
  assert.match(nodes.get("finalVoyageBody").innerHTML, /累計兵士損耗/); assert.equal(writes, 1);
  assert.match(nodes.get("finalVoyageBody").innerHTML, /海図の達成数/);
  saveOK = true; clickBody("data-ending-save"); assert.doesNotMatch(nodes.get("finalVoyageBody").innerHTML, /保存を再試行/);
  const firstIncome = state.finalVoyage.records.rise.snapshot.income;
  stats.receiveFunds(state, 100); clickBody("data-ending-stats"); assert.match(nodes.get("finalVoyageBody").innerHTML, /現在の航海/);
  assert.equal(state.finalVoyage.records.rise.snapshot.income, firstIncome);
  nodes.get("finalVoyageRestart").fire("click"); assert.equal(nodes.get("finalVoyageModal").hidden, true);
  resetOptions.onCancel(); assert.equal(nodes.get("finalVoyageModal").hidden, false);
  const beforeContinue = JSON.stringify(state);
  nodes.get("finalVoyageContinue").fire("click"); assert.equal(nodes.get("finalVoyageModal").hidden, true);
  assert.equal(JSON.stringify(state), beforeContinue, "続行は時間も資産も消費しない"); assert.equal(stopped, 1);
  resetState(); ui.renderFinalVoyageControl();
  assert.equal(state.voyageStats.income, 0); assert.equal(state.voyageStats.partial, false);
  assert.equal(state.voyageStats.chartsCompleted, 0);
  assert.equal(Object.keys(state.finalVoyage.unlocked).length, 0); assert.equal(Object.keys(state.finalVoyage.records).length, 0);
  assert.equal(nodes.get("finalVoyageBtn").hidden, true);
  console.log("最終航海: 11神話の境界・永続解放・初回統計・旧保存・原因別損耗・選択/続行/再出発/保存再試行: 成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
