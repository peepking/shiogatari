const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/**
 * ブラウザの保存先と地図を置き換え、実際の保存モジュールを検証する。
 * @returns {Promise<void>}
 */
async function main() {
  const state = {};
  let world = { settlements: [{ id: "village", stock: 3 }] };
  let saved = null;
  let writes = 0;
  let failWrite = false;
  const context = vm.createContext({
    queueMicrotask,
    console,
    localStorage: {
      /** @returns {string|null} 保存データを返す。 */
      getItem() { return saved; },
      /** @param {string} key @param {string} value 保存を模擬する。 */
      setItem(key, value) {
        if (failWrite) throw new Error("容量不足の検証");
        saved = value;
        writes += 1;
      },
    },
  });
  /** @returns {void} 状態を初期化する。 */
  function resetState() {
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, {
      modeLabel: "normal", pendingEncounter: { active: false },
      day: 1, funds: 1000, logs: [], eventQueue: [], position: { x: 10, y: 10 },
    });
  }
  /** @returns {object} 地図の状態を返す。 */
  function snapshotWorld() { return world; }
  /** @param {object} value 地図の状態を復元する。 */
  function restoreWorld(value) { world = value; }
  /** @param {object} exports @returns {vm.SyntheticModule} 依存モジュールを作る。 */
  function mockModule(exports) {
    /** @returns {void} モジュールの公開値を設定する。 */
    function initialize() {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }
    return new vm.SyntheticModule(Object.keys(exports), initialize, { context });
  }
  const modules = {
    "./state.js": mockModule({ state, resetState }),
    "./constants.js": mockModule({ MODE_LABEL: { NORMAL: "normal", BATTLE: "battle" } }),
    "./map.js": mockModule({ snapshotWorld, restoreWorld }),
  };
  /** @param {string} specifier @returns {Promise<vm.Module>} 実ファイルを読み込む。 */
  async function loadModule(specifier) {
    if (!modules[specifier]) {
      const source = await fs.readFile(path.join(__dirname, "..", specifier), "utf8");
      modules[specifier] = new vm.SourceTextModule(source, { context, identifier: specifier });
      await modules[specifier].link(loadModule);
    }
    return modules[specifier];
  }
  await loadModule("./fleet.js");
  await loadModule("./expansionState.js");
  const module = await loadModule("./storage.js");
  await module.evaluate();
  const { saveGameToStorage, scheduleGameSave, loadGameFromStorage } = module.namespace;
  const { normalizeLogs } = modules["./logStore.js"].namespace;
  /** @returns {void} 今回使わない勢力操作を置き換える。 */
  function unusedAction() {}
  modules["./actions.js"] = mockModule({ handleTravelEventAction: unusedAction });
  modules["./dom.js"] = mockModule({ elements: {} });
  modules["./faction.js"] = mockModule({
    addHonorFaction: unusedAction, addWarScore: unusedAction, adjustNobleFavor: unusedAction,
    adjustSupport: unusedAction, getPlayerFactionId: unusedAction,
  });
  const events = await loadModule("./events.js");
  await events.evaluate();
  resetState();

  // ログを追加しない移動も、行動完了後の状態で一度だけ保存する。
  scheduleGameSave();
  state.day = 9;
  state.position = { x: 14, y: 12 };
  scheduleGameSave();
  await Promise.resolve();
  assert.equal(writes, 1);
  resetState();
  assert.equal(loadGameFromStorage(), true);
  assert.equal(state.day, 9);
  assert.equal(state.position.y, 12);
  assert.equal(world.settlements[0].stock, 3);

  // 支払いとイベント除去を同一の保存にまとめ、再提示を防ぐ。
  state.eventQueue = [{ id: 1 }];
  state.funds -= 80;
  scheduleGameSave();
  state.eventQueue.shift();
  await Promise.resolve();
  resetState();
  loadGameFromStorage();
  assert.equal(state.funds, 920);
  assert.equal(state.eventQueue.length, 0);

  // 実際のイベント解決処理だけでも保存が更新される。
  state.eventSeq = 1;
  events.namespace.enqueueEvent({ title: "通知", body: "確認" });
  await Promise.resolve();
  assert.equal(JSON.parse(JSON.parse(saved).payload).state.eventQueue.length, 1);
  events.namespace.resolveCurrentEvent();
  await Promise.resolve();
  resetState();
  loadGameFromStorage();
  assert.equal(state.eventQueue.length, 0);

  // 戦闘途中は直前の保存を保持し、戦後は報酬付きで通常画面へ復元する。
  const beforeBattle = saved;
  state.modeLabel = "battle";
  state.pendingEncounter.active = true;
  state.funds = 1375;
  assert.equal(saveGameToStorage(), false);
  assert.equal(saved, beforeBattle);
  assert.equal(saveGameToStorage({ battleComplete: true }), true);
  assert.equal(state.modeLabel, "battle");
  resetState();
  loadGameFromStorage();
  assert.equal(state.modeLabel, "normal");
  assert.equal(state.pendingEncounter.active, false);
  assert.equal(state.funds, 1375);

  // 上限超過時は新しい200件を残し、長文と不正形式も制限する。
  const entries = [];
  for (let i = 204; i >= 0; i -= 1) {
    entries.push({ title: `記録${i}`, body: "あ".repeat(4100), gameTime: "春9日", realTime: "日時" });
  }
  state.logs = entries;
  saveGameToStorage();
  resetState();
  loadGameFromStorage();
  assert.equal(state.logs.length, 200);
  assert.equal(state.logs[0].title, "記録204");
  assert.equal(state.logs[199].title, "記録5");
  assert.equal(state.logs[0].body.length, 4000);
  assert.equal(normalizeLogs([null, {}, { title: "記録", body: "本文" }]).length, 1);
  state.logs = [];
  saveGameToStorage();
  resetState();
  loadGameFromStorage();
  assert.equal(state.logs.length, 0);

  // ログが存在しない旧形式も引き継ぐ。
  delete state.logs;
  saveGameToStorage();
  const legacy = JSON.parse(saved);
  const payload = JSON.parse(legacy.payload);
  delete payload.state.logs;
  legacy.payload = JSON.stringify(payload);
  let hash = 0;
  for (let i = 0; i < legacy.payload.length; i += 1) hash = (hash * 31 + legacy.payload.charCodeAt(i)) >>> 0;
  legacy.hash = hash.toString(16);
  saved = JSON.stringify(legacy);
  assert.equal(loadGameFromStorage(), true);
  assert.equal(state.logs.length, 0);

  // 拡張領域のない旧セーブも資金や日数を維持して補完する。
  delete state.expansion;
  state.funds = 4321;
  state.day = 19;
  assert.equal(saveGameToStorage(), true);
  resetState();
  assert.equal(loadGameFromStorage(), true);
  assert.equal(state.funds, 4321);
  assert.equal(state.day, 19);
  assert.equal(state.expansion.outfitting.slots, 1);
  assert.equal(state.expansion.exploration.initialized, false);
  assert.equal(state.expansion.exploration.sites.length, 0);

  // 新しい進行情報と購入済み設備を往復しても、再抽選・再初期化しない。
  state.expansion.exploration.initialized = true;
  state.expansion.exploration.nextId = 8;
  state.expansion.exploration.sites = [{ id: 7, kind: "wreck", position: { x: 12, y: 9 }, spawnedAbs: 200, expiresAbs: 320, danger: 0.75 }];
  state.expansion.exploration.pending = { siteId: 7, dayApplied: true, reward: { funds: 1000, ships: 1, supplies: { spice: 3, brew: 3 }, troops: { infantry: 4 } }, encounter: null };
  state.expansion.charts.nextId = 3;
  state.expansion.charts.active = [{ id: 2, kind: "altar", size: 3, destination: { x: 15, y: 20 }, fragments: 1, rumor: null, rumorFragmentClaimed: false, merchantClaims: ["sailor"], questIds: [] }];
  state.expansion.charts.rumorSeasons = { village: 4000 };
  state.expansion.outfitting = { slots: 2, owned: ["harpoon", "cargo_tent"], equipped: ["cargo_tent", null] };
  const expansionBefore = JSON.stringify(state.expansion);
  assert.equal(saveGameToStorage(), true);
  resetState();
  assert.equal(loadGameFromStorage(), true);
  assert.equal(JSON.stringify(state.expansion), expansionBefore);
  assert.equal(loadGameFromStorage(), true);
  assert.equal(JSON.stringify(state.expansion), expansionBefore);
  assert.equal(state.funds, 4321);

  // 保存失敗でも以前のデータを壊さず、次回の保存で復帰できる。
  delete state.fleet;
  state.ships = 3;
  assert.equal(saveGameToStorage(), true);
  assert.equal(loadGameFromStorage(), true);
  assert.equal(state.fleet.counts.cog, 3);
  assert.equal("ships" in state, false);
  state.fleet.counts.galleon = 2;
  world.settlements[0].shipyard = { regular: [{type:"cog",targetStock:2}], stock:{cog:0,galleon:3}, lastRestockSeason:4001 };
  state.expansion.exploration.pending.reward.shipTypes = { knarr: 1 };
  assert.equal(saveGameToStorage(), true);
  resetState();
  assert.equal(loadGameFromStorage(), true);
  assert.equal(state.fleet.counts.cog, 3);
  assert.equal(state.fleet.counts.galleon, 2);
  assert.equal(world.settlements[0].shipyard.stock.cog, 0);
  assert.equal(world.settlements[0].shipyard.stock.galleon, 3);
  assert.equal(state.expansion.exploration.pending.reward.shipTypes.knarr, 1);
  const validSave = saved;
  failWrite = true;
  assert.equal(saveGameToStorage(), false);
  assert.equal(saved, validSave);
  failWrite = false;
  assert.equal(saveGameToStorage(), true);
  console.log("保存・復元の回帰テスト: 全項目成功");
}

/** @param {Error} error 検証失敗を表示する。 */
function reportFailure(error) {
  console.error(error);
  process.exitCode = 1;
}

main().catch(reportFailure);
