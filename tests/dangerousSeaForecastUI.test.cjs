const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @param {number} x 横座標。 @param {number} y 縦座標。 @param {object} [extra] 拠点属性。 @returns {object} 無法港。 */
function port(x, y, extra = {}) { return { kind: "village", pirateHaven: true, coords: { x, y }, ...extra }; }

/**
 * 実際の地形・港選択・画面・日次通知を同じ世界で接続し、一般港の誤表示を再現する。
 * 表示先だけを制限して、全海域の周期や既知予報の保存情報を残すことも検証する。
 * @returns {Promise<void>} 検証完了。
 */
async function main() {
  let scouts = 0, saves = 0;
  const state = { year: 1000, season: 0, day: 1, position: { x: 0, y: 49 }, expansion: {}, wanted: {}, eventQueue: [], pendingEncounter: { active: false } };
  const mapData = [], settlements = [], toasts = [], logs = [], dispatched = [], nodes = new Map();
  /** @param {string} [id] 要素ID。 @returns {object} 表示内容を保持する最小の要素。 */
  function element(id = "") {
    return { id, hidden: false, textContent: "", children: [],
      /** @param {string} placement 挿入位置。 @param {object} child 子要素。 @returns {void} IDを登録する。 */
      insertAdjacentElement(placement, child) { nodes.set(child.id, child); },
      /** @param {object} child 子要素。 @returns {void} 子要素を保持する。 */
      append(child) { this.children.push(child); } };
  }
  nodes.set("locationLabel", element("locationLabel")); nodes.set("locationStatus", element("locationStatus"));
  const document = {
    /** @param {string} id 要素ID。 @returns {object|null} 登録済みの要素。 */
    getElementById(id) { return nodes.get(id) || null; },
    /** @returns {object} 最小の画面要素。 */
    createElement() { return element(); },
    /** @param {object} event 通知。 @returns {void} 自動移動停止を記録する。 */
    dispatchEvent(event) { dispatched.push(event.type); },
  };
  const math = Object.create(Math); math.random = () => 0.99;
  const context = vm.createContext({ structuredClone, Math: math, document,
    CustomEvent: class CustomEvent {
      /** @param {string} type 通知名。 */
      constructor(type) { this.type = type; }
    } });
  const cache = new Map();
  const stubs = {
    "state.js": { state },
    "map.js": { mapData, settlements,
      /** @returns {object} この検証では世界の変更は行わない。 */
      snapshotWorld() { return {}; },
      /** @returns {void} この検証では世界の復元は行わない。 */
      restoreWorld() {} },
    "storage.js": {
      /** @returns {boolean} 保存の試行を記録する。 */
      saveGameToStorage() { saves++; return true; } },
    "dom.js": { elements: { fishingModal: { hidden: true }, battleBlock: { hidden: true }, battleResultModal: { hidden: true } },
      /** @param {...unknown} args 通知内容。 @returns {void} ログを記録する。 */
      pushLog(...args) { logs.push(args); },
      /** @param {...unknown} args 通知内容。 @returns {void} 予報を記録する。 */
      pushToast(...args) { toasts.push(args); },
      /** @returns {void} この検証では操作結果の表示は不要。 */
      setOutput() {} },
    "events.js": {
      /** @param {object} event 通知。 @returns {void} 実際の案内判定の結果を受け取る。 */
      enqueueEvent(event) { state.eventQueue.push(event); } },
    "actions.js": {
      /** @returns {object} 日次襲撃が不要な検証用の固定編成。 */
      buildDangerousEnemyFormation() { return { formation: [{ type: "pirate_spear", count: 10, level: 2 }], total: 10 }; } },
    "outfitting.js": {
      /** @returns {object} 編成人数に応じた実効斥候。 */
      snapshotOutfitting() { return { scouts }; } },
    "time.js": {
      /** @returns {number} この検証で回避行動は使わない。 */
      advanceDayWithEvents() { state.day++; return 1; } },
  };
  /** @param {string} specifier 依存名。 @returns {vm.Module} 共有する実モジュールまたは外部依存。 */
  function get(specifier) {
    const name = specifier.replace(/^\.\//, "");
    if (!cache.has(name)) {
      const values = stubs[name];
      const module = values ? new vm.SyntheticModule(Object.keys(values),
        /** @returns {void} 画面・保存の外部依存を公開する。 */
        function initialize() { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context })
        : new vm.SourceTextModule(readSource(name), { context, identifier: name });
      cache.set(name, module);
    }
    return cache.get(name);
  }
  const uiModule = get("dangerousSeaUI.js"); await uiModule.link(get); await uiModule.evaluate();
  const hazardsModule = get("dangerousSeaHazards.js"); await hazardsModule.link(get); await hazardsModule.evaluate();
  const ui = uiModule.namespace, hazards = hazardsModule.namespace, world = cache.get("dangerousSeaWorld.js").namespace;
  const geometry = cache.get("dangerousSeaGeometry.js").namespace, rules = cache.get("dangerousSeaState.js").namespace;
  const mode = cache.get("constants.js").namespace.MODE_LABEL, today = cache.get("calendar.js").namespace.absDay(state);

  /** @param {object[]} ports 拠点一覧。 @param {object} position 現在地。 @returns {void} 独立した世界と予報を用意する。 */
  function setup(ports, position) {
    mapData.splice(0, mapData.length, ...Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => ({ terrain: "sea", building: "none", settlement: null }))));
    settlements.splice(0, settlements.length, ...ports);
    for (const site of ports) Object.assign(mapData[site.coords.y][site.coords.x], { building: site.kind, settlement: site });
    state.position = { ...position }; state.dangerousSeas = rules.createDangerousSeaState();
    state.modeLabel = mode.NORMAL; state.eventQueue = []; scouts = 0; toasts.length = 0; logs.length = 0; dispatched.length = 0;
    for (const region of Object.values(state.dangerousSeas.regions)) region.weather = { day: today + 2, safeRoll: 0.99, known: false, avoided: false };
    nodes.get("locationLabel").textContent = "通常の港名"; nodes.get("locationStatus").textContent = "安全な港";
  }
  /** @returns {object[]} 基準港・近接する一般無法港・街・通常海の検証に使う拠点。 */
  function standardPorts() { return [port(4, 45), port(45, 45), port(8, 44), port(20, 43), port(10, 10), port(40, 10), port(5, 44, { kind: "town", pirateHaven: false })]; }
  /** @param {boolean} shown 表示するか。 @returns {object} 危険情報と通常名称・状態を検証する。 */
  function checkPortInfo(shown) {
    ui.renderDangerousSeaStatus();
    const info = nodes.get("dangerousSeaInfo"); assert.equal(info.hidden, !shown);
    assert.equal(nodes.get("locationLabel").textContent, "通常の港名"); assert.equal(nodes.get("locationStatus").textContent, "安全な港");
    return info;
  }
  /** @param {string|null} regionId 通知する海域。 @param {boolean} [inPort=false] 港か。 @returns {void} 一つの海域だけへの予報を検証する。 */
  function checkForecastNotifications(regionId, inPort = false) {
    hazards.recognizeDangerousWeather();
    assert.equal(toasts.length, regionId ? 1 : 0); assert.equal(logs.length, regionId ? 1 : 0); assert.equal(dispatched.length, regionId ? 1 : 0);
    assert.equal(state.dangerousSeas.regions.sw.forecast.day, today + 2); assert.equal(state.dangerousSeas.regions.se.forecast.day, today + 2);
    if (regionId) {
      const name = regionId === "sw" ? /南西/ : /南東/, other = regionId === "sw" ? /南東/ : /南西/;
      assert.match(toasts[0][1], name); assert.doesNotMatch(toasts[0][1], other);
      assert.equal(toasts[0][0], inPort ? "周辺海域の予報（港内は安全）" : "荒波の予報");
      assert.equal(logs[0][0], toasts[0][0]); assert.equal(dispatched[0], "auto-move-stop");
    }
    hazards.recognizeDangerousWeather(); assert.equal(toasts.length, regionId ? 1 : 0, "画面同期で同じ予報を重ねない");
  }

  setup(standardPorts(), { x: 4, y: 45 });
  assert.equal(geometry.dangerousSeaExpeditionPort("sw", settlements), settlements[0]);
  assert.equal(geometry.dangerousSeaExpeditionPort("se", settlements), settlements[1]);
  assert.equal(geometry.dangerousSeaExpeditionPort("unknown", settlements), null);
  assert.equal(geometry.dangerousSeaExpeditionPort("sw", []), null);
  assert.equal(world.dangerousSeaExpeditionRegionAt(null), null);
  const tied = [port(3, 45), port(4, 44)]; assert.equal(geometry.dangerousSeaExpeditionPort("sw", tied), tied[1], "港は上下左右の距離、上、左の順位で選ぶ");
  const tiedX = [port(5, 44), port(3, 44)]; assert.equal(geometry.dangerousSeaExpeditionPort("sw", tiedX), tiedX[1]);

  for (const position of [{ x: 8, y: 44 }, { x: 20, y: 43 }, { x: 10, y: 10 }, { x: 40, y: 10 }, { x: 5, y: 44 }, { x: 20, y: 20 }]) {
    setup(standardPorts(), position);
    assert.equal(world.dangerousSeaForecastRegionAt(position), null);
    checkForecastNotifications(null); const info = checkPortInfo(false); assert.equal(info.textContent, "");
    assert.equal(hazards.processDangerousSeaIntroduction(), false); assert.equal(state.eventQueue.length, 0); assert.equal(state.dangerousSeas.tutorialSeen, false);
    state.dangerousSeas.pendingHazard = { kind: "raid", regionId: "sw", stage: "watch" }; checkPortInfo(false);
  }
  for (const [position, regionId] of [[{ x: 4, y: 45 }, "sw"], [{ x: 45, y: 45 }, "se"]]) {
    setup(standardPorts(), position);
    assert.equal(world.dangerousSeaAt(position), null, "港そのものは危険海域から除外する");
    assert.equal(world.dangerousSeaExpeditionRegionAt(position), regionId);
    checkForecastNotifications(regionId, true);
    const info = checkPortInfo(true); assert.match(info.textContent, /港内は安全/); assert.match(info.textContent, regionId === "sw" ? /南西/ : /南東/);
    assert.equal(hazards.processDangerousSeaIntroduction(), false, "対応遠征港でも危険海域到達の案内は出さない");
  }
  for (const [position, regionId] of [[{ x: 0, y: 49 }, "sw"], [{ x: 49, y: 49 }, "se"]]) {
    setup(standardPorts(), position);
    assert.equal(world.dangerousSeaForecastRegionAt(position), regionId);
    checkForecastNotifications(regionId); ui.renderDangerousSeaStatus();
    const info = nodes.get("dangerousSeaInfo"); assert.equal(info.hidden, false); assert.doesNotMatch(info.textContent, /港内は安全/);
    assert.match(nodes.get("locationLabel").textContent, regionId === "sw" ? /南西/ : /南東/);
    assert.match(nodes.get("locationStatus").textContent, /核心/);
    assert.equal(hazards.processDangerousSeaIntroduction(), true); assert.equal(state.eventQueue[0].kind, "dangerous_sea_intro");
  }
  for (const [position, regionId] of [[{ x: 9, y: 40 }, "sw"], [{ x: 40, y: 40 }, "se"]]) {
    setup([port(position.x, position.y)], position);
    assert.equal(world.dangerousSeaAt(position), null);
    assert.equal(world.dangerousSeaAt({ x: position.x, y: position.y + 1 }), null, "核心維持の補正で実港周辺が円外になる配置を検証する");
    assert.equal(world.dangerousSeaExpeditionRegionAt(position), regionId, "円外に補正された港も元の対応海域を保つ");
    checkForecastNotifications(regionId, true); assert.match(checkPortInfo(true).textContent, /港内は安全/);
  }
  setup(standardPorts(), { x: 20, y: 43 });
  for (const region of Object.values(state.dangerousSeas.regions)) {
    region.weather.day = today; region.weather.known = true; region.forecast = { day: today, avoided: false };
  }
  assert.equal(hazards.updateDangerousSeaDay(), null, "通常港では周期到来日に荒波を生成しない");
  assert.equal(state.dangerousSeas.pendingHazard, null); assert.equal(toasts.length, 0); assert.equal(dispatched.length, 0);
  for (const region of Object.values(state.dangerousSeas.regions)) {
    assert.equal(region.lastWaveAbs, today); assert.ok(region.weather.day > today); assert.equal(region.forecast, null);
  }

  setup(standardPorts(), { x: 20, y: 43 }); scouts = 10;
  for (const region of Object.values(state.dangerousSeas.regions)) region.weather = { day: today + 8, safeRoll: 0.1, known: false, avoided: false };
  hazards.recognizeDangerousWeather(); assert.equal(toasts.length, 0);
  const known = JSON.stringify(state.dangerousSeas.regions); scouts = 0; hazards.recognizeDangerousWeather();
  assert.equal(JSON.stringify(state.dangerousSeas.regions), known, "域外で得た既知予定と安全航路は斥候減員後も保持する");
  state.position = { x: 4, y: 45 }; const knownInfo = checkPortInfo(true);
  assert.match(knownInfo.textContent, /あと8日/); assert.match(knownInfo.textContent, /安全な潮筋あり・被害なし/);
  hazards.recognizeDangerousWeather(); assert.equal(toasts.length, 0); assert.ok(saves > 0, "既知情報は表示先制限後も保存する");
  console.log("dangerous sea forecast UI tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
