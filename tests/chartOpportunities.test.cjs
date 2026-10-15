const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @param {*} value VM内の値。 @returns {*} 比較用の独立した値。 */
function plain(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

/** @returns {Promise<void>} 実際の依頼・取引画面・保存を通して追加の海図入手機会を検証する。 */
async function main() {
  const nodes = new Map(), stored = new Map(), microtasks = [];
  let failSave = false, saveCalls = 0;
  /** 取引行の数量入力と登録済みクリック処理を保持する最小の画面要素。 */
  class Element {
    /** @param {string} [tag="div"] 要素名。 */
    constructor(tag = "div") {
      this.tagName = tag.toUpperCase(); this.dataset = {}; this.hidden = false; this.inputs = []; this.listeners = new Map();
      this.classList = { add() {}, remove() {}, toggle() {}, contains() { return true; } };
    }
    /** @param {string} value 一覧のHTML。 */
    set innerHTML(value) {
      this.html = value;
      this.inputs = [...value.matchAll(/<input\b([^>]+)>/g)].map(match => {
        const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(row => [row[1], row[2]]));
        const input = new Element("input");
        Object.assign(input, { value: attrs.value || "0", min: attrs.min, max: attrs.max, validity: { badInput: false }, disabled: false });
        input.dataset.id = attrs["data-id"]; return input;
      });
    }
    /** @returns {string} 一覧のHTML。 */
    get innerHTML() { return this.html || ""; }
    /** @param {string} selector 選択子。 @returns {Element[]} 数量入力。 */
    querySelectorAll(selector) { return selector.startsWith("input") ? this.inputs : []; }
    /** @returns {null} 数量ボタンの装飾は操作対象に含めない。 */
    closest() { return null; }
    /** @param {string} type イベント名。 @param {Function} handler 処理。 @returns {void} 処理を登録する。 */
    addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(handler); }
    /** @param {string} name 属性。 @param {string} value 値。 @returns {void} 属性を保存する。 */
    setAttribute(name, value) { this[name] = value; }
    /** @returns {void} 登録した確定処理を実行する。 */
    click() { if (!this.disabled) for (const handler of this.listeners.get("click") || []) handler({ target: this }); }
  }
  for (const id of ["tradeTableBody", "tradeConfirm", "tradeModal", "tradeBtn", "tradeFunds", "tradeDelta", "tradeError",
    "eventTradeTableBody", "eventTradeConfirm", "eventTradeModal", "eventTradeModalClose", "eventTradeTitle", "eventTradeNote", "eventTradeFunds", "eventTradeDelta", "eventTradeError"]) nodes.set(id, new Element());
  const math = Object.create(Math); math.random = () => .99;
  const context = vm.createContext({ structuredClone, Math: math, setTimeout, clearTimeout, HTMLInputElement: Element,
    console: { ...console, error() {} }, window: { confirm: () => true }, queueMicrotask: task => microtasks.push(task),
    document: { getElementById: id => nodes.get(id) || null, createElement: tag => new Element(tag),
      addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => [], querySelector: () => null },
    CustomEvent: class { constructor(type) { this.type = type; } },
    localStorage: { getItem: key => stored.get(key) ?? null, removeItem: key => stored.delete(key),
      setItem(key, value) { saveCalls++; if (failSave) throw Error("保存失敗の検証"); stored.set(key, value); } },
  });
  const cache = new Map();
  /** @param {string} specifier モジュール名。 @returns {vm.Module} 同じ実状態を共有するモジュール。 */
  function get(specifier) {
    const name = specifier.replace(/^\.\//, "");
    if (!cache.has(name)) cache.set(name, new vm.SourceTextModule(readSource(name), { context, identifier: name }));
    return cache.get(name);
  }
  const entry = get("ui.js"); await entry.link(get); await entry.evaluate();
  const stateModule = cache.get("state.js").namespace, state = stateModule.state;
  const world = cache.get("map.js").namespace, storage = cache.get("storage.js").namespace;
  const trade = cache.get("chartTrade.js").namespace, market = cache.get("marketUI.js").namespace;
  const quests = cache.get("quests.js").namespace, opportunities = cache.get("chartQuestOpportunities.js").namespace;
  const chartWorld = cache.get("chartWorld.js").namespace, charts = cache.get("charts.js").namespace;
  const mode = cache.get("constants.js").namespace.MODE_LABEL;
  market.wireMarketModals({ openModal() {}, closeModal() {}, bindModal() {}, syncUI() {}, clearActionMessage() {} });

  /** @returns {void} 独立した世界と十分な資産を用意する。 */
  function reset() {
    failSave = false; math.random = () => .99;
    stateModule.resetState(); world.buildWorld(2025); state.modeLabel = mode.NORMAL; state.funds = 30000;
    state.quests.active = []; state.eventQueue = []; state.supplies = {}; microtasks.length = 0;
    stored.clear(); saveCalls = 0;
  }
  /** @param {boolean} [pirate=false] 無法港か。 @returns {object} 現在地へ配置した拠点。 */
  function place(pirate = false) {
    const settlement = world.settlements.find(item => !!item.pirateHaven === pirate);
    assert.ok(settlement); state.position = { ...settlement.coords }; return settlement;
  }
  /** @param {boolean} event 行商人取引か。 @param {string} id 商品ID。 @param {number} qty 予定数量。 @returns {void} 実画面の数量を変更する。 */
  function quantity(event, id, qty) {
    const table = nodes.get(event ? "eventTradeTableBody" : "tradeTableBody");
    const input = table.inputs.find(item => item.dataset.id === id);
    assert.ok(input, `${id}の数量入力がある`); input.value = String(qty);
    for (const handler of table.listeners.get("input") || []) handler({ target: input });
  }
  /** @returns {number} 取得済み通常海図断片の合計。 */
  function fragments() { return state.expansion.charts.active.reduce((sum, chart) => sum + chart.fragments, 0); }

  // 港の当選・不発を保存し、画面を開き直しても抽選・値付けを繰り返さない。
  reset(); let port = place(true); math.random = () => .25;
  assert.equal(trade.havenChartDeal(port), null, "25%の境界は不発");
  math.random = () => assert.fail("不発を同じ季節に再抽選しない");
  assert.equal(trade.havenChartDeal(port), null);
  assert.equal(storage.loadGameFromStorage(), true); port = world.getSettlementById(port.id);
  assert.equal(trade.havenChartDeal(port), null, "保存復元でも不発を保持する");
  state.season++; math.random = () => 0;
  const fixed = plain(trade.havenChartDeal(port)); assert.equal(fixed.price, 4000);
  market.renderTradeSelects(); quantity(false, "chart", 1);
  failSave = true; nodes.get("tradeConfirm").click();
  assert.equal(state.funds, 30000); assert.equal(fragments(), 0);
  assert.equal(state.expansion.charts.havenStocks[port.id].deal.stock, 1);
  failSave = false; nodes.get("tradeConfirm").click();
  assert.equal(state.funds, 26000); assert.equal(fragments(), 1); assert.equal(state.supplies.chart, undefined);
  assert.equal(storage.loadGameFromStorage(), true); port = world.getSettlementById(port.id);
  assert.equal(trade.havenChartDeal(port).stock, 0, "購入済み在庫は復元後も売り切れ");
  const savedFunds = state.funds; nodes.get("tradeConfirm").click(); assert.equal(state.funds, savedFunds);
  const otherPort = world.settlements.find(item => item.pirateHaven && item.id !== port.id);
  state.position = { ...otherPort.coords }; math.random = () => 0;
  const otherDeal = trade.havenChartDeal(otherPort);
  assert.ok(otherDeal); assert.notEqual(otherDeal.chartOffer.size, fixed.chartOffer.size, "港が違っても同じ海図に2枚目は売らない");

  // 行商人は通常物資と断片を一括購入でき、失敗時は資金・物資・商品・海図を全て戻す。
  reset(); place(); math.random = () => .1;
  assert.equal(trade.createChartTradeDeal("trader"), null, "10%の境界は不発");
  math.random = () => 0;
  let deal = trade.createChartTradeDeal("trader"); assert.equal(deal.price, 3000);
  state.eventTrade = { source: "merchant", title: "行商人との取引", deals: [deal, { id: "wood", name: "木材", price: 100, stock: 2 }] };
  market.renderEventTradeModal(state.eventTrade);
  assert.doesNotMatch(nodes.get("eventTradeTableBody").innerHTML, /本物/);
  assert.match(nodes.get("eventTradeTableBody").innerHTML, /3000/);
  quantity(true, "chart", 1); quantity(true, "wood", 2);
  failSave = true; nodes.get("eventTradeConfirm").click();
  assert.equal(state.funds, 30000); assert.equal(state.supplies.wood || 0, 0); assert.equal(fragments(), 0);
  assert.equal(state.eventTrade.deals[0].stock, 1);
  failSave = false; nodes.get("eventTradeConfirm").click();
  assert.equal(state.funds, 26800); assert.equal(state.supplies.wood, 2); assert.equal(fragments(), 1);
  assert.equal(state.eventTrade, null); assert.equal(state.supplies.chart, undefined);
  assert.equal(storage.loadGameFromStorage(), true); assert.equal(state.funds, 26800); assert.equal(fragments(), 1);
  nodes.get("eventTradeConfirm").click(); assert.equal(state.funds, 26800, "再クリックで二重購入しない");

  // 販売時と購入時の対象・予約・資金を再検証し、海図の枠を他の報酬から奪わない。
  reset(); port = place(true); math.random = () => 0; market.renderTradeSelects();
  quantity(false, "chart", 1); state.funds = 3999; nodes.get("tradeConfirm").click();
  assert.equal(fragments(), 0); assert.equal(state.funds, 3999);
  state.funds = 30000;
  const stock = state.expansion.charts.havenStocks[port.id].deal;
  const target = chartWorld.allocateChart(stock.chartOffer); target.fragments = target.size - 1;
  target.rumor = { x: 25, y: 25 }; nodes.get("tradeConfirm").click();
  assert.equal(state.funds, 30000); assert.equal(stock.stock, 1);
  assert.equal(target.fragments, target.size - 1, "噂の予約済み枠を購入で埋めない");

  // 断片を割り当てられない候補は両一覧から隠し、候補や報酬を変えずに予約解放後は再表示する。
  {
    reset(); const town = place(), nobleId = "chart-test-noble";
    const data = state.expansion.charts;
    const chart = charts.assignChart(data, { chartId: null, size: 3, kind: "treasure" }, { x: 25, y: 25 });
    chart.fragments = 1;
    const fragment = { chartId: chart.id, size: 3, kind: "treasure" };
    const candidates = [
      { id: 901, reward: 1000 },
      { id: 902, reward: 0, rewardFragment: { ...fragment } },
      { id: 903, reward: 0, rewardFragment: { ...fragment, chartId: null } },
      { id: 904, reward: 0, rewardFragment: { ...fragment, chartId: null, kind: "inlet" } },
      { id: 905, reward: 0, rewardFragment: { ...fragment, chartId: chart.id + 99 } },
      { id: 906, reward: 0, rewardFragment: { chartId: null, size: 5, kind: "treasure" } },
    ];
    state.quests.availableBySettlement[town.id] = candidates;
    state.nobleQuests.availableByNoble[nobleId] = candidates;
    const original = plain(candidates);
    math.random = () => assert.fail("候補の表示で海図や報酬を再抽選しない");
    /** @param {number[]} expected 表示する依頼ID。 @returns {void} 両一覧と保存候補を確認する。 */
    function expectAvailable(expected) {
      assert.deepEqual(plain(quests.getAvailableQuestsForSettlement(town.id).map(item => item.id)), expected);
      assert.deepEqual(plain(quests.getAvailableNobleQuests(nobleId).map(item => item.id)), expected);
      assert.deepEqual(plain(state.quests.availableBySettlement[town.id]), original);
      assert.deepEqual(plain(state.nobleQuests.availableByNoble[nobleId]), original);
    }
    expectAvailable([901, 902, 903, 906]);
    state.quests.active = [{ id: 911, rewardFragment: { ...fragment } }, { id: 912, rewardFragment: { ...fragment } }];
    expectAvailable([901, 906]);
    state.quests.active.pop();
    expectAvailable([901, 902, 903, 906]);
    chart.rumor = { x: 26, y: 26 };
    expectAvailable([901, 906]);
    state.quests.active = [];
    expectAvailable([901, 902, 903, 906]);
    chart.rumor = null; chart.fragments = chart.size;
    expectAvailable([901, 906]);
    data.active = [];
    expectAvailable([901, 903, 904, 906]);
    charts.assignChart(data, { chartId: null, size: 3, kind: "inlet" }, { x: 25, y: 25 }).fragments = 1;
    expectAvailable([901, 904, 906]);
  }

  // 新しい季節依頼は通常三件に最大一件を追加し、受注で予約、納品成功時だけ取得する。
  reset(); let town = place(); math.random = () => 0;
  quests.ensureSeasonalQuests(town);
  let offers = state.quests.availableBySettlement[town.id];
  assert.equal(offers.length, 4); assert.equal(offers.filter(item => item.chartOpportunity).length, 1);
  let opportunity = offers.find(item => item.chartOpportunity);
  assert.equal(opportunity.reward, 0); assert.ok(opportunity.rewardFragment);
  assert.equal(opportunity.type, quests.QUEST_TYPES.SUPPLY);
  const generated = plain(offers);
  math.random = () => assert.fail("同じ季節の依頼を再生成しない"); quests.ensureSeasonalQuests(town);
  assert.deepEqual(plain(offers), generated);
  math.random = () => 0;
  failSave = true; assert.equal(quests.acceptQuest(opportunity.id, town), null);
  assert.equal(state.quests.active.length, 0); assert.equal(state.expansion.charts.active.length, 0);
  failSave = false; opportunity = quests.acceptQuest(opportunity.id, town); assert.ok(opportunity);
  for (const item of opportunity.items || [{ id: opportunity.itemId, qty: opportunity.qty }]) state.supplies[item.id] = item.qty;
  const beforeSupply = plain(state.supplies), beforeFame = state.fame, beforeSupport = plain(town.support);
  failSave = true; assert.equal(quests.completeQuest(opportunity.id), false);
  assert.deepEqual(plain(state.supplies), beforeSupply); assert.equal(state.fame, beforeFame);
  assert.deepEqual(plain(town.support), beforeSupport); assert.equal(fragments(), 0);
  failSave = false; assert.equal(quests.completeQuest(opportunity.id), true);
  assert.equal(fragments(), 1); assert.equal(quests.completeQuest(opportunity.id), false);
  assert.equal(storage.loadGameFromStorage(), true); assert.equal(fragments(), 1);

  // 討伐依頼は戦闘途中に保存せず、通常の戦後保存で断片と戦果をまとめる。
  reset(); town = place(); const huntRolls = [0, .9]; math.random = () => huntRolls.shift() ?? 0;
  const hunt = opportunities.makeChartQuestOpportunity(town, { supply: () => assert.fail("討伐を選んだ場合は調達を生成しない"),
    hunt: () => ({ id: 901, type: quests.QUEST_TYPES.PIRATE_HUNT, reward: 1000, rewardFame: 2,
      originId: town.id, desc: "討伐", target: { x: 25, y: 25 } }) });
  assert.ok(hunt); assert.equal(chartWorld.reserveQuestFragment(hunt), true); state.quests.active.push(hunt);
  state.modeLabel = mode.BATTLE; const beforeBattleSaves = saveCalls;
  assert.equal(quests.completeHuntBattleQuest(hunt.id, true), true);
  assert.equal(saveCalls, beforeBattleSaves, "戦果の途中状態を保存しない");
  assert.equal(fragments(), 1); assert.equal(state.quests.active.length, 0);
  assert.equal(storage.saveGameToStorage({ battleComplete: true }), true);
  assert.equal(storage.loadGameFromStorage(), true); assert.equal(fragments(), 1);
  reset(); town = place(); math.random = () => 0;
  const failedHunt = { id: 902, type: quests.QUEST_TYPES.PIRATE_HUNT, reward: 1000, originId: town.id, chartOpportunity: true, title: "討伐" };
  chartWorld.offerQuestFragment(failedHunt, true); chartWorld.reserveQuestFragment(failedHunt); state.quests.active.push(failedHunt);
  state.modeLabel = mode.BATTLE; assert.equal(quests.completeHuntBattleQuest(failedHunt.id, false), true);
  assert.equal(state.expansion.charts.active.length, 0, "敗北した依頼の予約と空の仮海図を解放する");
  reset(); town = place(); math.random = () => .2;
  assert.equal(opportunities.makeChartQuestOpportunity(town, { supply: () => assert.fail("生成しない"), hunt: () => assert.fail("生成しない") }), null, "追加依頼20%の境界は不発");

  // 護送の当落は受注時に固定し、保存失敗・期限切れ・二重到着で謝礼を増やさない。
  reset(); town = place(); math.random = () => .1;
  let escort = quests.addRefugeeEscortQuest(town); assert.equal(escort.refugeeFragmentReward, false);
  math.random = () => assert.fail("護送の当落を再抽選しない"); opportunities.fixRefugeeFragmentReward(escort);
  assert.equal(quests.completeRefugeeEscortAt(town), true); assert.equal(fragments(), 0); assert.equal(state.fame, 4);
  reset(); town = place(); math.random = () => 0;
  escort = quests.addRefugeeEscortQuest(town); state.refugeeEscort = { active: true, targetId: town.id };
  assert.equal(storage.saveGameToStorage(), true); assert.equal(storage.loadGameFromStorage(), true); town = world.getSettlementById(town.id);
  failSave = true; assert.equal(quests.completeRefugeeEscortAt(town), false);
  assert.equal(state.fame, 0); assert.equal(fragments(), 0); assert.equal(state.refugeeEscort.active, true);
  failSave = false; assert.equal(quests.completeRefugeeEscortAt(town), true);
  assert.equal(state.fame, 4); assert.equal(fragments(), 1);
  assert.equal(quests.completeRefugeeEscortAt(town), false); assert.equal(fragments(), 1);
  assert.equal(storage.loadGameFromStorage(), true); assert.equal(fragments(), 1);
  reset(); town = place(); math.random = () => 0; escort = quests.addRefugeeEscortQuest(town);
  state.day += 31; assert.equal(quests.completeRefugeeEscortAt(town), false); assert.equal(fragments(), 0);
  reset(); town = place(); math.random = () => 0; escort = quests.addRefugeeEscortQuest(town);
  for (const size of [3, 5]) charts.assignChart(state.expansion.charts, { chartId: null, size, kind: "treasure" }, { x: 25 + size, y: 25 }).fragments = size;
  assert.equal(quests.completeRefugeeEscortAt(town), true); assert.equal(state.fame, 4); assert.equal(fragments(), 8, "海図の空きがなくても護送の通常謝礼を維持する");
  reset(); town = place(); math.random = () => 0; escort = quests.addRefugeeEscortQuest(town); delete escort.refugeeFragmentReward;
  assert.equal(quests.completeRefugeeEscortAt(town), true); assert.equal(fragments(), 0, "旧保存の護送へ断片の抽選を遡及追加しない");
  assert.equal(charts.normalizeChartTradeDeal({ id: "chart", chartSource: "haven", price: -1, stock: 1, chartOffer: {} }, "haven"), null);
  console.log("海図追加機会: 実取引UI・季節在庫・購入上限・保存失敗・依頼予約/達成・護送当落・一意精算: 成功");
}

/** @param {Error} error 失敗。 @returns {void} 失敗を終了コードへ反映する。 */
function reportFailure(error) { console.error(error); process.exitCode = 1; }
main().catch(reportFailure);
