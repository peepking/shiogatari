const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @returns {Promise<void>} 周期・斥候・保存・退避の意思決定に必要な境界を検証する。 */
async function main() {
  const context = vm.createContext({ Math }), cache = new Map();
  /** @param {string} specifier モジュール名。 @returns {vm.Module} 純粋な依存。 */
  function get(specifier) {
    const name = specifier.replace(/^\.\//, "");
    if (!cache.has(name)) cache.set(name, new vm.SourceTextModule(readSource(name), { context, identifier: name }));
    return cache.get(name);
  }
  const root = get("dangerousSeaState.js"); await root.link(get); await root.evaluate();
  const weather = cache.get("dangerousSeaWeather.js").namespace, rules = root.namespace;
  const retreatModule = get("dangerousSeaRetreat.js"); await retreatModule.link(get); await retreatModule.evaluate();
  const sw = { regionId: "sw", level: "core" };
  for (const [random, expected] of [[0, 12], [0.999, 18]]) {
    const data = rules.createDangerousSeaState();
    weather.updateDangerousWeather(data, 100, 0, () => random);
    assert.equal(data.regions.sw.weather.day, 100 + expected);
    assert.equal(data.regions.se.weather.day, 100 + expected);
  }
  for (const [scouts, lead, avoidance, reduction] of [[0, 3, 0, 0], [1, 5, .15, .1], [4, 5, .15, .1], [5, 8, .3, .2], [9, 8, .3, .2], [10, 10, .4, .3], [99, 10, .4, .3]]) {
    const effect = weather.dangerousScoutRules(scouts);
    assert.equal(effect.lead, lead); assert.equal(effect.waveAvoidance, avoidance); assert.equal(effect.raidReduction, reduction);
  }
  const data = rules.createDangerousSeaState();
  weather.updateDangerousWeather(data, 100, 0, () => .2);
  const date = data.regions.sw.weather.day;
  weather.updateDangerousWeather(data, date - 8, 5, () => { throw new Error("増員で天候を再抽選しない"); });
  assert.equal(data.regions.sw.forecast.day, date); assert.equal(data.regions.sw.forecast.avoided, true);
  weather.updateDangerousWeather(data, date - 7, 0, () => { throw new Error("減員で天候を再抽選しない"); });
  assert.equal(data.regions.sw.forecast.day, date); assert.equal(data.regions.sw.forecast.avoided, true);
  const restored = rules.normalizeDangerousSeas(JSON.parse(JSON.stringify(data)));
  assert.equal(restored.regions.sw.weather.safeRoll, .2); assert.equal(restored.regions.sw.forecast.avoided, true);
  const result = rules.tickDangerousSeaDay(restored, sw, date, {}, () => .99);
  assert.equal(result.kind, "wave_avoided"); assert.equal(restored.pendingHazard, null);
  assert.equal(restored.regions.sw.weather.day, date + 18);
  const outside = rules.createDangerousSeaState();
  weather.updateDangerousWeather(outside, 100, 0, () => .9);
  const oldDay = outside.regions.sw.weather.day;
  rules.tickDangerousSeaDay(outside, null, oldDay + 1, {}, () => .99);
  assert.equal(outside.pendingHazard, null); assert.ok(outside.regions.sw.weather.day > oldDay + 1);
  rules.tickDangerousSeaDay(outside, sw, oldDay + 2, {}, () => .99);
  assert.equal(outside.pendingHazard, null, "域外で過ぎた荒波を帰還時に発生させない");
  const legacy = rules.normalizeDangerousSeas({ regions: { sw: { forecast: { day: 105 } } } });
  weather.updateDangerousWeather(legacy, 100, 0, () => .99);
  assert.equal(legacy.regions.sw.weather.day, 105, "旧予報の日付を引き継ぐ");
  weather.updateDangerousWeather(legacy, 105, 0, () => { throw new Error("表示で予定日を消費しない"); }, false);
  assert.equal(legacy.regions.sw.weather.day, 105);
  for (const [scouts, expectedRaid] of [[0, true], [10, false]]) {
    const raidData = rules.createDangerousSeaState();
    weather.updateDangerousWeather(raidData, 100, scouts, () => .99);
    raidData.regions.sw.alert = 12;
    const raid = rules.tickDangerousSeaDay(raidData, sw, 101, { scouts, createRaid: () => ({ formation: [{}], total: 20 }) }, () => .2);
    assert.equal(raid?.kind === "raid", expectedRaid, "最大25%を斥候10で17.5%へ減らす");
  }
  const grace = rules.createDangerousSeaState(); weather.updateDangerousWeather(grace, 100, 0, () => .99);
  grace.raidSafeUntil = 103;
  for (const day of [101, 102, 103]) assert.equal(rules.tickDangerousSeaDay(grace, { regionId: "se", level: "outer" }, day, {}, () => { throw new Error("再襲撃禁止中は抽選しない"); }), null);
  assert.equal(rules.tickDangerousSeaDay(grace, sw, 104, { createRaid: () => ({ formation: [{}], total: 10 }) }, () => 0).kind, "raid");
  const map = Array.from({ length: 4 }, () => Array(4).fill({ terrain: "sea" }));
  const distances = retreatModule.namespace.dangerousRetreatDistances(map, [{ coords: { x: 3, y: 0 } }], { x: 0, y: 3 }, p => p.x < 3 && p.y > 0 ? sw : null);
  assert.equal(distances.exit, 3); assert.equal(distances.port, 6);
  console.log("危険海域天候: 周期12～18日・斥候予報/回避・固定乱数・域外進行・3日襲撃抑制・退避距離: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
