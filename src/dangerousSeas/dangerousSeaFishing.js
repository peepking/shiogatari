import { BAIT_DEFS, FISH_SPECIES } from "../fishing/fishingConfig.js";
import { rollCatchFromPool } from "../fishing/fishing.js";
import { DANGEROUS_SEA_EVENT_CONFIG } from "./dangerousSeaEventConfig.js";

/** 危険海域で優遇する魚種。大きさの分類や売価からは自動判定しない。 */
export const DANGEROUS_SEA_RARE_FISH_IDS = Object.freeze([
  "dunkleosteus", "leed-sichthys", "xiphactinus", "helicoprion", "megalodon",
  "coelacanth", "ryugu-no-tsukai", "mitsukurizame", "sakegashira", "tengaibata",
  "demenigisu", "houraieso", "daiouika", "daiouhouzukiika", "denkiei", "dangouo",
]);

/** 優遇枠の比率。残り55%は希少魚・未登録魚を含む通常枠にする。 */
export const DANGEROUS_SEA_FISHING_RATES = Object.freeze({ rare: 0.2, undiscovered: 0.25 });

/** 希少魚の内部IDを検索する集合。外部から書き換えない。 */
const rareFishIds = new Set(DANGEROUS_SEA_RARE_FISH_IDS);

/**
 * 危険海域の釣果を選ぶ。地域・季節・水深を無視し、正の餌重みがある種だけを候補にする。
 * 希少枠20%・未登録枠25%・通常枠55%を先に選び、各枠内では既存の餌重みで抽選する。
 * 空の優遇枠は通常枠へ戻す。未登録は所持在庫ではなく、キャスト時点の図鑑登録回数で判定する。
 * 回遊期間は指定種の餌重みだけ二倍にし、枠の比率・餌の相性・魚種定義を変更しない。
 * @param {{baitId:string,codex?:object,migrationFishIds?:string[]}} environment 選択餌・図鑑・期間内の回遊種。
 * @param {Function} [random=Math.random] 0以上1未満を返す乱数。
 * @returns {object|null} 魚種定義。候補がない場合はnull。
 */
export function rollDangerousSeaCatch({ baitId, codex = {}, migrationFishIds = [] }, random = Math.random) {
  if (!Object.hasOwn(BAIT_DEFS, baitId)) return null;
  const candidates = FISH_SPECIES.filter(species => (species.baits[baitId] || 0) > 0);
  if (!candidates.length) return null;
  const slot = random();
  let pool = candidates;
  if (slot < DANGEROUS_SEA_FISHING_RATES.rare) {
    pool = candidates.filter(species => rareFishIds.has(species.id));
  } else if (slot < DANGEROUS_SEA_FISHING_RATES.rare + DANGEROUS_SEA_FISHING_RATES.undiscovered) {
    pool = candidates.filter(species => !(codex?.[species.id]?.count > 0));
  }
  pool = pool.length ? pool : candidates;
  if (!migrationFishIds.length) return rollCatchFromPool(pool, baitId, random);
  const migrating = new Set(migrationFishIds);
  const weights = pool.map(species => species.baits[baitId] * (migrating.has(species.id) ? DANGEROUS_SEA_EVENT_CONFIG.migrationMultiplier : 1));
  let value = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < pool.length; index++) {
    value -= weights[index];
    if (value < 0) return pool[index];
  }
  return pool[pool.length - 1];
}
