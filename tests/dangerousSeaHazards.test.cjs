const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @param {unknown} value VM内の値。 @returns {unknown} 検証側の独立した値。 */
function plain(value) { return JSON.parse(JSON.stringify(value)); }

/** @returns {Promise<void>} 日次・予報・固定危険・荒波・再開と保存失敗の境界を検証する。 */
async function main() {
  let randomValue = 0.99, canSave = true, saved = null;
  const math = Object.create(Math); math.random = () => randomValue;
  const state = { year: 1000, season: 0, day: 1, position: { x: 0, y: 49 }, expansion: {}, wanted: {}, eventQueue: [], pendingEncounter: { active: false } };
  const queue = [];
  const elements = { fishingModal: { hidden: true }, battleBlock: { hidden: true }, battleResultModal: { hidden: true } };
  const context = vm.createContext({ structuredClone, Math: math, document: { dispatchEvent() {} }, CustomEvent: class CustomEvent {} });
  const cache = new Map(), formation = { formation: [{ type: "pirate_spear", count: 10, level: 2 }], total: 10 };
  const stubs = {
    "state.js": { state }, "storage.js": { saveGameToStorage() { if (!canSave) return false; saved = plain(state); return true; } },
    "dom.js": { elements, pushLog() {}, pushToast() {}, setOutput() {} },
    "events.js": { enqueueEvent(event) { queue.push(event); state.eventQueue.push(event); } },
    "actions.js": { buildDangerousEnemyFormation() { return structuredClone(formation); } },
    "outfitting.js": { snapshotOutfitting() { return { scouts: 0 }; } },
    "time.js": { advanceDayWithEvents() { state.day++; return 1; } },
    "map.js": { snapshotWorld() { return {}; }, restoreWorld() {} },
    "dangerousSeaWorld.js": { dangerousSeaAt(position) { return position.x < 5 ? { regionId: "sw", level: "outer" } : null; } },
  };
  /** @param {string} specifier 論理名。 @returns {vm.Module} 実際の純粋処理または画面依存の代替。 */
  function get(specifier) {
    const name = specifier.replace(/^\.\//, "");
    if (!cache.has(name)) {
      const values = stubs[name];
      const module = values ? new vm.SyntheticModule(Object.keys(values),
        /** @returns {void} 画面と保存の依存を公開する。 */
        function initialize() { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context })
        : new vm.SourceTextModule(readSource(name), { context, identifier: name });
      cache.set(name, module);
    }
    return cache.get(name);
  }
  const root = get("dangerousSeaHazards.js"); await root.link(get); await root.evaluate();
  const hazards = root.namespace, actualRules = cache.get("dangerousSeaState.js").namespace;
  const rules = { ...actualRules,
    /** @returns {object} 警戒だけの検証では天候を遠い固定日へ置く。 */
    createDangerousSeaState() {
    const data = actualRules.createDangerousSeaState();
    for (const region of Object.values(data.regions)) region.weather = { day: 120100, safeRoll: 0.9, known: false, avoided: false };
    return data;
  } };
  const mode = cache.get("constants.js").namespace.MODE_LABEL;
  const sw = { regionId: "sw", level: "outer" }, core = { regionId: "sw", level: "core" }, se = { regionId: "se", level: "outer" };
  for (const [sea, activity, expected] of [[sw, "move", 1], [core, "move", 2], [sw, "fishing", 2], [core, "wait", 3], [core, "exploration", 3]]) {
    const data = rules.createDangerousSeaState();
    rules.tickDangerousSeaDay(data, sea, 120002, { activity }, () => 0.99);
    assert.equal(data.regions.sw.alert, expected, "活動と外縁・核心に対応する警戒加算");
  }
  const capped = rules.createDangerousSeaState(); capped.regions.sw.alert = 12;
  rules.tickDangerousSeaDay(capped, core, 120002, { activity: "fishing" }, () => 0.99); assert.equal(capped.regions.sw.alert, 12);
  const outside = rules.createDangerousSeaState(); outside.regions.sw.alert = 8;
  for (const [day, expected] of [[1, 8], [2, 8], [3, 6], [4, 4]]) {
    rules.tickDangerousSeaDay(outside, null, 120000 + day, {}, () => { throw new Error("海域外で抽選しない"); });
    assert.equal(outside.regions.sw.alert, expected);
  }
  const brief = rules.createDangerousSeaState(); brief.regions.sw.alert = 8;
  rules.tickDangerousSeaDay(brief, null, 120001); rules.tickDangerousSeaDay(brief, null, 120002);
  rules.tickDangerousSeaDay(brief, sw, 120003, { activity: "move" }, () => 0.99);
  assert.equal(brief.regions.sw.alert, 9); assert.equal(brief.regions.sw.outsideDays, 0);
  rules.tickDangerousSeaDay(brief, se, 120004, { activity: "move" }, () => 0.99);
  assert.equal(brief.regions.sw.alert, 9); assert.equal(brief.regions.sw.outsideDays, 1);
  const detained = rules.createDangerousSeaState(); detained.regions.sw.alert = 8; detained.regions.sw.outsideDays = 2;
  rules.tickDangerousSeaDay(detained, core, 120003, { detained: true }, () => { throw new Error("投獄中は抽選しない"); });
  assert.equal(detained.regions.sw.alert, 6); assert.equal(detained.pendingHazard, null);
  const forecast = rules.createDangerousSeaState();
  forecast.regions.sw.weather.day = 120002;
  rules.tickDangerousSeaDay(forecast, sw, 120001, { activity: "move" }, () => 0.99);
  assert.equal(forecast.regions.sw.forecast.day, 120002); assert.equal(forecast.pendingHazard, null);
  state.dangerousSeas = forecast; assert.equal(hazards.dangerousSeaActionBlocked(), false, "予報だけでは次の活動を止めない");
  const wave = rules.tickDangerousSeaDay(forecast, sw, 120002, { activity: "fishing" }, () => 0.99);
  assert.equal(wave.kind, "wave"); assert.equal(forecast.regions.sw.forecast, null);
  const escapedForecast = rules.createDangerousSeaState(); escapedForecast.regions.sw.forecast = { day: 120002 };
  escapedForecast.regions.sw.weather.day = 120002;
  rules.tickDangerousSeaDay(escapedForecast, null, 120002, {}, () => 0.99);
  assert.equal(escapedForecast.regions.sw.forecast, null); assert.equal(escapedForecast.pendingHazard, null);
  rules.tickDangerousSeaDay(escapedForecast, sw, 120003, { activity: "move" }, () => 0.99);
  assert.equal(escapedForecast.pendingHazard, null, "退避済みの古い予報が後日再発しない");
  const attack = rules.createDangerousSeaState(); attack.action = { id: 11, kind: "fishing", startedAbs: 120001 };
  let rolls = 0, builds = 0;
  const raid = rules.tickDangerousSeaDay(attack, sw, 120002, { createRaid() { builds++; return structuredClone(formation); } }, () => { rolls++; return 0; });
  assert.equal(raid.kind, "raid"); assert.equal(raid.sourceActionId, 11); assert.equal(rolls, 1); assert.equal(builds, 1);
  const duplicateSnapshot = JSON.stringify(attack);
  rules.tickDangerousSeaDay(attack, core, 120002, {}, () => { throw new Error("同日は再抽選しない"); });
  rules.tickDangerousSeaDay(attack, core, 120001, {}, () => { throw new Error("過去日は再抽選しない"); });
  assert.equal(JSON.stringify(attack), duplicateSnapshot);
  rules.tickDangerousSeaDay(attack, sw, 120003, {}, () => { throw new Error("未解決襲撃を重ねない"); });
  assert.equal(attack.pendingHazard.id, raid.id);
  const suppressed = rules.createDangerousSeaState();
  rules.tickDangerousSeaDay(suppressed, sw, 120002, { suppressRaid: true, createRaid() { throw new Error("探索戦闘へ襲撃を重ねない"); } }, () => 0);
  assert.equal(suppressed.pendingHazard, null);
  for (const [amount, expected] of [[0, 0], [19, 0], [20, 1], [39, 1], [40, 2]]) {
    const losses = rules.rollRoughWaveLosses({ fish: amount }, () => 0);
    assert.equal(Object.values(losses).reduce((sum, n) => sum + n, 0), expected, "所持釣果総数の五％を切り捨てる");
  }
  const inventory = { scarce: 4, common: 16 }, inventoryBefore = JSON.stringify(inventory), aggregate = { scarce: 0, common: 0 };
  for (let i = 0; i < 20; i++) {
    const losses = rules.rollRoughWaveLosses(inventory, () => (i + 0.5) / 20);
    for (const [id, count] of Object.entries(losses)) aggregate[id] += count;
  }
  assert.deepEqual(aggregate, { scarce: 4, common: 16 }, "全個体を等確率で選び、魚種を等確率にしない");
  assert.equal(JSON.stringify(inventory), inventoryBefore, "損失内訳の確定ではまだ在庫を減らさない");
  assert.deepEqual(plain(rules.rollRoughWaveLosses({ single: 1, other: 99 }, () => 0)), { single: 1, other: 4 }, "同じ個体を重複選択しない");
  const large = rules.rollRoughWaveLosses({ fish: 100000 }, () => 0.5); assert.equal(large.fish, 5000);
  const game = { dangerousSeas: rules.createDangerousSeaState(), supplies: { wood: 2, fiber: 0 },
    expansion: { fishing: { counts: { fish: 100 }, codex: { fish: { count: 100, maxSize: 70, maxDay: 120001, maxPlace: "南西" } }, rewards: ["known"] } },
    voyageStats: { fishCaught: 100 } };
  game.dangerousSeas.pendingHazard = { id: 7, kind: "wave", regionId: "sw", stage: "displaying", losses: { fish: 5 } };
  const missingMaterial = JSON.stringify(game);
  assert.equal(rules.resolveRoughWave(game, 7, true), null); assert.equal(JSON.stringify(game), missingMaterial, "繊維不足では木材も消費しない");
  game.supplies.fiber = 3;
  assert.deepEqual(plain(rules.resolveRoughWave(game, 7, true)), { protected: true, lost: 0 });
  assert.deepEqual(game.supplies, { wood: 1, fiber: 2 }); assert.equal(game.expansion.fishing.counts.fish, 100);
  const protectedSnapshot = JSON.stringify(game); assert.equal(rules.resolveRoughWave(game, 7, true), null); assert.equal(JSON.stringify(game), protectedSnapshot);
  game.dangerousSeas.pendingHazard = { id: 8, kind: "wave", regionId: "sw", stage: "displaying", losses: { fish: 5 } };
  const codexBefore = JSON.stringify(game.expansion.fishing.codex), rewardsBefore = JSON.stringify(game.expansion.fishing.rewards);
  assert.deepEqual(plain(rules.resolveRoughWave(game, 8, false)), { protected: false, lost: 5 });
  assert.equal(game.expansion.fishing.counts.fish, 95); assert.equal(JSON.stringify(game.expansion.fishing.codex), codexBefore);
  assert.equal(JSON.stringify(game.expansion.fishing.rewards), rewardsBefore); assert.equal(game.voyageStats.fishCaught, 100);
  assert.equal(rules.resolveRoughWave(game, 8, false), null);
  game.expansion.fishing.counts = { fish: 19, single: 1 };
  game.dangerousSeas.pendingHazard = { id: 9, kind: "wave", regionId: "sw", stage: "displaying", losses: { single: 1 } };
  rules.resolveRoughWave(game, 9, false);
  assert.equal(Object.hasOwn(game.expansion.fishing.counts, "single"), false, "失った最後の一匹を在庫表示に残さない");
  const restoredRaid = rules.normalizeDangerousSeas(plain(attack));
  assert.equal(restoredRaid.pendingHazard.id, raid.id); assert.equal(restoredRaid.pendingHazard.stage, "action_running");
  assert.deepEqual(plain(restoredRaid.pendingHazard.encounter), plain(raid.encounter));
  const reloadSnapshot = JSON.stringify(restoredRaid);
  rules.tickDangerousSeaDay(restoredRaid, sw, 120003, {}, () => { throw new Error("復帰した同日危険は再抽選しない"); });
  assert.equal(JSON.stringify(restoredRaid), reloadSnapshot);
  const restoredWave = rules.normalizeDangerousSeas({ pendingHazard: { id: 20, kind: "wave", regionId: "se", stage: "displaying", losses: { fish: 5 } } });
  assert.deepEqual(plain(restoredWave.pendingHazard.losses), { fish: 5 }); assert.equal(restoredWave.nextEventId, 21);
  assert.equal(rules.normalizeDangerousSeas({ pendingHazard: { id: 1, kind: "raid", regionId: "sw", encounter: { formation: [] } } }).pendingHazard, null);
  state.dangerousSeas = restoredRaid; state.modeLabel = mode.NORMAL; state.pendingEncounter = { active: false };
  state.expansion = { fishing: { pending: { castsLeft: 3 }, counts: { fish: 40 } } }; state.eventQueue = [];
  assert.equal(hazards.processDangerousSeaHazards(), false); assert.equal(state.dangerousSeas.pendingHazard.stage, "action_running");
  hazards.finishDangerousSeaAction("wait"); assert.equal(state.dangerousSeas.action.kind, "fishing", "別の行動から釣りを終えない");
  state.expansion.fishing.pending = null; hazards.finishDangerousSeaAction("fishing");
  assert.equal(state.dangerousSeas.pendingHazard.stage, "ready");
  canSave = false; assert.equal(hazards.processDangerousSeaHazards(), false);
  assert.equal(state.pendingEncounter.active, false); assert.equal(state.modeLabel, mode.NORMAL); assert.equal(state.dangerousSeas.pendingHazard.stage, "ready");
  canSave = true; assert.equal(hazards.processDangerousSeaHazards(), true);
  assert.equal(state.pendingEncounter.dangerousHazardId, raid.id); assert.equal(saved.dangerousSeas.pendingHazard.stage, "battle");
  assert.deepEqual(plain(state.pendingEncounter.enemyFormation), plain(raid.encounter.formation));
  assert.equal(hazards.processDangerousSeaHazards(), false);
  hazards.finishDangerousSeaEncounter({ dangerousHazardId: raid.id + 1 }); assert.ok(state.dangerousSeas.pendingHazard);
  hazards.finishDangerousSeaEncounter(state.pendingEncounter); assert.equal(state.dangerousSeas.pendingHazard, null);
  hazards.finishDangerousSeaEncounter(state.pendingEncounter); assert.equal(state.dangerousSeas.pendingHazard, null);
  state.pendingEncounter = { active: false }; state.modeLabel = mode.NORMAL; state.dangerousSeas = rules.createDangerousSeaState();
  state.dangerousSeas.action = { id: 1, kind: "fishing", startedAbs: 120001 };
  state.dangerousSeas.pendingHazard = { id: 1, kind: "wave", regionId: "sw", stage: "action_running", losses: null };
  state.expansion.fishing.counts.fish = 60; hazards.finishDangerousSeaAction("fishing");
  assert.equal(Object.values(state.dangerousSeas.pendingHazard.losses).reduce((sum, n) => sum + n, 0), 3, "同じ日の新しい釣果を含め、終了時の在庫で損失を固定する");
  canSave = false; assert.equal(hazards.processDangerousSeaHazards(), false); assert.equal(state.dangerousSeas.pendingHazard.stage, "ready");
  canSave = true; state.supplies = { wood: 1, fiber: 1 }; assert.equal(hazards.processDangerousSeaHazards(), true);
  assert.equal(queue.at(-1).actions.length, 2); assert.equal(saved.dangerousSeas.pendingHazard.stage, "displaying");
  const fixedLosses = JSON.stringify(state.dangerousSeas.pendingHazard.losses), queueSize = queue.length;
  randomValue = 0; assert.equal(hazards.processDangerousSeaHazards(), false); assert.equal(queue.length, queueSize);
  state.eventQueue = []; assert.equal(hazards.processDangerousSeaHazards(), true);
  assert.equal(JSON.stringify(state.dangerousSeas.pendingHazard.losses), fixedLosses, "通知を復元しても損失内訳は再抽選しない");
  rules.resolveRoughWave(state, 1, false); state.eventQueue = [];
  state.dangerousSeas.pendingHazard = { id: 2, kind: "wave", regionId: "sw", stage: "ready", losses: {} };
  assert.equal(hazards.processDangerousSeaHazards(), true);
  assert.equal(queue.at(-1).actions.length, 1); assert.equal(queue.at(-1).actions[0].type, "dangerous_wave_accept", "被害なしでは資材消費を提示しない");
  state.eventQueue = []; state.dangerousSeas = rules.createDangerousSeaState();
  state.dangerousSeas.pendingHazard = { id: 31, kind: "raid", regionId: "sw", stage: "ready", encounter: structuredClone(formation), detected: true, arrivalDay: 120002, evasionSuccess: false };
  assert.equal(hazards.processDangerousSeaHazards(), true);
  assert.equal(state.dangerousSeas.pendingHazard.stage, "warning");
  assert.equal(queue.at(-1).kind, "dangerous_raid_warning"); assert.equal(state.pendingEncounter.active, false, "察知時は戦闘へ直行しない");
  const continueAction = { type: "dangerous_raid_continue", payload: { id: 31 } };
  canSave = false; assert.equal(hazards.handleDangerousRaidAction(continueAction), false);
  assert.equal(state.dangerousSeas.pendingHazard.stage, "warning", "保存失敗は未選択へ戻す");
  canSave = true; assert.equal(hazards.handleDangerousRaidAction(continueAction), true);
  Object.assign(state, structuredClone(saved));
  assert.ok(state.eventQueue.some(event => event.kind === "dangerous_raid_warning"));
  assert.equal(hazards.processDangerousSeaHazards(), false);
  assert.equal(state.eventQueue.length, 0, "選択保存直後の再読込で古い警告を消し、watchをロックしない");
  state.eventQueue = []; assert.equal(hazards.dangerousSeaActionBlocked(), false, "警告の続行後は次の日の活動を選べる");
  assert.ok(hazards.beginDangerousSeaAction("fishing"));
  rules.tickDangerousSeaDay(state.dangerousSeas, sw, 120002, { activity: "fishing" }, () => .99);
  assert.equal(state.dangerousSeas.pendingHazard.stage, "action_running");
  hazards.finishDangerousSeaAction("fishing"); assert.equal(hazards.processDangerousSeaHazards(), true);
  assert.equal(state.pendingEncounter.dangerousHazardId, 31, "翌日の活動後も察知した固定編成を使う");
  hazards.finishDangerousSeaEncounter(state.pendingEncounter); assert.equal(state.dangerousSeas.raidSafeUntil, 120004);
  state.pendingEncounter = { active: false }; state.modeLabel = mode.NORMAL; state.eventQueue = [];
  state.dangerousSeas.pendingHazard = { id: 32, kind: "raid", regionId: "sw", stage: "warning", encounter: structuredClone(formation), evasionSuccess: true,
    deferredWave: { regionId: "sw", day: 120002 } };
  const previousDay = state.day;
  assert.equal(hazards.handleDangerousRaidAction({ type: "dangerous_raid_evade", payload: { id: 32 } }), true);
  assert.equal(state.day, previousDay + 1); assert.equal(state.dangerousSeas.pendingHazard.kind, "wave", "回避した日の荒波を消さず一件引き継ぐ");
  const evaded = JSON.stringify(state); assert.equal(hazards.handleDangerousRaidAction({ type: "dangerous_raid_evade", payload: { id: 32 } }), false);
  assert.equal(JSON.stringify(state), evaded, "回避日数の二重適用をしない");
  state.dangerousSeas.pendingHazard = { id: 33, kind: "raid", regionId: "sw", stage: "warning", encounter: structuredClone(formation), evasionSuccess: false };
  assert.equal(hazards.handleDangerousRaidAction({ type: "dangerous_raid_evade", payload: { id: 33 } }), true);
  assert.equal(state.dangerousSeas.pendingHazard.stage, "ready"); assert.equal(state.dangerousSeas.pendingHazard.warningAccepted, true);
  assert.equal(hazards.processDangerousSeaHazards(), true); assert.equal(state.pendingEncounter.dangerousHazardId, 33);
  console.log("危険海域日次: 警戒・予報・排他・固定荒波・資材同時消費・図鑑維持・保存再開: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
