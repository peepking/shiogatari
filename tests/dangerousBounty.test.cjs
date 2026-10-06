const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @returns {Promise<void>} 専用枠・固定敵・報酬・予約・保存復帰を実モジュールで検証する。 */
async function main() {
  const fixedMath = Object.create(Math); fixedMath.random = () => 0;
  const state = { year: 1000, season: 0, day: 1, funds: 0, fame: 100, position: { x: 0, y: 45 }, honorFactions: [], pendingEncounter: { active: false },
    modeLabel: "通常", troops: { infantry: { 1: 10 } }, dangerousSeas: {}, expansion: {}, wanted: {} };
  const favors = {}, document = { dispatchEvent() {} };
  const context = vm.createContext({ structuredClone, Math: fixedMath, document, CustomEvent: class CustomEvent {} });
  const cache = new Map();
  let canSave = true, saves = 0;
  const positions = {
    sw: [{ x: 0, y: 45, level: "core" }, { x: 1, y: 45, level: "core" }, { x: 2, y: 45, level: "outer" }],
    se: [{ x: 45, y: 45, level: "core" }, { x: 46, y: 45, level: "core" }, { x: 47, y: 45, level: "outer" }],
  };
  const stubs = {
    "state.js": { state }, "map.js": { mapData: [[{ terrain: "sea" }]], focusMapPosition() {} },
    "faction.js": { adjustNobleFavor(id, amount) { favors[id] = (favors[id] || 0) + amount; } },
    "lore.js": { FACTIONS: ["north", "archipelago", "citadel", "pirates"].map(id => ({ id, nobles: [{ id: id + "_noble" }] })) },
    "dom.js": { pushLog() {}, pushToast() {} }, "troops.js": { TROOP_STATS: {}, totalTroops() { return 10; } },
    "storage.js": { saveGameToStorage() { saves++; return canSave; } }, "resourceUI.js": { resourceIcon() { return ""; } },
    "dangerousSeaWorld.js": { getDangerousSeaPositions(id, level) { return positions[id].filter(p => !level || p.level === level); } },
  };
  /** @param {string} specifier 論理名。 @returns {vm.Module} 実モジュールまたは依存代替。 */
  function get(specifier) {
    const name = specifier.replace(/^\.\//, "");
    if (!cache.has(name)) {
      const values = stubs[name];
      const module = values ? new vm.SyntheticModule(Object.keys(values),
        /** @returns {void} 検証用の依存を公開する。 */
        function initialize() { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context })
        : new vm.SourceTextModule(readSource(name), { context, identifier: name });
      cache.set(name, module);
    }
    return cache.get(name);
  }
  const ui = get("dangerousBountyUI.js"); await ui.link(get); await ui.evaluate();
  const core = cache.get("dangerousBounty.js").namespace, world = cache.get("dangerousBountyWorld.js").namespace;
  const templates = cache.get("dangerousBountyConfig.js").namespace.DANGEROUS_BOUNTY_TEMPLATES;
  const variants = cache.get("variantShips.js").namespace.VARIANT_SHIPS;
  const fleet = cache.get("fleet.js").namespace;
  state.voyageStats = cache.get("voyageStats.js").namespace.createVoyageStats(state);
  const modes = cache.get("constants.js").namespace.MODE_LABEL; state.modeLabel = modes.NORMAL;
  assert.equal(templates.length, 9);
  assert.equal(new Set(templates.map(t => variants[t.id].base)).size, 9);
  for (const template of templates) {
    assert.equal(variants[template.id].supplies, 10); assert.equal(variants[template.id].troops, 10);
    assert.ok(!["fishing_boat", "viking_ship"].includes(variants[template.id].base));
    assert.ok(Object.values(template.troops).reduce((sum, n) => sum + n, 0) <= 200);
    assert.ok(template.reward > 30150);
  }
  assert.equal(cache.get("bountyConfig.js").namespace.BOUNTY_TEMPLATES.length, 27, "通常の抽選候補へ九種類を混ぜない");
  const data = core.normalizeDangerousBounties();
  core.tickDangerousBounties(data, positions, 120001, 4000, new Set(["0,45"]), null, () => 0);
  assert.equal(data.active.length, 4);
  assert.equal(data.active.filter(s => s.regionId === "sw").length, 2);
  assert.equal(data.active.filter(s => s.regionId === "se").length, 2);
  assert.equal(new Set(data.active.map(s => s.templateId)).size, 4);
  assert.equal(data.active[0].position.x, 1, "核心の予約済み位置を除き、残る核心を優先する");
  assert.equal(data.active[1].position.x, 2, "核心不足では外縁へ配置する");
  for (const site of data.active) {
    assert.equal(site.total, site.formation.reduce((sum, u) => sum + u.count, 0));
    assert.ok(site.formation.length <= 20); assert.ok(site.formation.every(u => u.count === 10 && u.level >= 4));
  }
  const saved = structuredClone(data); saved.active[0].name = "保存した船長"; saved.active[0].reward = 37001;
  const restored = core.normalizeDangerousBounties(saved);
  assert.equal(restored.active[0].name, "保存した船長"); assert.equal(restored.active[0].reward, 37001);
  assert.equal(JSON.stringify(restored.active[0].formation), JSON.stringify(saved.active[0].formation));
  const malformed = structuredClone(saved); malformed.active.push(structuredClone(malformed.active[0])); malformed.active[0].formation[0].count = 11;
  const cleaned = core.normalizeDangerousBounties(malformed);
  assert.ok(cleaned.active.every(s => s.formation.every(u => u.count <= 10)));
  assert.equal(new Set(cleaned.active.map(s => s.id)).size, cleaned.active.length);
  state.dangerousSeas = { bounties: data, regions: { sw: { sites: [] }, se: { sites: [] } } };
  const site = data.active[0]; state.position = { ...site.position };
  assert.equal(world.getDangerousBountyAt(state.position).id, site.id);
  assert.equal(world.finishDangerousBounty(site.id, false).length, 0); assert.equal(data.active.length, 4);
  assert.equal(state.fame, 100, "非勝利では討伐ボーナスを付与しない");
  const summary = world.finishDangerousBounty(site.id, true);
  assert.equal(summary.length, 4);
  assert.ok(summary.some(item => item.icon === "fame" && item.text === "賞金首討伐ボーナス 名声 +15"));
  assert.equal(state.fame, 115);
  assert.equal(state.funds, site.reward); assert.equal(state.fleet.variants.length, 1);
  assert.equal(state.voyageStats.bountiesDefeated, 1); assert.equal(state.voyageStats.variantsAcquired, 1);
  assert.equal(favors.pirates_noble, -3); assert.equal(favors.north_noble, 1);
  assert.equal(world.finishDangerousBounty(site.id, true).length, 0); assert.equal(state.funds, site.reward);
  assert.equal(state.fame, 115, "再通知で追加名声を二重付与しない");
  const veteranData = core.normalizeDangerousBounties({ active: [{ ...site, id: 100,
    formation: site.formation.map(unit => ({ ...unit, level: 5 })) }] });
  state.dangerousSeas.bounties = veteranData;
  assert.equal(world.finishDangerousBounty(100, true).length, 4);
  assert.equal(state.fame, 135, "旧保存のLv5編成には＋20を付与する");
  assert.equal(world.finishDangerousBounty(100, true).length, 0);
  assert.equal(state.fame, 135);
  state.dangerousSeas.bounties = data;
  assert.ok(data.defeatedTemplateIds.includes(site.templateId));
  core.tickDangerousBounties(data, positions, 120002, 4000, new Set(), null, () => 0);
  assert.equal(data.active.length, 3, "同じ季節に討伐枠を再補充しない");
  core.tickDangerousBounties(data, positions, 120031, 4001, new Set(), null, () => 0);
  assert.equal(data.active.length, 4); assert.ok(!data.active.some(row => row.templateId === site.templateId));
  const empty = core.normalizeDangerousBounties(); core.tickDangerousBounties(empty, { sw: [], se: [] }, 120001, 4000);
  assert.equal(empty.active.length, 0);
  const protectedSite = data.active[0];
  core.tickDangerousBounties(data, { sw: [], se: [] }, protectedSite.expiresAbs, 4020, new Set(), protectedSite.id);
  assert.ok(data.active.some(row => row.id === protectedSite.id), "交戦中は寿命で消さない");
  core.tickDangerousBounties(data, { sw: [], se: [] }, 121000, 4030);
  assert.equal(data.active.length, 0);
  const completed = core.normalizeDangerousBounties({ defeatedTemplateIds: templates.map(t => t.id) });
  core.tickDangerousBounties(completed, positions, 120001, 4000, new Set(), null, () => 0);
  assert.equal(completed.active.length, 4, "全種類討伐後は新個体で再登場できる");
  const encounter = core.buildDangerousBountyEncounter(completed.active[0]);
  assert.equal(encounter.dangerousBountyId, completed.active[0].id); assert.equal(encounter.bountyId, undefined);
  encounter.enemyFormation[0].count = 1; assert.equal(completed.active[0].formation[0].count, 10);
  state.dangerousSeas.bounties = completed; state.position = { ...completed.active[0].position };
  state.dangerousSeas.pendingHazard = { kind: "raid", stage: "action_running" };
  assert.equal(ui.namespace.beginDangerousBounty(completed.active[0].id), false);
  state.dangerousSeas.pendingHazard = null; state.honorFactions = ["pirates"];
  assert.ok(ui.namespace.dangerousBountyRestriction(completed.active[0]));
  state.honorFactions = []; state.expansion.fishing = { pending: {} };
  assert.equal(ui.namespace.beginDangerousBounty(completed.active[0].id), false);
  state.expansion.fishing.pending = null; canSave = false;
  assert.equal(ui.namespace.beginDangerousBounty(completed.active[0].id), false); assert.equal(state.pendingEncounter.active, false);
  canSave = true; assert.equal(ui.namespace.beginDangerousBounty(completed.active[0].id), true);
  assert.ok(saves >= 3); assert.equal(state.pendingEncounter.dangerousBountyId, completed.active[0].id);
  const effect = fleet.fleetEffects({ variants: [{ id: 1, variantId: "danger_ironwake", sourceName: "元船長", acquiredAbs: 120001 }] });
  assert.equal(effect.supplies, 45); assert.equal(effect.troops, 20);
  console.log("危険海域賞金首: 九種・独立枠・予約・固定編成・保存・報酬・固有船・二重適用防止: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
