const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

/**
 * 報告の装飾とログ本文の分離、不正なラベル・IDの安全な表示を検証する。
 * @returns {Promise<void>}
 */
async function main() {
  const modules = {};
  /** @param {string} name @returns {Promise<vm.Module>} 表示モジュールを読み込む。 */
  async function load(name) {
    if (!modules[name]) {
      modules[name] = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "..", name), "utf8"));
      await modules[name].link(load);
    }
    return modules[name];
  }
  const module = await load("./resourceUI.js");
  await module.evaluate();
  const { resourceIcon, resourceToken, resourceList, renderReportLine, reportLineText } = module.namespace;
  for (const id of ["food", "wood", "stone", "iron", "fiber", "salt", "spice", "arms", "textile", "brew", "leather", "funds", "fame", "faith", "ships", "troops"]) {
    const html = resourceIcon(id);
    const src = html.match(/src="([^"]+)"/)[1];
    await fs.access(path.join(__dirname, "..", src));
    assert.ok(html.includes('alt=""'));
  }
  assert.equal(resourceIcon("../../secret"), "");
  assert.equal(resourceIcon("__proto__"), "");
  const malicious = resourceToken({ id: "funds", label: '<img src=x onerror="alert(1)">', value: "<script>" });
  assert.ok(!malicious.includes("<script>"));
  assert.ok(malicious.includes("&lt;img"));
  const lines = ["勝利", { text: "資金 +120", icon: "funds" }, { text: "物資: 木材 +2", label: "物資", resources: [{ id: "wood", label: "木材", value: "+2" }] }];
  assert.equal(lines.map(reportLineText).join("\n"), "勝利\n資金 +120\n物資: 木材 +2");
  assert.ok(renderReportLine(lines[1]).includes("funds.svg"));
  assert.ok(renderReportLine(lines[2]).includes("wood.svg"));
  assert.equal(renderReportLine("<b>本文</b>"), "&lt;b&gt;本文&lt;/b&gt;");
  const restored = JSON.parse(JSON.stringify({ body: "達成", resources: lines[2].resources }));
  assert.ok(resourceList(restored.resources).includes("wood.svg"));
  console.log("報告アイコン・ログ分離・安全な表示: 全項目成功");
}

/** @param {Error} error 検証失敗を終了コードへ反映する。 */
function reportFailure(error) { console.error(error); process.exitCode = 1; }
main().catch(reportFailure);
