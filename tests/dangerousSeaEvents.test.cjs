const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");
const { loadTestModule } = require("./helpers/module.cjs");

/** @param {*} value VM内の値。 @returns {*} 通常の値。 */
function plain(value) { return JSON.parse(JSON.stringify(value)); }

/** @param {number[]} values 乱数列。 @returns {Function} 余分な抽選を検出する乱数。 */
function sequence(values) {
  let index = 0;
  return () => { assert.ok(index < values.length, "再抽選しない"); return values[index++]; };
}

/** @returns {Promise<void>} 固定正体・期限・排他報酬・鐘進行・保存と世界更新を検証する。 */
async function main() {
  const context = vm.createContext({ structuredClone });
  const rules = (await loadTestModule("dangerousSeaEventState.js", context)).namespace;
  const config = (await loadTestModule("dangerousSeaEventConfig.js", context)).namespace;
  const point = [{ x: 0, y: 49, level: "outer", travelDays: 9 }];
  const enemy = () => ({ formation: [{ type: "pirate_spear", level: 2, count: 10 }, { type: "raider_cavalry", level: 3, count: 5 }] });
  assert.equal(rules.normalizeDangerousSeaEvents().pending, null, "旧保存に領域がなくても復元できる");
  assert.equal(rules.normalizeDangerousSeaEvents(null).pending, null);
  for (const kind of Object.keys(config.DANGEROUS_SEA_EVENT_DEFS)) {
    const data = rules.createDangerousSeaEvents(), regionId = kind === "seabed_bell" ? "se" : "sw";
    const event = rules.spawnDangerousSeaEvent(data, regionId, kind, point, 120001, enemy, () => 0.9);
    assert.ok(event, kind);
    assert.equal(event.expiresAbs, 120001 + 9 + config.DANGEROUS_SEA_EVENT_DEFS[kind].days + 10);
    assert.equal(rules.spawnDangerousSeaEvent(data, regionId, kind, point, 120001, enemy, sequence([])), null, "同海域の同じ枠を超えない");
    assert.deepEqual(plain(rules.normalizeDangerousSeaEvents(plain(data))), plain(data), `${kind}の正体・報酬・期限を保持`);
  }
  assert.equal(rules.spawnDangerousSeaEvent(rules.createDangerousSeaEvents(), "sw", "seabed_bell", point, 120001, enemy, sequence([])), null);
  const trapData = rules.createDangerousSeaEvents();
  const trap = rules.spawnDangerousSeaEvent(trapData, "sw", "fog_light", point, 120001, enemy, sequence([0, 0.9, 0.4]));
  assert.equal(trap.variant, "trap");
  assert.equal(trap.encounter.dangerousEventId, trap.id);
  assert.equal(trap.encounter.dangerousRegionId, "sw");
  assert.equal(trap.encounter.storyId, undefined, "海賊王物語の参照を使わない");
  assert.deepEqual(plain(rules.normalizeDangerousSeaEvents(plain(trapData)).active.sw.encounter), plain(trap.encounter), "既存海賊兵も固定復元する");
  trapData.pending = { eventId: trap.id, regionId: "sw", stage: "battle", choice: "investigate", dayApplied: true, scoutTier: 5,
    pausedForHazard: false, applied: false, complete: true, accident: false, reward: trap.rewards.trap, encounter: trap.encounter, resultText: "罠" };
  assert.equal(rules.normalizeDangerousSeaEvents(plain(trapData)).pending.dayApplied, true);
  const treasure = rules.spawnDangerousSeaEvent(rules.createDangerousSeaEvents(), "sw", "sinking_treasure", point, 120001, enemy, () => 0.9);
  const cargo = rules.dangerousSeaEventOutcome(treasure, "cargo", 0), rescue = rules.dangerousSeaEventOutcome(treasure, "rescue", 0);
  assert.equal(cargo.reward.funds, 3000); assert.deepEqual(plain(cargo.reward.troops), {});
  assert.equal(rescue.reward.funds, 300); assert.deepEqual(plain(rescue.reward.supplies), {});
  assert.deepEqual(plain(rescue.reward.troops), { marine: 4, scout: 2 }, "積荷と救助を混ぜない");
  treasure.accidentRoll = 0.1;
  assert.equal(rules.dangerousSeaEventOutcome(treasure, "cargo", 0).reward.funds, 1500);
  assert.equal(rules.dangerousSeaEventOutcome(treasure, "cargo", 10).reward.funds, 3000, "斥候で事故を減らす");
  assert.deepEqual(plain(rules.dangerousSeaEventOutcome(treasure, "rescue", 0).reward.troops), { marine: 4, scout: 2 });
  const bellData = rules.createDangerousSeaEvents(), bell = rules.spawnDangerousSeaEvent(bellData, "se", "seabed_bell", point, 120001, enemy, () => 0.9);
  assert.equal(rules.dangerousSeaEventOutcome(bell, "descend", 0), null, "鐘の段階を飛ばせない");
  assert.equal(rules.dangerousSeaEventOutcome(bell, "listen", 0).complete, false);
  bell.progress = 1; assert.equal(rules.dangerousSeaEventOutcome(bell, "descend", 0).reward.funds, 0);
  bell.progress = 2; assert.equal(rules.dangerousSeaEventOutcome(bell, "answer", 0).reward.funds, 2200);
  assert.equal(rules.closeDangerousSeaEvent(bellData, bell.id, 120004), true);
  assert.equal(rules.closeDangerousSeaEvent(bellData, bell.id, 120004), false, "履歴へ二重移動しない");
  assert.equal(bellData.history.length, 1);
  const migrationData = rules.createDangerousSeaEvents(), migration = rules.spawnDangerousSeaEvent(migrationData, "se", "fish_migration", point, 120001, enemy, () => 0.9);
  assert.equal(new Set(migration.fishIds).size, 3);
  const game = { dangerousSeas: { events: migrationData } };
  assert.equal(rules.migrationFishIds(game, "se", 120001).length, 3);
  assert.equal(rules.migrationFishIds(game, "sw", 120001).length, 0);
  assert.equal(rules.migrationFishIds(game, "se", migration.expiresAbs).length, 0, "期限から優遇を終了する");
  verifyIndependentSlots(rules, point, enemy);
  await verifyWorld();
  console.log("dangerousSeaEvents: 五種・独立枠・旧保存移行・固定結果・期限・斥候・日次一意性の検証成功");
}

/** 両枠の共存と独立終了、旧置き土産の各途中段階を再抽選なく移行する。 @param {object} rules 状態処理。 @param {object[]} point 候補。 @param {Function} enemy 敵生成。 @returns {void} */
function verifyIndependentSlots(rules, point, enemy) {
  const data = rules.createDangerousSeaEvents();
  for (const regionId of ["sw", "se"]) {
    const normal = rules.spawnDangerousSeaEvent(data, regionId, "fish_migration", point, 120001, enemy, () => .9);
    const storm = rules.spawnDangerousSeaEvent(data, regionId, "storm_aftermath", [{ ...point[0], x: 1 }], 120001, enemy, () => .9);
    assert.ok(normal && storm, "回遊があっても置き土産を別枠へ生成する");
    assert.equal(rules.migrationFishIds({ dangerousSeas: { events: data } }, regionId, 120001).length, 3, "置き土産で回遊効果を遮らない");
    assert.equal(rules.spawnDangerousSeaEvent(data, regionId, "sinking_treasure", point, 120001, enemy, sequence([])), null, "通常の四種は一枠を共有する");
  }
  assert.equal(rules.activeDangerousSeaEvents(data).length, 4);
  assert.equal(new Set(rules.activeDangerousSeaEvents(data).map(event => event.id)).size, 4);
  assert.deepEqual(plain(rules.normalizeDangerousSeaEvents(plain(data))), plain(data), "両海域の全四枠を固定復元する");
  const storm = data.stormAftermath.sw, normal = data.active.sw;
  assert.equal(rules.getDangerousSeaEventById(data, storm.id), storm);
  assert.equal(rules.getDangerousSeaEventById(data, normal.id), normal);
  assert.equal(rules.getDangerousSeaEventById(data, 9999), null);
  assert.equal(rules.closeDangerousSeaEvent(data, storm.id, 120002), true);
  assert.equal(data.stormAftermath.sw, null); assert.equal(data.active.sw, normal, "置き土産の終了で他イベントを消さない");
  const replacement = rules.spawnDangerousSeaEvent(data, "sw", "storm_aftermath", point, 120002, enemy, () => .9);
  assert.ok(replacement);
  assert.equal(rules.closeDangerousSeaEvent(data, normal.id, 120002), true);
  assert.equal(data.stormAftermath.sw, replacement, "他イベントの終了で置き土産を消さない");

  for (const stage of ["choice", "action", "result"]) {
    const legacy = rules.createDangerousSeaEvents();
    const event = rules.spawnDangerousSeaEvent(legacy, "sw", "storm_aftermath", point, 120001, enemy, () => .9);
    const outcome = rules.dangerousSeaEventOutcome(event, "recover", 5);
    legacy.active.sw = event; delete legacy.stormAftermath; legacy.version = 1;
    legacy.pending = { eventId: event.id, regionId: "sw", stage, choice: stage === "choice" ? null : "recover", dayApplied: stage !== "choice",
      scoutTier: 5, pausedForHazard: stage === "action", reward: outcome.reward, encounter: null, applied: stage === "result",
      complete: true, accident: outcome.accident, resultText: outcome.resultText };
    const restored = rules.normalizeDangerousSeaEvents(plain(legacy));
    assert.equal(restored.version, 2); assert.equal(restored.active.sw, null);
    assert.deepEqual(plain(restored.stormAftermath.sw), plain(event), `${stage}: ID・位置・期限・固定乱数・報酬を保持して専用枠へ移す`);
    assert.deepEqual(plain(restored.pending), plain(legacy.pending), `${stage}: 途中参照・日数・支給済み印を維持する`);
    assert.deepEqual(plain(rules.normalizeDangerousSeaEvents(plain(restored))), plain(restored), "再読み込みで移行を繰り返さない");
    const other = rules.spawnDangerousSeaEvent(restored, "sw", "sinking_treasure", [{ ...point[0], x: 2 }], 120002, enemy, () => .9);
    assert.ok(other); assert.notEqual(other.id, event.id, "移行後もIDを共有せず他イベントを生成できる");
    const mismatch = plain(restored); mismatch.pending.regionId = "se";
    assert.equal(rules.normalizeDangerousSeaEvents(mismatch).pending, null, "IDがあっても別海域の途中参照は除外する");
  }
}

/** @returns {Promise<void>} 日次生成と波後生成・予約・斥候の公開段階を実モジュールで検証する。 */
async function verifyWorld() {
  const state = { year: 1000, season: 0, day: 1, position: { x: 20, y: 20 }, wanted: {}, dangerousSeas: { regions: { sw: {}, se: {} } },
    expansion: { exploration: { sites: [{ position: { x: 0, y: 49 } }] } } };
  let random = () => 0.99, scouts = 0;
  const math = Object.create(Math); math.random = () => random();
  const context = vm.createContext({ structuredClone, Math: math }), cache = new Map();
  const stubs = {
    "state.js": { state }, "map.js": { settlements: [{ pirateHaven: true, coords: { x: 4, y: 45 } }, { pirateHaven: true, coords: { x: 45, y: 45 } }] },
    "outfitting.js": { snapshotOutfitting: () => ({ scouts }) },
    "actions.js": { buildDangerousEnemyFormation: () => ({ formation: [{ type: "pirate_spear", level: 2, count: 10 }] }) },
    "dangerousSeaWorld.js": { getDangerousSeaPositions: id => id === "sw" ? [{ x: 0, y: 49 }, { x: 1, y: 49 }, { x: 2, y: 49 }] : [{ x: 49, y: 49 }, { x: 48, y: 49 }], dangerousSeaAt: () => ({ level: "outer" }) },
  };
  /** @param {string} path 依存。 @returns {vm.Module} 実処理か世界依存の代替。 */
  function get(path) {
    const name = path.replace(/^\.\//, "");
    if (!cache.has(name)) {
      const values = stubs[name];
      cache.set(name, values ? new vm.SyntheticModule(Object.keys(values), function publish() {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, { context }) : new vm.SourceTextModule(readSource(name), { context }));
    }
    return cache.get(name);
  }
  const root = get("dangerousSeaEventWorld.js"); await root.link(get); await root.evaluate();
  const world = root.namespace;
  world.updateDangerousSeaEvents();
  assert.equal(state.dangerousSeas.events.active.sw, null, "初期同期では出現抽選しない");
  state.day++;
  random = sequence([0, 0.4, 0, 0.9, 0.1, 0.2, 0.3, 0.99]);
  world.updateDangerousSeaEvents(true);
  const event = state.dangerousSeas.events.active.sw;
  assert.equal(event.kind, "fish_migration"); assert.deepEqual(plain(event.position), { x: 1, y: 49 }, "通常探索の予約を避ける");
  random = sequence([]); world.updateDangerousSeaEvents(true); assert.equal(state.dangerousSeas.events.active.sw.id, event.id, "同日再同期で抽選しない");
  state.dangerousSeas.regions.sw.lastWaveAbs = 120002;
  random = sequence([0, .9]);
  const swStorm = world.afterDangerousSeaWave("sw");
  assert.equal(swStorm.kind, "storm_aftermath", "他のイベントがあっても荒波後に独立生成する");
  assert.deepEqual(plain(swStorm.position), { x: 2, y: 49 }, "置き土産は通常探索と他イベントの予約を避ける");
  assert.equal(state.dangerousSeas.events.active.sw, event);
  state.dangerousSeas.regions.se.lastWaveAbs = 120002;
  random = sequence([0, 0.9]); assert.equal(world.afterDangerousSeaWave("se").kind, "storm_aftermath", "海域外でも荒波後に残骸を置く");
  random = sequence([]); assert.equal(world.afterDangerousSeaWave("se"), null);
  assert.equal(world.afterDangerousSeaWave("sw"), null, "同じ荒波から両枠へ重複生成しない");
  state.day++;
  random = sequence([0, .6, 0, .9]); world.updateDangerousSeaEvents(true);
  const seNormal = state.dangerousSeas.events.active.se;
  assert.equal(seNormal.kind, "sinking_treasure", "置き土産の占有中も通常枠で日次抽選する");
  assert.deepEqual(plain(seNormal.position), { x: 48, y: 49 }, "他イベントも置き土産の予約を避ける");
  state.day++; state.dangerousSeas.regions.sw.lastWaveAbs = 120004;
  random = sequence([]); world.updateDangerousSeaEvents(true);
  assert.equal(state.dangerousSeas.events.stormAftermath.sw.id, swStorm.id, "次の波でも未回収の置き土産を上書きしない");
  state.position = { x: 2, y: 49 }; world.updateDangerousSeaEvents(); assert.equal(event.discovered, false, "斥候ゼロでは現地で発見する");
  assert.equal(swStorm.discovered, true);
  scouts = 1; world.updateDangerousSeaEvents(); assert.equal(event.discovered, true); assert.equal(event.hintTier, 1);
  scouts = 10; world.updateDangerousSeaEvents(); assert.equal(event.hintTier, 10);
  scouts = 0; world.updateDangerousSeaEvents(); assert.equal(event.hintTier, 10, "発見した内容は減員で失わない");
  assert.equal(world.visibleDangerousSeaEvents().length, 2, "同海域の両枠を発見情報へ公開する");
  assert.equal(world.getDangerousSeaEventAt(swStorm.position).id, swStorm.id);
  assert.equal(world.getDangerousSeaEventAt(event.position).id, event.id);
  const reservations = cache.get("dangerousSeaReservations.js").namespace.worldReservedPositions(state);
  assert.ok(["1,49", "2,49", "49,49", "48,49"].every(key => reservations.has(key)), "全四枠の位置を同時予約する");
  swStorm.expiresAbs = 120005;
  state.day = 5; state.dangerousSeas.events.pending = { eventId: swStorm.id, regionId: "sw" };
  random = sequence([]); world.updateDangerousSeaEvents(true);
  assert.equal(state.dangerousSeas.events.stormAftermath.sw.id, swStorm.id, "開始済みの置き土産は期限から保護する");
  state.dangerousSeas.events.pending = null; state.day++; world.updateDangerousSeaEvents(true);
  assert.equal(state.dangerousSeas.events.stormAftermath.sw, null, "置き土産の期限切れは専用枠だけ空ける");
  assert.equal(state.dangerousSeas.events.active.sw.id, event.id);
  assert.equal(world.afterDangerousSeaWave("sw"), null, "満枠時に処理済みの波を後から再生成しない");
  state.day = event.expiresAbs - 120000;
  state.dangerousSeas.events.pending = { eventId: event.id, regionId: "sw" };
  random = () => 0.99; world.updateDangerousSeaEvents(true); assert.ok(state.dangerousSeas.events.active.sw, "期限中に開始した保留は確認まで残す");
  state.dangerousSeas.events.pending = null; state.day++; world.updateDangerousSeaEvents(true); assert.equal(state.dangerousSeas.events.active.sw, null);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
