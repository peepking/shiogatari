const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const path = require("node:path");
/** @returns {Promise<void>} 指定順・候補切れ・評価優先・20枠での公平性・再実行の一致を検証する。 */
async function main() {
  const module = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../rosterPriority.js"), "utf8"));
  await module.link(() => {}); await module.evaluate();
  const order = module.namespace.orderRosterCandidates;
  for (const types of [["crossbow", "halberd", "seaArcher"], ["shield", "archer", "marine"], ["scout", "medic"]]) {
    const chunks = [...types].reverse().flatMap(type => Array.from({ length: 3 }, () => ({ type, weight: 100, size: 10 })));
    const before = JSON.stringify(chunks);
    assert.equal(order(chunks).map(c => c.type).join(), [...types, ...types, ...types].join());
    assert.equal(JSON.stringify(chunks), before);
    assert.equal(JSON.stringify(order(chunks)), JSON.stringify(order(chunks)));
  }
  const chunks = [
    ...Array.from({ length: 7 }, () => ({ type: "archer", weight: 1680, size: 10 })),
    ...Array.from({ length: 10 }, () => ({ type: "marine", weight: 1680, size: 10 })),
    ...Array.from({ length: 4 }, () => ({ type: "shield", weight: 1680, size: 10 })),
    ...Array.from({ length: 13 }, () => ({ type: "cavalier", weight: 2520, size: 10 })),
  ];
  const selected = order(chunks).slice(0, 20);
  assert.equal(selected.slice(0, 13).every(c => c.type === "cavalier"), true);
  assert.equal(selected.slice(13).map(c => c.type).join(), "shield,archer,marine,shield,archer,marine,shield");
  const exhausted = order([{ type: "shield", weight: 100, size: 10 }, ...Array.from({ length: 3 }, () => ({ type: "marine", weight: 100, size: 10 }))]);
  assert.equal(exhausted.map(c => c.type).join(), "shield,marine,marine,marine");
  assert.equal(order([{ type: "shield", weight: 90, size: 9 }, { type: "archer", weight: 100, size: 10 }])[0].type, "archer");
  assert.equal(order([]).length, 0);
  console.log("おまかせ編成の同評価ローテーション: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
