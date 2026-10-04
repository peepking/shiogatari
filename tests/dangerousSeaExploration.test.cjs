/* eslint-env node */
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @returns {object} 両海域の未生成探索状態。 */
function explorationState() {
  return { nextSiteId: 1, explorationPending: null, regions: { sw: { sites: [], initialized: false, lastTickAbs: -1 }, se: { sites: [], initialized: false, lastTickAbs: -1 } } };
}

/** @returns {number} 抽選の下端。 */
function zero() { return 0; }
/** @returns {number} 抽選の上端。 */
function high() { return 0.999999; }

/** @returns {Promise<void>} 区域・独立枠・固定報酬・旧報酬上限からの独立を検証する。 */
async function main() {
  const modules = new Map();
  /** @param {string} name 論理モジュール名。 @returns {Promise<vm.Module>} 対象モジュール。 */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const module = new vm.SourceTextModule(readSource(name));
    modules.set(name, module);
    await module.link(load);
    return module;
  }
  const geometry = await load("./dangerousSeaGeometry.js");
  await geometry.evaluate();
  const { buildDangerousSeaGeometry } = geometry.namespace;
  const map = Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => ({ terrain: "sea", building: "none" })));
  const ports = [{ kind: "town", pirateHaven: true, coords: { x: 4, y: 45 } }, { kind: "town", pirateHaven: true, coords: { x: 45, y: 45 } }];
  map[45][4].building = "town"; map[45][45].building = "town";
  const beforeMap = JSON.stringify(map), beforePorts = JSON.stringify(ports);
  const shape = buildDangerousSeaGeometry(map, ports);
  assert.equal(JSON.stringify(map), beforeMap);
  assert.equal(JSON.stringify(ports), beforePorts);
  assert.equal(shape.positions.sw.length, 96);
  assert.equal(shape.positions.se.length, 96);
  assert.equal(shape.positions.sw.filter(point => point.level === "core").length, 10);
  assert.equal(shape.byPosition.get("0,46").level, "core");
  assert.equal(shape.byPosition.get("1,46").level, "outer");
  assert.equal(shape.byPosition.has("4,45"), false);
  assert.equal(shape.byPosition.has("45,45"), false);
  map[49][0].terrain = "shoal";
  assert.equal(buildDangerousSeaGeometry(map, ports).byPosition.has("0,49"), false);
  ports.push({ kind: "village", coords: { x: 0, y: 49 } });
  assert.equal(buildDangerousSeaGeometry(map, ports).byPosition.get("0,46").level, "outer");
  const split = Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => ({ terrain: "plain", building: "none" })));
  for (const [x, y] of [[0, 41], [1, 41], [48, 41], [49, 41]]) split[y][x].terrain = "sea";
  const tied = buildDangerousSeaGeometry(split);
  assert.equal(tied.positions.sw.length, 2);
  assert.equal(tied.positions.se.length, 0);

  const exploration = await load("./dangerousSeaExploration.js");
  await exploration.evaluate();
  const { initializeDangerousExploration, tickDangerousExploration, rollDangerousExplorationReward, consumeDangerousExploration, validateDangerousExploration } = exploration.namespace;
  const positions = { sw: [{ x: 0, y: 49, level: "outer" }, { x: 1, y: 49, level: "outer" }, { x: 2, y: 49, level: "core" }, { x: 3, y: 49, level: "core" }],
    se: [{ x: 49, y: 49, level: "core" }, { x: 48, y: 49, level: "core" }, { x: 47, y: 49, level: "outer" }] };
  const data = explorationState();
  initializeDangerousExploration(data, positions, 100, new Set(["1,49"]), zero);
  assert.equal(data.regions.sw.sites.length, 2);
  assert.equal(data.regions.se.sites.length, 2);
  assert.equal(new Set(Object.values(data.regions).flatMap(region => region.sites.map(site => site.id))).size, 4);
  assert.ok(!data.regions.sw.sites.some(site => site.position.x === 1));
  const initialized = JSON.stringify(data);
  initializeDangerousExploration(data, positions, 100, new Set(), high);
  assert.equal(JSON.stringify(data), initialized);
  for (let day = 101; day <= 110; day++) tickDangerousExploration(data, positions, day, new Set(["1,49"]), zero);
  for (const region of Object.values(data.regions)) {
    assert.equal(region.sites.filter(site => site.kind === "drift").length, 2);
    assert.equal(region.sites.filter(site => site.kind === "wreck").length, 1);
  }
  const unchanged = JSON.stringify(data);
  /** @returns {number} 同日の再抽選を拒否する。 */
  function noRepeat() { throw new Error("同日に再抽選した"); }
  tickDangerousExploration(data, positions, 110, new Set(), noRepeat);
  assert.equal(JSON.stringify(data), unchanged);
  const goods = ["spice", "brew", "arms"];
  const outer = data.regions.sw.sites.find(site => site.profile === "danger_outer");
  const coreWreck = data.regions.se.sites.find(site => site.kind === "wreck");
  const outerReward = rollDangerousExplorationReward(outer, goods, ["infantry"], zero);
  assert.equal(outerReward.funds, 900);
  assert.equal(Object.values(outerReward.supplies).reduce((sum, quantity) => sum + quantity, 0), 4);
  const coreReward = rollDangerousExplorationReward(coreWreck, goods, ["infantry"], high);
  assert.equal(coreReward.funds, 3300);
  assert.equal(Object.values(coreReward.supplies).reduce((sum, quantity) => sum + quantity, 0), 24);
  assert.equal(coreReward.troops.infantry, 5);
  assert.equal(coreReward.ships, 0);
  data.explorationPending = { regionId: "se", siteId: coreWreck.id, dayApplied: true, reward: coreReward, encounter: null };
  tickDangerousExploration(data, positions, 400, new Set(), high);
  assert.equal(data.regions.sw.sites.length, 0);
  assert.equal(data.regions.se.sites.length, 1);
  const restored = validateDangerousExploration(JSON.parse(JSON.stringify(data)));
  assert.equal(restored.explorationPending.reward.funds, 3300);
  assert.equal(consumeDangerousExploration(restored, true).funds, 3300);
  assert.equal(consumeDangerousExploration(restored, true), null);
  assert.equal(restored.regions.se.sites.length, 0);
  const losing = validateDangerousExploration(JSON.parse(JSON.stringify(data)));
  assert.equal(consumeDangerousExploration(losing, false), null);
  assert.equal(losing.regions.se.sites.length, 0);
  const corrupted = JSON.parse(JSON.stringify(data));
  corrupted.explorationPending.reward.funds = 3301;
  assert.equal(validateDangerousExploration(corrupted).explorationPending, null);
  const badReference = JSON.parse(JSON.stringify(data));
  badReference.explorationPending.regionId = "__proto__";
  assert.equal(validateDangerousExploration(badReference).explorationPending, null);
  const duplicated = JSON.parse(JSON.stringify(data));
  duplicated.regions.sw.sites.push({ ...duplicated.regions.se.sites[0], regionId: "sw" });
  validateDangerousExploration(duplicated);
  assert.equal(duplicated.regions.se.sites.length, 0);
  const empty = explorationState();
  initializeDangerousExploration(empty, { sw: [], se: [] }, 1, new Set(), zero);
  assert.equal(empty.regions.sw.initialized, true);
  assert.equal(empty.regions.se.initialized, true);
  assert.equal(empty.nextSiteId, 1);
  const threshold = explorationState();
  initializeDangerousExploration(threshold, { sw: [], se: [] }, 1, new Set(), zero);
  tickDangerousExploration(threshold, positions, 2, new Set(), () => 0.05);
  assert.equal(threshold.nextSiteId, 1);
  tickDangerousExploration(threshold, positions, 3, new Set(), () => 1 / 60);
  assert.equal(threshold.regions.sw.sites.filter(site => site.kind === "drift").length, 1);
  assert.equal(threshold.regions.sw.sites.filter(site => site.kind === "wreck").length, 0);
  const wreckModule = await load("./dangerousWreck.js"); await wreckModule.evaluate();
  const wreck = wreckModule.namespace;
  /** @param {Function} random 固定乱数。 @param {number} scouts 有効斥候。 @returns {object} 新しい甲板探索。 */
  function stagedWreck(random = high, scouts = 0) {
    const result = explorationState();
    result.regions.se.sites = [JSON.parse(JSON.stringify(coreWreck))];
    result.explorationPending = wreck.createDangerousWreckPending(coreWreck, coreReward, null, scouts,
      /** @returns {object} 再読込後も同じ固定敵。 */
      () => ({ active: true, dangerousExplorationId: coreWreck.id, dangerousRegionId: "se", enemyFormation: [{ type: "infantry", level: 3, count: 10 }], enemyTotal: 10 }), random);
    return result;
  }
  const staged = stagedWreck(high, 10), stagedPending = staged.explorationPending;
  assert.equal(stagedPending.reward.funds, 3300);
  assert.equal(Object.values(stagedPending.reward.troops).length, 0);
  assert.equal(stagedPending.wreck.branches.cargo.reward.funds, 1650);
  assert.equal(Object.values(stagedPending.wreck.branches.cargo.reward.supplies).reduce((sum, n) => sum + n, 0), 12);
  assert.equal(stagedPending.wreck.branches.rescue.reward.troopLevel, 3);
  assert.equal(stagedPending.wreck.branches.rescue.reward.troops.infantry, 5);
  assert.equal(wreck.chooseDangerousWreckStage(stagedPending, "cargo"), false, "甲板が終わるまでは船倉を選べない");
  assert.equal(wreck.settleDangerousWreckStage(staged, true), null, "日数未適用では受け取れない");
  stagedPending.dayApplied = true; stagedPending.wreck.branches.deck.appliedDays = 1;
  assert.equal(wreck.settleDangerousWreckStage(staged, true).reward.funds, 3300);
  assert.equal(stagedPending.wreck.stage, "choice");
  assert.equal(staged.regions.se.sites.length, 1);
  assert.equal(wreck.settleDangerousWreckStage(staged, true), null, "甲板は二重精算しない");
  assert.equal(wreck.chooseDangerousWreckStage(stagedPending, "cargo"), true);
  assert.equal(wreck.chooseDangerousWreckStage(stagedPending, "rescue"), false, "積荷と救助は両方選べない");
  stagedPending.pausedForHazard = true;
  const paused = validateDangerousExploration(JSON.parse(JSON.stringify(staged)));
  assert.equal(paused.explorationPending.wreck.choice, "cargo");
  assert.equal(paused.explorationPending.dayApplied, false);
  assert.equal(paused.explorationPending.pausedForHazard, true);
  assert.equal(paused.explorationPending.reward.funds, 1650);
  paused.explorationPending.dayApplied = true; paused.explorationPending.wreck.branches.cargo.appliedDays = 1;
  assert.equal(wreck.settleDangerousWreckStage(paused, true).reward.funds, 1650);
  assert.equal(paused.explorationPending, null);
  assert.equal(paused.regions.se.sites.length, 0);
  assert.equal(wreck.settleDangerousWreckStage(paused, true), null);
  const risky = stagedWreck(zero, 0), safe = stagedWreck(() => 0.4, 10), unscouted = stagedWreck(() => 0.4, 0);
  assert.equal(risky.explorationPending.wreck.branches.cargo.reward.funds, 1238, "浸水損失は追加の積荷だけへ適用する");
  assert.equal(risky.explorationPending.reward.funds, 3300);
  assert.equal(risky.explorationPending.wreck.branches.rescue.reward.fragment, true);
  assert.equal(Object.keys(risky.explorationPending.wreck.branches.rescue.reward.troops).length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(risky.explorationPending.wreck.branches.rescue.losses)), { wood: 1, food: 2 });
  assert.equal(unscouted.explorationPending.wreck.branches.cargo.accident, "flood");
  assert.equal(safe.explorationPending.wreck.branches.cargo.accident, null);
  assert.equal(stagedWreck(zero, 10).explorationPending.wreck.branches.rescue.encounter.enemyTotal, 10, "斥候最大でも戦闘の成功を保証しない");
  for (const [count, tier] of [[0, 0], [1, 1], [4, 1], [5, 2], [9, 2], [10, 3]]) assert.equal(wreck.dangerousWreckScoutTier(count), tier);
  assert.ok(wreck.dangerousWreckHints(risky.explorationPending).includes("待ち伏せや浸水"));
  assert.ok(wreck.dangerousWreckHints(safe.explorationPending).includes("救助の足場と退避経路"));
  for (const damaged of ["cargo", "rescue"]) {
    const failed = stagedWreck();
    failed.explorationPending.dayApplied = true; failed.explorationPending.wreck.branches.deck.appliedDays = 1;
    wreck.settleDangerousWreckStage(failed, true);
    wreck.chooseDangerousWreckStage(failed.explorationPending, damaged);
    failed.explorationPending.dayApplied = true; failed.explorationPending.wreck.branches[damaged].appliedDays = 1;
    assert.equal(wreck.settleDangerousWreckStage(failed, false), null);
    assert.equal(failed.explorationPending, null);
    assert.equal(failed.regions.se.sites.length, 0);
  }
  const invalid = JSON.parse(JSON.stringify(staged)); invalid.explorationPending.wreck.branches.cargo.reward.funds = 1651;
  assert.equal(validateDangerousExploration(invalid).explorationPending, null, "追加枝の上限を甲板報酬の上限と分離する");
  const invalidStage = stagedWreck(); invalidStage.explorationPending.wreck.deckClaimed = true;
  assert.equal(validateDangerousExploration(invalidStage).explorationPending, null, "受取印と段階の食い違いを拒否する");
  console.log("危険海域の区域・専用探索・固定報酬・保存復元: 全項目成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
