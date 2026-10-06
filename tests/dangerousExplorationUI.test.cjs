/* eslint-env node */
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @returns {Promise<void>} 専用探索の保存失敗・固定敵再開・旧通常地点の報酬維持を確認する。 */
async function main() {
  const button = {}, info = {}, calls = { day: 0, normalEnemy: 0, dangerousEnemy: 0, finish: 0 };
  let confirmation = null, saveFails = false, reserved = null, hazardOnDay = false, scoutCount = 0, failAfterDay = false, saveCalls = 0, failSaveAt = null;
  const state = { year: 0, season: 0, day: 1, modeLabel: "normal", position: { x: 49, y: 49 }, fleet: {}, funds: 0, supplies: {}, troops: {}, pendingEncounter: null,
    expansion: { exploration: { sites: [], pending: null }, charts: { active: [], pending: null } },
    dangerousSeas: { nextSiteId: 2, explorationPending: null, action: null, regions: { sw: { sites: [] }, se: { sites: [{ id: 1, regionId: "se", kind: "wreck", position: { x: 49, y: 49 }, level: "core", profile: "danger_core", version: 1, danger: 1, spawnedAbs: 1, expiresAbs: 121 }] } } } };
  const initialSite = JSON.parse(JSON.stringify(state.dangerousSeas.regions.se.sites[0]));
  /** @returns {object} 通常探索の上端報酬。 */
  function normalReward() { return { funds: 1100, supplies: { brew: 8 }, troops: { infantry: 5 }, ships: 0, fragment: false }; }
  /** @returns {object|null} 通常の途中探索を消費する。 */
  function consumeNormal(data, success) {
    const pending = data.pending;
    data.pending = null;
    data.sites = data.sites.filter(site => site.id !== pending.siteId);
    return success ? pending.reward : null;
  }
  /** @returns {object} 固定した精鋭編成。 */
  function enemy() { return { formation: [{ type: "infantry", count: 10, level: 3 }], total: 10, strength: "elite" }; }
  const mapData = Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => ({ terrain: "sea", building: "none" })));
  const stubs = {
    "./voyageStats.js": { receiveFunds: (game, amount) => { game.funds += amount; } },
    "./state.js": { state }, "./constants.js": { MODE_LABEL: { NORMAL: "normal", PREP: "prep", BATTLE: "battle" } },
    "./map.js": { mapData, snapshotWorld: () => ({}), restoreWorld: () => true }, "./questUtils.js": { absDay: () => state.day },
    "./time.js": { advanceDayWithEvents: () => { calls.day++; state.day++; if (hazardOnDay) state.dangerousSeas.pendingHazard = { id: 99, kind: "wave", stage: "action_running" }; if (failAfterDay) saveFails = true; return 1; } },
    "./actions.js": { buildEnemyFormation: () => { calls.normalEnemy++; return enemy(); }, buildDangerousEnemyFormation: () => { calls.dangerousEnemy++; return enemy(); } },
    "./storage.js": { saveGameToStorage: () => { saveCalls++; return !saveFails && saveCalls !== failSaveAt; } },
    "./dom.js": { elements: {}, confirmAction: options => { confirmation = options; }, pushLog: () => {}, pushToast: () => {} },
    "./events.js": { enqueueEvent: () => {} }, "./supplies.js": { SUPPLY_ITEMS: [{ id: "brew", name: "酒", type: "processed" }], SUPPLY_TYPES: { processed: "processed" }, formatSupplyDisplay: () => ({ total: Object.values(state.supplies).reduce((sum, qty) => sum + qty, 0), cap: 60 }) },
    "./troops.js": { addTroops: (id, level, amount) => { state.troops[id] = (state.troops[id] || 0) + amount; (calls.troopLevels ||= []).push(level); }, TROOP_STATS: { infantry: { name: "歩兵" } }, formatTroopDisplay: () => ({ total: Object.values(state.troops).reduce((sum, qty) => sum + qty, 0), cap: 30 }) },
    "./chartWorld.js": { awardExplorationFragment: () => { calls.fragment = (calls.fragment || 0) + 1; } },
    "./outfitting.js": { snapshotOutfitting: () => ({ scouts: scoutCount }) },
    "./exploration.js": { initializeExploration: (data, map, day, blocked) => { reserved = blocked; }, tickExploration: () => {}, describeDanger: chance => `${chance * 100}%`,
      rollExplorationReward: normalReward, consumeExploration: consumeNormal, EXPLORATION_NAMES: { wreck: "難破船", drift: "漂流物" } },
    "./dangerousSeaWorld.js": { getDangerousSeaPositions: id => id === "se" ? [{ x: 49, y: 49, level: "core" }] : [] },
    "./dangerousSeaHazards.js": {
      dangerousSeaActionBlocked: () => !!(state.dangerousSeas.action || state.dangerousSeas.explorationPending || state.dangerousSeas.pendingHazard),
      beginDangerousSeaAction: kind => { if (state.dangerousSeas.action) return false; state.dangerousSeas.action = { kind }; return 1; },
      finishDangerousSeaAction: kind => { assert.equal(kind, "exploration"); state.dangerousSeas.action = null; if (state.dangerousSeas.pendingHazard?.stage === "action_running") state.dangerousSeas.pendingHazard.stage = "ready"; calls.finish++; },
    },
    "./fleet.js": { addShips: () => {}, prepareShipReward: reward => reward, shipListText: () => "" },
  };
  const nodes = { exploreBtn: button, exploreInfo: info };
  /** @returns {object} 選択行を表示する最小画面要素。 */
  function element() {
    return { children: [],
      /** @param {object} node 子要素。 @returns {void} 子を追加する。 */
      append(node) { this.children.push(node); },
      /** @param {string} value 表示内容。 @returns {void} 古い選択肢を消す。 */
      set innerHTML(value) { this.children = []; this.html = value; } };
  }
  /** @param {object} node 選択行。 @returns {void} 探索ボタンの後に置く。 */
  button.after = node => { nodes[node.id] = node; };
  let randomValue = 0.999999;
  const math = Object.create(Math); math.random = () => randomValue;
  const context = vm.createContext({ structuredClone, document: { getElementById: id => nodes[id] || null, createElement: element, dispatchEvent: () => {} }, CustomEvent: class {}, Math: math });
  const modules = new Map();
  /** @param {string} name モジュール名。 @returns {Promise<vm.Module>} 検証用モジュール。 */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const exports = stubs[name];
    const module = exports ? new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context })
      : new vm.SourceTextModule(readSource(name), { context });
    modules.set(name, module);
    await module.link(load);
    return module;
  }
  const module = await load("./explorationUI.js"); await module.evaluate();
  const { renderExplorationControl, resumeExploration, finishExploration, updateExplorationWorld, chooseDangerousWreckBranch } = module.namespace;
  updateExplorationWorld();
  assert.equal(reserved.has("49,49"), true);
  renderExplorationControl(() => {});
  assert.equal(button.hidden, false);
  assert.ok(info.textContent.includes("核心"));
  saveFails = true;
  button.onclick(); confirmation.onConfirm();
  assert.equal(state.dangerousSeas.explorationPending, null);
  assert.equal(state.dangerousSeas.action, null);
  assert.equal(state.day, 1);
  assert.equal(state.dangerousSeas.regions.se.sites.length, 1);
  saveFails = false;
  renderExplorationControl(() => {});
  button.onclick(); confirmation.onConfirm();
  assert.equal(state.day, 2);
  assert.equal(state.dangerousSeas.explorationPending.reward.funds, 3300);
  assert.equal(state.dangerousSeas.explorationPending.dayApplied, true);
  assert.equal(state.pendingEncounter.dangerousExplorationId, 1);
  assert.equal(state.pendingEncounter.dangerousRegionId, "se");
  assert.equal(state.pendingEncounter.explorationId, undefined);
  state.pendingEncounter = null;
  resumeExploration(() => {});
  assert.equal(state.day, 2);
  assert.equal(calls.day, 1);
  assert.equal(state.pendingEncounter.enemyTotal, 10);
  finishExploration(true);
  assert.equal(state.funds, 3300);
  assert.equal(state.supplies.brew, 24);
  assert.equal(state.troops.infantry, undefined, "救助兵は船倉の救助を選んだ場合だけ得る");
  assert.equal(state.dangerousSeas.explorationPending.wreck.stage, "choice");
  assert.equal(state.dangerousSeas.regions.se.sites.length, 1);
  assert.equal(state.dangerousSeas.action, null);
  assert.equal(finishExploration(true).length, 0);
  assert.equal(state.funds, 3300);
  state.pendingEncounter = null; state.modeLabel = "normal";
  renderExplorationControl(() => {});
  assert.equal(nodes.dangerousWreckChoices.hidden, false);
  assert.equal(nodes.dangerousWreckChoices.children.filter(node => node.onclick).length, 3);
  const fixedBranches = JSON.stringify(state.dangerousSeas.explorationPending.wreck.branches);
  state.dangerousSeas.pendingHazard = { id: 98, kind: "raid", stage: "ready" };
  assert.equal(chooseDangerousWreckBranch("cargo", () => {}), false);
  resumeExploration(() => {});
  assert.equal(state.dangerousSeas.explorationPending.pausedForHazard, true);
  assert.equal(state.day, 2);
  assert.equal(JSON.stringify(state.dangerousSeas.explorationPending.wreck.branches), fixedBranches);
  state.dangerousSeas.pendingHazard = null;
  resumeExploration(() => {});
  assert.equal(state.dangerousSeas.explorationPending.pausedForHazard, false);
  saveFails = true;
  assert.equal(chooseDangerousWreckBranch("cargo", () => {}), false);
  assert.equal(state.dangerousSeas.explorationPending.wreck.stage, "choice");
  assert.equal(state.day, 2);
  saveFails = false; hazardOnDay = true;
  assert.equal(chooseDangerousWreckBranch("cargo", () => {}), true);
  assert.equal(state.day, 3);
  assert.equal(state.funds, 3300, "追加日の危険が済むまでは積荷の報酬を受け取らない");
  assert.equal(state.dangerousSeas.explorationPending.wreck.choice, "cargo");
  assert.equal(state.dangerousSeas.explorationPending.dayApplied, true);
  assert.equal(state.dangerousSeas.explorationPending.pausedForHazard, true);
  assert.equal(state.dangerousSeas.pendingHazard.stage, "ready");
  const restoreRules = (await load("./dangerousSeaExploration.js")).namespace;
  state.dangerousSeas = restoreRules.validateDangerousExploration(JSON.parse(JSON.stringify(state.dangerousSeas)));
  assert.equal(state.dangerousSeas.explorationPending.wreck.choice, "cargo");
  assert.equal(chooseDangerousWreckBranch("rescue", () => {}), false);
  state.dangerousSeas.pendingHazard = null; hazardOnDay = false;
  resumeExploration(() => {});
  assert.equal(state.day, 3, "危険解決後は追加日数を再適用しない");
  assert.equal(state.funds, 4950);
  assert.equal(state.supplies.brew, 36);
  assert.equal(state.dangerousSeas.explorationPending, null);
  assert.equal(state.dangerousSeas.regions.se.sites.length, 0);
  assert.equal(finishExploration(true).length, 0);
  assert.equal(state.funds, 4950);
  state.expansion.exploration.sites = [{ id: 20, kind: "wreck", position: { x: 49, y: 49 }, danger: 0, expiresAbs: 200 }];
  renderExplorationControl(() => {});
  button.onclick(); confirmation.onConfirm();
  assert.equal(state.funds, 6050);
  assert.equal(calls.dangerousEnemy, 2);
  assert.equal(calls.normalEnemy, 0);
  assert.ok(calls.finish >= 3);
  assert.equal(state.expansion.exploration.pending, null);
  /** @param {number} id 地点ID。 @param {number} [danger=0.75] 甲板の戦闘率。 @returns {void} 新しい難破船を開始する。 */
  function startWreck(id, danger = 0.75) {
    state.pendingEncounter = null; state.modeLabel = "normal";
    state.dangerousSeas.pendingHazard = null;
    state.dangerousSeas.regions.se.sites = [{ ...initialSite, id, danger }];
    renderExplorationControl(() => {}); button.onclick(); confirmation.onConfirm();
  }
  scoutCount = 10; startWreck(30);
  const afterDeck = state.funds, beforeAdditionalDay = state.day;
  assert.equal(state.dangerousSeas.explorationPending.wreck.scouts, 10);
  failAfterDay = true;
  assert.equal(chooseDangerousWreckBranch("cargo", () => {}), true);
  assert.equal(state.day, beforeAdditionalDay, "追加日の保存失敗では日付を巻き戻す");
  assert.equal(state.dangerousSeas.explorationPending.wreck.choice, "cargo", "確定済みの選択は維持する");
  assert.equal(state.dangerousSeas.explorationPending.dayApplied, false);
  assert.equal(state.funds, afterDeck);
  failAfterDay = false; saveFails = false;
  resumeExploration(() => {});
  assert.equal(state.day, beforeAdditionalDay + 1);
  assert.equal(state.funds, afterDeck + 1650);
  startWreck(31);
  const afterRescueDeck = state.funds, beforeRescue = state.troops.infantry;
  assert.equal(chooseDangerousWreckBranch("rescue", () => {}), true);
  assert.equal(state.funds, afterRescueDeck, "救助では追加積荷を受け取らない");
  assert.equal(state.troops.infantry, beforeRescue + 5);
  assert.equal(calls.troopLevels.at(-1), 3);
  startWreck(32);
  const leaveDay = state.day, leaveFunds = state.funds;
  assert.equal(chooseDangerousWreckBranch("leave", () => {}), true);
  assert.equal(state.day, leaveDay, "引き上げは追加日数なし");
  assert.equal(state.funds, leaveFunds);
  assert.equal(state.dangerousSeas.explorationPending, null);
  assert.equal(state.dangerousSeas.regions.se.sites.length, 0);
  assert.equal(chooseDangerousWreckBranch("rescue", () => {}), false);
  randomValue = 0; scoutCount = 0; startWreck(33, 1);
  finishExploration(true); state.pendingEncounter = null; state.modeLabel = "normal";
  state.supplies.wood = 3; state.supplies.food = 5;
  const clueBefore = calls.fragment || 0, troopsBeforeClue = state.troops.infantry, afterClueDeck = state.funds;
  assert.equal(chooseDangerousWreckBranch("rescue", () => {}), true);
  assert.equal(state.modeLabel, "prep");
  finishExploration(true);
  assert.equal(calls.fragment, clueBefore + 1);
  assert.equal(state.troops.infantry, troopsBeforeClue, "手掛かりと救助兵は排他的に受け取る");
  assert.equal(state.supplies.wood, 2); assert.equal(state.supplies.food, 3);
  assert.equal(state.funds, afterClueDeck);
  startWreck(34, 1);
  finishExploration(true); state.pendingEncounter = null; state.modeLabel = "normal";
  const wonDeckFunds = state.funds;
  chooseDangerousWreckBranch("cargo", () => {});
  finishExploration(false);
  assert.equal(state.funds, wonDeckFunds, "追加枝の敗北で甲板の受取を取り消さない");
  assert.equal(state.dangerousSeas.explorationPending, null);
  assert.equal(state.dangerousSeas.regions.se.sites.length, 0);
  randomValue = 0.999999; startWreck(35);
  state.dangerousSeas.pendingHazard = { id: 101, kind: "raid", stage: "watch" };
  const watchDay = state.day;
  assert.equal(chooseDangerousWreckBranch("cargo", () => {}), true, "察知した翌日予定の襲撃では選択を止めない");
  assert.equal(state.day, watchDay + 1);
  state.dangerousSeas.pendingHazard = null;
  startWreck(36);
  const savedDeckFunds = state.funds, savedDeckDay = state.day;
  failSaveAt = saveCalls + 4;
  chooseDangerousWreckBranch("cargo", () => {});
  assert.equal(state.day, savedDeckDay + 1);
  assert.equal(state.funds, savedDeckFunds, "付与後の保存失敗では追加報酬を巻き戻す");
  assert.equal(state.dangerousSeas.explorationPending.wreck.stage, "cargo");
  assert.equal(state.dangerousSeas.explorationPending.wreck.branches.cargo.settled, false);
  assert.equal(state.dangerousSeas.explorationPending.dayApplied, true);
  failSaveAt = null;
  resumeExploration(() => {});
  assert.equal(state.day, savedDeckDay + 1);
  assert.equal(state.funds, savedDeckFunds + 1650);
  state.dangerousSeas.pendingHazard = null;
  state.pendingEncounter = null; state.modeLabel = "normal";
  state.dangerousSeas.regions.se.sites = [{ ...initialSite, id: 40 }];
  state.dangerousSeas.explorationPending = { siteId: 40, regionId: "se", dayApplied: false, encounter: null,
    reward: { funds: 3300, supplies: { brew: 24 }, troops: { infantry: 5 }, ships: 0, fragment: false } };
  const legacyDay = state.day, legacyFunds = state.funds, legacyTroops = state.troops.infantry;
  resumeExploration(() => {});
  assert.equal(state.day, legacyDay + 1, "日数未適用の旧保存は共通行動を再開して一日進める");
  assert.equal(state.funds, legacyFunds + 3300);
  assert.equal(state.troops.infantry, legacyTroops + 5);
  assert.equal(calls.troopLevels.at(-1), 1, "旧救助兵の練度を変更しない");
  assert.equal(state.dangerousSeas.explorationPending, null);
  console.log("危険難破船の甲板/積荷選択・危険割込み/保存再開・二重回収防止・旧地点維持: 全項目成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
