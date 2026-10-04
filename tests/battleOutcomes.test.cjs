const { readSource } = require("./helpers/source.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadTestModule } = require("./helpers/module.cjs");

/** @param {string} source 実ソース。 @param {string} name 関数名。 @returns {string} 非公開の実関数。 */
function outcomeFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} が実ソースに存在する`);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}

/** 危険四経路の戦後・逃走で、固定報酬と保留危険を実処理により精算する。
 * 勢力の変更は専用賞金首の確定補正だけを許し、戦況・国力・近傍貴族の通常補正を検出する。
 * @param {string} uiSource 戦後画面の実ソース。
 * @param {object} voyage 航海統計の実処理。
 * @param {object} personnel 兵員精算の実処理。
 * @param {object} pursuit 追跡精算の実処理。
 * @returns {Promise<void>} 検証完了。
 */
async function testDangerousOutcomes(uiSource, voyage, personnel, pursuit) {
  const pureContext = vm.createContext({ structuredClone });
  const rules = (await loadTestModule("dangerousSeaState.js", pureContext)).namespace;
  const bountyRules = (await loadTestModule("dangerousBounty.js", pureContext)).namespace;
  const bountyConfig = (await loadTestModule("dangerousBountyConfig.js", pureContext)).namespace;
  const explorationRules = (await loadTestModule("dangerousSeaExploration.js", pureContext)).namespace;
  const wreckRules = (await loadTestModule("dangerousWreck.js", pureContext)).namespace;
  const eventRules = (await loadTestModule("dangerousSeaEventState.js", pureContext)).namespace;
  const eventConfig = (await loadTestModule("dangerousSeaEventConfig.js", pureContext)).namespace;
  const fleet = (await loadTestModule("fleet.js", pureContext)).namespace;
  const variants = (await loadTestModule("variantShips.js", pureContext)).namespace;
  const ships = (await loadTestModule("shipConfig.js", pureContext)).namespace;
  const lore = (await loadTestModule("lore.js", pureContext)).namespace;
  const hazardsSource = readSource("dangerousSeaHazards.js"), explorationSource = readSource("explorationUI.js");
  const bountySource = readSource("dangerousBountyWorld.js"), bountyUISource = readSource("dangerousBountyUI.js");
  const eventSource = readSource("dangerousSeaEventUI.js");
  for (const route of ["raid", "exploration", "bounty", "event"]) for (const outcome of ["win", "lose", "draw", "escape"]) {
    const danger = rules.createDangerousSeaState();
    bountyRules.tickDangerousBounties(danger.bounties, { sw: [{ x: 0, y: 49, level: "core" }], se: [] }, 1, 4000, new Set(), null, () => 0);
    const bounty = danger.bounties.active[0];
    const pending = { active: true, enemyFactionId: "pirates", enemyFormation: [{ type: "pirate_spear", count: 10, level: 2 }],
      enemyTotal: 10, strength: "elite", dangerousRegionId: "sw", eventTag: `dangerous_${route}` };
    if (route === "raid") {
      pending.dangerousHazardId = 99;
      danger.pendingHazard = { id: 99, kind: "raid", stage: "battle", regionId: "sw", encounter: { formation: pending.enemyFormation, total: 10 } };
    }
    if (route === "exploration") {
      pending.dangerousExplorationId = 1;
      danger.regions.sw.sites = [{ id: 1, position: { x: 0, y: 49 } }];
      danger.explorationPending = { siteId: 1, regionId: "sw", dayApplied: true, encounter: pending,
        reward: { funds: 1200, supplies: { wood: 3 }, troops: {}, ships: 0 } };
      danger.action = { id: 1, kind: "exploration", startedAbs: 1 };
      danger.pendingHazard = { id: 100, kind: "wave", stage: "action_running", regionId: "sw", losses: { herring: 1 } };
    }
    if (route === "bounty") pending.dangerousBountyId = bounty.id;
    if (route === "event") {
      const event = eventRules.spawnDangerousSeaEvent(danger.events, "sw", "fog_light", [{ x: 0, y: 49, level: "core", travelDays: 8 }], 1,
        () => ({ formation: pending.enemyFormation, total: pending.enemyTotal }), () => .4);
      assert.equal(event.variant, "trap");
      pending.dangerousEventId = event.id;
      danger.events.pending = { eventId: event.id, regionId: "sw", stage: "battle", dayApplied: true, choice: "investigate", applied: false,
        reward: structuredClone(event.rewards.trap), encounter: pending, complete: true, accident: false, resultText: "灯火は海賊の罠でした。" };
      danger.action = { id: 1, kind: "event", startedAbs: 1 };
      danger.pendingHazard = { id: 100, kind: "wave", stage: "action_running", regionId: "sw", losses: { herring: 1 } };
      eventRules.spawnDangerousSeaEvent(danger.events, "sw", "storm_aftermath", [{ x: 1, y: 49, level: "core", travelDays: 8 }], 1, () => null, () => .9);
    }
    const stormBefore = JSON.stringify(danger.events.stormAftermath.sw);
    const state = { funds: 1000, fame: 100, supplies: { food: 50, wood: 5 }, troops: { infantry: { 1: 10 } },
      quests: { active: [] }, pendingEncounter: pending, bounties: { active: [] }, dangerousSeas: danger, wanted: {},
      expansion: { exploration: { pending: null }, fishing: { counts: { herring: 20 } } }, position: { x: 0, y: 49 },
      nobleFavor: {}, nationalPower: { marker: "維持" }, modeLabel: "prep" };
    state.voyageStats = voyage.createVoyageStats({ ...state, year: 1000, season: 0, day: 1 });
    const calls = [];
    /** @param {string} name 呼出名。 @returns {Function} 外部副作用の記録。 */
    const record = name => (...args) => { calls.push({ name, args }); return []; };
    const context = vm.createContext({ state, structuredClone, ...voyage, ...personnel, ...pursuit, ...rules, ...bountyRules, ...explorationRules, ...wreckRules, ...fleet, ...variants, ...ships,
      DEFS: eventConfig.DANGEROUS_SEA_EVENT_DEFS,
      getDangerousSeaEventById: eventRules.getDangerousSeaEventById,
      Math: Object.assign(Object.create(Math), { random: () => 0.5 }), FACTIONS: lore.FACTIONS, CONFIG: bountyConfig.DANGEROUS_BOUNTY_CONFIG,
      MODE_LABEL: { NORMAL: "normal", PREP: "prep", BATTLE: "battle" }, BATTLE_RESULT: { WIN: "win", LOSE: "lose", DRAW: "draw" }, BATTLE_RESULT_LABEL: {}, NONE_LABEL: "なし",
      QUEST_TYPES: {}, SUPPLY_ITEMS: [{ id: "food", name: "食料" }, { id: "wood", name: "木材" }], TROOP_STATS: {}, BONUS_CAPTURE_EVENT_TAGS: new Set(),
      getPlayerFactionId: () => "north", calcLosses: () => ({ lossProb: 0.6 }), calcCaptures: () => ({}), awardBattleFragment: () => null, absDay: () => 1,
      /** @returns {object} 固定戦闘の現在地は南西の核心にある。 */
      dangerousSeaAt() { return { regionId: "sw", level: "core" }; },
      settlements: [{ nobleId: "nearby_noble", coords: { x: 1, y: 49 } }], manhattan: () => 1,
      addWarScore: record("war"), completeBattlePower: record("power"), nationalPowerResources: record("powerResources"),
      adjustSupport: record("support"),
      /** @param {string} id 貴族ID。 @param {number} value 好感度変化。 @returns {void} 専用の補正を記録する。 */
      adjustNobleFavor(id, value) { calls.push({ name: "favor", args: [id, value] }); state.nobleFavor[id] = (state.nobleFavor[id] || 0) + value; },
      renderBattleSummary: record("summary"), syncUI: record("sync"), finishBounty: record("normalBounty"),
      pushLog: record("log"), pushToast: record("toast"), setOutput: record("output"), resetEncounterMeter: record("meter"),
      setEnemyFormation: record("enemy"), setBattleEnemyFaction: record("faction"), setBattleTerrain: record("terrain"),
      totalTroops: () => 10, snapshotBattlePower: () => ({}), nationalPowerAtWar: () => false,
      setBattleEndHandler: record("handler"), openBattle: record("open"), getTerrainAt: () => "sea",
      addTroops: record("troops"), awardExplorationFragment: record("fragment"),
      currentExplorationPending: () => state.expansion.exploration.pending || state.dangerousSeas.explorationPending || null,
    });
    for (const [source, name] of [[hazardsSource, "handOverDeferredWave"], [hazardsSource, "finishDangerousSeaEncounter"], [hazardsSource, "finishDangerousSeaAction"],
      [eventSource, "pending"], [eventSource, "currentEvent"], [eventSource, "rewardResources"], [eventSource, "settleEvent"], [eventSource, "finishDangerousSeaEventEncounter"],
      [explorationSource, "finishExploration"], [bountySource, "finishDangerousBounty"], [uiSource, "killedEnemyCount"],
      [uiSource, "clearBattlePrep"], [uiSource, "escapeBattleSuccess"], [uiSource, "processBattleOutcome"],
      [bountyUISource, "dangerousBountyRestriction"], [uiSource, "startPrepBattle"]]) {
      vm.runInContext(outcomeFunction(source, name), context);
    }
    if (route === "bounty") {
      context.site = bounty;
      assert.equal(vm.runInContext("dangerousBountyRestriction(site)", context), "", "自身の固定準備を未解決遭遇として拒否しない");
      vm.runInContext("startPrepBattle()", context);
      assert.equal(state.modeLabel, "battle", "専用賞金首の準備から戦闘へ進める");
      assert.equal(state.pendingEncounter.dangerousBountyId, bounty.id);
      assert.equal(calls.filter(call => call.name === "open").length, 1);
    }
    const meta = { units: [{ side: "enemy", type: "pirate_spear", count: 10, hp: 0, status: "destroyed", deployedAt: 0 }], enemyFactionId: "pirates" };
    context.meta = meta;
    vm.runInContext(outcome === "escape" ? "escapeBattleSuccess('逃走成功')" : `processBattleOutcome(${JSON.stringify(outcome)}, meta)`, context);
    const label = `${route}/${outcome}`;
    assert.equal(state.pendingEncounter.active, false, `${label}: 準備を完了する`);
    assert.equal(state.modeLabel, "normal", `${label}: 通常モードへ戻る`);
    assert.equal(calls.filter(call => ["war", "power", "powerResources", "support", "normalBounty"].includes(call.name)).length, 0, `${label}: 通常の戦況・国力・賞金枠へ混入しない`);
    assert.equal(state.nationalPower.marker, "維持");
    assert.equal(state.wanted.pursuitUntil, undefined, `${label}: 追跡戦闘として扱わない`);
    assert.equal(state.nobleFavor.nearby_noble, undefined, `${label}: 近傍貴族への通常海賊勝利補正を与えない`);
    assert.equal(state.voyageStats.battles[outcome] || 0, outcome === "escape" ? 0 : 1);
    assert.equal(state.voyageStats.enemyDefeated, outcome === "escape" ? 0 : 10);
    if (route === "raid") assert.equal(danger.pendingHazard, null, `${label}: 勝敗・引分け・逃走の全てで襲撃を解決する`);
    if (route === "exploration") {
      assert.equal(danger.explorationPending, null, `${label}: 途中探索を完了する`);
      assert.equal(danger.regions.sw.sites.length, 0, `${label}: 失敗でも地点を消費する`);
      assert.equal(danger.action, null, `${label}: 継続中の探索行動を終える`);
      assert.equal(danger.pendingHazard.stage, "ready", `${label}: 保留中の荒波は戦闘終了後へ渡す`);
      assert.equal(state.supplies.wood, outcome === "win" ? 10 : outcome === "lose" ? 2 : 5, `${label}: 固定探索報酬は勝利時だけ付与する`);
    }
    if (route === "event") {
      assert.equal(danger.events.pending.stage, "result", `${label}: 全ての勝敗を結果確認へ渡す`);
      assert.equal(danger.events.pending.applied, true, `${label}: 報酬と進行の精算を一度だけ記録する`);
      assert.equal(state.supplies.iron || 0, outcome === "win" ? 3 : 0, `${label}: 罠の報酬は勝利時だけ付与する`);
      assert.equal(danger.events.active.sw.progress, outcome === "win" ? 1 : 0);
      assert.equal(JSON.stringify(danger.events.stormAftermath.sw), stormBefore, `${label}: 併存する置き土産へ戦果を誤適用しない`);
      assert.equal(danger.pendingHazard.stage, "action_running", `${label}: 荒波は報告確認後の区切りまで保留する`);
      const settled = JSON.stringify(state);
      context.encounter = pending;
      vm.runInContext("finishDangerousSeaEventEncounter(encounter, true)", context);
      assert.equal(JSON.stringify(state), settled, `${label}: 再通知で報酬を二重に加算しない`);
    }
    const bountyWon = route === "bounty" && outcome === "win";
    assert.equal(danger.bounties.active.length, bountyWon ? 0 : 1, `${label}: 賞金首は勝利時だけ消費する`);
    assert.equal(danger.bounties.history.length, bountyWon ? 1 : 0);
    assert.equal(state.voyageStats.bountiesDefeated, bountyWon ? 1 : 0);
    assert.equal(state.fleet?.variants?.length || 0, bountyWon ? 1 : 0);
    assert.equal(calls.filter(call => call.name === "favor").length, bountyWon ? lore.FACTIONS.reduce((sum, faction) => sum + (faction.nobles || []).length, 0) : 0);
    if (bountyWon) for (const faction of lore.FACTIONS) for (const noble of faction.nobles || []) {
      assert.equal(state.nobleFavor[noble.id], faction.id === "pirates" ? -3 : 1, `${label}: 専用の確定好感度補正のみ適用する`);
    }
    assert.equal(state.funds, outcome === "win" ? 1400 + (route === "exploration" ? 1200 : route === "event" ? 2400 : bountyWon ? bounty.reward : 0) : outcome === "lose" ? 500 : 1000);
    if (outcome === "escape") {
      assert.equal(state.fame, 100); assert.equal(state.voyageStats.income, 0); assert.equal(state.voyageStats.expenses.other, 0);
    } else {
      const settled = JSON.stringify(state);
      vm.runInContext(`processBattleOutcome(${JSON.stringify(outcome)}, meta)`, context);
      assert.equal(JSON.stringify(state), settled, `${label}: 二重精算しない`);
    }
  }
}

/** 実際の戦後処理へ勝敗を渡し、経路別通知・予備隊除外・再戦維持を検証する。
 * 外部の依頼更新や画面描画は呼出記録へ置換し、報酬計算と兵員精算は実処理を使う。
 * @returns {Promise<void>} 検証完了。
 */
async function main() {
  const voyage = await loadTestModule("voyageStats.js");
  const storyContext = vm.createContext({ structuredClone });
  const storyRules = (await loadTestModule("pirateKingStory.js", storyContext)).namespace;
  const storyConfig = (await loadTestModule("pirateKingConfig.js", storyContext)).namespace;
  const variants = (await loadTestModule("variantShips.js", storyContext)).namespace;
  const raw = await readSource("ui.js");
  const start = raw.indexOf("function processBattleOutcome(");
  const body = raw.slice(start, raw.indexOf("\n}", start) + 2);
  const personnel = new vm.SourceTextModule(await readSource("battlePersonnel.js"));
  await personnel.link(() => {}); await personnel.evaluate();
  const pursuit = new vm.SourceTextModule(await readSource("pursuit.js"));
  const pursuitDependencies = new Map();
  /** @param {string} name 相対名。 @returns {Promise<vm.Module>} 追跡の実依存モジュール。 */
  async function loadPursuitDependency(name) {
    if (pursuitDependencies.has(name)) return pursuitDependencies.get(name);
    const module = new vm.SourceTextModule(await readSource(name));
    pursuitDependencies.set(name, module);
    await module.link(loadPursuitDependency);
    return module;
  }
  await pursuit.link(loadPursuitDependency); await pursuit.evaluate();
  const theft = await loadPursuitDependency("./settlementCrime.js"); await theft.evaluate();
  const QUEST_TYPES = Object.fromEntries(["ORACLE_HUNT", "ORACLE_ELITE", "PIRATE_HUNT", "BOUNTY_HUNT",
    "NOBLE_SECURITY", "NOBLE_HUNT", "WAR_DEFEND_RAID", "WAR_ATTACK_RAID", "WAR_SKIRMISH", "WAR_BLOCKADE"].map(id => [id,id]));
  const routes = ["normal", "armory", "raid", "pursuit", "hunter", "exploration", "bounty", "story_lord", "story_king1", "story_king2", ...Object.keys(QUEST_TYPES)];
  for (const route of routes) for (const outcome of ["win", "lose", "draw"]) {
    const quest = { id: 1 };
    const pending = { enemyFactionId: "north", enemyFormation: [{type:"infantry",count:20}], enemyTotal:120 };
    if (QUEST_TYPES[route]) Object.assign(pending,{questId:1,questType:route,questFightIdx:1});
    if (route === "bounty") pending.bountyId = 1;
    if (route === "exploration") pending.explorationId = 1;
    if (route === "pursuit") pending.pursuitKind = "regular";
    if (route === "hunter") pending.pursuitKind = "hunter";
    if (route === "armory") Object.assign(pending, { theftKind: "theft_armory", theftReward: { arms: 8, iron: 10 } });
    if (route === "raid") Object.assign(pending, { theftKind: "settlement_raid", theftReward: { food: 50, wood: 10 }, theftFunds: 5000 });
    const state = { funds:1000,fame:100,supplies:{food:50},troops:{infantry:{1:10}},quests:{active:[quest]},
      pendingEncounter:pending,bounties:{active:[{id:1}]},wanted:{} };
    if (route.startsWith("story_")) {
      const king = route !== "story_lord";
      state.pirateKingStory = storyRules.normalizePirateKingStory({ defeated: king ? storyConfig.PIRATE_LORDS.map(lord => lord.id) : [] });
      state.pirateKingStory.active = storyRules.createStorySite(king ? storyConfig.PIRATE_KING : storyConfig.PIRATE_LORDS[0], { x: 1, y: 1 });
      state.pirateKingStory.waitingId = null;
      state.pirateKingStory.kingPhase = route === "story_king2" ? 2 : 1;
      Object.assign(pending, { storyId: king ? "olav" : "bjorn", storyPhase: state.pirateKingStory.kingPhase, enemyFactionId: "pirates" });
    }
    state.voyageStats = voyage.namespace.createVoyageStats({ ...state, year: 1000, season: 0, day: 1 });
    const calls = [];
    /** @param {string} name 呼出名。 @returns {Function} 呼出記録。 */
    const record = name => (...args) => { calls.push({name,args}); return []; };
    const context = vm.createContext({ state, QUEST_TYPES, ...voyage.namespace, ...personnel.namespace, ...pursuit.namespace, ...storyRules, ...variants, MODE_LABEL: { PREP: "prep" }, finishTheftBattle: theft.namespace.finishTheftBattle,
      Math:Object.assign(Object.create(Math),{random:()=>0.5}),
      BATTLE_RESULT:{WIN:"win",LOSE:"lose",DRAW:"draw"},BATTLE_RESULT_LABEL:{},NONE_LABEL:"なし",
      SUPPLY_ITEMS:[{id:"food",name:"食料"}],TROOP_STATS:{},BONUS_CAPTURE_EVENT_TAGS:new Set(),
      getPlayerFactionId:()=>"west", calcLosses:()=>({lossProb:0.6}), killedEnemyCount:()=>0,
      calcCaptures:()=>({}),awardBattleFragment:()=>null,absDay:()=>0,
      nationalPowerResources:()=>[],completeBattlePower:()=>[],addWarScore:record("war"),
      completeOracleBattleQuest:record("oracleWin"),failOracleBattleQuest:record("oracleLose"),
      completeHuntBattleQuest:record("hunt"),completeNobleBattleQuest:record("noble"),completeWarBattleQuest:record("front"),
      finishExploration:record("exploration"),finishBounty:record("bounty"),
      renderBattleSummary:record("summary"),clearBattlePrep:record("clear"),syncUI:record("sync") });
    vm.runInContext(body,context);
    const killedStart = raw.indexOf("function killedEnemyCount(");
    vm.runInContext(raw.slice(killedStart, raw.indexOf("\n}", killedStart) + 2), context);
    context.meta = {faithRescue: 1, units:[
      {id:"ally",side:"ally",type:"infantry",count:10,hp:0,status:"destroyed",deployedAt:0,sources:{1:10}},
      {side:"enemy",count:10,hp:0,status:"destroyed",deployedAt:0},
      {side:"enemy",count:10,hp:100,status:"escaped",deployedAt:3},
      {side:"enemy",count:100,hp:100,status:"reserve",deployedAt:null},
    ]};
    vm.runInContext(`processBattleOutcome(${JSON.stringify(outcome)},meta)`,context);
    assert.equal(state.wanted.pursuitUntil, ["pursuit", "hunter"].includes(route) ? 3 : undefined);
    if (route === "armory") {
      assert.equal(state.supplies.arms || 0, outcome === "win" ? 8 : 0);
      assert.equal(calls.filter(c => c.name === "war").length, 0);
    }
    assert.equal(calls.filter(c=>c.name==="clear").length,1);
    assert.equal(calls.find(c=>c.name==="summary").args[3],20,"未投入の敵を報酬基準へ含めない");
    assert.equal(state.funds,outcome==="win"?(route==="raid"?6400:route==="story_king1"?1000:1400):outcome==="lose"?500:1000);
    if (route === "raid") assert.equal(calls.filter(c => c.name === "war").length, 0);
    assert.equal(state.fame,outcome==="win"?(route==="story_king1"?100:105):outcome==="lose"?95:100);
    if (route.startsWith("story_")) {
      assert.equal(calls.filter(c => c.name === "war").length, 0, "物語戦は戦況へ影響しない");
      assert.equal(state.pirateKingStory.completed, route === "story_king2" && outcome === "win");
      assert.equal(state.voyageStats.chartsCompleted, 0);
      if (route === "story_king1" && outcome === "win") { assert.equal(state.pendingEncounter.storyPhase, 2); assert.equal(state.modeLabel, "prep"); }
      if (route === "story_lord" && outcome === "win") assert.equal(state.fleet.variants.length, 1);
    }
    const completion = calls.filter(c=>["oracleWin","oracleLose","hunt","noble","front"].includes(c.name));
    assert.equal(completion.length,QUEST_TYPES[route] && outcome!=="draw"?1:0);
    if (completion.length) {
      const call=completion[0];
      const expected=route.startsWith("ORACLE")?(outcome==="win"?"oracleWin":"oracleLose")
        :route.startsWith("NOBLE")?"noble":route.startsWith("WAR")?"front":"hunt";
      assert.equal(call.name,expected);
      if (["hunt","noble","front"].includes(expected)) assert.equal(call.args[1],outcome==="win");
      if (expected==="front") assert.equal(call.args[2],1);
    }
    assert.equal(calls.filter(c=>c.name==="bounty").length,route==="bounty"&&outcome==="win"?1:0);
    assert.equal(calls.filter(c=>c.name==="exploration").length,route==="exploration"?1:0);
    if (route==="exploration") assert.equal(calls.find(c=>c.name==="exploration").args[0],outcome==="win");
    if (outcome==="draw" && QUEST_TYPES[route]) assert.equal(quest.fixedEnemyByFight[1].total,20);
    assert.equal(state.voyageStats.enemyDefeated, 10, "敗走・未投入を撃破数へ含めない");
    assert.equal(state.voyageStats.battles[outcome], 1);
    assert.equal(state.voyageStats.losses.battle, outcome === "win" ? 0 : 6, "救護で生還した兵士は恒久損耗へ含めない");
    assert.equal(state.voyageStats.income, outcome === "win" ? (route === "raid" ? 5400 : route === "story_king1" ? 0 : 400) : 0);
    assert.equal(state.voyageStats.expenses.other, outcome === "lose" ? 500 : 0);
    const beforeRepeated = JSON.stringify(state);
    vm.runInContext(`processBattleOutcome(${JSON.stringify(outcome)},meta)`,context);
    assert.equal(JSON.stringify(state), beforeRepeated, "結果の再処理で報酬・撃破・戦闘数を増やさない");
  }
  await testDangerousOutcomes(raw, voyage.namespace, personnel.namespace, pursuit.namespace);
  console.log("戦後接続: 通常遭遇・依頼・海賊物語・危険海域の襲撃/探索/賞金首/限定イベント、勝敗/引分け/逃走・二重精算防止: 成功");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
