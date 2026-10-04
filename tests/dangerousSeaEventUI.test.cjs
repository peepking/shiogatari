const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @param {*} value 値。 @returns {*} VM参照を切った値。 */
function plain(value) { return JSON.parse(JSON.stringify(value)); }

/** @returns {Promise<void>} 期限・選択・一日適用・保存失敗・危険一時停止・固定戦闘・結果確認を検証する。 */
async function main() {
  const state = {}, context = vm.createContext({ structuredClone, CustomEvent: class {}, console });
  let saves = 0, failAt = 0, days = 0, scouts = 0, newHazard = null;
  const nodes = new Map();
  /** @returns {object} ボタン追加に必要な最小限のDOM。 */
  function node() { return { hidden: true, insertAdjacentElement(where, child) { nodes.set(child.id, child); } }; }
  nodes.set("exploreBtn", node());
  context.document = { getElementById: id => nodes.get(id), createElement: node, dispatchEvent() {} };
  const cache = new Map();
  const stubs = {
    "state.js": { state },
    "storage.js": { saveGameToStorage: () => ++saves !== failAt },
    "map.js": { snapshotWorld: () => ({}), restoreWorld() {} },
    "dom.js": { elements: { battleBlock: { hidden: true }, battleResultModal: { hidden: true } }, pushToast() {}, pushLog() {} },
    "events.js": { enqueueEvent: event => state.eventQueue.push(event) },
    "outfitting.js": { snapshotOutfitting: () => ({ scouts }) },
    "troops.js": { TROOP_STATS: { marine: { name: "海兵" }, scout: { name: "斥候" }, medic: { name: "衛生兵" } },
      addTroops: (id, level, qty) => { state.troops[id] ||= {}; state.troops[id][level] = (state.troops[id][level] || 0) + qty; } },
    "supplies.js": { SUPPLY_ITEMS: [{ id: "wood", name: "木材" }, { id: "fiber", name: "繊維" }] },
    "time.js": { advanceDayWithEvents: (count, options) => {
      days += count; state.day += count;
      if (newHazard) state.dangerousSeas.pendingHazard = { kind: newHazard, stage: "action_running" };
      if (state.dangerousSeas.events.pending?.encounter) assert.equal(options.suppressDangerRaid, true, "固定罠の日には追加襲撃を抑える");
      return count;
    } },
    "dangerousSeaWorld.js": { dangerousSeaAt: () => ({ regionId: "sw", level: "outer" }) },
    "dangerousSeaEventWorld.js": { getDangerousSeaEventAt: position => Object.values(state.dangerousSeas.events.active).find(event => event?.position.x === position.x && event.position.y === position.y),
      visibleDangerousSeaEvents: () => Object.values(state.dangerousSeas.events.active).filter(event => event?.discovered) },
    "dangerousSeaHazards.js": {
      dangerousSeaActionBlocked: () => !!((state.dangerousSeas.pendingHazard && state.dangerousSeas.pendingHazard.stage !== "watch") || state.dangerousSeas.action || state.dangerousSeas.events.pending),
      beginDangerousSeaAction: kind => {
        if (state.dangerousSeas.action || (state.dangerousSeas.pendingHazard && state.dangerousSeas.pendingHazard.stage !== "watch")) return false;
        state.dangerousSeas.action = { id: state.dangerousSeas.nextActionId++, kind }; return state.dangerousSeas.action.id;
      },
      finishDangerousSeaAction: kind => {
        if (state.dangerousSeas.action?.kind !== kind) return;
        state.dangerousSeas.action = null;
        if (state.dangerousSeas.pendingHazard?.stage === "action_running") state.dangerousSeas.pendingHazard.stage = "ready";
      },
    },
  };
  /** @param {string} path 依存名。 @returns {vm.Module} 実際のイベントと画面依存の代替。 */
  function get(path) {
    const name = path.replace(/^\.\//, "");
    if (!cache.has(name)) {
      const values = stubs[name];
      cache.set(name, values ? new vm.SyntheticModule(Object.keys(values),
        /** @returns {void} 画面と保存の依存を公開する。 */
        function publish() { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context })
        : new vm.SourceTextModule(readSource(name), { context }));
    }
    return cache.get(name);
  }
  const module = get("dangerousSeaEventUI.js"); await module.link(get); await module.evaluate();
  const ui = module.namespace, rules = cache.get("dangerousSeaEventState.js").namespace;
  const mode = cache.get("constants.js").namespace.MODE_LABEL;
  /** @param {string} kind 種類。 @param {string} [regionId=sw] 海域。 @param {number} [variant=0.9] 灯火の正体。 @returns {object} 新しい固定地点。 */
  function prepare(kind, regionId = "sw", variant = 0.9) {
    saves = 0; failAt = 0; days = 0; scouts = 0; newHazard = null;
    Object.assign(state, { year: 1000, season: 0, day: 1, position: { x: 0, y: 49 }, modeLabel: mode.NORMAL, pendingEncounter: { active: false },
      funds: 0, troops: {}, supplies: {}, voyageStats: { income: 0, refugeesRescued: 0 }, wanted: {}, eventQueue: [],
      expansion: { fishing: {}, exploration: {}, charts: {} }, dangerousSeas: { nextActionId: 1, action: null, pendingHazard: null, events: rules.createDangerousSeaEvents() } });
    let roll = 0;
    return rules.spawnDangerousSeaEvent(state.dangerousSeas.events, regionId, kind, [{ x: 0, y: 49, level: "outer", travelDays: 2 }], 120001,
      () => ({ formation: [{ type: "pirate_spear", count: 10, level: 2 }] }), () => ++roll === 3 ? variant : 0.9);
  }
  /** @param {object} event 出来事。 @returns {void} 現地入口から保存済み選択を表示する。 */
  function open(event) {
    ui.renderDangerousSeaEventControl(() => {});
    assert.equal(nodes.get("dangerousSeaEventBtn").hidden, false);
    nodes.get("dangerousSeaEventBtn").onclick();
    assert.equal(state.dangerousSeas.events.pending.eventId, event.id);
  }
  /** @param {number} id 出来事ID。 @param {string} choice 選択。 @returns {boolean} 通知を解決したか。 */
  function choose(id, choice) {
    const accepted = ui.handleDangerousSeaEventAction({ eventId: id, choice });
    if (accepted) state.eventQueue.shift();
    ui.processDangerousSeaEvent();
    return accepted;
  }

  // 入口と選択の保存失敗で、日数・選択・報酬・統計を進めない。
  let event = prepare("storm_aftermath");
  failAt = 1; ui.renderDangerousSeaEventControl(() => {}); nodes.get("dangerousSeaEventBtn").onclick();
  assert.equal(state.dangerousSeas.events.pending, null); assert.equal(days, 0);
  failAt = 0; open(event);
  const before = plain(state); failAt = saves + 1;
  assert.equal(choose(event.id, "recover"), false); assert.deepEqual(plain(state), before);
  failAt = 0; assert.equal(choose(event.id, "recover"), true);
  assert.equal(days, 1); assert.equal(state.funds, 1800); assert.equal(state.voyageStats.income, 1800);
  assert.equal(state.dangerousSeas.events.pending.stage, "result");
  assert.ok(state.dangerousSeas.events.active.sw, "報酬確認までは一枠を保持");
  assert.equal(choose(event.id, "recover"), false); assert.equal(state.funds, 1800);
  assert.equal(choose(event.id, "ack"), true); assert.equal(state.dangerousSeas.events.active.sw, null); assert.equal(state.dangerousSeas.action, null);

  // 日数適用直後に保存できなかった場合、確定済み選択から一日だけ再開する。
  event = prepare("sinking_treasure"); open(event); failAt = saves + 2;
  assert.equal(choose(event.id, "rescue"), true); assert.equal(state.day, 1); assert.equal(state.funds, 0);
  assert.equal(state.dangerousSeas.events.pending.dayApplied, false);
  failAt = 0; ui.resumeDangerousSeaEvent(); assert.equal(state.day, 2); assert.equal(state.funds, 300);
  assert.deepEqual(plain(state.troops), { marine: { 1: 4 }, scout: { 1: 2 } }); assert.equal(state.voyageStats.refugeesRescued, 6);
  ui.resumeDangerousSeaEvent(); assert.equal(state.day, 2); assert.equal(state.funds, 300);

  // 日数保存後の報酬保存失敗は全報酬だけ戻し、再開で日数を重ねない。
  event = prepare("sinking_treasure"); open(event); failAt = saves + 3;
  choose(event.id, "rescue"); assert.equal(state.day, 2); assert.equal(state.funds, 0); assert.deepEqual(plain(state.troops), {});
  assert.equal(state.voyageStats.income, 0); assert.equal(state.voyageStats.refugeesRescued, 0);
  assert.equal(state.dangerousSeas.events.pending.applied, false); assert.equal(state.dangerousSeas.events.active.sw.progress, 0);
  failAt = 0; ui.resumeDangerousSeaEvent(); assert.equal(state.day, 2); assert.equal(state.funds, 300);

  // 再読込に残った古い選択通知は結果確認へ置き換え、支給済み資金を繰り返さない。
  state.eventQueue = [{ kind: "dangerous_event", actions: [{ payload: { eventId: event.id, choice: "rescue" } }] }];
  ui.processDangerousSeaEvent(); assert.equal(state.eventQueue[0].actions[0].payload.choice, "ack"); assert.equal(state.funds, 300);
  assert.equal(choose(event.id, "ack"), true);

  // 荒波を先に解決してから同じ一日分の結果を再開する。
  event = prepare("storm_aftermath"); open(event); newHazard = "wave"; choose(event.id, "recover");
  assert.equal(state.dangerousSeas.events.pending.pausedForHazard, true); assert.equal(state.dangerousSeas.pendingHazard.stage, "ready");
  assert.equal(state.day, 2); assert.equal(state.funds, 0); assert.equal(ui.resumeDangerousSeaEvent(), false);
  state.dangerousSeas.pendingHazard = null; newHazard = null; ui.resumeDangerousSeaEvent();
  assert.equal(state.day, 2); assert.equal(state.funds, 1800); assert.equal(state.dangerousSeas.events.pending.pausedForHazard, false);

  // 灯火の固定戦闘では既存海賊編成と専用参照を使い、勝敗精算は一度だけ行う。
  event = prepare("fog_light", "sw", 0.4); open(event); newHazard = "wave"; choose(event.id, "investigate");
  assert.equal(state.modeLabel, mode.PREP); assert.equal(state.pendingEncounter.dangerousEventId, event.id); assert.equal(state.pendingEncounter.storyId, undefined);
  assert.equal(state.dangerousSeas.events.pending.pausedForHazard, false, "地点固定敵を先に解決");
  const encounter = plain(state.pendingEncounter);
  assert.ok(ui.finishDangerousSeaEventEncounter(encounter, true).length); assert.equal(state.funds, 2400);
  assert.equal(ui.finishDangerousSeaEventEncounter(encounter, true).length, 0); assert.equal(state.funds, 2400);
  state.pendingEncounter.active = false; state.modeLabel = mode.NORMAL; ui.processDangerousSeaEvent();
  assert.equal(choose(event.id, "ack"), true); assert.equal(state.dangerousSeas.pendingHazard.stage, "ready", "戦後成果を確認してから荒波");
  event = prepare("fog_light", "sw", 0.4); open(event); choose(event.id, "investigate");
  ui.finishDangerousSeaEventEncounter(plain(state.pendingEncounter), false); assert.equal(state.funds, 0);
  assert.equal(state.dangerousSeas.events.pending.complete, true);

  // 鐘は海域内の同じ地点を三日かけて段階的に調べ、最後にだけ報酬を受け取る。
  event = prepare("seabed_bell", "se");
  for (const [index, choice] of ["listen", "descend", "answer"].entries()) {
    open(event); assert.equal(choose(event.id, choice), true);
    assert.equal(state.day, index + 2); assert.equal(state.funds, index === 2 ? 2200 : 0);
    assert.equal(choose(event.id, "ack"), true);
    if (index < 2) { event = state.dangerousSeas.events.active.se; assert.equal(event.progress, index + 1); }
  }
  assert.equal(state.dangerousSeas.events.history[0].choices.length, 3);

  event = prepare("sinking_treasure"); open(event); state.day = event.expiresAbs - 120000;
  assert.equal(choose(event.id, "cargo"), true); assert.equal(days, 0); assert.equal(state.funds, 0); assert.equal(state.dangerousSeas.events.active.sw, null, "期限後の調査は始めない");
  state.eventQueue = [{ kind: "dangerous_event", actions: [{}] }]; ui.processDangerousSeaEvent(); assert.equal(state.eventQueue.length, 0);
  console.log("dangerousSeaEventUI: 固定選択・保存失敗・危険保留・再開・戦後一意精算・鐘三段階の検証成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
