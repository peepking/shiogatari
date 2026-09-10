const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/**
 * 人数配分の境界値、兵種除外、設定保存と再読み込みを検証する。
 * @returns {Promise<void>}
 */
async function main() {
  let stored = null;
  let fail = false;
  let change;
  const nodes = {
    rosterExcludeSupport: {}, rosterSizeMode: {}, rosterOptionsStatus: {},
    rosterOptions: {
      /** @param {string} name @param {Function} handler 変更通知を保持する。 */
      addEventListener(name, handler) { change = handler; },
    },
  };
  const source = await fs.readFile(path.join(__dirname, "../rosterOptions.js"), "utf8");
  /** @returns {Promise<object>} 独立した画面起動を再現する。 */
  async function boot() {
    const context = vm.createContext({
      localStorage: {
        /** @returns {string|null} 設定を読む。 */
        getItem() { if (fail) throw Error(); return stored; },
        /** @param {string} key @param {string} value 設定を保存する。 */
        setItem(key, value) { if (fail) throw Error(); stored = value; },
      },
      document: {
        /** @param {string} id @returns {object} 入力欄を取得する。 */
        getElementById(id) { return nodes[id]; },
      },
    });
    const module = new vm.SourceTextModule(source, { context });
    /** @returns {void} 外部依存がないことを確認する。 */
    function link() { throw Error("予期しない外部依存"); }
    await module.link(link);
    await module.evaluate();
    return module.namespace;
  }
  const api = await boot();
  assert.equal(api.rosterOptions.sizeMode, "any");
  assert.equal(api.rosterOptions.excludeSupport, false);
  assert.deepEqual([...api.splitRosterCounts(23, "min7")], [7, 8, 8]);
  assert.deepEqual([...api.splitRosterCounts(13, "min7")], [10]);
  assert.deepEqual([...api.splitRosterCounts(23, "full")], [10, 10]);
  assert.deepEqual([...api.splitRosterCounts(23, "any")], [10, 10, 3]);
  for (let total = 0; total <= 300; total++) {
    for (const mode of ["any", "min7", "full"]) {
      const counts = [...api.splitRosterCounts(total, mode)];
      const min = mode === "full" ? 10 : mode === "min7" ? 7 : 1;
      assert.ok(counts.every(count => count >= min && count <= 10));
      const deployed = counts.reduce((sum, count) => sum + count, 0);
      assert.ok(deployed <= total);
      let best = 0;
      for (let slots = 0; slots <= total; slots++) {
        if (slots * min <= total) best = Math.max(best, Math.min(total, slots * 10));
      }
      assert.equal(deployed, best, `${total}/${mode}`);
      if (mode === "min7" && counts.length) assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
    }
  }
  for (const type of ["scout", "medic", "infantry", "archer"]) {
    assert.equal(api.canAutoDeploy(type, { excludeSupport: false }), true);
    assert.equal(api.canAutoDeploy(type, { excludeSupport: true }), !["scout", "medic"].includes(type));
  }
  api.initRosterOptions();
  nodes.rosterExcludeSupport.checked = true;
  nodes.rosterSizeMode.value = "min7";
  change();
  let restored = await boot();
  assert.equal(restored.rosterOptions.sizeMode, "min7");
  assert.equal(restored.rosterOptions.excludeSupport, true);
  nodes.rosterSizeMode.value = "full";
  change();
  restored = await boot();
  assert.equal(restored.rosterOptions.sizeMode, "full");
  stored = "破損データ";
  assert.equal((await boot()).rosterOptions.sizeMode, "any");
  stored = '{"sizeMode":"invalid","excludeSupport":"true"}';
  assert.equal((await boot()).rosterOptions.excludeSupport, false);
  fail = true;
  nodes.rosterSizeMode.value = "min7";
  assert.doesNotThrow(change);
  assert.equal(api.rosterOptions.sizeMode, "min7");
  assert.equal((await boot()).rosterOptions.sizeMode, "any");
  console.log("自動編成の人数配分・兵種除外・設定保存: 全項目成功");
}

/** @param {Error} error 検証失敗を終了コードへ反映する。 */
function reportFailure(error) {
  console.error(error);
  process.exitCode = 1;
}

main().catch(reportFailure);
