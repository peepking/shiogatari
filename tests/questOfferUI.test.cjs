/* eslint-env node */
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @param {string} html 依頼表示。 @returns {string} 閉じた詳細を除いた主表示。 */
function primaryContent(html) { return html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, ""); }

/** @param {string} html 表示。 @param {string} text 調べる文字列。 @returns {number} 表示回数。 */
function countText(html, text) { return html.split(text).length - 1; }

/** @returns {Promise<void>} 受注前の必須条件を詳細へ隠さず、配達先を見出しで強調し、数量・報酬の重複を避けることを検証する。 */
async function main() {
  const origin = { id: "origin", name: "潮待ち村", coords: { x: 1, y: 2 } };
  const destination = { id: "destination", name: "灯台港", coords: { x: 5, y: 2 } };
  const settlements = [origin, destination], state = { currentOracleReward: 45 };
  const types = ["supply", "delivery", "refugee_escort", "oracle_supply", "oracle_move", "oracle_troop", "oracle_hunt", "oracle_elite", "pirate_hunt", "bounty_hunt", "noble_supply", "noble_scout", "noble_security", "noble_refugee", "noble_logistics", "noble_hunt", "war_defend_raid", "war_attack_raid", "war_skirmish", "war_supply", "war_escort", "war_blockade", "war_truce"];
  const stubs = {
    "./tideAlliance.js": { tideOracleReward: game => game.currentOracleReward },
    "./pirateEconomy.js": { pirateRewardLabel: () => "" },
    "./wantedPolicy.js": { wantedFacilityReason: () => "" },
    "./actions.js": { getCurrentSettlement: () => origin },
    "./dom.js": { elements: {}, pushToast() {} },
    "./map.js": { getSettlementById: id => settlements.find(settlement => settlement.id === id), focusMapPosition() {} },
    "./chartWorld.js": { chartLabel: () => "海図" },
    "./quests.js": { acceptQuest() {}, canCompleteQuest() {}, completeQuest() {}, getAvailableQuestsForSettlement() {}, getQuests() {}, QUEST_TYPES: Object.fromEntries(types.map(type => [type.toUpperCase(), type])) },
    "./questUtils.js": { absDay: () => 1, manhattan: (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) },
    "./state.js": { state }, "./nationalPowerUI.js": { questPowerRewardHtml: () => "" },
    "./supplies.js": { SUPPLY_ITEMS: [{ id: "wood", name: "木材" }] },
    "./troops.js": { TROOP_STATS: {} }, "./questProgress.js": { getQuestProgress() {} },
    "./questDeadlines.js": { modalDeadlineText: () => "受注から30日" },
  };
  const context = vm.createContext({}), modules = new Map();
  /** @param {string} name 依存名。 @returns {Promise<vm.Module>} 表示とエスケープは実際のモジュールを使う。 */
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const values = stubs[name];
    const module = values ? new vm.SyntheticModule(Object.keys(values),
      /** @returns {void} 画面と無関係な依頼処理を差し替える。 */
      function publish() { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context })
      : new vm.SourceTextModule(readSource(name), { context });
    modules.set(name, module); await module.link(load); return module;
  }
  const module = await load("./questUI.js"); await module.evaluate();
  const { renderQuestOffer, renderQuestRewards } = module.namespace;

  const supply = renderQuestOffer({ type: "supply", originId: origin.id, title: "調達依頼: 木材 x8", itemId: "wood", qty: 8, desc: "木材を8個用意し、受注した拠点で納品。" }, origin);
  const supplyPrimary = primaryContent(supply);
  assert.ok(supplyPrimary.includes("木材")); assert.equal(countText(supplyPrimary, "×8"), 1, "必要数量は主表示に一度だけ出す");
  assert.equal(countText(supplyPrimary, "8"), 1, "旧タイトル・本文の数量を主表示へ重ねない");
  assert.equal(countText(supplyPrimary, origin.name), 1, "納品先は主表示に一度だけ出す");
  assert.ok(supplyPrimary.includes("(2, 3)")); assert.ok(!supplyPrimary.includes("8個用意"));

  const delivery = renderQuestOffer({ type: "delivery", originId: origin.id, targetId: destination.id, title: "配達依頼: 木材を灯台港へ", itemId: "wood", qty: 3, desc: "灯台港へ木材を届ける。" }, origin);
  const deliveryPrimary = primaryContent(delivery);
  assert.equal(countText(deliveryPrimary, "×3"), 1);
  assert.ok(deliveryPrimary.includes('<div class="quest-offer-title"><b>灯台港への配達</b></div>'), "配達先を主見出しで強調する");
  assert.equal(countText(deliveryPrimary, "木材"), 1, "物資は条件欄に残す");
  assert.ok(deliveryPrimary.includes("(6, 3)")); assert.ok(deliveryPrimary.includes("最短4マス"));
  assert.ok(!deliveryPrimary.includes("木材を届ける"));
  for (const [pirateKind, label] of [["smuggle", "密輸"], ["courier", "運び屋依頼"]]) {
    const html = renderQuestOffer({ type: "delivery", targetId: destination.id, pirateKind, itemId: "wood", qty: 1 }, origin);
    assert.ok(primaryContent(html).includes(`<b>灯台港への${label}</b>`), "海賊の配達も行き先を主見出しに含める");
  }

  for (const type of ["oracle_move", "oracle_hunt", "oracle_elite"]) {
    const target = { x: 8, y: 11 }, coords = "(9, 12)";
    const html = renderQuestOffer({ type, title: "神託", target, desc: `${coords}で達成してください。` }, origin);
    assert.equal(countText(primaryContent(html), coords), 1, `${type}: 本文を閉じても行き先を確認できる`);
  }
  for (const type of ["pirate_hunt", "bounty_hunt"]) {
    const html = renderQuestOffer({ type, title: "討伐", target: { x: 12, y: 16 }, estimatedTotal: 48, desc: "(13, 17)で敵48人を討伐。" }, origin);
    assert.ok(primaryContent(html).includes("(13, 17)")); assert.ok(primaryContent(html).includes("推定48人"));
  }

  const escort = renderQuestOffer({ type: "war_escort", title: "輸送護衛", originId: origin.id,
    target: { x: 14, y: 22 }, desc: "(15, 23)の輸送隊を潮待ち村へ護送。" }, origin);
  const escortPrimary = primaryContent(escort);
  assert.equal(countText(escortPrimary, "(15, 23)"), 1, "輸送隊との合流地点を主表示に残す");
  assert.equal(countText(escortPrimary, origin.name), 1, "輸送隊の帰還先を主表示に残す");
  assert.ok(escortPrimary.includes("(2, 3)"), "帰還先の座標も本文を開かず確認できる");

  const security = renderQuestOffer({ type: "noble_security", title: "治安回復", originId: origin.id,
    fights: [{ target: { x: 10, y: 13 }, estimatedTotal: 37, strength: "normal" }, { target: { x: 18, y: 20 }, estimatedTotal: 64, strength: "elite" }],
    desc: "(11, 14)の敵37人と(19, 21)の精鋭64人を討伐。" }, origin);
  const securityPrimary = primaryContent(security);
  for (const text of ["(11, 14)", "推定37人", "(19, 21)", "推定64人", "精鋭"]) assert.ok(securityPrimary.includes(text), `治安回復: ${text}を本文に隠さない`);
  assert.equal(countText(securityPrimary, "(11, 14)"), 1); assert.equal(countText(securityPrimary, "(19, 21)"), 1);

  const oracle = { type: "oracle_hunt", rewardFaith: 30 };
  const reward = primaryContent(renderQuestRewards(oracle));
  assert.ok(reward.includes("今季の見込み")); assert.ok(reward.includes("+45")); assert.ok(!reward.includes("30"));
  state.currentOracleReward = 72;
  assert.ok(primaryContent(renderQuestRewards(oracle)).includes("+72"), "再表示時は現在の受取見込みへ更新する");
  assert.equal(oracle.rewardFaith, 30, "表示の短縮で基礎報酬は変更しない");

  const attack = '<img src=x onerror="alert(1)"> & <script>bad()</script>';
  const safe = renderQuestOffer({ type: "oracle_move", title: attack, target: { x: 1, y: 1 }, desc: attack }, origin);
  assert.ok(!safe.includes("<img src=x")); assert.ok(!safe.includes("<script>"));
  assert.ok(primaryContent(safe).includes("&lt;img"), "タイトルも安全に表示する");
  assert.ok(safe.includes("&lt;script&gt;bad()&lt;/script&gt;"), "本文を展開してもHTMLを実行しない");
  assert.ok(safe.includes("&quot;alert(1)&quot;")); assert.ok(safe.includes("&amp;"));
  console.log("依頼受注表示: 配達先の強調・数量の重複防止・神託座標・複数戦の場所/敵人数・現在報酬・安全な本文表示: 成功");
}

/** @param {Error} error 検証失敗。 @returns {void} 終了コードへ反映する。 */
function reportFailure(error) { console.error(error); process.exitCode = 1; }
main().catch(reportFailure);
