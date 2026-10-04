/* eslint-env node */
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @returns {void} 配置と無関係な通知を省略する。 */
function noop() {}

/** @returns {Promise<void>} 通常依頼・海図・賞金首・物語・港移設が専用地点を避けるか検証する。 */
async function main() {
  const math = Object.create(Math); math.random = () => 0;
  const game = { year: 0, season: 0, day: 1, position: { x: 0, y: 30 },
    expansion: { exploration: { sites: [] }, charts: { active: [] } },
    quests: { active: [], availableBySettlement: {} }, nobleQuests: { availableByNoble: {} },
    dangerousSeas: { regions: { sw: { sites: [{ position: { x: 0, y: 40 } }] }, se: { sites: [] } }, bounties: { active: [{ position: { x: 1, y: 40 } }] } } };
  const grid = Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => ({ terrain: "plain", building: "none" })));
  for (let x = 0; x <= 10; x++) grid[40][x].terrain = "sea";
  const stubs = {
    "state.js": { state: game }, "map.js": { mapData: grid, settlements: [] },
    "supplies.js": { SUPPLY_ITEMS: [], SUPPLY_TYPES: {} },
    "voyageStats.js": { receiveFunds: noop, spendFunds: noop, recordVoyage: noop },
    "events.js": { enqueueEvent: noop }, "dom.js": { pushLog: noop, pushToast: noop },
    "storage.js": { scheduleGameSave: noop }, "lore.js": { FACTIONS: [] }, "faction.js": { adjustNobleFavor: noop },
    "fleet.js": { addVariantShip: noop, addShips: noop, prepareShipReward: noop, shipListText: noop }, "playerWanted.js": { expireWanted: () => false },
  };
  const context = vm.createContext({ Math: math, structuredClone, console }), modules = new Map();
  /** @param {string} specifier 論理モジュール名。 @returns {vm.Module} 実際の配置処理または通知の代替。 */
  function get(specifier) {
    const key = specifier.replace(/^\.\//, "");
    if (modules.has(key)) return modules.get(key);
    const exports = stubs[key];
    const module = exports ? new vm.SyntheticModule(Object.keys(exports),
      /** @returns {void} 外部依存の代替値を公開する。 */
      function initialize() { for (const [name, value] of Object.entries(exports)) this.setExport(name, value); }, { context })
      : new vm.SourceTextModule(readSource(key), { context, identifier: key });
    modules.set(key, module);
    return module;
  }
  /** @param {string} name 対象名。 @returns {Promise<object>} 評価済みの公開関数。 */
  async function load(name) {
    const module = get(name);
    if (module.status === "unlinked") await module.link(get);
    if (module.status !== "evaluated") await module.evaluate();
    return module.namespace;
  }
  const reservations = await load("dangerousSeaReservations.js");
  assert.equal(reservations.dangerousSeaReservedPositions(game).length, 2);
  assert.ok(["0,40", "1,40"].every(key => reservations.worldReservedPositions(game).has(key)));
  const quests = await load("questUtils.js");
  const sea = await load("dangerousSeaWorld.js");
  assert.deepEqual(JSON.parse(JSON.stringify(quests.randomSeaTarget(game.position))), { x: 8, y: 40 }, "通常神託は円内の空きマスを避け、削った角側の通常海を使える");
  const hunt = quests.randomHuntTarget({ x: 1, y: 40 }, 1, 1, [{ x: 1, y: 39 }, { x: 1, y: 41 }]);
  assert.equal(sea.dangerousSeaAt(hunt), null, "通常討伐の範囲を緩和しても危険海域を使わない");
  const chart = await load("chartWorld.js");
  assert.ok(["0,40", "1,40"].every(key => chart.reservedChartPositions().has(key)));
  assert.ok(chart.reservedChartPositions().has("7,40"), "海図も円内の空き危険マスを新規候補から除く");
  assert.equal(chart.reservedChartPositions().has("9,40"), false, "削った角は通常海図の候補に戻る");
  const bounties = await load("bountyWorld.js");
  bounties.updateBountyWorld();
  assert.equal(game.bounties.active.length, 9);
  assert.ok(game.bounties.active.every(site => !["0,40", "1,40"].includes(`${site.position.x},${site.position.y}`)));
  assert.deepEqual(JSON.parse(JSON.stringify(game.bounties.active[0].position)), { x: 2, y: 40 });

  const story = await load("pirateKingWorld.js");
  const blocked = story.pirateStoryBlockedPositions(game);
  assert.ok(["0,40", "1,40", "2,40"].every(key => blocked.has(key)));
  grid[41][2].terrain = "sea";
  const progress = { completed: false, active: null, waitingId: "bjorn", rumorOrigin: game.position };
  const lord = story.placePirateStory(progress, grid, game.position, blocked, () => 0);
  assert.deepEqual(JSON.parse(JSON.stringify(lord.position)), { x: 2, y: 41 });

  const migration = await load("pirateHavenMigration.js");
  const ocean = Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => ({ terrain: "sea", building: "none" })));
  const kept = { dangerousSeas: { regions: { sw: { sites: [{ position: { x: 4, y: 45 } }] }, se: { sites: [] } }, bounties: { active: [{ position: { x: 45, y: 45 } }] } },
    quests: { active: [], availableBySettlement: {} }, nobleQuests: { availableByNoble: {} } };
  const settlements = [];
  migration.migratePirateHavenWorld(ocean, settlements, new Map(), noop, kept);
  assert.equal(settlements.length, 15);
  for (const port of settlements) {
    assert.notEqual(`${port.coords.x},${port.coords.y}`, "4,45");
    assert.notEqual(`${port.coords.x},${port.coords.y}`, "45,45");
  }
  assert.equal(ocean[45][4].building, "none");
  assert.equal(ocean[45][45].building, "none");
  console.log("危険海域専用地点の依頼・海図・通常賞金首・物語・港移設での予約回避: 全項目成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
