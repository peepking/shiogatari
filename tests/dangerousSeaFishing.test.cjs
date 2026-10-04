const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadTestModule } = require("./helpers/module.cjs");
const { readSource } = require("./helpers/source.cjs");

/**
 * 枠と魚種の抽選へ順に値を返し、不要な再抽選を検出する。
 * @param {number[]} values 抽選値。
 * @returns {Function} 検証用乱数。
 */
function randomSequence(values) {
  let index = 0;
  return () => {
    assert.ok(index < values.length, "抽選を余分に行わない");
    return values[index++];
  };
}

/**
 * 生息条件の例外、餌、優遇枠と図鑑の更新を実データで確認する。
 * @returns {Promise<void>} 検証完了。
 */
async function main() {
  const module = await loadTestModule("dangerousSeaFishing.js");
  const { rollDangerousSeaCatch, DANGEROUS_SEA_RARE_FISH_IDS } = module.namespace;
  const config = await loadTestModule("fishingConfig.js");
  const species = config.namespace.FISH_SPECIES;
  const rareIds = new Set(DANGEROUS_SEA_RARE_FISH_IDS);
  assert.equal(rareIds.size, 16);
  for (const id of rareIds) assert.ok(species.some(fish => fish.id === id), `${id}は既存魚種`);

  // 全286種を餌重みの区間中央で選び、浅瀬・北方・季節限定魚も除外されないことを確認する。
  for (const target of species) {
    const baitId = Object.keys(target.baits).find(id => target.baits[id] > 0);
    const pool = species.filter(fish => fish.baits[baitId] > 0);
    const total = pool.reduce((sum, fish) => sum + fish.baits[baitId], 0);
    const index = pool.findIndex(fish => fish.id === target.id);
    const before = pool.slice(0, index).reduce((sum, fish) => sum + fish.baits[baitId], 0);
    const caught = rollDangerousSeaCatch(
      { baitId, regionId: "sw", season: 2, depth: "sea" },
      randomSequence([0.45, (before + target.baits[baitId] / 2) / total])
    );
    assert.equal(caught.id, target.id, `${target.id}は生息条件にかかわらず餌が合えば釣れる`);
  }

  // 希少枠は各餌に合う指定魚だけを選ぶ。通常枠にも指定魚が残る。
  for (const baitId of Object.keys(config.namespace.BAIT_DEFS)) {
    for (const value of [0, 0.5, 0.999999]) {
      const caught = rollDangerousSeaCatch({ baitId }, randomSequence([0.199999, value]));
      assert.ok(rareIds.has(caught.id));
      assert.ok(caught.baits[baitId] > 0);
    }
  }
  assert.equal(rollDangerousSeaCatch({ baitId: "invalid" }, randomSequence([])), null);
  assert.equal(rollDangerousSeaCatch({ baitId: "toString" }, randomSequence([])), null);

  const codex = Object.fromEntries(species.map(fish => [fish.id, { count: 1 }]));
  codex.aji.count = 0;
  codex.madai.count = 0;
  assert.equal(rollDangerousSeaCatch({ baitId: "insect", codex }, randomSequence([0.2, 0])).id, "aji");
  codex.aji.count = 1;
  assert.equal(rollDangerousSeaCatch({ baitId: "insect", codex }, randomSequence([0.449999, 0])).id, "madai", "次の投へ登録済み魚の除外を反映する");
  codex.madai.count = 1;
  assert.equal(rollDangerousSeaCatch({ baitId: "insect", codex }, randomSequence([0.2, 0])).id, "aji", "図鑑完成後は未登録枠を通常枠へ戻す");

  // 未登録魚が餌に合わない場合も通常枠へ戻し、相性0を救済しない。
  codex.megalodon.count = 0;
  const fallback = rollDangerousSeaCatch({ baitId: "insect", codex }, randomSequence([0.25, 0]));
  assert.equal(fallback.id, "aji");
  assert.equal(species.find(fish => fish.id === "megalodon").baits.insect, 0);

  // 希少魚が存在しない餌の将来設定でも空振りにならず、通常枠の3対1の餌重みを維持する。
  const testSpecies = [
    { id: "ordinary-a", baits: { cut: 3 } },
    { id: "ordinary-b", baits: { cut: 1 } },
  ];
  const mock = new vm.SyntheticModule(["BAIT_DEFS", "FISH_SPECIES"],
    /** @returns {void} 将来の餌設定を検証用に公開する。 */
    function publishTestSpecies() {
      this.setExport("BAIT_DEFS", { cut: {} });
      this.setExport("FISH_SPECIES", testSpecies);
    });
  const fishing = await loadTestModule("fishing.js");
  const eventsConfig = await loadTestModule("dangerousSeaEventConfig.js");
  const future = new vm.SourceTextModule(readSource("dangerousSeaFishing.js"));
  await future.link(name => name === "./fishingConfig.js" ? mock : name === "./dangerousSeaEventConfig.js" ? eventsConfig : fishing);
  await future.evaluate();
  const futureCatch = future.namespace.rollDangerousSeaCatch;
  assert.equal(futureCatch({ baitId: "cut" }, randomSequence([0, 0.749999])).id, "ordinary-a");
  assert.equal(futureCatch({ baitId: "cut" }, randomSequence([0, 0.75])).id, "ordinary-b");
  assert.equal(futureCatch({ baitId: "cut", migrationFishIds: ["ordinary-b"] }, randomSequence([0, 0.6])).id, "ordinary-b", "回遊は空の優遇枠の振替後も重みだけ二倍にする");
  assert.equal(testSpecies[1].baits.cut, 1, "元の餌相性を変更しない");
  console.log("dangerousSeaFishing: 全魚種・餌・希少枠・未登録更新・空枠の検証成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
