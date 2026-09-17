const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const path = require("node:path");

/** 釣りモジュールの名前空間（読み込み後に設定）。 */
let fishing = null;

/** 釣りの最小ステートを作る。 */
function makeState() {
  return {
    year: 1000,
    season: 0,
    day: 1,
    position: { x: 10, y: 10 },
    supplies: { food: 10 },
    funds: 100,
    expansion: { fishing: fishing.createFishingState() },
  };
}

/** 海域判定・抽選・猶予・登録・捌き・売却・補完・図鑑フィルタ・ヒント公開を検証する。 */
async function main() {
  const config = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../fishingConfig.js"), "utf8"));
  const mod = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../fishing.js"), "utf8"));
  await config.link(() => {});
  await mod.link((name) =>
    name === "./fishingConfig.js"
      ? config
      : (() => {
          throw new Error(`予期しない依存: ${name}`);
        })()
  );
  await mod.evaluate();
  fishing = mod.namespace;

  // 海域判定: 50×50を2等分した象限
  assert.equal(fishing.fishingRegionAt(10, 10), "nw");
  assert.equal(fishing.fishingRegionAt(30, 10), "ne");
  assert.equal(fishing.fishingRegionAt(10, 30), "sw");
  assert.equal(fishing.fishingRegionAt(30, 30), "se");
  assert.equal(fishing.fishingRegionAt(24, 24), "nw");
  assert.equal(fishing.fishingRegionAt(25, 24), "ne");
  assert.equal(fishing.fishingRegionAt(24, 25), "sw");
  assert.equal(fishing.fishingRegionAt(25, 25), "se");

  // サイズ: madai のサイズ範囲内で整数を返す
  const size = fishing.rollSize("madai", () => 0.5);
  assert.ok(Number.isInteger(size) && size >= 30 && size <= 70);

  // 重み付き抽選: テスト専用プールでは定義どおりの種が選ばれる
  const pool = [
    { id: "test-a", baits: { cut: 3 } },
    { id: "test-b", baits: { cut: 1 } },
  ];
  assert.equal(fishing.rollCatchFromPool(pool, "cut", () => 0).id, "test-a");
  assert.equal(fishing.rollCatchFromPool(pool, "cut", () => 0.5).id, "test-a");
  assert.equal(fishing.rollCatchFromPool(pool, "cut", () => 0.99).id, "test-b");

  // 空プール・重み0のみ・不正な餌IDは null を返す
  assert.equal(fishing.rollCatchFromPool([], "cut", () => 0.5), null);
  assert.equal(fishing.rollCatchFromPool([{ id: "test-c", baits: { cut: 0 } }], "cut", () => 0.5), null);
  assert.equal(fishing.rollCatchFromPool(pool, "nope", () => 0.5), null);

  // 実データ全組み合わせ: 返り値は必ず環境条件を満たす（総当たり検証）
  for (const regionId of ["nw", "ne", "sw", "se"]) {
    for (let season = 0; season < 4; season++) {
      for (const depth of ["sea", "shoal"]) {
        for (const baitId of ["insect", "shell", "cut", "small"]) {
          const s = fishing.rollCatch({ regionId, season, depth, baitId }, Math.random);
          if (s == null) continue;
          assert.ok(
            s.regions.includes(regionId) && s.seasons.includes(season) && s.depth.includes(depth),
            `環境 ${regionId}/${season}/${depth}/${baitId} で条件不一致`
          );
          assert.ok(s.baits[baitId] > 0, `環境 ${regionId}/${season}/${depth}/${baitId} で重み0を選出`);
          assert.equal(fishing.speciesById(s.id), s);
        }
      }
    }
  }

  // 維持種が保証する環境は必ず候補がある（海×虫餌は全季節・全海域、海×切れ身は春夏秋）
  assert.ok(fishing.rollCatch({ regionId: "se", season: 0, depth: "sea", baitId: "insect" }, Math.random));
  assert.ok(fishing.rollCatch({ regionId: "nw", season: 1, depth: "sea", baitId: "insect" }, Math.random));
  assert.ok(fishing.rollCatch({ regionId: "sw", season: 2, depth: "sea", baitId: "cut" }, Math.random));

  // 餌の重み0の種は決して引かない（虫餌・夏・海の候補はすべて昆虫重み>0）
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const s = fishing.rollCatch({ regionId: "ne", season: 1, depth: "sea", baitId: "insect" }, Math.random);
    assert.ok(s, "候補は必ず存在する");
    assert.ok((s.baits.insect || 0) > 0, "重み0の種は選ばれない");
    seen.add(s.id);
  }
  assert.ok(seen.size >= 3, "複数の種が混ざる");

  // 猶予: 一般魚ほど長く、大物・超大物ほど短い。竿倍率で調整（最低2秒）
  assert.ok(fishing.windowFor("aji", "rod_basic") > fishing.windowFor("madai", "rod_basic"));
  // madai(base=4) と kuromaguro(base=2) は粗末竿(0.5倍)でともに下限2秒になるため等しい
  assert.equal(fishing.windowFor("madai", "rod_basic"), 2);
  assert.equal(fishing.windowFor("kuromaguro", "rod_basic"), 2);
  // 古き海の竿(1.0倍)なら元の差が保たれる
  assert.ok(fishing.windowFor("madai", "rod_ancient") > fishing.windowFor("kuromaguro", "rod_ancient"));

  // 時間内判定
  assert.equal(fishing.isPullWithinWindow(6, 5999), true);
  assert.equal(fishing.isPullWithinWindow(6, 6001), false);

  // 登録: 初回は図鑑に記載、2回目以降は最大サイズのみ更新
  const st = makeState();
  const aji = fishing.speciesById("aji");
  fishing.recordCatch(st, { species: aji, size: 25 });
  assert.equal(st.expansion.fishing.counts.aji, 1);
  assert.equal(st.expansion.fishing.codex.aji.count, 1);
  assert.equal(st.expansion.fishing.codex.aji.maxSize, 25);
  assert.equal(st.expansion.fishing.codex.aji.maxSizeAbs, 1000 * 120 + 1);
  assert.deepEqual(st.expansion.fishing.codex.aji.maxSizePos, { x: 10, y: 10 });
  fishing.recordCatch(st, { species: aji, size: 20 });
  assert.equal(st.expansion.fishing.counts.aji, 2);
  assert.equal(st.expansion.fishing.codex.aji.count, 2);
  assert.equal(st.expansion.fishing.codex.aji.maxSize, 25);
  fishing.recordCatch(st, { species: aji, size: 30 });
  assert.equal(st.expansion.fishing.codex.aji.maxSize, 30);

  // 捌く: 食料へ変換し、所持数を超える指定は所持数分だけ変換
  assert.equal(fishing.dressCatch(st, "aji", 2), 2);
  assert.equal(st.supplies.food, 12);
  assert.equal(st.expansion.fishing.counts.aji, 1);
  assert.equal(fishing.dressCatch(st, "aji", 9), 1);
  assert.equal(st.supplies.food, 13);
  assert.equal(st.expansion.fishing.counts.aji, undefined);

  // 売却: 所持を減らし売却額を返す（資金の加算は呼び出し側が行う）
  fishing.recordCatch(st, { species: aji, size: 22 });
  fishing.recordCatch(st, { species: aji, size: 22 });
  assert.equal(fishing.sellCatch(st, "aji", 2), 20);
  assert.equal(st.funds, 100);
  assert.equal(st.expansion.fishing.counts.aji, undefined);

  // 補完: 欠損・不正値は既定値へ、壊れたセッションは破棄
  const fresh = fishing.normalizeFishing();
  assert.deepEqual(fresh, { rodId: null, counts: {}, codex: {}, bait: { insect: 0, shell: 0, cut: 0, small: 0 }, pending: null });
  const dirty = fishing.normalizeFishing({
    rodId: "unknown",
    counts: { aji: 3, nope: 1, madai: -1 },
    codex: { aji: { count: 2, maxSize: 40, maxSizeAbs: 5, maxSizePos: { x: 1, y: 2 } }, nope: { count: 1 } },
    pending: { baitId: "unknown", castsLeft: 4 },
  });
  assert.equal(dirty.rodId, null);
  assert.deepEqual(dirty.counts, { aji: 3 });
  assert.ok(dirty.codex.nope === undefined);
  assert.equal(dirty.codex.aji.maxSizePos.x, 1);
  assert.deepEqual(dirty.bait, { insect: 0, shell: 0, cut: 0, small: 0 });
  assert.equal(dirty.pending, null);
  const kept = fishing.normalizeFishing({
    rodId: "rod_basic",
    pending: { baitId: "cut", dayApplied: true, castsLeft: 3, lastDay: 7, catch: { speciesId: "madai", windowSeconds: 4 }, lastResult: { speciesId: "madai" } },
  });
  assert.equal(kept.pending.baitId, "cut");
  assert.equal(kept.pending.castsLeft, 3);
  assert.equal(kept.pending.catch.speciesId, "madai");
  assert.equal(kept.pending.lastDay, 7);
  assert.equal(kept.pending.lastResult, null);

  // 待機中（アタリ待ち）のセッションは waitUntil / hookSpeciesId を引き継ぎ、catch を空にする
  const waiting = fishing.normalizeFishing({
    rodId: "rod_basic",
    pending: { baitId: "cut", dayApplied: true, castsLeft: 2, waitUntil: 5000, hookSpeciesId: "aji", catch: { speciesId: "aji", windowSeconds: 6 } },
  });
  assert.equal(waiting.pending.waitUntil, 5000);
  assert.equal(waiting.pending.hookSpeciesId, "aji");
  assert.equal(waiting.pending.catch, null);

  // waitUntil / hookSpeciesId のうち片方だけでは待機扱いにしない（catch を優先）
  const halfWait = fishing.normalizeFishing({
    rodId: "rod_basic",
    pending: { baitId: "cut", castsLeft: 2, waitUntil: 5000, catch: { speciesId: "aji", windowSeconds: 6 } },
  });
  assert.equal(halfWait.pending.waitUntil, null);
  assert.equal(halfWait.pending.hookSpeciesId, null);
  assert.equal(halfWait.pending.catch.speciesId, "aji");

  // 日付リセット: 同じ日は維持・日が変われば破棄・旧保存は当日分に移行
  assert.equal(fishing.sessionDayRule({ lastDay: 10 }, 10), "keep");
  assert.equal(fishing.sessionDayRule({ lastDay: 9 }, 10), "discard");
  assert.equal(fishing.sessionDayRule({ lastDay: null }, 10), "migrate");
  assert.equal(fishing.sessionDayRule(null, 10), "discard");

  // 図鑑フィルタ: 全グループ未選択なら絞り込みなし
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("hamadai"),
      { categories: new Set(), regions: new Set(), seasons: new Set() },
      { caught: false }
    ),
    true
  );

  // カテゴリ: グループ内OR・空なら全カテゴリ
  assert.equal(
    fishing.matchesCodexFilters(fishing.speciesById("aji"), { categories: new Set(["big", "common"]), regions: new Set(), seasons: new Set() }, {}),
    true
  );
  assert.equal(
    fishing.matchesCodexFilters(fishing.speciesById("madai"), { categories: new Set(["big", "giant"]), regions: new Set(), seasons: new Set() }, {}),
    true
  );
  assert.equal(
    fishing.matchesCodexFilters(fishing.speciesById("aji"), { categories: new Set(["big", "giant"]), regions: new Set(), seasons: new Set() }, {}),
    false
  );
  assert.equal(
    fishing.matchesCodexFilters(fishing.speciesById("aji"), { categories: new Set(), regions: new Set(), seasons: new Set() }, {}),
    true
  );

  // カテゴリ選択時は未発見魚を対象外（category は発見まで非公開）
  assert.equal(
    fishing.matchesCodexFilters(fishing.speciesById("aji"), { categories: new Set(["common"]), regions: new Set(), seasons: new Set() }, { caught: false }),
    false
  );

  // 海域: グループ内OR・未発見魚にも実データを適用（最初から公開情報）
  assert.equal(
    fishing.matchesCodexFilters(fishing.speciesById("hamadai"), { categories: new Set(), regions: new Set(["se"]), seasons: new Set() }, {}),
    true
  );
  assert.equal(
    fishing.matchesCodexFilters(fishing.speciesById("hamadai"), { categories: new Set(), regions: new Set(["ne"]), seasons: new Set() }, {}),
    false
  );
  assert.equal(
    fishing.matchesCodexFilters(fishing.speciesById("hokke"), { categories: new Set(), regions: new Set(["nw", "ne"]), seasons: new Set() }, {}),
    true
  );
  assert.equal(
    fishing.matchesCodexFilters(fishing.speciesById("hokke"), { categories: new Set(), regions: new Set(["se"]), seasons: new Set() }, { caught: false }),
    false
  );

  // 季節: 発見済みは常に適用・未発見は seasonsRevealed で公開状態を切替
  assert.equal(
    fishing.matchesCodexFilters(fishing.speciesById("madai"), { categories: new Set(), regions: new Set(), seasons: new Set([0]) }, {}),
    true
  );
  assert.equal(
    fishing.matchesCodexFilters(fishing.speciesById("madai"), { categories: new Set(), regions: new Set(), seasons: new Set([3]) }, {}),
    false
  );
  assert.equal(
    fishing.matchesCodexFilters(fishing.speciesById("madai"), { categories: new Set(), regions: new Set(), seasons: new Set([2, 3]) }, {}),
    true
  );
  // 未発見魚: 季節未公開（seasonsRevealed:false）なら季節指定中は対象外・公開後は実データで判定
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("madai"),
      { categories: new Set(), regions: new Set(), seasons: new Set([3]) },
      { caught: false, seasonsRevealed: false }
    ),
    false
  );
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("madai"),
      { categories: new Set(), regions: new Set(), seasons: new Set([3]) },
      { caught: false, seasonsRevealed: true }
    ),
    false
  );
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("madai"),
      { categories: new Set(), regions: new Set(), seasons: new Set([0]) },
      { caught: false, seasonsRevealed: true }
    ),
    true
  );

  // グループ間AND: カテゴリ・海域・季節のすべてを満たす必要がある
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("hamadai"),
      { categories: new Set(["big"]), regions: new Set(["se"]), seasons: new Set([0]) },
      {}
    ),
    true
  );
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("hamadai"),
      { categories: new Set(["big"]), regions: new Set(["se"]), seasons: new Set([3]) },
      {}
    ),
    false
  );
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("hokke"),
      { categories: new Set(["big"]), regions: new Set(["ne"]), seasons: new Set([0]) },
      {}
    ),
    false
  );
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("aji"),
      { categories: new Set(["common"]), regions: new Set(["ne"]), seasons: new Set([2]) },
      { caught: true }
    ),
    true
  );

  // 検索フィルタ: 発見済みの魚名のみ対象・未発見魚は名前を検索対象にしない（逆算防止）
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("aji"),
      { categories: new Set(), regions: new Set(), seasons: new Set() },
      { caught: true, search: "アジ" }
    ),
    true
  );
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("aji"),
      { categories: new Set(), regions: new Set(), seasons: new Set() },
      { caught: true, search: "サンマ" }
    ),
    false
  );
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("aji"),
      { categories: new Set(), regions: new Set(), seasons: new Set() },
      { caught: false, search: "アジ" }
    ),
    false
  );

  // 完成率: 発見済み数 / 総数で、既存の図鑑登録状態のみから算出
  const completion = fishing.codexCompletion({ aji: { count: 3 }, madai: { count: 1 }, hamadai: { count: 1 } });
  assert.equal(completion.caught, 3);
  assert.equal(completion.total, 286);
  assert.ok(Math.abs(completion.ratio - 3 / 286) < 1e-12);
  assert.equal(fishing.codexCompletion({}).caught, 0);
  assert.equal(fishing.codexCompletion({}).ratio, 0);

  // 段階公開: 海域は常時・季節25%以上・水深50%以上・有効餌75%以上（境界を含む）
  const state0 = fishing.codexRevealState(0);
  assert.deepEqual(state0, { regions: true, seasons: false, depth: false, baits: false });
  assert.equal(fishing.codexRevealState(0.24).seasons, false);
  assert.equal(fishing.codexRevealState(0.25).seasons, true);
  assert.equal(fishing.codexRevealState(0.25).depth, false);
  assert.equal(fishing.codexRevealState(0.49).depth, false);
  assert.equal(fishing.codexRevealState(0.5).depth, true);
  assert.equal(fishing.codexRevealState(0.5).baits, false);
  assert.equal(fishing.codexRevealState(0.74).baits, false);
  assert.equal(fishing.codexRevealState(0.75).baits, true);
  assert.deepEqual(fishing.codexRevealState(1), { regions: true, seasons: true, depth: true, baits: true });

  // 図鑑詳細の公開判定（回帰）: 発見済み魚は完成率に関係なく全項目を公開する
  assert.deepEqual(fishing.codexDetailReveal(false, 0), { regions: true, seasons: false, depth: false, baits: false });
  assert.deepEqual(fishing.codexDetailReveal(true, 0), { regions: true, seasons: true, depth: true, baits: true });
  assert.deepEqual(fishing.codexDetailReveal(true, 0.24), { regions: true, seasons: true, depth: true, baits: true });
  assert.deepEqual(fishing.codexDetailReveal(true, 0.49), { regions: true, seasons: true, depth: true, baits: true });
  assert.deepEqual(fishing.codexDetailReveal(true, 0.74), { regions: true, seasons: true, depth: true, baits: true });
  assert.deepEqual(fishing.codexDetailReveal(true, 1), { regions: true, seasons: true, depth: true, baits: true });
  // 未発見魚には段階公開を維持（季節25%・水深50%・有効餌75%、境界を含む）
  assert.deepEqual(fishing.codexDetailReveal(false, 0.25), { regions: true, seasons: true, depth: false, baits: false });
  assert.deepEqual(fishing.codexDetailReveal(false, 0.5), { regions: true, seasons: true, depth: true, baits: false });
  assert.deepEqual(fishing.codexDetailReveal(false, 0.75), { regions: true, seasons: true, depth: true, baits: true });
  assert.deepEqual(fishing.codexDetailReveal(false, 1), { regions: true, seasons: true, depth: true, baits: true });

  // 発見済み魚の季節フィルタ（回帰）: 完成率（seasonsRevealed）に関係なく実データで判定する
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("madai"),
      { categories: new Set(), regions: new Set(), seasons: new Set([0]) },
      { caught: true, seasonsRevealed: false }
    ),
    true
  );
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("madai"),
      { categories: new Set(), regions: new Set(), seasons: new Set([3]) },
      { caught: true, seasonsRevealed: true }
    ),
    false
  );

  // 未発見魚の季節フィルタ: 完成率25%以上（seasonsRevealed）で公開・未満は季節指定中は対象外
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("madai"),
      { categories: new Set(), regions: new Set(), seasons: new Set([3]) },
      { caught: false, seasonsRevealed: true }
    ),
    false
  );
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("madai"),
      { categories: new Set(), regions: new Set(), seasons: new Set([3]) },
      { caught: false, seasonsRevealed: false }
    ),
    false
  );

  // 統一方針の適用例: 「南東＋冬」指定時、完成率10%（季節未公開）は未発見魚を対象外、
  // 完成率30%（季節公開）は海域・季節の両方を実データで判定する（madai: 全海域・季節[0,1,2]）
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("madai"),
      { categories: new Set(), regions: new Set(["se"]), seasons: new Set([3]) },
      { caught: false, seasonsRevealed: false }
    ),
    false
  );
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("madai"),
      { categories: new Set(), regions: new Set(["se"]), seasons: new Set([3]) },
      { caught: false, seasonsRevealed: true }
    ),
    false
  );
  assert.equal(
    fishing.matchesCodexFilters(
      fishing.speciesById("madai"),
      { categories: new Set(), regions: new Set(["se"]), seasons: new Set([0]) },
      { caught: false, seasonsRevealed: true }
    ),
    true
  );

  // アタリ文言: カテゴリ別で魚名は公開しない（未知カテゴリは一般魚にフォールバック）
  assert.equal(fishing.atariMessage("common"), "アタリ！ 魚が掛かった！");
  assert.equal(fishing.atariMessage("big"), "アタリ！ 強い引きだ！");
  assert.equal(fishing.atariMessage("giant"), "アタリ！ とんでもない引きだ！");
  assert.equal(fishing.atariMessage("unknown"), "アタリ！ 魚が掛かった！");
  assert.equal(fishing.atariMessage(undefined), "アタリ！ 魚が掛かった！");

  // 演出トーン: カテゴリを正規化し未知は一般魚に寄せる
  assert.equal(fishing.categoryTone("common"), "common");
  assert.equal(fishing.categoryTone("big"), "big");
  assert.equal(fishing.categoryTone("giant"), "giant");
  assert.equal(fishing.categoryTone("mystery"), "common");
  assert.equal(fishing.categoryTone(undefined), "common");

  // 釣果イベント判定: 登録前のエントリと今回サイズから事前判定する（登録後の状態には依存しない）
  assert.deepEqual(fishing.catchRecordFacts(undefined, 30), { firstCatch: true, maxUpdate: true });
  assert.deepEqual(fishing.catchRecordFacts(null, 30), { firstCatch: true, maxUpdate: true });
  assert.deepEqual(fishing.catchRecordFacts({ count: 1, maxSize: 25 }, 30), { firstCatch: false, maxUpdate: true });
  assert.deepEqual(fishing.catchRecordFacts({ count: 2, maxSize: 40 }, 30), { firstCatch: false, maxUpdate: false });
  assert.deepEqual(fishing.catchRecordFacts({ count: 1, maxSize: 0 }, 30), { firstCatch: false, maxUpdate: true });

  // 統合: 初釣果判定と図鑑登録が同じ事象を指す（count 0→1）
  const integ = makeState();
  const facts0 = fishing.catchRecordFacts(integ.expansion.fishing.codex.aji, 22);
  fishing.recordCatch(integ, { species: fishing.speciesById("aji"), size: 22 });
  assert.deepEqual(facts0, { firstCatch: true, maxUpdate: true });
  assert.equal(integ.expansion.fishing.codex.aji.count, 1);
  assert.equal(integ.expansion.fishing.codex.aji.maxSize, 22);

  // BAIT_DEFS の価格・名称（config.namespace から取得）
  const BAIT_DEFS = config.namespace.BAIT_DEFS;
  const FISH_SPECIES = config.namespace.FISH_SPECIES;
  assert.deepEqual(BAIT_DEFS.insect, { name: "虫餌", price: 2 });
  assert.deepEqual(BAIT_DEFS.shell, { name: "甲殻類", price: 5 });
  assert.deepEqual(BAIT_DEFS.cut, { name: "魚肉団子", price: 7 });
  assert.deepEqual(BAIT_DEFS.small, { name: "小魚", price: 10 });

  // feedType 全種網羅チェック
  for (const s of FISH_SPECIES) {
    assert.ok(["shell", "cut", "small"].includes(s.feedType), `${s.id} feedType不正: ${s.feedType}`);
    assert.notEqual(s.feedType, "insect");
  }

  // 餌消費: consumeBait
  const stBait = makeState();
  stBait.expansion.fishing.bait = { insect: 3, shell: 0, cut: 0, small: 0 };
  assert.equal(fishing.consumeBait(stBait, "insect"), true);
  assert.equal(stBait.expansion.fishing.bait.insect, 2);
  assert.equal(fishing.consumeBait(stBait, "insect"), true);
  assert.equal(stBait.expansion.fishing.bait.insect, 1);
  assert.equal(fishing.consumeBait(stBait, "insect"), true);
  assert.equal(stBait.expansion.fishing.bait.insect, 0);
  assert.equal(fishing.consumeBait(stBait, "insect"), false);

  // 餌加工: processToBait (count × dressFood)
  const stProc = makeState();
  stProc.expansion.fishing.counts.aji = 3;  // dressFood:1, feedType:"small"
  stProc.expansion.fishing.bait = { insect:0, shell:0, cut:0, small:0 };
  const res = fishing.processToBait(stProc, "aji", 3);
  assert.deepEqual(res, { baitId: "small", amount: 3 });
  assert.equal(stProc.expansion.fishing.bait.small, 3);
  assert.equal(stProc.expansion.fishing.counts.aji || 0, 0);

  // 加工: feedType に対応した餌だけが増える
  const stProc2 = makeState();
  stProc2.expansion.fishing.counts.madai = 2; // dressFood:3, feedType:"cut"
  stProc2.expansion.fishing.bait = { insect:0, shell:0, cut:0, small:0 };
  const res2 = fishing.processToBait(stProc2, "madai", 2);
  assert.deepEqual(res2, { baitId: "cut", amount: 6 });
  assert.equal(stProc2.expansion.fishing.bait.cut, 6);
  assert.equal(stProc2.expansion.fishing.bait.small, 0);
  assert.equal(stProc2.expansion.fishing.counts.madai || 0, 0);

  // 加工: 所持数を超える指定は所持数分だけ
  const stProc3 = makeState();
  stProc3.expansion.fishing.counts.aji = 2;
  stProc3.expansion.fishing.bait = { insect:0, shell:0, cut:0, small:0 };
  const res3 = fishing.processToBait(stProc3, "aji", 5);
  assert.deepEqual(res3, { baitId: "small", amount: 2 });
  assert.equal(stProc3.expansion.fishing.counts.aji || 0, 0);

  // 購入: purchaseBait
  const stBuy = makeState();
  stBuy.funds = 100;
  stBuy.expansion.fishing.bait = { insect:0, shell:0, cut:0, small:0 };
  assert.deepEqual(fishing.purchaseBait(stBuy, "insect", 3), { cost: 6 });
  assert.equal(stBuy.funds, 94);
  assert.equal(stBuy.expansion.fishing.bait.insect, 3);

  // 購入: 所持金不足
  const stBuy2 = makeState();
  stBuy2.funds = 5;
  stBuy2.expansion.fishing.bait = { insect:0, shell:0, cut:0, small:0 };
  assert.equal(fishing.purchaseBait(stBuy2, "small", 1), false); // price 10

  // 購入: 存在しない餌ID
  const stBuy3 = makeState();
  stBuy3.funds = 100;
  stBuy3.expansion.fishing.bait = { insect:0, shell:0, cut:0, small:0 };
  assert.equal(fishing.purchaseBait(stBuy3, "invalid", 1), false);

  console.log("釣り: 海域・抽選・猶予・図鑑・捌き・売却・補完・フィルタ・ヒント公開・アタリ文言・演出トーン・釣果判定・餌システム: 全項目成功");

// 釣り竿アップグレードシステムのテスト
// ROD_DEFS と ROD_UPGRADE_THRESHOLDS の整合性
const ROD_DEFS = config.namespace.ROD_DEFS;
const ROD_UPGRADE_THRESHOLDS = config.namespace.ROD_UPGRADE_THRESHOLDS;
assert.equal(ROD_DEFS.rod_basic.windowMultiplier, 0.5);
assert.equal(ROD_DEFS.rod_sturdy.windowMultiplier, 0.625);
assert.equal(ROD_DEFS.rod_fine.windowMultiplier, 0.75);
assert.equal(ROD_DEFS.rod_master.windowMultiplier, 0.875);
assert.equal(ROD_DEFS.rod_ancient.windowMultiplier, 1.0);
assert.equal(ROD_UPGRADE_THRESHOLDS[0].requiredRatio, 0.0);
assert.equal(ROD_UPGRADE_THRESHOLDS[1].requiredRatio, 0.10);
assert.equal(ROD_UPGRADE_THRESHOLDS[2].requiredRatio, 0.30);
assert.equal(ROD_UPGRADE_THRESHOLDS[3].requiredRatio, 0.55);
assert.equal(ROD_UPGRADE_THRESHOLDS[4].requiredRatio, 0.80);

// windowFor: 倍率適用・下限維持
// aji: baseWindow=6
assert.equal(fishing.windowFor("aji", "rod_basic"), 3);    // 6 * 0.5 = 3
assert.equal(fishing.windowFor("aji", "rod_sturdy"), 3);   // 6 * 0.625 = 3.75 -> floor 3
assert.equal(fishing.windowFor("aji", "rod_fine"), 4);     // 6 * 0.75 = 4
assert.equal(fishing.windowFor("aji", "rod_master"), 5);   // 6 * 0.875 = 5.25 -> floor 5
assert.equal(fishing.windowFor("aji", "rod_ancient"), 6);  // 6 * 1.0 = 6
// madai: baseWindow=4 -> 粗末で 2 (下限)
assert.equal(fishing.windowFor("madai", "rod_basic"), 2);  // 4 * 0.5 = 2 (下限)
assert.equal(fishing.windowFor("madai", "rod_ancient"), 4); // 4 * 1.0 = 4
// baseWindow=3 の魚で粗末でも 2 秒保証
assert.equal(fishing.windowFor("unknown", "rod_basic"), 2);

// getCurrentRod: 閾値境界
const emptyCodex = {};
assert.equal(fishing.getCurrentRod(emptyCodex), "rod_basic");

// 10% ちょうど (29/286 ≈ 0.101)
const codex10 = makeCodexAtRatio(29/286);
assert.equal(fishing.getCurrentRod(codex10), "rod_sturdy");
// 30% ちょうど (86/286 ≈ 0.300)
const codex30 = makeCodexAtRatio(86/286);
assert.equal(fishing.getCurrentRod(codex30), "rod_fine");
// 55% ちょうど (158/286 ≈ 0.552)
const codex55 = makeCodexAtRatio(158/286);
assert.equal(fishing.getCurrentRod(codex55), "rod_master");
// 80% ちょうど (229/286 ≈ 0.800)
const codex80 = makeCodexAtRatio(229/286);
assert.equal(fishing.getCurrentRod(codex80), "rod_ancient");

// 境界未満
const codex09 = makeCodexAtRatio(0.09);
assert.equal(fishing.getCurrentRod(codex09), "rod_basic");
const codex29 = makeCodexAtRatio(0.29);
assert.equal(fishing.getCurrentRod(codex29), "rod_sturdy");

// checkRodUpgrade: スキップ・再発生防止
const stUpgrade = makeState();
// 完成率 58% (166/286) で粗末 -> 名人へジャンプ
stUpgrade.expansion.fishing.rodId = "rod_basic";
stUpgrade.expansion.fishing.codex = makeCodexAtRatio(166/286);
assert.equal(fishing.checkRodUpgrade(stUpgrade), "rod_master");

// 一度取得したら再発生しない
stUpgrade.expansion.fishing.rodId = "rod_master";
assert.equal(fishing.checkRodUpgrade(stUpgrade), null);

// 竿取得前は図鑑完成率だけで現在の竿は変わらない
const stBefore = makeState();
stBefore.expansion.fishing.rodId = "rod_basic";
stBefore.expansion.fishing.codex = makeCodexAtRatio(166/286);
assert.equal(fishing.getCurrentRod(stBefore.expansion.fishing.codex), "rod_master"); // 取得可能な最高位
assert.equal(stBefore.expansion.fishing.rodId, "rod_basic"); // 実際の竿は変わらない

// 既存ロジック不変確認: 抽選・餌消費等
const testState = makeState();
testState.expansion.fishing.bait = { insect: 1, shell: 0, cut: 0, small: 0 };
assert.equal(fishing.consumeBait(testState, "insect"), true);
assert.equal(testState.expansion.fishing.bait.insect, 0);

// ヘルパー: 指定完成率相当の codex を作る（FISH_SPECIES 総数 286 種想定）
function makeCodexAtRatio(ratio) {
  const codex = {};
  const total = 286;
  const caught = Math.round(total * ratio);
  const species = config.namespace.FISH_SPECIES;
  for (let i = 0; i < caught; i++) {
    codex[species[i].id] = { count: 1, maxSize: species[i].sizeRange[0] };
  }
  return codex;
}

console.log("釣り: 海域・抽選・猶予・図鑑・捌き・売却・補完・フィルタ・ヒント公開・アタリ文言・演出トーン・釣果判定・餌システム・竿アップグレード: 全項目成功");

// 竿なし状態のテスト
// 初期状態は竿なし
const fresh2 = fishing.normalizeFishing();
assert.equal(fresh2.rodId, null);

// 竿なしで windowFor は最低保証 2 秒
assert.equal(fishing.windowFor("aji", null), 2);
assert.equal(fishing.windowFor("madai", null), 2);
assert.equal(fishing.windowFor("unknown", null), 2);

// 竿ありなら倍率適用
assert.equal(fishing.windowFor("aji", "rod_basic"), 3);
assert.equal(fishing.windowFor("aji", "rod_sturdy"), 3);
assert.equal(fishing.windowFor("aji", "rod_fine"), 4);
assert.equal(fishing.windowFor("aji", "rod_master"), 5);
assert.equal(fishing.windowFor("aji", "rod_ancient"), 6);

// normalizeFishing で既存有効 rodId は維持
const kept2 = fishing.normalizeFishing({ rodId: "rod_basic", counts: {}, codex: {}, bait: {}, pending: null });
assert.equal(kept2.rodId, "rod_basic");

// 無効な rodId は null に
const fixed2 = fishing.normalizeFishing({ rodId: "invalid", counts: {}, codex: {}, bait: {}, pending: null });
assert.equal(fixed2.rodId, null);

// 既存 rodId なしの場合は null に
const noRod2 = fishing.normalizeFishing({ counts: {}, codex: {}, bait: {}, pending: null });
assert.equal(noRod2.rodId, null);

console.log("釣り: 海域・抽選・猶予・図鑑・捌き・売却・補完・フィルタ・ヒント公開・アタリ文言・演出トーン・釣果判定・餌システム・竿アップグレード・竿なし状態: 全項目成功");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});