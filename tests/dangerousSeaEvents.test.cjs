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
    assert.equal(event.expiresAbs, 120001 + 9 + config.DANGEROUS_SEA_EVENT_DEFS[kind].days + 5);
    assert.equal(rules.spawnDangerousSeaEvent(data, regionId, kind, point, 120001, enemy, sequence([])), null, "同海域一枠を超えない");
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
  await verifyWorld();
  console.log("dangerousSeaEvents: 五種・固定正体・期限・斥候・排他選択・回遊・日次一意性の検証成功");
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
    "dangerousSeaWorld.js": { getDangerousSeaPositions: id => id === "sw" ? [{ x: 0, y: 49 }, { x: 1, y: 49 }] : [{ x: 49, y: 49 }], dangerousSeaAt: () => ({ level: "outer" }) },
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
  assert.equal(world.afterDangerousSeaWave("sw"), null, "荒波後も活動中一枠を維持する");
  state.dangerousSeas.regions.se.lastWaveAbs = 120002;
  random = sequence([0, 0.9]); assert.equal(world.afterDangerousSeaWave("se").kind, "storm_aftermath", "海域外でも荒波後に残骸を置く");
  random = sequence([]); assert.equal(world.afterDangerousSeaWave("se"), null);
  state.position = { x: 2, y: 49 }; world.updateDangerousSeaEvents(); assert.equal(event.discovered, false, "斥候ゼロでは現地で発見する");
  scouts = 1; world.updateDangerousSeaEvents(); assert.equal(event.discovered, true); assert.equal(event.hintTier, 1);
  scouts = 10; world.updateDangerousSeaEvents(); assert.equal(event.hintTier, 10);
  scouts = 0; world.updateDangerousSeaEvents(); assert.equal(event.hintTier, 10, "発見した内容は減員で失わない");
  const reservations = cache.get("dangerousSeaReservations.js").namespace.worldReservedPositions(state);
  assert.ok(reservations.has("1,49") && reservations.has("49,49"));
  state.day = event.expiresAbs - 120000;
  state.dangerousSeas.events.pending = { eventId: event.id, regionId: "sw" };
  random = () => 0.99; world.updateDangerousSeaEvents(true); assert.ok(state.dangerousSeas.events.active.sw, "期限中に開始した保留は確認まで残す");
  state.dangerousSeas.events.pending = null; state.day++; world.updateDangerousSeaEvents(true); assert.equal(state.dangerousSeas.events.active.sw, null);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
