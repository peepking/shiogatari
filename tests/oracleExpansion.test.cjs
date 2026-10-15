/* eslint-env node */
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @param {*} value VM内の値。 @returns {*} 比較用の通常値。 */
function plain(value) { return JSON.parse(JSON.stringify(value)); }

/**
 * 実際のモジュールを共有状態で読み、5種類の抽選・資産消費・保存復元・行動への接続を検証する。
 * 画面を省略し、保存失敗だけを任意に発生させる。
 * @returns {Promise<void>} 検証完了。
 */
async function main() {
  let saveFails = false, failSaveAt = null, writes = 0, randomValue = 0.99;
  const stored = new Map(), math = Object.create(Math);
  math.random = () => randomValue;
  const context = vm.createContext({ console: { ...console, error() {} }, structuredClone, Math: math, setTimeout, clearTimeout,
    queueMicrotask() {},
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], dispatchEvent() {}, addEventListener() {} },
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { writes++; if (saveFails || writes === failSaveAt) throw Error("保存失敗の検証"); stored.set(key, value); } },
  });
  const cache = new Map();
  /** @param {string} specifier 依存名。 @returns {vm.Module} 共有モジュール。 */
  function get(specifier) {
    const name = specifier.replace(/^\.\//, "");
    if (!cache.has(name)) cache.set(name, new vm.SourceTextModule(readSource(name), { context, identifier: name }));
    return cache.get(name);
  }
  const entry = get("ui.js"); await entry.link(get); await entry.evaluate();
  const { state, resetState } = cache.get("state.js").namespace;
  const world = cache.get("map.js").namespace, storage = cache.get("storage.js").namespace;
  const oracle = cache.get("oracleExpansion.js").namespace, oracleUI = cache.get("oracleUI.js").namespace;
  const quests = cache.get("quests.js").namespace, actions = cache.get("actions.js").namespace;
  const exploration = cache.get("explorationUI.js").namespace, mode = cache.get("constants.js").namespace.MODE_LABEL;
  const { absDay } = cache.get("calendar.js").namespace;
  const { FISH_SPECIES } = cache.get("fishingConfig.js").namespace;
  const { proposeTideSupport, tideRanking, TIDE_STAGES } = cache.get("tideAlliance.js").namespace;
  const { recordVoyage, recordExpense } = cache.get("voyageStats.js").namespace;
  world.buildWorld(2025);
  const village = world.settlements.find(s => s.kind === "village" && !s.pirateHaven && s.coords.y < 25);
  const town = world.settlements.find(s => s.id !== village.id && !s.pirateHaven);
  assert.ok(village && town);

  /** @param {string} type 種類。 @param {Array} candidates 候補。 @returns {object} 実際の生成処理による受領済み神託。 */
  function accept(type, candidates) {
    const q = oracle.makeExpandedOracle(type, candidates, absDay(state), () => 0);
    q.id = state.quests.nextId++; state.quests.active = [q]; return q;
  }
  /** @returns {void} 世界を保持してプレイヤーの状態を初期化する。 */
  function reset() { resetState(); state.position = { ...village.coords }; state.expansion.fishing.rodId = "rod_basic"; saveFails = false; }
  reset();

  // 距離境界と候補なし。巡礼は受領地点と拠点間の両方を制限する。
  const map = Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => ({ terrain: "sea" })));
  const nearby = [
    { id: "here", kind: "village", coords: { x: 20, y: 20 } },
    { id: "edge", kind: "village", coords: { x: 35, y: 20 } },
    { id: "far", kind: "village", coords: { x: 36, y: 20 } },
    { id: "diagonal", kind: "town", coords: { x: 27, y: 27 } },
    { id: "opposite", kind: "town", coords: { x: 5, y: 20 } },
    { id: "haven", kind: "town", pirateHaven: true, coords: { x: 21, y: 20 } },
    { id: "banned", kind: "village", coords: { x: 21, y: 21 } },
    { id: "danger", kind: "village", coords: { x: 22, y: 20 } },
  ];
  state.position = { x: 20, y: 20 };
  state.tideAlliance.sites = { edge: { funds: 1 }, far: { funds: 1 } };
  const now = absDay(state);
  state.expansion.exploration.sites = [
    { id: 1, kind: "drift", position: { x: 35, y: 20 }, expiresAbs: now + 91, danger: 0 },
    { id: 2, kind: "drift", position: { x: 36, y: 20 }, expiresAbs: now + 120, danger: 0 },
    { id: 3, kind: "drift", position: { x: 21, y: 20 }, expiresAbs: now + 90, danger: 0 },
    { id: 4, kind: "wreck", position: { x: 20, y: 21 }, expiresAbs: now + 120, danger: 0 },
  ];
  const rules = { canEnter: s => s.id !== "banned", isDangerous: p => p.x === 22 && p.y === 20 };
  let choices = oracle.expandedOracleChoices(state, nearby, map, rules);
  assert.deepEqual(plain(choices.oracle_share.map(s => s.id)), ["here", "edge"]);
  assert.deepEqual(plain(choices.oracle_support.map(s => s.id)), ["edge"]);
  assert.deepEqual(plain(choices.oracle_explore.map(s => s.id)), [1]);
  const pilgrimagePairs = plain(choices.oracle_pilgrimage.map(pair => pair.map(s => s.id)));
  assert.ok(pilgrimagePairs.some(pair => pair[0] === "edge" && pair[1] === "diagonal"));
  assert.ok(pilgrimagePairs.some(pair => pair.includes("banned")), "巡礼は入場禁止の拠点も到着できれば候補にできる");
  assert.ok(pilgrimagePairs.every(pair => !pair.includes("far") && !pair.includes("danger") && !pair.includes("haven")));
  assert.deepEqual(plain(choices.oracle_fish), ["common", "big"]);
  state.expansion.fishing.rodId = null;
  state.expansion.exploration.sites = [];
  choices = oracle.expandedOracleChoices(state, [], map, rules);
  assert.ok(Object.values(choices).every(list => list.length === 0));
  assert.equal(oracle.makeExpandedOracle("oracle_share", [], now), null);
  // 危険セルに囲まれた拠点は距離内でも対象にしない。
  state.position = { x: 20, y: 20 };
  const isolated = { id: "isolated", kind: "village", coords: { x: 24, y: 20 } };
  choices = oracle.expandedOracleChoices(state, [isolated], map, { canEnter: () => true,
    isDangerous: p => Math.abs(p.x - 24) + Math.abs(p.y - 20) === 1 });
  assert.equal(choices.oracle_share.length, 0);

  // 奉納は魚種をまたいで安いものから消費し、図鑑・大物・超大物を保持する。
  reset();
  state.expansion.fishing.counts = { aji: 2, madai: 3, hirame: 2 };
  const commonFish = FISH_SPECIES.find(s => s.category === "common" && s.sellPrice > 10);
  state.expansion.fishing.counts[commonFish.id] = 4;
  state.expansion.fishing.codex = { aji: { count: 50, maxSize: 31 } };
  let q = accept("oracle_fish", ["common"]);
  assert.deepEqual(plain(oracle.fishOffering(state, q).items.map(item => [item.id, item.qty])), [["aji", 2], [commonFish.id, 3]]);
  const codexBefore = JSON.stringify(state.expansion.fishing.codex);
  saveFails = true;
  const before = JSON.stringify(state);
  assert.equal(oracleUI.commitExpandedOracle(q), false);
  assert.equal(JSON.stringify(state), before, "保存失敗で在庫・信仰・累計・依頼をすべて復元する");
  saveFails = false; q = state.quests.active[0];
  state.season = 1; state.tideAlliance.season = state.year * 4 + 1; state.tideAlliance.bonus = 50;
  assert.equal(oracleUI.commitExpandedOracle(q), true);
  assert.equal(state.faith, 6); assert.equal(state.voyageStats.faithEarned, 6);
  assert.equal(state.expansion.fishing.counts.aji, undefined);
  assert.equal(state.expansion.fishing.counts[commonFish.id], 1);
  assert.equal(state.expansion.fishing.counts.madai, 3);
  assert.equal(JSON.stringify(state.expansion.fishing.codex), codexBefore);
  assert.equal(oracleUI.commitExpandedOracle(q), false); assert.equal(state.faith, 6);
  q = accept("oracle_fish", ["big"]);
  assert.deepEqual(plain(oracle.fishOffering(state, q).items.map(item => [item.id, item.qty])), [["hirame", 2]]);
  state.expansion.fishing.counts = { aji: 99 };
  assert.equal(oracle.canCompleteExpandedOracle(state, q, world.settlements), false);
  assert.equal(oracle.completeExpandedOracle(state, q, world.settlements), null);
  assert.equal(state.expansion.fishing.counts.aji, 99);

  // 同額では在庫の登録順によらず内部ID順。期限当日は完了でき、翌日は不可。
  const tied = FISH_SPECIES.filter(s => s.category === "common" && s.sellPrice === 10).sort((a, b) => a.id.localeCompare(b.id));
  assert.ok(tied.length >= 2);
  q = accept("oracle_fish", ["common"]);
  state.expansion.fishing.counts = { [tied[1].id]: 5, [tied[0].id]: 5 };
  assert.equal(oracle.fishOffering(state, q).items[0].id, tied[0].id);
  q.acceptedAbs = absDay(state) - 90; q.deadlineAbs = absDay(state);
  assert.equal(oracle.canCompleteExpandedOracle(state, q, world.settlements), true);
  state.day++; assert.equal(oracle.canCompleteExpandedOracle(state, q, world.settlements), false);

  // 施しは村の外や別拠点では完了できず、必要数を一度だけ消費する。
  reset(); q = accept("oracle_share", [village]); state.supplies.food = 12;
  assert.equal(quests.canCompleteQuest(q), false);
  state.modeLabel = mode.IN_VILLAGE;
  state.position = { ...town.coords }; assert.equal(quests.canCompleteQuest(q), false);
  state.position = { ...village.coords };
  assert.equal(quests.completeQuest(q.id), true); assert.equal(state.supplies.food, 2);
  assert.equal(quests.completeQuest(q.id), false);

  // 本体の移動で巡礼を進める。保存失敗では到着位置を保ち、進捗を復元して再確認する。
  reset(); q = accept("oracle_pilgrimage", [[village, town]]);
  state.position = { x: village.coords.x === 0 ? 1 : village.coords.x - 1, y: village.coords.y };
  state.selectedPosition = { ...village.coords };
  saveFails = true;
  assert.equal(actions.moveToSelected().ok, true);
  assert.deepEqual(plain(state.position), plain(village.coords));
  assert.equal(state.modeLabel, mode.NORMAL); assert.equal(state.quests.active[0].visits[0].done, false);
  saveFails = false;
  assert.equal(quests.getQuests().active[0].visits[0].done, true);
  assert.equal(state.modeLabel, mode.NORMAL);
  quests.getQuests(); assert.equal(state.faith, 0);
  assert.equal(storage.saveGameToStorage(), true); assert.equal(storage.loadGameFromStorage(), true);
  assert.equal(state.quests.active[0].visits[0].done, true);
  state.position = { x: town.coords.x === 0 ? 1 : town.coords.x - 1, y: town.coords.y };
  state.selectedPosition = { ...town.coords }; state.modeLabel = mode.NORMAL;
  state.warLedger.entries = [{ factions: ["pirates", town.factionId], activeFronts: [{ id: "oracle-siege", settlementId: town.id,
    attacker: "pirates", defender: town.factionId, startAbs: absDay(state), endAbs: absDay(state) + 60, resolved: false }] }];
  const faction = cache.get("faction.js").namespace;
  assert.equal(faction.isSettlementUnderSiege(town.id), true);
  assert.equal(actions.moveToSelected().ok, true);
  assert.equal(faction.isSettlementUnderSiege(town.id), true);
  assert.equal(actions.attemptEnter(town.kind), false, "防衛中の入場拒否は維持する");
  assert.equal(state.quests.active.length, 0); assert.equal(state.faith, 4);
  assert.equal(state.modeLabel, mode.NORMAL);
  quests.getQuests(); assert.equal(state.faith, 4);

  // 旧セーブで目的地のマスにいる場合も、入場操作なしで到着を反映する。
  reset(); q = accept("oracle_pilgrimage", [[village, town]]); q.visits[0].done = true;
  state.position = { ...town.coords };
  assert.equal(storage.saveGameToStorage(), true); assert.equal(storage.loadGameFromStorage(), true);
  assert.equal(quests.getQuests().active.length, 0); assert.equal(state.faith, 4);
  // 到着した日が期限翌日なら達成せず、期限当日の到着は有効。
  for (const remaining of [0, 1]) {
    reset(); q = accept("oracle_pilgrimage", [[village, town]]); q.visits[0].done = true;
    q.acceptedAbs = absDay(state) - 90 + remaining; q.deadlineAbs = absDay(state) + remaining;
    state.position = { x: town.coords.x === 0 ? 1 : town.coords.x - 1, y: town.coords.y }; state.selectedPosition = { ...town.coords };
    actions.moveToSelected(); assert.equal(state.faith, remaining ? 4 : 0);
  }

  // 本体の探索終了を使い、非戦闘・勝利・非成功で地点と神託を同時に消費する。
  for (const success of [true, false]) {
    reset(); const position = { x: 1, y: 1 };
    const site = { id: 10, kind: "drift", position, spawnedAbs: absDay(state), expiresAbs: absDay(state) + 120, danger: 0.5 };
    state.expansion.exploration.sites = [site]; q = accept("oracle_explore", [site]);
    state.expansion.exploration.pending = { siteId: site.id, dayApplied: true, reward: { funds: 500, supplies: {}, troops: {}, ships: 0, fragment: false } };
    const resources = exploration.finishExploration(success);
    assert.equal(state.quests.active.length, 0); assert.equal(state.expansion.exploration.sites.length, 0);
    assert.equal(state.faith, success ? 4 : 0);
    assert.equal(resources.some(r => r.id === "faith"), success);
    exploration.finishExploration(success); assert.equal(state.faith, success ? 4 : 0);
  }
  reset();
  const retrySite = { id: 11, kind: "drift", position: { x: 1, y: 1 }, spawnedAbs: absDay(state), expiresAbs: absDay(state) + 120, danger: 0 };
  state.expansion.exploration.sites = [retrySite]; accept("oracle_explore", [retrySite]);
  state.expansion.exploration.pending = { siteId: retrySite.id, dayApplied: true, reward: { funds: 500, supplies: {}, troops: {}, ships: 0, fragment: false } };
  const retryFunds = state.funds;
  failSaveAt = writes + 2;
  exploration.resumeExploration(() => {});
  assert.equal(state.faith, 0); assert.equal(state.funds, retryFunds); assert.equal(state.quests.active.length, 1);
  assert.equal(state.expansion.exploration.pending.siteId, retrySite.id);
  failSaveAt = null; exploration.resumeExploration(() => {});
  assert.equal(state.faith, 4); assert.equal(state.funds, retryFunds + 500); assert.equal(state.quests.active.length, 0);
  assert.equal(state.expansion.exploration.pending, null);

  // 潮盟の実際の確認処理を使い、支援・進捗・達成報酬の一括保存を検証する。
  const supportSource = readSource("tideAllianceUI.js");
  const supportStart = supportSource.indexOf("function confirmSupport(");
  const supportFunction = supportSource.slice(supportStart, supportSource.indexOf("\n}", supportStart) + 2);
  for (const byPeople of [false, true]) {
    reset(); state.funds = 10000; state.tideAlliance.sites[village.id] = { funds: 100000, people: 50 };
    q = accept("oracle_support", [village]);
    let confirmation;
    const supportContext = vm.createContext({ state, structuredClone, selected: village.id, support: {}, canSupport: () => true,
      settlements: world.settlements, proposeTideSupport, tideRanking, TIDE_STAGES,
      TROOP_STATS: cache.get("troops.js").namespace.TROOP_STATS,
      recordVoyage, recordExpense, advanceExpandedOracle: oracle.advanceExpandedOracle, restoreOracleState: oracle.restoreOracleState,
      saveGameToStorage: storage.saveGameToStorage, announceOracleResults: oracleUI.announceOracleResults,
      confirmAction: options => { confirmation = options; }, pushToast() {}, pushLog() {}, progressText: () => "", contribution: () => "" });
    vm.runInContext(supportFunction, supportContext);
    let amount = byPeople ? 0 : 1000;
    const panel = { querySelector: () => ({ value: amount }), querySelectorAll: () => byPeople ? [{ dataset: { tideType: "infantry", level: "1" }, value: 1 }] : [] };
    supportContext.panel = panel;
    vm.runInContext("confirmSupport(panel, () => {})", supportContext);
    saveFails = true; const snapshot = JSON.stringify(state); confirmation.onConfirm();
    assert.equal(JSON.stringify(state), snapshot);
    saveFails = false;
    vm.runInContext("confirmSupport(panel, () => {})", supportContext); confirmation.onConfirm();
    if (!byPeople) {
      assert.equal(state.quests.active[0].supportedFunds, 1000); assert.equal(state.faith, 0);
      assert.equal(storage.saveGameToStorage(), true); assert.equal(storage.loadGameFromStorage(), true);
      amount = 1000;
      vm.runInContext("confirmSupport(panel, () => {})", supportContext); confirmation.onConfirm();
    }
    assert.equal(state.quests.active.length, 0); assert.equal(state.faith, 4);
    assert.equal(state.tideAlliance.sites[village.id].funds, byPeople ? 100000 : 102000);
    assert.equal(state.tideAlliance.sites[village.id].people, byPeople ? 51 : 50);
  }

  // 全種類で受領中の制限を確認し、条件を満たす種類を本体から実際に受領する。
  reset(); state.position = { x: 20, y: 20 }; state.tideAlliance.sites[village.id] = { funds: 0, people: 0 };
  for (const type of Object.keys(oracle.EXPANDED_ORACLES)) {
    state.quests.active = [{ type }]; assert.equal(quests.canReceiveOracle(), false);
  }
  state.quests.active = []; state.position = { ...village.coords };
  const beforeReceive = JSON.stringify(state.quests); saveFails = true;
  assert.equal(quests.receiveOracle(), null); assert.equal(JSON.stringify(state.quests), beforeReceive);
  saveFails = false; randomValue = 0.99;
  const received = quests.receiveOracle();
  assert.ok(received); assert.equal(received.type, "oracle_support");
  assert.equal(quests.receiveOracle(), null);
  assert.equal(storage.loadGameFromStorage(), true); assert.equal(state.quests.active[0].id, received.id);
  state.quests.active[0].supportedFunds = -1;
  assert.equal(quests.getQuests().active.length, 0);
  assert.ok(state.eventQueue.some(event => event.title === "神託失敗"));

  // 本体の依頼一覧を描画し、2目的地・分類別所持数・自動完了案内を確認する。
  reset();
  const elements = cache.get("dom.js").namespace.elements;
  const list = { innerHTML: "", querySelectorAll: () => [] };
  elements.questList = list;
  const questUI = cache.get("questUI.js").namespace;
  state.expansion.fishing.counts = { aji: 3 };
  accept("oracle_fish", ["common"]); questUI.renderQuestUI();
  assert.match(list.innerHTML, /一般魚（匹）/); assert.match(list.innerHTML, /3 \/ 5/);
  state.position = { x: 0, y: 0 };
  accept("oracle_pilgrimage", [[village, town]]); questUI.renderQuestUI();
  assert.equal((list.innerHTML.match(/class="btn quest-location"/g) || []).length, 2);
  assert.match(list.innerHTML, /2拠点のマスへの到着で自動完了/);
  assert.match(list.innerHTML, /拠点への入場は不要/);
  state.tideAlliance.sites[village.id] = { funds: 0, people: 0 };
  accept("oracle_support", [village]); questUI.renderQuestUI();
  assert.match(list.innerHTML, /受領後の寄付資金/); assert.match(list.innerHTML, /資金・担い手のどちらか/);
  accept("oracle_share", [village]); questUI.renderQuestUI();
  assert.match(list.innerHTML, /食料/); assert.match(list.innerHTML, /10/);
  state.expansion.exploration.sites = [retrySite];
  accept("oracle_explore", [retrySite]); questUI.renderQuestUI();
  assert.match(list.innerHTML, /戦闘確率0%/); assert.match(list.innerHTML, /探索成功で自動完了/);
  console.log("追加神託5種類: 距離・奉納順・期限・入場・探索・支援・保存失敗と再開・受領制限の全項目成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
