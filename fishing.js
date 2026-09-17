import { FISH_SPECIES, BAIT_DEFS, ROD_DEFS, FISHING_CONFIG } from "./fishingConfig.js";

/**
 * game時間から絶対日を算出する。questUtils.absDayと同じ式なので、独立して維持する。
 * @param {object} state ゲーム状態。
 * @returns {number} 現在の絶対日。
 */
const absDay = (state) => state.year * 120 + state.season * 30 + state.day;

/** 種IDから定義を引くためのインデックス。 */
const SPECIES_INDEX = Object.create(null);
for (const s of FISH_SPECIES) SPECIES_INDEX[s.id] = s;

/**
 * 配列以外のデータオブジェクトか判定する。
 * @param {*} value 対象。
 * @returns {boolean} データオブジェクトか。
 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 座標が位置情報として使えるか判定する。
 * @param {*} value 対象。
 * @returns {boolean} 有効な位置情報か。
 */
function isPosition(value) {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

/**
 * 釣りの空の保存領域を生成する。
 * @returns {object} 共有参照を持たない初期状態。
 */
export function createFishingState() {
  return { rodId: "rod_basic", counts: {}, codex: {}, pending: null };
}

/**
 * 釣果IDから種定義を返す。
 * @param {string} id 種ID。
 * @returns {object|null} 種定義。
 */
export function speciesById(id) {
  return SPECIES_INDEX[id] || null;
}

/**
 * 座標から4海域のどれに属するかを判定する。
 * マップを東西・南北で2等分し、北西・北東・南西・南東に分割する。
 * @param {number} x マップX座標。
 * @param {number} y マップY座標。
 * @returns {string} 海域ID。
 */
export function fishingRegionAt(x, y) {
  const half = FISHING_CONFIG.seaQuadrantSize;
  if (y < half) return x < half ? "nw" : "ne";
  return x < half ? "sw" : "se";
}

/**
 * 図鑑のフィルタ条件に種が合致するかを判定する。
 * 各グループ（分類・海域・季節）は未選択（空のSet）なら絞り込みなし、グループ内はOR・グループ間はANDで判定する。
 * 未発見魚の開示仕様（段階公開）に合わせて、フィールドごとに公開条件を分けて適用する。
 * 統一方針: フィールドが未公開のままそのフィールドのフィルタが指定されている間は、未発見魚は対象外。
 * 公開された後は実データを使って通常どおり判定する。発見済みには全フィルタを通常適用する。
 * - 分類（category）: 発見するまで非公開のため、分類グループが選択中なら未発見魚は対象外。
 * - 海域（regions）: 最初から公開情報のため、未発見魚にも実データを適用する。
 * - 季節（seasons）: 発見済みなら常に適用。未発見魚は seasonsRevealed（図鑑完成率25%以上）で公開され、
 *   公開前は季節グループ選択中であれば対象外、公開後は実データを適用する。
 * - 検索（search）: 未発見魚の名前は非公開のため、検索キーワードがある場合は未発見魚を対象外にする。
 *   （内部の name 一致で ??? が検索結果に現れるのを防ぐ）
 * - 水深・有効餌: 図鑑フィルタ化の際は、公開閾値（水深50%・有効餌75%）前は指定中に未発見魚を対象外とし、
 *   公開後に実データを適用する同パターンとする。
 * @param {object} s 種定義。
 * @param {{categories:Set<string>,regions:Set<string>,seasons:Set<number>}} sel 選択中のフィルタ条件。
 * @param {{caught?:boolean,seasonsRevealed?:boolean,search?:string}} [opts] 判定オプション。
 * @param {boolean} [opts.caught=true] 図鑑登録済みか。
 * @param {boolean} [opts.seasonsRevealed=false] 未発見魚の季節を公開済みとするか。
 * @param {string} [opts.search=""] 魚名検索キーワード（発見済みの魚名のみ対象）。
 * @returns {boolean} 条件に合致するか。
 */
export function matchesCodexFilters(s, sel, opts = {}) {
  const caught = opts.caught !== false;
  const seasonsRevealed = !!opts.seasonsRevealed;
  const search = opts.search || "";
  if (sel.categories.size > 0 && (!caught || !sel.categories.has(s.category))) return false;
  if (sel.regions.size > 0 && !s.regions.some((r) => sel.regions.has(r))) return false;
  if (sel.seasons.size > 0 && (!(caught || seasonsRevealed) || !s.seasons.some((x) => sel.seasons.has(x)))) return false;
  if (search && (!caught || !s.name.includes(search))) return false;
  return true;
}

/**
 * 図鑑の完成率を算出する。発見済み魚種数 / FISH_SPECIES 総数。
 * ヒント解放（季節25%・水深50%・有効餌75%）の判定に用いる。セーブデータへの新たな進行度は持たせず、
 * 既存の図鑑登録状態のみから計算する。
 * @param {Object} codex 図鑑登録状態（種ID→{count:number}）。
 * @returns {{caught:number,total:number,ratio:number}} 発見数・総数・完成率（0〜1）。
 */
export function codexCompletion(codex) {
  const total = FISH_SPECIES.length;
  const caught = FISH_SPECIES.filter((s) => (codex?.[s.id]?.count || 0) > 0).length;
  return { caught, total, ratio: caught / total };
}

/**
 * 図鑑完成率ごとの未発見魚のヒント公開状態を返す。
 * 海域は最初から公開、季節は25%以上、水深は50%以上、有効な餌は75%以上で公開する（境界を含む）。
 * @param {number} ratio 図鑑完成率（0〜1）。
 * @returns {{regions:boolean,seasons:boolean,depth:boolean,baits:boolean}} 公開対象ごとの公開可否。
 */
export function codexRevealState(ratio) {
  return {
    regions: true,
    seasons: ratio >= 0.25,
    depth: ratio >= 0.5,
    baits: ratio >= 0.75,
  };
}

/**
 * 図鑑詳細の生態情報の公開状態を返す。
 * 発見済み魚は完成率に関係なく全項目を公開し、段階公開（季節25%・水深50%・有効餌75%）は
 * 未発見魚のみに適用する（項目ごとに「発見済み || 段階公開」で合成する）。
 * @param {boolean} discovered 発見済みか（図鑑登録済み）。
 * @param {number} ratio 図鑑完成率（0〜1）。
 * @returns {{regions:boolean,seasons:boolean,depth:boolean,baits:boolean}} 公開対象ごとの公開可否。
 */
export function codexDetailReveal(discovered, ratio) {
  const reveal = codexRevealState(ratio);
  return {
    regions: reveal.regions,
    seasons: discovered || reveal.seasons,
    depth: discovered || reveal.depth,
    baits: discovered || reveal.baits,
  };
}

/**
 * 候補プールから餌の重みで釣果を抽選する。
 * 指定餌が未定義・候補内の重みがすべて0・プールが空の場合は null を返す。
 * 乱数が1未満である限り必ずいずれかの種が返る。
 * @param {Array<{baits:Object}>} pool 候補の種定義配列。
 * @param {string} baitId 餌ID。
 * @param {Function} random 0〜1未満を返す乱数。
 * @returns {object|null} 種定義。
 */
export function rollCatchFromPool(pool, baitId, random) {
  if (!(baitId in BAIT_DEFS)) return null;
  const candidates = pool.filter((s) => (s.baits[baitId] || 0) > 0);
  if (!candidates.length) return null;
  const total = candidates.reduce((sum, s) => sum + s.baits[baitId], 0);
  let r = random() * total;
  for (const s of candidates) {
    r -= s.baits[baitId];
    if (r < 0) return s;
  }
  return candidates[candidates.length - 1];
}

/**
 * 海域・季節・水深・餌の条件から釣果を重み付き抽選で選ぶ。
 * 条件に合わない種は候補から外れ、候補が空なら null を返す。
 * @param {{regionId:string,season:number,depth:string,baitId:string}} env 釣り環境。
 * @param {Function} random 0〜1未満を返す乱数。
 * @returns {object|null} 種定義。
 */
export function rollCatch({ regionId, season, depth, baitId }, random) {
  const pool = FISH_SPECIES.filter(
    (s) =>
      s.regions.includes(regionId) &&
      s.seasons.includes(season) &&
      s.depth.includes(depth)
  );
  return rollCatchFromPool(pool, baitId, random);
}

/**
 * アタリ発生後の入力猶予（実時間・秒）を返す。
 * 竿の windowBonus は猶予を延長する。最低2秒を保証する。
 * @param {string} speciesId 種ID。
 * @param {string} rodId 竿ID。
 * @returns {number} 猶予秒数。
 */
export function windowFor(speciesId, rodId) {
  const species = SPECIES_INDEX[speciesId];
  const rod = ROD_DEFS[rodId];
  const base = species?.baseWindow ?? 3;
  return Math.max(2, base + (rod?.windowBonus ?? 0));
}

/**
 * 種ごとのサイズ範囲から体長を抽選する。
 * @param {string} speciesId 種ID。
 * @param {Function} random 0〜1未満を返す乱数。
 * @returns {number} 体長(cm)。
 */
export function rollSize(speciesId, random) {
  const s = SPECIES_INDEX[speciesId];
  if (!s) return 0;
  const [min, max] = s.sizeRange;
  if (max <= min) return min;
  return min + Math.floor(random() * (max - min + 1));
}

/**
 * 猶予時間内に引けたかを判定する。
 * @param {number} windowSeconds 猶予秒数。
 * @param {number} elapsedMs 経過ミリ秒。
 * @returns {boolean} 時間内なら true。
 */
export function isPullWithinWindow(windowSeconds, elapsedMs) {
  return elapsedMs <= windowSeconds * 1000;
}

/**
 * 釣果を在庫へ加算し、図鑑を登録・更新する。
 * 最大サイズを更新した場合は場所と日付も記録する。
 * @param {object} state ゲーム状態。
 * @param {{species:object,size:number}} catch 釣果。
 * @returns {void}
 */
export function recordCatch(state, { species, size }) {
  const data = state.expansion.fishing;
  data.counts[species.id] = (data.counts[species.id] || 0) + 1;
  const entry = data.codex[species.id] || (data.codex[species.id] = { count: 0, maxSize: 0, maxSizeAbs: null, maxSizePos: null });
  entry.count = (entry.count || 0) + 1;
  if (size > (entry.maxSize || 0)) {
    entry.maxSize = size;
    entry.maxSizeAbs = absDay(state);
    entry.maxSizePos = { x: state.position.x, y: state.position.y };
  }
}

/**
 * 図鑑を全開放する。未登録の魚種のみ「発見済み」として登録し、
 * 既存のエントリ（釣獲回数・最大サイズ等）は上書きしない。
 * @param {object} state ゲーム状態。
 * @returns {void}
 */
export function unlockAllCodex(state) {
  const data = state.expansion.fishing;
  for (const s of FISH_SPECIES) {
    if (data.codex[s.id]?.count > 0) continue;
    data.codex[s.id] = { count: 1, maxSize: 0, maxSizeAbs: null, maxSizePos: null };
  }
}

/**
 * 釣果を食料へ変換する。所持数を超える指定は所持数の分だけ変換する。
 * @param {object} state ゲーム状態。
 * @param {string} speciesId 種ID。
 * @param {number} qty 変換数。
 * @returns {number} 増加した食料。
 */
export function dressCatch(state, speciesId, qty = 1) {
  const data = state.expansion.fishing;
  const n = Math.min(data.counts[speciesId] || 0, Math.max(1, Math.trunc(qty || 1)));
  if (!n) return 0;
  data.counts[speciesId] -= n;
  if (data.counts[speciesId] <= 0) delete data.counts[speciesId];
  const food = n * (SPECIES_INDEX[speciesId]?.dressFood || 1);
  state.supplies.food = (state.supplies.food || 0) + food;
  return food;
}

/**
 * 釣果を売却し、売却額を返す。資金の加算は呼び出し側（取引確定処理）が行う。
 * @param {object} state ゲーム状態。
 * @param {string} speciesId 種ID。
 * @param {number} qty 売却数。
 * @returns {number} 売却額。
 */
export function sellCatch(state, speciesId, qty = 1) {
  const data = state.expansion.fishing;
  const s = SPECIES_INDEX[speciesId];
  if (!s) return 0;
  const n = Math.min(data.counts[speciesId] || 0, Math.max(1, Math.trunc(qty || 1)));
  if (!n) return 0;
  data.counts[speciesId] -= n;
  if (data.counts[speciesId] <= 0) delete data.counts[speciesId];
  return n * s.sellPrice;
}

/**
 * 未完のセッション情報を検証する。釣果がアタリ中の場合は引き継がない。
 * @param {*} value 保存値。
 * @returns {object|null} 有効なセッション情報。
 */
function validPending(value) {
  if (!isRecord(value)) return null;
  if (!BAIT_DEFS[value.baitId]) return null;
  const castsLeft = Number.isSafeInteger(value.castsLeft) && value.castsLeft > 0 ? value.castsLeft : 0;
  if (castsLeft <= 0) return null;
  const catchInfo =
    isRecord(value.catch) &&
    SPECIES_INDEX[value.catch.speciesId] &&
    Number.isFinite(value.catch.windowSeconds) &&
    value.catch.windowSeconds >= 1
      ? { speciesId: value.catch.speciesId, windowSeconds: value.catch.windowSeconds }
      : null;
  const waitUntil = Number.isFinite(value.waitUntil) && value.waitUntil > 0 ? value.waitUntil : null;
  const hookSpeciesId = SPECIES_INDEX[value.hookSpeciesId] ? value.hookSpeciesId : null;
  const waiting = waitUntil != null && hookSpeciesId != null;
  return {
    baitId: value.baitId,
    dayApplied: value.dayApplied === true,
    castsLeft,
    catch: waiting ? null : catchInfo,
    waitUntil: waiting ? waitUntil : null,
    hookSpeciesId: waiting ? hookSpeciesId : null,
    lastResult: null,
    lastDay: Number.isSafeInteger(value.lastDay) ? value.lastDay : null,
  };
}

/**
 * セッションの日付が今日と同じなら維持、旧保存で日付不明なら当日分として登録、日が変わっていれば破棄する。
 * @param {object} pending セッション情報。
 * @param {number} today 現在の絶対日。
 * @returns {"keep"|"migrate"|"discard"} 扱い。
 */
export function sessionDayRule(pending, today) {
  if (!isRecord(pending)) return "discard";
  if (pending.lastDay == null) return "migrate";
  return pending.lastDay === today ? "keep" : "discard";
}

/**
 * 旧セーブへ釣り領域を補完する。未知の種・不正な数量は除外し、壊れたセッションは破棄する。
 * @param {*} value 保存値。
 * @returns {object} 補完済みの釣り領域。
 */
export function normalizeFishing(value) {
  const source = isRecord(value) ? value : {};
  const counts = {};
  if (isRecord(source.counts)) {
    for (const [id, qty] of Object.entries(source.counts)) {
      if (SPECIES_INDEX[id] && Number.isSafeInteger(qty) && qty > 0) counts[id] = qty;
    }
  }
  const codex = {};
  if (isRecord(source.codex)) {
    for (const [id, entry] of Object.entries(source.codex)) {
      if (!SPECIES_INDEX[id] || !isRecord(entry)) continue;
      codex[id] = {
        count: Number.isSafeInteger(entry.count) && entry.count > 0 ? entry.count : 0,
        maxSize: Number.isSafeInteger(entry.maxSize) && entry.maxSize > 0 ? entry.maxSize : 0,
        maxSizeAbs: Number.isSafeInteger(entry.maxSizeAbs) ? entry.maxSizeAbs : null,
        maxSizePos: isPosition(entry.maxSizePos) ? { x: entry.maxSizePos.x, y: entry.maxSizePos.y } : null,
      };
    }
  }
  return {
    rodId: ROD_DEFS[source.rodId] ? source.rodId : "rod_basic",
    counts,
    codex,
    pending: validPending(source.pending),
  };
}

