const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/** 名前抽選・固定敵・期限・補充・報酬の一度だけの適用と犯罪期限を実モジュールで検証する。 @returns {Promise<void>} */
async function main() {
  const context = vm.createContext({ structuredClone });
  const modules = new Map();
  const state = { year: 1000, season: 0, day: 1, funds: 0, honorFactions: [], troops: {} };
  const favors = {}, ships = {};
  const factions = ["north", "archipelago", "citadel", "pirates"].map(id => ({ id, nobles: [{ id: id + "1" }, { id: id + "2" }] }));
  const stubs = {
    "state.js": { state }, "map.js": { mapData: [] },
    "questUtils.js": { absDay: s => s.year * 120 + s.season * 30 + s.day },
    "faction.js": { adjustNobleFavor: (id, n) => { favors[id] = (favors[id] || 0) + n; } },
    "lore.js": { FACTIONS: factions }, "dom.js": { pushLog() {} },
    "fleet.js": { addShips: (_s, counts) => { for (const [id, n] of Object.entries(counts)) ships[id] = (ships[id] || 0) + n; } },
  };
  /** @param {string} name モジュール。 @returns {Promise<vm.Module>} 検証対象。 */
  async function load(name) {
    name = name.replace(/^\.\//, "");
    if (modules.has(name)) return modules.get(name);
    const exports = stubs[name];
    const mod = exports ? new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context }) : new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "..", name), "utf8"), { context });
    modules.set(name, mod); await mod.link(load); return mod;
  }
  const core = await load("bounty.js"); await core.evaluate();
  const b = core.namespace, names = modules.get("name.js").namespace.REGIONAL_NAMES;
  for (const [fid, pool] of [["north", names.NORTH], ["archipelago", names.NORTH], ["citadel", names.WEST], ["pirates", Object.values(names).flat()]]) {
    const unique = [...new Set(pool)];
    for (let i = 0; i < unique.length; i++) assert.equal(b.rollBountyName(fid, () => (i + 0.5) / unique.length), unique[i]);
  }
  const data = b.normalizeBounties();
  const candidates = Array.from({ length: 400 }, (_, n) => ({ x: n % 20, y: Math.floor(n / 20) }));
  b.tickBounties(data, candidates, 120001, 4000, new Set(["0,0"]), null, () => 0);
  assert.equal(data.active.length, 10);
  assert.equal(new Set(data.active.map(s => s.templateId)).size, 10);
  assert.ok(data.active.every(s => s.position.x || s.position.y));
  assert.equal(new Set(data.active.map(s => `${s.position.x},${s.position.y}`)).size, 10);
  for (const s of data.active) {
    assert.ok(s.formation.length <= 20);
    assert.equal(s.total, s.formation.reduce((n, u) => n + u.count, 0));
    assert.equal(s.reward, Math.floor((s.total * 100 + 100) * 1.5));
  }
  const saved = JSON.stringify(data);
  b.tickBounties(data, candidates, 120030, 4000, new Set(), null, () => { throw Error("同季節の再抽選"); });
  assert.equal(JSON.stringify(data), saved);
  assert.equal(JSON.stringify(b.normalizeBounties(JSON.parse(saved))), saved);
  const id = data.active[0].id;
  assert.ok(b.claimBounty(data, id, 120030)); assert.equal(b.claimBounty(data, id, 120030), null);
  b.tickBounties(data, candidates, 120030, 4000); assert.equal(data.active.length, 9);
  b.tickBounties(data, candidates, 120031, 4001); assert.equal(data.active.length, 10);
  const keep = data.active.find(s => s.spawnedAbs === 120001);
  b.tickBounties(data, [], 120601, 4020, new Set(), keep.id);
  assert.ok(data.active.some(s => s.id === keep.id));
  b.tickBounties(data, [], 120601, 4020); assert.ok(!data.active.some(s => s.id === keep.id));
  const small = b.normalizeBounties(); b.tickBounties(small, [{ x: 1, y: 1 }], 1, 0); assert.equal(small.active.length, 1);
  const grid = [[{ terrain: "plain" }, { terrain: "mountain" }, { terrain: "sea" }], [{ terrain: "shoal" }, { terrain: "mountain" }, { terrain: "sea" }]];
  assert.equal(b.bountySeaPositions(grid, { x: 0, y: 0 }).length, 1);
  const wanted = await load("playerWanted.js"); await wanted.evaluate(); const w = wanted.namespace;
  const action = {}; assert.equal(w.recordCrime(state, "merchant_attack", action, 100), 1000);
  assert.equal(w.recordCrime(state, "merchant_attack", action, 101), 0);
  assert.equal(state.wanted.history.length, 1);
  assert.equal(state.wanted.history[0].kind, "merchant_attack");
  assert.equal(state.wanted.history[0].day, 100);
  assert.equal(w.recordCrime(state, "battle", {}, 101), 0);
  assert.equal(w.expireWanted(state.wanted, 699), false);
  assert.equal(w.recordCrime(state, "refugee_raid", {}, 699), 1500);
  assert.equal(state.wanted.amount, 2500);
  assert.equal(w.expireWanted(state.wanted, 1298), false); assert.equal(w.expireWanted(state.wanted, 1299), true);
  assert.equal(state.wanted.amount, 0);
  assert.equal(state.wanted.history.length, 2);
  assert.equal(state.wanted.history[0].kind, "refugee_raid");
  assert.equal(w.normalizeWanted({}).lastCrimeAbs, null);
  assert.equal(w.normalizeWanted({amount: 1000, lastCrimeAbs: 100}).history.length, 0);
  const archive = {};
  for (let i = 0; i < 60; i++) w.recordCrime(archive, "pirate_quest", {}, 120001 + i);
  assert.equal(archive.wanted.history.length, 50);
  assert.equal(archive.wanted.history.at(-1).day, 120011);
  assert.equal(archive.wanted.history[0].day, 120060);
  assert.equal(JSON.stringify(w.normalizeWanted(JSON.parse(JSON.stringify(archive.wanted)))), JSON.stringify(archive.wanted));
  assert.equal(w.normalizeWanted({history:[{kind:"unknown",day:1},{kind:"merchant_attack",day:NaN},null]}).history.length, 0);
  state.bounties = b.normalizeBounties(JSON.parse(saved));
  const world = await load("bountyWorld.js"); await world.evaluate();
  const shark = state.bounties.active.find(s => s.ship === "longship");
  assert.ok(world.namespace.finishBounty(shark.id).length);
  assert.equal(state.funds, shark.reward); assert.equal(ships.longship, 1);
  for (const f of factions) for (const n of f.nobles) assert.equal(favors[n.id], f.id === shark.factionId ? -3 : 1);
  assert.equal(world.namespace.finishBounty(shark.id).length, 0); assert.equal(ships.longship, 1); assert.equal(state.funds, shark.reward);
  // 公開UIの制限とイベント成立経路も、実際の関数を抽出して検証する。
  const uiSource = await fs.readFile(path.join(__dirname, "..", "bountyUI.js"), "utf8");
  const checks = vm.createContext({ state, totalTroops: () => 10 });
  Object.assign(checks, { CRIME_LABELS: modules.get("bountyConfig.js").namespace.CRIME_LABELS, CRIME_HISTORY_LIMIT: 50, DAY_PER_YEAR: 120, DAY_PER_SEASON: 30, SEASONS: ["春", "夏", "秋", "冬"], escapeHtml: s => s });
  vm.runInContext(uiSource.match(/function wantedCrimesHtml\([^\n]*\) \{[\s\S]*?\n\}/)[0], checks);
  checks.wanted = {history:[{kind:"merchant_attack",day:120001},{kind:"refugee_raid",day:120120}]};
  const crimeHtml = vm.runInContext("wantedCrimesHtml(wanted)", checks);
  assert.ok(crimeHtml.includes("神歴1000年 春 1日"));
  assert.ok(crimeHtml.includes("神歴1000年 冬 30日"));
  assert.ok(crimeHtml.includes("商人襲撃"));
  assert.ok(!/<details[^>]*\bopen\b/.test(crimeHtml));
  vm.runInContext(uiSource.match(/function bountyRestriction\([^\n]*\) \{[\s\S]*?\n\}/)[0], checks);
  checks.site = state.bounties.active.find(s => s.factionId === "north");
  state.honorFactions = ["north"];
  assert.ok(vm.runInContext("bountyRestriction(site)", checks));
  state.honorFactions = []; assert.equal(vm.runInContext("bountyRestriction(site)", checks), "");
  checks.totalTroops = () => 0; assert.ok(vm.runInContext("bountyRestriction(site)", checks));
  const source = await fs.readFile(path.join(__dirname, "..", "actions.js"), "utf8");
  const eventState = { year: 1000, season: 0, day: 1 };
  let blocked = false, starts = true;
  const eventContext = vm.createContext({ state: eventState, recordCrime: w.recordCrime, absDay: () => 120001,
    isBattleEventActionBlocked: () => blocked, pushLog() {}, pushToast() {},
    handlePirateCheckpoint: action => { if (starts) eventState.pendingEncounter = { active: true }; return action.type !== "unknown"; },
    handleChartPurchase: () => false, handleMerchantAction: () => false, handleFrontAction: () => false,
    handleSmuggleAction: () => false, handleRefugeeAction: () => false, handleCheckpointAction: () => false,
    handleOmenAction: () => false, handleWreckAction: () => false, handleTraitorAction: () => false,
  });
  vm.runInContext(source.match(/function handleTravelEventAction\([^\n]*\) \{[\s\S]*?\n\}/)[0], eventContext);
  for (const [type, amount] of [["merchant_attack", 1000], ["merchant_rescue_attack", 1000], ["refugee_attack", 1500], ["checkpoint_force", 2000], ["pirate_force", 2000]]) {
    eventState.pendingEncounter = null; eventState.wanted = w.normalizeWanted();
    eventContext.action = { type };
    vm.runInContext("handleTravelEventAction(action)", eventContext);
    assert.equal(eventState.wanted.amount, amount);
    vm.runInContext("handleTravelEventAction(action)", eventContext);
    assert.equal(eventState.wanted.amount, amount);
  }
  eventState.pendingEncounter = null; eventState.wanted = w.normalizeWanted(); blocked = true;
  eventContext.action = { type: "merchant_attack" }; vm.runInContext("handleTravelEventAction(action)", eventContext);
  assert.equal(eventState.wanted.amount, 0);
  blocked = false; starts = false; vm.runInContext("handleTravelEventAction(action)", eventContext);
  assert.equal(eventState.wanted.amount, 0);
  starts = true; eventContext.action = { type: "merchant_rescue_help" }; vm.runInContext("handleTravelEventAction(action)", eventContext);
  assert.equal(eventState.wanted.amount, 0);
  console.log("賞金首: 名前・固定編成・配置・補充・期限・二重報酬防止・関係変化・犯罪と手配解除: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
