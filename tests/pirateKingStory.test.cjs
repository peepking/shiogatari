const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");
const { loadTestModule } = require("./helpers/module.cjs");

/** 物語の全進行・固定部隊・報酬・配置待ち・HP補正を実モジュールで検証する。 @returns {Promise<void>} 検証完了。 */
async function main() {
  const context = vm.createContext({ structuredClone, console });
  const story = (await loadTestModule("pirateKingStory.js", context)).namespace;
  const config = (await loadTestModule("pirateKingConfig.js", context)).namespace;
  const fleet = (await loadTestModule("fleet.js", context)).namespace;
  const stats = (await loadTestModule("voyageStats.js", context)).namespace;
  const outfitting = (await loadTestModule("outfitting.js", context)).namespace;
  const game = { fame: 1000, year: 1000, season: 0, day: 1, fleet: fleet.normalizeFleet(), troops: {}, pirateKingStory: story.normalizePirateKingStory() };
  game.voyageStats = stats.createVoyageStats(game);
  const town = { id: "town", kind: "town", coords: { x: 0, y: 0 } };
  let rolls = 0;
  /** @returns {number} 当選乱数と呼出回数。 */
  function hit() { rolls++; return 0; }
  assert.equal(story.rollPirateStoryRumor(game, town, hit), null);
  assert.equal(rolls, 0, "名声未達は季節抽選を消費しない");
  game.fame = 1001;
  assert.equal(story.rollPirateStoryRumor(game, town, () => 0.1), null, "初期確率10%の境界は不発");
  assert.equal(story.rollPirateStoryRumor(game, town, hit), null);
  assert.equal(rolls, 0, "同拠点・季節の不発を再抽選しない");
  const adjusted = { ...config.PIRATE_KING_CONFIG, rumorChance: 0.2 };
  game.season++;
  assert.equal(story.rollPirateStoryRumor(game, town, () => 0.15, adjusted).id, "bjorn", "設定変更は次の抽選から反映");
  assert.equal(story.rollPirateStoryRumor(game, { ...town, id: "other" }, hit), null, "配置待ちも次の噂を止める");

  const worldState = {};
  const worldContext = vm.createContext({ structuredClone, console });
  const cache = new Map();
  /** @param {string} specifier 依存名。 @returns {vm.Module} 地図と通知のみ置換したモジュール。 */
  function get(specifier) {
    const key = specifier.replace(/^\.\//, "");
    if (cache.has(key)) return cache.get(key);
    const mocks = { "state.js": { state: worldState }, "map.js": { mapData: [] },
      "events.js": { enqueueEvent() {} }, "dom.js": { pushLog() {} }, "storage.js": { scheduleGameSave() {} } };
    const exports = mocks[key];
    const module = exports ? new vm.SyntheticModule(Object.keys(exports),
      /** 代替値を公開する。 */
      function initialize() { for (const [name, value] of Object.entries(exports)) this.setExport(name, value); }, { context: worldContext })
      : new vm.SourceTextModule(readSource(key), { context: worldContext, identifier: key });
    cache.set(key, module); return module;
  }
  const world = get("pirateKingWorld.js"); await world.link(get); await world.evaluate();
  const { placePirateStory, pirateStoryBlockedPositions } = world.namespace;
  const map = Array.from({ length: 21 }, () => Array.from({ length: 21 }, () => ({ terrain: "sea", building: "none" })));
  assert.equal(placePirateStory(game.pirateKingStory, [[{ terrain: "plain" }]], { x: 0, y: 0 }), null);
  assert.equal(game.pirateKingStory.waitingId, "bjorn", "配置候補不足でも当選を保持");
  for (let i = 0; i < config.PIRATE_LORDS.length; i++) {
    const lord = config.PIRATE_LORDS[i];
    if (i) { game.season++; assert.equal(story.rollPirateStoryRumor(game, town, hit).id, lord.id); }
    const site = placePirateStory(game.pirateKingStory, map, { x: 0, y: 0 }, new Set(["0,10"]), () => 0);
    assert.equal(site.id, lord.id);
    assert.notEqual(`${site.position.x},${site.position.y}`, "0,10");
    assert.equal(site.formation.reduce((n, u) => n + u.count, 0), 200);
    assert.ok(site.formation.every(u => u.level === 4), "五列強の兵士は全員Lv4");
    const legacySite = { ...site, formation: site.formation.map(u => ({ ...u, level: 3 })) };
    const migrated = story.normalizePirateKingStory({ ...game.pirateKingStory, active: legacySite });
    assert.ok(migrated.active.formation.every(u => u.level === 4), "出現済み五列強の旧保存もLv4へ揃える");
    assert.ok(site.formation.every(u => u.type.startsWith("pirate_") || u.type === "raider_cavalry"));
    const encounter = story.pirateStoryEncounter(game.pirateKingStory);
    assert.equal(encounter.enemyFormation.length, 20);
    game.fame = 0;
    assert.equal(story.finishPirateStoryBattle(game, encounter, "draw", 120001).defeated, false);
    assert.equal(game.pirateKingStory.active.id, lord.id, "名声低下や引き分けで出現済みの敵は消さない");
    assert.equal(story.rollPirateStoryRumor(game, town, hit), null);
    game.fame = 1001;
    const claimed = story.finishPirateStoryBattle(game, encounter, "win", 120001);
    assert.equal(claimed.fragments, i + 1);
    assert.equal(game.fleet.variants.length, i + 1);
    assert.equal(game.voyageStats.variantsAcquired, i + 1);
    assert.equal(story.finishPirateStoryBattle(game, encounter, "win", 120001), null, "同じ敵から船や破片を再取得しない");
    game.pirateKingStory = story.normalizePirateKingStory(JSON.parse(JSON.stringify(game.pirateKingStory)));
    assert.equal(game.pirateKingStory.defeated.length, i + 1);
  }
  assert.equal(game.pirateKingStory.waitingId, "olav");
  map[10][10].terrain = "plain";
  const king = placePirateStory(game.pirateKingStory, map, { x: 0, y: 0 }, new Set(["10,9"]));
  assert.equal(map[king.position.y][king.position.x].terrain, "sea");
  assert.equal(Math.abs(king.position.x - 10) + Math.abs(king.position.y - 10), 1, "中央が陸なら最寄りの海");
  assert.notEqual(`${king.position.x},${king.position.y}`, "10,9");
  const first = story.pirateStoryEncounter(game.pirateKingStory);
  assert.equal(story.finishPirateStoryBattle(game, first, "win", 120001).continuation, true);
  assert.equal(game.fleet.counts.viking_ship, 0, "1戦目だけでは王の船を得ない");
  assert.equal(game.pirateKingStory.completed, false);
  assert.equal(story.finishPirateStoryBattle(game, first, "win", 120001), null);
  game.pirateKingStory = story.normalizePirateKingStory(JSON.parse(JSON.stringify(game.pirateKingStory)));
  assert.equal(game.pirateKingStory.kingPhase, 2, "連戦間の保存を復元できる");
  let second = story.pirateStoryEncounter(game.pirateKingStory);
  assert.equal(second.battleKind, "grand");
  assert.equal(second.enemyFormation.reduce((n, u) => n + u.count, 0), 200);
  assert.equal(second.enemyReserve.reduce((n, u) => n + u.count, 0), 100);
  assert.equal(second.enemyReserve.filter(u => u.type === "raider_cavalry").length, 8);
  for (const result of ["lose", "draw"]) {
    story.finishPirateStoryBattle(game, second, result, 120001);
    assert.equal(game.pirateKingStory.kingPhase, 1);
    assert.equal(game.pirateKingStory.active.id, "olav");
    assert.equal(story.pirateStoryEncounter(game.pirateKingStory).battleKind, "normal");
    story.finishPirateStoryBattle(game, story.pirateStoryEncounter(game.pirateKingStory), "win", 120001);
    second = story.pirateStoryEncounter(game.pirateKingStory);
  }
  story.abandonPirateStory(game.pirateKingStory); assert.equal(game.pirateKingStory.kingPhase, 1);
  story.finishPirateStoryBattle(game, story.pirateStoryEncounter(game.pirateKingStory), "win", 120001);
  second = story.pirateStoryEncounter(game.pirateKingStory);
  story.finishPirateStoryBattle(game, second, "win", 120001);
  assert.equal(game.fleet.counts.viking_ship, 1);
  assert.equal(game.pirateKingStory.completed, true);
  assert.equal(game.pirateKingStory.active, null);
  assert.equal(game.voyageStats.chartsCompleted, 0, "専用海図は達成数に含めない");
  assert.equal(game.voyageStats.bountiesDefeated, 0, "通常賞金首の件数と混在させない");
  assert.equal(story.finishPirateStoryBattle(game, second, "win", 120001), null);
  assert.equal(story.rollPirateStoryRumor(game, town, hit), null);
  const corrupted = story.normalizePirateKingStory({ defeated: ["bjorn", "ivar", "erik"], active: king, completed: true });
  assert.equal(corrupted.defeated.length, 1); assert.equal(corrupted.completed, false); assert.equal(corrupted.active, null);
  const blocked = pirateStoryBlockedPositions({ bounties: { active: [{ position: { x: 1, y: 2 } }] }, expansion: { charts: { active: [{ destination: { x: 2, y: 3 } }] } }, quests: { active: [{ fights: [{ target: { x: 3, y: 4 } }] }] } });
  assert.ok(["1,2", "2,3", "3,4"].every(p => blocked.has(p)));

  const hpContext = vm.createContext({ MAX_UNIT_COUNT: 10, BATTLE_HP_MULTIPLIER: 3, MORALE_RULES: { initial: 100 },
    TROOP_STATS: { basic: { hp: 100, atk: 30, def: 20, role: "melee" } }, clamp: (n, min, max) => Math.min(max, Math.max(min, n)),
    battleState: { outfitting: { effects: outfitting.getOutfittingEffects({}, game.fleet) } }, outfittedStat: outfitting.outfittedStat });
  const raw = readSource("battle.js"), start = raw.indexOf("function createUnit(");
  vm.runInContext(raw.slice(start, raw.indexOf("\n}", start) + 2), hpContext);
  assert.equal(vm.runInContext("createUnit('basic', 'ally', 0, {x:0,y:0}, 10).hp", hpContext), 360);
  assert.equal(vm.runInContext("createUnit('basic', 'enemy', 0, {x:0,y:0}, 10).hp", hpContext), 300);
  fleet.addShips(game, { viking_ship: 1 });
  assert.equal(fleet.fleetEffects(game.fleet).hp, 20, "HP効果は1隻分まで");
  assert.equal(fleet.fleetEffects(fleet.normalizeFleet()).hp, 0);
  console.log("海賊王の物語：噂・六人の固定順・再挑戦・専用報酬・配置・保存・味方HP効果: 成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
