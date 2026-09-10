const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/**
 * 依頼種別ごとの数量、到着、護送段階、連戦、期限境界を検証する。
 * @returns {Promise<void>}
 */
async function main() {
  const source = await fs.readFile(path.join(__dirname, "../questProgress.js"), "utf8");
  const module = new vm.SourceTextModule(source);
  /** @returns {void} 外部依存を禁止する。 */
  function link() { throw Error("予期しない依存"); }
  await module.link(link);
  await module.evaluate();
  const { getQuestProgress } = module.namespace;
  const state = { supplies: { food: 3, wood: 20 }, troops: { infantry: { 1: 2, 3: 5 } }, funds: 80, position: { x: 1, y: 2 } };
  const context = { now: 100, canFinish: false, origin: { name: "村", coords: { x: 3, y: 4 } }, target: { name: "港", coords: { x: 1, y: 2 } } };
  const before = JSON.stringify(state);
  let result = getQuestProgress({ type: "supply", itemId: "food", qty: 10 }, state, context);
  assert.equal(result.rows[0].text, "3 / 10");
  assert.equal(result.rows[0].note, "あと7");
  assert.equal(result.rows[1].done, false);
  result = getQuestProgress({ type: "delivery", itemId: "wood", qty: 10 }, state, context);
  assert.equal(result.rows[0].current, 10);
  assert.equal(result.rows[0].text, "20 / 10");
  assert.equal(result.rows[1].done, true);
  for (const type of ["oracle_supply", "noble_supply", "noble_logistics", "war_supply"]) {
    result = getQuestProgress({ type, items: [{ id: "food", qty: 10 }, { id: "wood", qty: 5 }] }, state, context);
    assert.equal(result.rows[0].done, false);
    assert.equal(result.rows[1].done, true);
    assert.equal(result.ready, false);
  }
  result = getQuestProgress({ type: "oracle_troop", troopType: "infantry" }, state, context);
  assert.equal(result.rows[0].text, "7 / 1");
  result = getQuestProgress({ type: "war_truce", costFunds: 100 }, state, context);
  assert.equal(result.rows[0].note, "あと20");
  for (const type of ["oracle_move", "noble_scout"]) {
    result = getQuestProgress({ type, target: state.position }, state, context);
    assert.equal(result.rows[0].done, true);
  }
  for (const type of ["noble_refugee", "war_escort"]) {
    result = getQuestProgress({ type, picked: false, target: state.position }, state, context);
    assert.equal(result.rows[0].done, false);
    result = getQuestProgress({ type, picked: true, target: state.position }, state, context);
    assert.equal(result.rows[0].done, true);
    assert.equal(result.rows[1].done, false);
    assert.ok(result.next.includes("村"));
  }
  for (const type of ["noble_security", "war_blockade"]) {
    result = getQuestProgress({ type, fights: [{ done: true }, { done: false, target: state.position }] }, state, context);
    assert.equal(result.rows[0].text, "1 / 2戦");
    assert.equal(result.automatic, true);
  }
  result = getQuestProgress({ type: "pirate_hunt", target: state.position }, state, context);
  assert.equal(result.rows[0].text, "0 / 1戦");
  for (const [deadlineAbs, deadline, ready] of [[100, "本日が期限", true], [99, "期限切れ", false], [103, "残り3日", true], [null, "期限なし", true]]) {
    result = getQuestProgress({ type: "oracle_move", target: state.position, deadlineAbs }, state, { ...context, canFinish: true });
    assert.equal(result.deadline, deadline);
    assert.equal(result.ready, ready);
  }
  assert.equal(JSON.stringify(state), before);
  console.log("依頼進捗・期限・段階表示: 全項目成功");
}

/** @param {Error} error 検証失敗を終了コードに反映する。 */
function reportFailure(error) { console.error(error); process.exitCode = 1; }
main().catch(reportFailure);
