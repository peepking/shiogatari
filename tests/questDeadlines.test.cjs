const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/**
 * 期限設定の変更が計算用日数と案内に連動し、確定期限が優先されることを検証する。
 * @returns {Promise<void>}
 */
async function main() {
  const source = await fs.readFile(path.join(__dirname, "../questDeadlines.js"), "utf8");
  for (const days of [60, 75]) {
    const module = new vm.SourceTextModule(source.replace("delivery: 60", `delivery: ${days}`));
    /** @returns {void} 外部依存を禁止する。 */
    function link() { throw Error("予期しない依存"); }
    await module.link(link);
    await module.evaluate();
    const { getQuestDeadlineDays, modalDeadlineText } = module.namespace;
    assert.equal(getQuestDeadlineDays("delivery"), days);
    assert.equal(modalDeadlineText({ type: "delivery" }, 100), `受注から${days}日`);
    assert.equal(modalDeadlineText({ type: "delivery", deadlineAbs: 110 }, 100), "残り10日");
    assert.equal(modalDeadlineText({ deadlineAbs: 100 }, 100), "本日が期限");
    assert.equal(modalDeadlineText({ deadlineAbs: 99 }, 100), "期限切れ");
    assert.equal(modalDeadlineText({ type: "unknown" }, 100), "期限なし");
    for (const [type, expected] of [["supply",30],["pirate_hunt",45],["noble_scout",30],["noble_hunt",60]]) {
      assert.equal(getQuestDeadlineDays(type), expected);
      assert.equal(modalDeadlineText({ type }, 100), `受注から${expected}日`);
    }
  }
  console.log("依頼期限の設定連動・期限境界: 全項目成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
