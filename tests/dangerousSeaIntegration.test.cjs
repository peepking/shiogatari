const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @param {unknown} value VM内の値。 @returns {unknown} 通常の比較用の値。 */
function plain(value) { return JSON.parse(JSON.stringify(value)); }

/** 実際の依存関係を一度だけ初期化し、日次・移動・配置・保存の共通状態を検証する。
 * 画面要素だけを省略し、ゲーム用モジュールの差し替えを使わない。
 * @returns {Promise<void>} 検証完了。
 */
async function main() {
  let randomValue = 0.99;
  const math = Object.create(Math); math.random = () => randomValue;
  const stored = new Map(), microtasks = [], dispatched = [];
  const context = vm.createContext({ console, structuredClone, Math: math, setTimeout, clearTimeout,
    queueMicrotask: task => microtasks.push(task),
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      dispatchEvent: event => { dispatched.push(event.type); }, addEventListener() {} },
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
  });
  const cache = new Map();
  /** @param {string} specifier 実ソースの名前。 @returns {vm.Module} 同じ状態を共有する依存。 */
  function get(specifier) {
    const name = specifier.replace(/^\.\//, "");
    if (!cache.has(name)) cache.set(name, new vm.SourceTextModule(readSource(name), { context, identifier: name }));
    return cache.get(name);
  }
  const entry = get("ui.js");
  await entry.link(get); await entry.evaluate();
  const stateModule = cache.get("state.js").namespace, state = stateModule.state;
  const world = cache.get("map.js").namespace, geometry = cache.get("dangerousSeaWorld.js").namespace;
  const time = cache.get("time.js").namespace, actions = cache.get("actions.js").namespace;
  const storage = cache.get("storage.js").namespace, hazards = cache.get("dangerousSeaHazards.js").namespace;
  const bounties = cache.get("dangerousBountyWorld.js").namespace, bountyUI = cache.get("dangerousBountyUI.js").namespace;
  const mode = cache.get("constants.js").namespace.MODE_LABEL;
  world.buildWorld(2025);
  const lifecycle = cache.get("dangerousSeaLifecycle.js").namespace, ordinary = cache.get("explorationUI.js").namespace;
  const pure = cache.get("dangerousSeaState.js").namespace;
  cache.get("fleet.js").namespace.addShips(state, { galleon: 2 });
  lifecycle.updateDangerousExplorationWorld(); bounties.updateDangerousBountyWorld(); ordinary.updateExplorationWorld();
  assert.equal(state.dangerousSeas.bounties.active.length, 4);
  assert.equal(state.bounties.active.length, 0, "専用更新は通常枠を補充しない");
  for (const regionId of ["sw", "se"]) assert.equal(state.dangerousSeas.regions[regionId].sites.length, 2);
  for (const site of state.expansion.exploration.sites) assert.equal(geometry.dangerousSeaAt(site.position), null);
  const occupied = [...state.expansion.exploration.sites, ...state.dangerousSeas.bounties.active,
    ...Object.values(state.dangerousSeas.regions).flatMap(region => region.sites)];
  assert.equal(new Set(occupied.map(site => `${site.position.x},${site.position.y}`)).size, occupied.length);

  // 固定賞金首は進行中の別行動へ割り込まず、準備の保存後も同じ編成へ復帰する。
  const target = state.dangerousSeas.bounties.active[0]; state.position = { ...target.position };
  hazards.beginDangerousSeaAction("wait");
  assert.equal(bountyUI.beginDangerousBounty(target.id), false);
  hazards.finishDangerousSeaAction("wait");
  assert.equal(bountyUI.beginDangerousBounty(target.id), true);
  const targetFormation = JSON.stringify(state.pendingEncounter.enemyFormation);
  assert.equal(storage.loadGameFromStorage(), true); assert.equal(state.modeLabel, mode.PREP);
  assert.equal(state.pendingEncounter.dangerousBountyId, target.id);
  assert.equal(JSON.stringify(state.pendingEncounter.enemyFormation), targetFormation);
  state.pendingEncounter = { active: false }; state.modeLabel = mode.NORMAL;

  // 予報は次の日を止めず、待機後に一件の荒波を表示する。材料の二重支払を拒否する。
  state.position = { x: 0, y: 49 }; state.expansion.fishing.counts = { aji: 40 };
  state.supplies = { wood: 1, fiber: 1, food: 100 }; state.eventQueue = [];
  math.random = () => 0.1;
  state.dangerousSeas.regions.sw.weather = { day: cache.get("calendar.js").namespace.absDay(state) + 2, safeRoll: .9, known: false, avoided: false };
  assert.equal(time.advanceDayWithEvents(1), 1);
  assert.ok(state.dangerousSeas.regions.sw.forecast);
  assert.equal(hazards.dangerousSeaActionBlocked(), false);
  assert.equal(time.advanceDayWithEvents(1), 1);
  assert.equal(state.dangerousSeas.pendingHazard.kind, "wave");
  const date = state.day;
  assert.equal(time.advanceDayWithEvents(1), 0); assert.equal(state.day, date);
  assert.equal(hazards.processDangerousSeaHazards(), true);
  assert.equal(state.eventQueue[0].kind, "dangerous_wave");
  const id = state.dangerousSeas.pendingHazard.id;
  assert.equal(storage.saveGameToStorage(), true);
  const savedLosses = JSON.stringify(state.dangerousSeas.pendingHazard.losses);
  assert.equal(storage.loadGameFromStorage(), true);
  assert.equal(JSON.stringify(state.dangerousSeas.pendingHazard.losses), savedLosses);
  assert.equal(state.dangerousSeas.pendingHazard.stage, "displaying");
  assert.equal(pure.resolveRoughWave(state, id, true).protected, true);
  assert.equal(state.supplies.wood, 0); assert.equal(state.supplies.fiber, 0);
  assert.equal(pure.resolveRoughWave(state, id, true), null);
  assert.equal(state.expansion.fishing.counts.aji, 40); state.eventQueue = [];

  // 釣りが継続している間は固定襲撃を準備にしない。再読込後も同じ敵を使う。
  math.random = () => 0;
  hazards.beginDangerousSeaAction("fishing");
  state.expansion.fishing.pending = { remaining: 5, baitId: "insect", dayApplied: false };
  assert.equal(time.advanceDayWithEvents(1), 1);
  state.expansion.fishing.pending.dayApplied = true;
  assert.equal(state.dangerousSeas.pendingHazard.kind, "raid");
  assert.equal(hazards.processDangerousSeaHazards(), false); assert.equal(state.pendingEncounter.active, false);
  state.expansion.fishing.pending = null; hazards.finishDangerousSeaAction("fishing");
  const fixed = JSON.stringify(state.dangerousSeas.pendingHazard.encounter.formation);
  assert.equal(hazards.processDangerousSeaHazards(), true); assert.equal(state.pendingEncounter.eventTag, "dangerous_raid");
  assert.equal(storage.loadGameFromStorage(), true); assert.equal(state.modeLabel, mode.PREP);
  assert.equal(JSON.stringify(state.pendingEncounter.enemyFormation), fixed);
  hazards.finishDangerousSeaEncounter(state.pendingEncounter);
  state.pendingEncounter = { active: false }; state.modeLabel = mode.NORMAL;

  // 移動先で警戒を数え、港到着では外へ出た日として予報を回避する。
  math.random = () => 0.99;
  state.position = { x: 0, y: 48 }; state.selectedPosition = { x: 0, y: 49 };
  state.dangerousSeas.regions.sw.alert = 0; state.eventQueue = [];
  assert.equal(actions.moveToSelected().ok, true); assert.equal(state.dangerousSeas.regions.sw.alert, 2);
  const port = world.settlements.find(site => site.pirateHaven && site.coords.x === 4 && site.coords.y === 45);
  assert.ok(port); state.position = { x: 3, y: 45 }; state.selectedPosition = { ...port.coords };
  state.dangerousSeas.regions.sw.forecast = { day: cache.get("calendar.js").namespace.absDay(state) + 1 };
  state.dangerousSeas.regions.sw.weather.day = cache.get("calendar.js").namespace.absDay(state) + 1;
  assert.equal(actions.moveToSelected().ok, true); assert.equal(geometry.dangerousSeaAt(state.position), null);
  assert.equal(state.dangerousSeas.regions.sw.forecast, null); assert.equal(state.dangerousSeas.pendingHazard, null);
  const previousGeometry = geometry.dangerousSeaGeometry(), snapshot = world.snapshotWorld();
  assert.equal(world.restoreWorld(snapshot), true);
  assert.notEqual(geometry.dangerousSeaGeometry(), previousGeometry, "世界の復元では索引を再計算する");
  assert.equal(hazards.processDangerousSeaIntroduction(), false, "港では進入案内を出さない");
  state.position = { x: 0, y: 49 };
  assert.equal(hazards.processDangerousSeaIntroduction(), true);
  assert.equal(state.eventQueue[0].kind, "dangerous_sea_intro");
  assert.equal(storage.saveGameToStorage(), true); assert.equal(storage.loadGameFromStorage(), true);
  state.eventQueue = [];
  assert.equal(hazards.processDangerousSeaIntroduction(), false, "一度見た進入案内を再読込で繰り返さない");

  // 固定乱数列で倍率分布を比較し、外縁・核心の順に強い側へ寄ることと編成上限を確認する。
  let seed = 2025; math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  state.fame = 1000;
  const averages = [];
  for (const level of [null, "outer", "core"]) {
    let sum = 0;
    for (let i = 0; i < 500; i++) {
      const enemy = level ? actions.buildDangerousEnemyFormation(state.position, level) : actions.buildEnemyFormation("elite", "pirates");
      assert.equal(enemy.total, enemy.formation.reduce((n, unit) => n + unit.count, 0));
      assert.ok(enemy.total <= 200 && enemy.formation.length <= 20);
      assert.ok(enemy.formation.every(unit => unit.count <= 10 && unit.level >= 1 && unit.level <= 3));
      sum += enemy.total;
    }
    averages.push(sum / 500);
  }
  assert.ok(averages[1] > averages[0] + 8 && averages[2] > averages[1] + 4, plain(averages));
  console.log("危険海域の実モジュール接続: 独立配置・日次・移動・港退避・固定戦闘/荒波の保存復帰・進入案内・強敵分布: 成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
