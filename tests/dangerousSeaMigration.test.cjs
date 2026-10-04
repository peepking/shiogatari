/* eslint-env node */
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @param {unknown} value VM内の値。 @returns {unknown} 参照を共有しない比較値。 */
function plain(value) { return JSON.parse(JSON.stringify(value)); }

/** @param {object} position 座標。 @returns {string} 比較用キー。 */
function key(position) { return `${position.x},${position.y}`; }

/** @param {object} site 地点。 @returns {object} 位置以外の固定内容。 */
function fixedContent(site) { const copy = plain(site); delete copy.position; return copy; }

/** @returns {object} 地形変更のない移行テスト用の母海域。 */
function ocean() {
  return { cells: Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => ({ terrain: "sea", building: "none", settlementId: null }))), settlements: [] };
}

/** @returns {object} 通常領域と履歴を含む旧専用状態。 */
function legacyGame() {
  return { position: { x: 25, y: 25 }, selectedPosition: { x: 24, y: 25 }, funds: 4321, day: 18,
    pendingEncounter: { active: false }, expansion: { exploration: { sites: [] }, charts: { active: [] } },
    bounties: { active: [] }, quests: { active: [], availableBySettlement: {} }, nobleQuests: { availableByNoble: {} },
    dangerousSeas: { regions: { sw: { sites: [] }, se: { sites: [] } }, bounties: { active: [], history: [{ id: 99 }] },
      events: { active: { sw: null, se: null }, stormAftermath: { sw: null, se: null }, history: [{ id: 88 }] }, explorationPending: null, pendingHazard: null, action: null } };
}

/** @param {number} id 個体。 @param {string} regionId 海域。 @param {object} position 位置。 @param {string} [level="outer"] 段階。 @returns {object} 固定情報のある旧探索。 */
function explorationSite(id, regionId, position, level = "outer") {
  return { id, regionId, kind: "wreck", position, level, profile: `danger_${level}`, version: 1, danger: .75, spawnedAbs: 21, expiresAbs: 141 };
}

/**
 * 実ソースを一つの依存グラフで読み込み、純粋な移設と実際の保存復元の接続を検証する。
 * ブラウザ保存先と画面だけを用意し、世界・正規化・移行・保存モジュールは差し替えない。
 * @returns {Promise<void>} 検証完了。
 */
async function main() {
  const stored = new Map(), microtasks = [];
  let writes = 0, failWrite = false;
  const math = Object.create(Math); math.random = () => .99;
  const context = vm.createContext({ console, structuredClone, Math: math, setTimeout, clearTimeout,
    queueMicrotask: task => microtasks.push(task),
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, dispatchEvent() {} },
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    localStorage: { getItem: name => stored.get(name) ?? null, removeItem: name => stored.delete(name),
      /** @param {string} name 保存キー。 @param {string} value 保存内容。 @returns {void} 書き込み回数と失敗を記録する。 */
      setItem(name, value) { if (failWrite) throw new Error("移行保存失敗の検証"); stored.set(name, value); writes += 1; } },
  });
  const cache = new Map();
  /** @param {string} specifier 実ソース名。 @returns {vm.Module} 共通状態を持つ依存。 */
  function get(specifier) {
    const name = specifier.replace(/^\.\//, "");
    if (!cache.has(name)) cache.set(name, new vm.SourceTextModule(readSource(name), { context, identifier: name }));
    return cache.get(name);
  }
  const entry = get("ui.js"); await entry.link(get); await entry.evaluate();
  const migration = cache.get("dangerousSeaMigration.js").namespace;
  const geometry = cache.get("dangerousSeaGeometry.js").namespace;
  const reservations = cache.get("dangerousSeaReservations.js").namespace;
  const migrate = migration.migrateDangerousSeaPlacements;
  const world = ocean(), shape = geometry.buildDangerousSeaGeometry(world.cells, world.settlements);

  // 通常の全予約と他の専用地点を避け、位置以外の全情報・履歴・現在地を保持する。
  const game = legacyGame();
  game.expansion.exploration.sites = [{ id: 1, position: { x: 8, y: 41 } }];
  game.expansion.charts.active = [{ destination: { x: 7, y: 40 }, rumor: { x: 9, y: 42 } }];
  game.bounties.active = [{ id: 1, position: { x: 8, y: 42 } }];
  game.quests.active = [{ target: { x: 6, y: 40 }, fights: [{ target: { x: 7, y: 41 } }] }];
  game.quests.availableBySettlement.port = [{ target: { x: 6, y: 41 } }];
  game.nobleQuests.availableByNoble.noble = [{ target: { x: 9, y: 43 } }];
  game.pirateKingStory = { active: { position: { x: 8, y: 43 } } };
  const sites = [explorationSite(2, "sw", { x: 9, y: 40 }), explorationSite(1, "sw", { x: 0, y: 40 })];
  game.dangerousSeas.regions.sw.sites = sites;
  game.dangerousSeas.bounties.active = [{ id: 4, regionId: "sw", position: { x: 9, y: 41 }, reward: 123456, formation: [{ type: "marine", count: 7, level: 4 }], expiresAbs: 500 }];
  game.dangerousSeas.events.active.se = { id: 3, regionId: "se", position: { x: 40, y: 40 }, level: "outer", progress: 0, choices: [],
    rewards: { cargo: { funds: 3456 } }, accidentRoll: .123, fishIds: ["oarfish"], expiresAbs: 77 };
  game.dangerousSeas.events.stormAftermath.se = { id: 5, kind: "storm_aftermath", regionId: "se", position: { x: 41, y: 40 }, level: "outer", progress: 0, choices: [],
    rewards: { collect: { funds: 1234, supplies: { spice: 3 }, troops: {} } }, accidentRoll: .321, expiresAbs: 88 };
  const dedicated = [...sites, ...game.dangerousSeas.bounties.active, game.dangerousSeas.events.active.se, game.dangerousSeas.events.stormAftermath.se];
  const fixed = dedicated.map(fixedContent), before = plain(game), reserved = reservations.worldReservedPositions(game);
  const noRandom = math.random; math.random = () => { throw new Error("移行で再抽選しない"); };
  const result = migrate(game, world);
  assert.deepEqual(plain(result), { changed: true, moved: 5, unplaced: 0, deferred: 0, complete: true });
  assert.equal(game.dangerousSeas.placementVersion, 1);
  dedicated.forEach((site, index) => {
    assert.equal(shape.byPosition.get(key(site.position)).regionId, site.regionId);
    assert.equal(shape.byPosition.get(key(site.position)).level, "outer");
    assert.ok(!reserved.has(key(site.position)), "旧予約へ重ねない");
    assert.deepEqual(fixedContent(site), fixed[index]);
  });
  assert.equal(new Set(dedicated.map(site => key(site.position))).size, dedicated.length);
  const ordinaryAfter = plain(game); delete ordinaryAfter.dangerousSeas; delete before.dangerousSeas;
  assert.deepEqual(ordinaryAfter, before, "通常の地点・現在地・日数・資金は移動しない");
  const once = JSON.stringify(game);
  assert.equal(migrate(game, world).changed, false); assert.equal(JSON.stringify(game), once);
  const reversed = legacyGame(), ordered = legacyGame();
  reversed.dangerousSeas.regions.sw.sites = [explorationSite(2, "sw", { x: 9, y: 40 }), explorationSite(1, "sw", { x: 9, y: 41 })];
  ordered.dangerousSeas.regions.sw.sites = plain(reversed.dangerousSeas.regions.sw.sites).reverse();
  migrate(reversed, world); migrate(ordered, world);
  for (const site of reversed.dangerousSeas.regions.sw.sites) assert.deepEqual(site.position, ordered.dangerousSeas.regions.sw.sites.find(row => row.id === site.id).position);

  // 同段階を優先し、同距離なら上・左を選ぶ。別段階しか空いていなくても生成版は変更しない。
  const tie = legacyGame(); tie.quests.active = [{ target: { x: 8, y: 41 } }];
  tie.dangerousSeas.regions.sw.sites = [explorationSite(1, "sw", { x: 9, y: 40 })]; migrate(tie, world);
  assert.deepEqual(plain(tie.dangerousSeas.regions.sw.sites[0].position), { x: 7, y: 40 });
  const terrainWorld = ocean(); terrainWorld.cells[49][0].terrain = "plain";
  const core = legacyGame(); core.dangerousSeas.regions.sw.sites = [explorationSite(1, "sw", { x: 0, y: 49 }, "core")];
  migrate(core, terrainWorld);
  assert.equal(geometry.buildDangerousSeaGeometry(terrainWorld.cells).byPosition.get(key(core.dangerousSeas.regions.sw.sites[0].position)).level, "core");
  const fallback = legacyGame(); fallback.dangerousSeas.regions.sw.sites = [explorationSite(1, "sw", { x: 0, y: 49 }, "core")];
  fallback.quests.active = shape.positions.sw.filter(point => point.level === "core").map(point => ({ target: point }));
  migrate(fallback, terrainWorld);
  assert.equal(shape.byPosition.get(key(fallback.dangerousSeas.regions.sw.sites[0].position)).level, "outer");
  assert.equal(fallback.dangerousSeas.regions.sw.sites[0].profile, "danger_core"); assert.equal(fallback.dangerousSeas.regions.sw.sites[0].level, "core");

  // 未選択のイベントでもpendingなら保護し、鐘の途中履歴や専用戦闘・保留危険も位置を維持する。
  for (const route of ["exploration", "event_choice", "event_progress", "event_history", "storm_choice", "storm_history", "storm_battle", "bounty_battle", "exploration_battle", "event_battle", "hazard"]) {
    const kept = legacyGame(), position = { x: 9, y: 40 };
    let site;
    if (route.startsWith("event") || route.startsWith("storm")) {
      site = { id: 1, regionId: "sw", position, level: "outer", progress: 0, choices: [] };
      if (route.startsWith("storm")) kept.dangerousSeas.events.stormAftermath.sw = site;
      else kept.dangerousSeas.events.active.sw = site;
      if (route === "event_choice" || route === "storm_choice") kept.dangerousSeas.events.pending = { eventId: 1, regionId: "sw", stage: "choice" };
      if (route === "event_progress") site.progress = 1;
      if (route === "event_history" || route === "storm_history") site.choices = [{ choice: "listen", day: 20 }];
      if (route === "event_battle" || route === "storm_battle") kept.pendingEncounter = { active: true, dangerousEventId: 1 };
    } else if (route === "bounty_battle") {
      site = { id: 1, regionId: "sw", position }; kept.dangerousSeas.bounties.active = [site]; kept.pendingEncounter = { active: true, dangerousBountyId: 1 };
    } else {
      site = explorationSite(1, "sw", position); kept.dangerousSeas.regions.sw.sites = [site];
      if (route === "exploration") kept.dangerousSeas.explorationPending = { siteId: 1, regionId: "sw", pausedForHazard: true, reward: { funds: 2200 } };
      if (route === "exploration_battle") kept.pendingEncounter = { active: true, dangerousExplorationId: 1 };
      if (route === "hazard") { kept.position = position; kept.dangerousSeas.pendingHazard = { id: 1, kind: "raid", stage: "watch", encounter: { enemyFormation: [{ type: "marine", count: 5, level: 2 }] } }; }
    }
    const protectedBefore = plain(kept), deferred = migrate(kept, world);
    assert.equal(deferred.deferred, 1, route); assert.equal(deferred.complete, false, route);
    assert.deepEqual(site.position, position, route); assert.deepEqual(plain(kept), protectedBefore, route);
  }

  // 復元した拠点座標・建物・拠点IDは候補から除き、空き不足では削除せず部分移行だけ保持する。
  const occupiedWorld = ocean(), unavailable = legacyGame();
  occupiedWorld.cells[41][8].settlementId = "unmarked-port";
  occupiedWorld.cells[40][7].building = "ruins";
  occupiedWorld.settlements = [{ id: "port", coords: { x: 9, y: 42 }, kind: "town" }];
  unavailable.dangerousSeas.regions.sw.sites = [explorationSite(1, "sw", { x: 9, y: 40 })];
  migrate(unavailable, occupiedWorld);
  assert.ok(!["8,41", "7,40", "9,42"].includes(key(unavailable.dangerousSeas.regions.sw.sites[0].position)));
  const partial = legacyGame(); partial.dangerousSeas.regions.sw.sites = [explorationSite(1, "sw", { x: 9, y: 40 }), explorationSite(2, "sw", { x: 9, y: 41 })];
  partial.quests.active = shape.positions.sw.filter(point => key(point) !== "8,41").map(point => ({ target: point }));
  const secondFixed = plain(partial.dangerousSeas.regions.sw.sites[1]);
  assert.deepEqual(plain(migrate(partial, world)), { changed: true, moved: 1, unplaced: 1, deferred: 0, complete: false });
  assert.deepEqual(partial.dangerousSeas.regions.sw.sites[1], secondFixed); assert.notEqual(partial.dangerousSeas.placementVersion, 1);
  const firstPosition = plain(partial.dangerousSeas.regions.sw.sites[0].position);
  assert.deepEqual(plain(migrate(partial, world)), { changed: false, moved: 0, unplaced: 1, deferred: 0, complete: false });
  partial.quests.active = partial.quests.active.filter(quest => key(quest.target) !== "7,40");
  assert.equal(migrate(partial, world).moved, 1); assert.deepEqual(plain(partial.dangerousSeas.regions.sw.sites[0].position), firstPosition);
  assert.equal(partial.dangerousSeas.placementVersion, 1);
  const missing = legacyGame(); assert.equal(migrate(missing, { settlements: [] }).complete, false); assert.equal(missing.dangerousSeas.placementVersion, undefined);
  math.random = noRandom;

  // 実際の世界復元後に旧矩形の地点を一度だけ移し、固定内容と版を同じ保存へ確定する。
  const stateModule = cache.get("state.js").namespace, state = stateModule.state;
  const map = cache.get("map.js").namespace, storage = cache.get("storage.js").namespace;
  const normalization = cache.get("dangerousSeaState.js").namespace;
  const mode = cache.get("constants.js").namespace.MODE_LABEL;
  /** @returns {void} 保存予約を処理して測定を開始する。 */
  function flush() { while (microtasks.length) microtasks.shift()(); }
  /** @returns {void} 実配置を持つ旧セーブを準備する。 */
  function prepareLegacy() {
    stateModule.resetState(); map.buildWorld(2025); flush();
    cache.get("dangerousSeaLifecycle.js").namespace.updateDangerousExplorationWorld();
    cache.get("dangerousBountyWorld.js").namespace.updateDangerousBountyWorld();
    state.dangerousSeas.regions.sw.sites[0].position = { x: 0, y: 40 };
    state.dangerousSeas.regions.sw.sites[1].position = { x: 9, y: 41 };
    state.dangerousSeas.bounties.active.find(site => site.regionId === "sw").position = { x: 9, y: 40 };
    cache.get("dangerousSeaEventState.js").namespace.spawnDangerousSeaEvent(state.dangerousSeas.events, "se", "sinking_treasure",
      [{ x: 40, y: 40, level: "outer", travelDays: 20 }], cache.get("calendar.js").namespace.absDay(state), () => null, () => .99);
    cache.get("dangerousSeaEventState.js").namespace.spawnDangerousSeaEvent(state.dangerousSeas.events, "se", "storm_aftermath",
      [{ x: 41, y: 40, level: "outer", travelDays: 20 }], cache.get("calendar.js").namespace.absDay(state), () => null, () => .99);
    delete state.dangerousSeas.placementVersion;
    assert.equal(storage.saveGameToStorage(), true);
  }
  /** @returns {Array} 比較する全専用地点。 */
  function activeSites() { return [...Object.values(state.dangerousSeas.regions).flatMap(region => region.sites), ...state.dangerousSeas.bounties.active,
    ...cache.get("dangerousSeaEventState.js").namespace.activeDangerousSeaEvents(state.dangerousSeas.events)]; }
  prepareLegacy();
  assert.equal(state.dangerousSeas.events.active.se.kind, "sinking_treasure");
  assert.equal(state.dangerousSeas.events.stormAftermath.se.kind, "storm_aftermath");
  const actualBefore = activeSites().map(fixedContent), beforeLoad = writes;
  assert.equal(storage.loadGameFromStorage(), true);
  assert.equal(writes, beforeLoad + 1); assert.equal(state.dangerousSeas.placementVersion, 1);
  assert.deepEqual(activeSites().map(fixedContent), actualBefore);
  for (const site of activeSites()) assert.equal(cache.get("dangerousSeaWorld.js").namespace.dangerousSeaAt(site.position).regionId, site.regionId);
  const saved = stored.get("shiogatari-save"), loadedSites = JSON.stringify(activeSites());
  assert.equal(JSON.parse(JSON.parse(saved).payload).state.dangerousSeas.placementVersion, 1);
  assert.equal(storage.loadGameFromStorage(), true); assert.equal(writes, beforeLoad + 1); assert.equal(JSON.stringify(activeSites()), loadedSites);
  assert.equal(normalization.normalizeDangerousSeas(plain(state.dangerousSeas)).placementVersion, 1);

  // 固定討伐の準備中にも移行を保存するが、交戦相手の旧位置と敵編成は保持する。
  prepareLegacy();
  const target = state.dangerousSeas.bounties.active.find(site => site.regionId === "sw");
  state.position = { ...target.position }; state.pendingEncounter = cache.get("dangerousBounty.js").namespace.buildDangerousBountyEncounter(target); state.modeLabel = mode.PREP;
  const targetBefore = plain(target), encounterBefore = plain(state.pendingEncounter);
  assert.equal(storage.saveGameToStorage(), true); const prepWrites = writes;
  assert.equal(storage.loadGameFromStorage(), true); assert.equal(writes, prepWrites + 1);
  assert.deepEqual(plain(state.dangerousSeas.bounties.active.find(site => site.id === target.id)), targetBefore);
  assert.deepEqual(plain(state.pendingEncounter), encounterBefore); assert.equal(state.modeLabel, mode.PREP);
  assert.equal(state.dangerousSeas.placementVersion, 0, "円外の交戦相手が残る間は移行版を確定しない");
  assert.equal(storage.loadGameFromStorage(), true); assert.equal(writes, prepWrites + 1);
  state.pendingEncounter = { active: false }; state.modeLabel = mode.NORMAL;
  assert.equal(storage.saveGameToStorage(), true);
  assert.equal(storage.loadGameFromStorage(), true);
  const relocatedTarget = state.dangerousSeas.bounties.active.find(site => site.id === target.id);
  assert.notDeepEqual(plain(relocatedTarget.position), targetBefore.position, "敗北や逃走で残った個体は次の読み込みで移す");
  assert.deepEqual(fixedContent(relocatedTarget), fixedContent(targetBefore));
  assert.equal(cache.get("dangerousSeaWorld.js").namespace.dangerousSeaAt(relocatedTarget.position).regionId, "sw");
  assert.equal(state.dangerousSeas.placementVersion, 1);

  // 移行後の保存失敗でも旧保存を壊さず、再読込で同じ移設先を得る。
  state.modeLabel = mode.NORMAL; state.pendingEncounter = { active: false }; prepareLegacy();
  const oldSave = stored.get("shiogatari-save"), failedWrites = writes;
  failWrite = true; assert.equal(storage.loadGameFromStorage(), true);
  const failedSites = JSON.stringify(activeSites()); assert.equal(stored.get("shiogatari-save"), oldSave); assert.equal(writes, failedWrites);
  failWrite = false; assert.equal(storage.loadGameFromStorage(), true);
  assert.equal(JSON.stringify(activeSites()), failedSites); assert.equal(writes, failedWrites + 1);
  console.log("危険海域の保存地点移行: 決定的移設・通常予約回避・同段階優先・途中保護・不足再試行・実保存/再読込: 成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
