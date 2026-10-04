const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @param {unknown} value VM内の値。 @returns {unknown} 独立した比較用の値。 */
function plain(value) { return JSON.parse(JSON.stringify(value)); }

/** 実際のイベントキューと日次・保存を通し、甲板報告・追加探索・限定出来事の確認を検証する。
 * 全ui.js依存を実ソースで初期化し、画面要素とブラウザ保存先だけを用意する。
 * @returns {Promise<void>} 検証完了。
 */
async function main() {
  const nodes = new Map(), listeners = new Map(), microtasks = [], stored = new Map(), saves = [];
  /** 最小の要素でクリックの伝播と実際のボタン登録を再現する。 */
  class Element {
    /** @param {string} [tag="div"] 要素名。 */
    constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.hidden = false; this.listeners = new Map(); this.classList = { add() {}, remove() {}, toggle() {} }; }
    /** @param {string} value 要素ID。 */
    set id(value) { this.identifier = value; nodes.set(value, this); }
    /** @returns {string} 要素ID。 */
    get id() { return this.identifier; }
    /** @returns {Element[]} 発見情報の子要素。 */
    get childNodes() { return this.children; }
    /** @param {string} value 表示内容。 */
    set innerHTML(value) { this.html = value; this.children = []; }
    /** @returns {string} 表示内容。 */
    get innerHTML() { return this.html || ""; }
    /** @param {Element[]} values 子要素。 @returns {void} 子を追加する。 */
    append(...values) { for (const value of values) { value.parentElement = this; this.children.push(value); } }
    /** @param {Element} value 後続要素。 @returns {void} 同じ親へ追加する。 */
    after(value) { this.parentElement?.append(value); }
    /** @param {string} where 挿入位置。 @param {Element} value 後続要素。 @returns {void} 同じ親へ追加する。 */
    insertAdjacentElement(where, value) { this.after(value); }
    /** @param {string} where 挿入位置。 @param {string} value 資源表示。 @returns {void} 資源表示を記録する。 */
    insertAdjacentHTML(where, value) { this.html = (this.html || "") + value; }
    /** @param {string} type イベント名。 @param {Function} handler 実画面の処理。 @returns {void} 処理を登録する。 */
    addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(handler); }
    /** @param {object} event 発火するイベント。 @returns {void} 親へクリックを伝える。 */
    dispatchEvent(event) { for (const handler of this.listeners.get(event.type) || []) handler(event); if (!event.stopped) this.parentElement?.dispatchEvent(event); }
    /** @returns {void} 実際に登録されたクリック処理を呼ぶ。 */
    click() { if (this.disabled) return; const event = { type: "click", target: this, stopPropagation() { this.stopped = true; } }; this.onclick?.(event); this.dispatchEvent(event); }
    /** @param {string} selector 選択子。 @returns {Element|null} 対象ボタン。 */
    closest(selector) { return this.tagName === "BUTTON" && selector.startsWith("button") ? this : this.parentElement?.closest(selector) || null; }
  }
  const journey = new Element();
  for (const id of ["exploreBtn", "exploreInfo", "eventModal", "eventModalClose", "eventModalTitle", "eventModalBody", "eventModalActions", "battleBlock", "battleResultModal", "fishingModal"]) {
    const element = new Element(id.endsWith("Btn") || id.endsWith("Close") ? "button" : "div"); element.id = id; element.hidden = true; journey.append(element);
  }
  nodes.get("eventModal").append(nodes.get("eventModalClose"), nodes.get("eventModalTitle"), nodes.get("eventModalBody"), nodes.get("eventModalActions"));
  const math = Object.create(Math); math.random = () => 0.999999;
  const context = vm.createContext({ console, structuredClone, Math: math, setTimeout, clearTimeout,
    window: { confirm: () => true }, queueMicrotask: task => microtasks.push(task),
    document: { getElementById: id => nodes.get(id) || null, createElement: tag => new Element(tag), querySelector: () => null, querySelectorAll: () => [],
      addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); },
      dispatchEvent(event) { for (const handler of listeners.get(event.type) || []) handler(event); } },
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    localStorage: { getItem: key => stored.get(key) ?? null, setItem(key, value) { stored.set(key, value); saves.push(value); }, removeItem: key => stored.delete(key) },
  });
  const cache = new Map();
  /** @param {string} specifier 実ソース名。 @returns {vm.Module} 同じ状態を共有する実依存。 */
  function get(specifier) {
    const name = specifier.replace(/^\.\//, "");
    if (!cache.has(name)) cache.set(name, new vm.SourceTextModule(readSource(name), { context, identifier: name }));
    return cache.get(name);
  }
  const entry = get("ui.js"); await entry.link(get); await entry.evaluate();
  const stateModule = cache.get("state.js").namespace, state = stateModule.state;
  const world = cache.get("map.js").namespace, storage = cache.get("storage.js").namespace;
  const exploration = cache.get("explorationUI.js").namespace, events = cache.get("events.js").namespace;
  const eventUI = cache.get("dangerousSeaEventUI.js").namespace, eventRules = cache.get("dangerousSeaEventState.js").namespace;
  const calendar = cache.get("calendar.js").namespace, mode = cache.get("constants.js").namespace.MODE_LABEL;
  /** @returns {void} 通知と選択行の実描画を同じ境界で更新する。 */
  function syncViews() { eventUI.processDangerousSeaEvent(); events.showNextEvent(); exploration.renderExplorationControl(syncViews); eventUI.renderDangerousSeaEventControl(syncViews); }
  context.document.addEventListener("quests-updated", syncViews);
  events.initEventQueueUI();
  /** @returns {void} 保存予約を実行し、次のユーザー操作に進む。 */
  function flush() { while (microtasks.length) microtasks.shift()(); }
  /** @returns {void} 同じ実モジュール参照の状態と世界を新しくする。 */
  function reset() {
    stateModule.resetState(); world.buildWorld(2025); state.day = 2; state.position = { x: 0, y: 49 }; state.modeLabel = mode.NORMAL;
    cache.get("fleet.js").namespace.addShips(state, { galleon: 2 });
    for (const id of ["eventModal", "battleBlock", "battleResultModal", "fishingModal"]) nodes.get(id).hidden = true;
    saves.length = 0; flush();
  }
  /** @returns {void} 本物のキューの閉じる操作で甲板報告を確認する。 */
  function closeReport() { assert.equal(nodes.get("eventModal").hidden, false); nodes.get("eventModalClose").click(); syncViews(); flush(); }
  for (const branch of ["cargo", "rescue"]) {
    reset();
    const now = calendar.absDay(state), site = { id: 1, regionId: "sw", kind: "wreck", position: { ...state.position }, level: "core", profile: "danger_core", version: 1,
      danger: 0.75, spawnedAbs: now, expiresAbs: now + 120 };
    state.dangerousSeas.regions.sw.sites = [site];
    syncViews(); nodes.get("exploreBtn").click();
    assert.equal(state.dangerousSeas.explorationPending.wreck.stage, "choice");
    assert.equal(state.day, 3); assert.equal(state.funds, 4300);
    assert.equal(state.eventQueue.length, 1); assert.equal(state.eventQueue[0].title, "甲板の探索完了");
    assert.equal(nodes.get("eventModal").hidden, false, "甲板報告は探索pendingを残していても開く");
    assert.equal(nodes.get("dangerousWreckChoices").hidden, true, "甲板報告を閉じるまでは三択を開始しない");
    assert.equal(storage.saveGameToStorage(), true); assert.equal(storage.loadGameFromStorage(), true);
    syncViews(); assert.equal(nodes.get("eventModal").hidden, false);
    closeReport(); assert.equal(nodes.get("dangerousWreckChoices").hidden, false);
    const pending = state.dangerousSeas.explorationPending, reward = plain(pending.wreck.branches[branch].reward), funds = state.funds;
    const levels = plain(state.troops);
    const button = nodes.get("dangerousWreckChoices").children.find(node => node.tagName === "BUTTON" && node.textContent.includes(branch === "cargo" ? "積荷を回収" : "救助"));
    assert.ok(button); button.click(); flush();
    assert.equal(state.day, 4); assert.equal(state.dangerousSeas.explorationPending, null);
    assert.equal(state.dangerousSeas.regions.sw.sites.some(row => row.id === site.id), false);
    assert.equal(state.funds, funds + reward.funds);
    if (branch === "rescue") for (const [id, amount] of Object.entries(reward.troops)) assert.equal(state.troops[id][reward.troopLevel], (levels[id]?.[reward.troopLevel] || 0) + amount);
    assert.equal(state.eventQueue[0].title, "船倉の探索完了"); assert.equal(nodes.get("eventModal").hidden, false);
    assert.equal(storage.loadGameFromStorage(), true); syncViews(); closeReport();
    const settledFunds = state.funds, settledDay = state.day;
    exploration.resumeExploration(syncViews); exploration.finishExploration(true);
    assert.equal(state.funds, settledFunds); assert.equal(state.day, settledDay);
  }
  for (const choice of ["cargo", "rescue"]) {
    reset();
    const now = calendar.absDay(state);
    const site = eventRules.spawnDangerousSeaEvent(state.dangerousSeas.events, "sw", "sinking_treasure", [{ ...state.position, level: "core", travelDays: 8 }], now, () => { throw new Error("宝船で敵を生成しない"); }, () => .99);
    syncViews(); nodes.get("dangerousSeaEventBtn").click();
    assert.equal(nodes.get("eventModal").hidden, false);
    assert.equal(nodes.get("eventModalClose").hidden, true);
    nodes.get("eventModalClose").click();
    assert.equal(state.dangerousSeas.events.pending.stage, "choice", "選択画面を閉じて活動を回避しない");
    const selection = nodes.get("eventModalActions").children.find(button => state.eventQueue[0].actions.find(action => action.id === button.dataset.actionId)?.payload?.choice === choice);
    assert.ok(selection); selection.click();
    assert.equal(state.day, 3); assert.equal(state.dangerousSeas.events.pending.stage, "result");
    const funds = state.funds, troops = plain(state.troops);
    const checkpoint = [...saves].reverse().find(value => {
      const snapshot = JSON.parse(JSON.parse(value).payload).state;
      return snapshot.dangerousSeas.events.pending?.stage === "result" && snapshot.eventQueue[0]?.actions?.some(action => action.payload?.choice === choice);
    });
    assert.ok(checkpoint, "結果保存と旧選択通知の削除の間を実際の保存から取り出す");
    stored.set("shiogatari-save", checkpoint); assert.equal(storage.loadGameFromStorage(), true);
    eventUI.resumeDangerousSeaEvent(syncViews); syncViews();
    assert.equal(state.day, 3); assert.equal(state.funds, funds); assert.deepEqual(plain(state.troops), troops);
    assert.equal(state.eventQueue.length, 1); assert.equal(state.eventQueue[0].actions[0].payload.choice, "ack");
    assert.equal(nodes.get("eventModal").hidden, false, "再開時は古い選択を除き、結果確認を表示する");
    nodes.get("eventModalActions").children[0].click();
    assert.equal(state.dangerousSeas.events.pending, null); assert.equal(state.dangerousSeas.action, null);
    assert.equal(state.dangerousSeas.events.active.sw, null); assert.equal(state.dangerousSeas.events.history.length, 1);
    const ackCheckpoint = saves.at(-1);
    stored.set("shiogatari-save", ackCheckpoint); assert.equal(storage.loadGameFromStorage(), true); syncViews();
    assert.equal(state.eventQueue.length, 0, "確認保存直後の旧確認通知も除去する");
    assert.equal(state.funds, funds); assert.equal(state.day, 3);
    assert.equal(eventUI.handleDangerousSeaEventAction({ eventId: site.id, choice }), false, "もう一方の枝と報酬の再受取を拒否する");
    flush();
  }
  // 旧保存の置き土産を実際の保存復元と通知キューで進め、併存する宝船を消さない。
  reset();
  const storm = eventRules.spawnDangerousSeaEvent(state.dangerousSeas.events, "sw", "storm_aftermath",
    [{ ...state.position, level: "core", travelDays: 8 }], calendar.absDay(state), () => null, () => .99);
  syncViews(); nodes.get("dangerousSeaEventBtn").click();
  const legacy = state.dangerousSeas.events;
  legacy.version = 1; legacy.active.sw = legacy.stormAftermath.sw; delete legacy.stormAftermath;
  assert.equal(storage.saveGameToStorage(), true); assert.equal(storage.loadGameFromStorage(), true);
  assert.equal(state.dangerousSeas.events.version, 2); assert.equal(state.dangerousSeas.events.active.sw, null);
  assert.deepEqual(plain(state.dangerousSeas.events.stormAftermath.sw), plain(storm), "旧置き土産の固定内容・期限を復元する");
  const treasure = eventRules.spawnDangerousSeaEvent(state.dangerousSeas.events, "sw", "sinking_treasure",
    [{ x: state.position.x + 1, y: state.position.y, level: "core", travelDays: 8 }], calendar.absDay(state), () => null, () => .99);
  treasure.discovered = true;
  eventUI.resumeDangerousSeaEvent(syncViews); syncViews();
  assert.equal(state.eventQueue[0].actions[0].payload.eventId, storm.id);
  nodes.get("eventModalActions").children[0].click();
  assert.equal(state.day, 3); assert.equal(state.dangerousSeas.events.pending.stage, "result");
  const recoveredFunds = state.funds;
  assert.equal(storage.saveGameToStorage(), true); assert.equal(storage.loadGameFromStorage(), true);
  eventUI.resumeDangerousSeaEvent(syncViews); syncViews();
  assert.equal(state.funds, recoveredFunds); assert.equal(state.day, 3);
  assert.equal(state.eventQueue[0].actions[0].payload.choice, "ack");
  nodes.get("eventModalActions").children[0].click(); flush();
  assert.equal(state.dangerousSeas.events.pending, null); assert.equal(state.dangerousSeas.events.stormAftermath.sw, null);
  assert.equal(state.dangerousSeas.events.active.sw.id, treasure.id, "置き土産の結果確認で併存する宝船を保持する");
  assert.equal(state.dangerousSeas.events.history.length, 1);
  assert.equal(eventUI.handleDangerousSeaEventAction({ eventId: storm.id, choice: "recover" }), false);

  // 域外の旧保存に荒波通知が残っても初回の表示前に除き、別の通知と魚・物資を保持する。
  for (const position of [{ x: 20, y: 20 }, { x: 4, y: 4 }, { x: 4, y: 45 }, { x: 49, y: 49 }]) {
    reset(); state.position = position;
    state.expansion.fishing.counts = { aji: 40 }; state.supplies = { wood: 2, fiber: 2 };
    state.dangerousSeas.pendingHazard = { id: 77, kind: "wave", regionId: "sw", day: calendar.absDay(state), stage: "displaying", losses: { aji: 2 } };
    state.eventQueue = [
      { id: 1, kind: "dangerous_wave", title: "古い荒波", actions: [{ id: "1-0", label: "対策", type: "dangerous_wave_protect", payload: { id: 77 } }] },
      { id: 2, kind: "info", title: "通常の通知", actions: [{ id: "2-0", label: "閉じる", type: "close" }] },
    ];
    assert.equal(storage.saveGameToStorage(), true); assert.equal(storage.loadGameFromStorage(), true);
    events.showNextEvent(); flush();
    assert.equal(state.dangerousSeas.pendingHazard, null, "港・通常海・別の危険海域では旧荒波を解除する");
    assert.equal(state.eventQueue.length, 1); assert.equal(state.eventQueue[0].title, "通常の通知");
    assert.equal(nodes.get("eventModalTitle").textContent, "通常の通知"); assert.equal(nodes.get("eventModalClose").hidden, false);
    assert.deepEqual(plain(state.expansion.fishing.counts), { aji: 40 }); assert.deepEqual(plain(state.supplies), { wood: 2, fiber: 2 });
  }

  // 表示後に現在地が変わった場合もクリック直前に確認し、次の通知を誤って閉じない。
  for (const actionType of ["dangerous_wave_protect", "dangerous_wave_accept"]) {
    reset(); state.expansion.fishing.counts = { aji: 40 }; state.supplies = { wood: 2, fiber: 2 };
    state.dangerousSeas.pendingHazard = { id: 78, kind: "wave", regionId: "sw", day: calendar.absDay(state), stage: "displaying", losses: { aji: 2 } };
    state.eventQueue = [
      { id: 3, kind: "dangerous_wave", title: "荒波", actions: [{ id: "3-0", label: "選択", type: actionType, payload: { id: 78 } }] },
      { id: 4, kind: "info", title: "残す通知", actions: [{ id: "4-0", label: "閉じる", type: "close" }] },
    ];
    events.showNextEvent(); const waveButton = nodes.get("eventModalActions").children[0];
    assert.equal(nodes.get("eventModalTitle").textContent, "荒波"); state.position = { x: 20, y: 20 };
    waveButton.click(); flush();
    assert.equal(state.dangerousSeas.pendingHazard, null); assert.equal(state.eventQueue.length, 1);
    assert.equal(state.eventQueue[0].title, "残す通知"); assert.equal(nodes.get("eventModalTitle").textContent, "残す通知");
    assert.deepEqual(plain(state.expansion.fishing.counts), { aji: 40 }); assert.deepEqual(plain(state.supplies), { wood: 2, fiber: 2 });
  }
  console.log("危険海域の選択接続: 実甲板/船倉・宝船・保存直後の通知復帰・域外荒波の表示/操作/資源保護: 成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
