import { NATIONAL_POWER_CONFIG as CONFIG, NATIONAL_POWER_FACTIONS } from "./nationalPowerConfig.js";

/** @param {string} factionId 勢力ID。 @returns {boolean} 国力を持つ国家か。 */
export function isNationalPowerFaction(factionId) {
  return NATIONAL_POWER_FACTIONS.includes(factionId);
}

/**
 * 既存暦の絶対日（年×120＋季節×30＋日）を算出する。世界モジュールへ依存しない。
 * @param {object} date ゲームの日付。 @returns {number} 現在の絶対日。不正値は0。
 */
export function nationalPowerDay(date) {
  const day = date?.year * 120 + date?.season * 30 + date?.day;
  return Number.isSafeInteger(day) && day >= 0 ? day : 0;
}

/** @param {number} points 国力の表示単位。 @returns {number} 四捨五入した内部整数。異常な増減は拒否する。 */
export function nationalPowerUnits(points) {
  const units = Math.round(points * CONFIG.precision);
  if (!Number.isFinite(points) || !Number.isSafeInteger(units)) throw new RangeError("国力は安全な範囲の数値を指定してください。");
  return units;
}

/**
 * 旧セーブの未設定値は初期値へ補完し、既存の0は保持する。不明国家は除外する。
 * 現在日を初期チェックポイントとし、過去の回復を遡及させない。
 * @param {object|null} value 保存値。 @param {number} currentAbs 現在の絶対日。
 * @returns {object} 独立した正規化済み保存データ。
 */
export function normalizeNationalPower(value, currentAbs = 0) {
  const today = Number.isSafeInteger(currentAbs) && currentAbs >= 0 ? currentAbs : 0;
  const max = nationalPowerUnits(CONFIG.max);
  const initial = nationalPowerUnits(CONFIG.initial);
  const values = Object.fromEntries(NATIONAL_POWER_FACTIONS.map(id => {
    const saved = value?.values?.[id];
    return [id, Number.isSafeInteger(saved) ? Math.max(0, Math.min(max, saved)) : initial];
  }));
  const last = value?.lastProcessedAbs;
  return { version: 1, values, lastProcessedAbs: Number.isSafeInteger(last) && last >= 0 && last <= today ? last : today };
}

/** @param {number} currentAbs 現在の絶対日。 @returns {object} 初期国力。開始日の回復は適用しない。 */
export function createNationalPower(currentAbs = 0) {
  return normalizeNationalPower(null, currentAbs);
}

/** @param {object} data 正規化済み国力。 @param {string} factionId 国家。 @returns {number|null} 表示単位の国力。対象外はnull。 */
export function getNationalPower(data, factionId) {
  return isNationalPowerFaction(factionId) ? data.values[factionId] / CONFIG.precision : null;
}

/**
 * 国力だけを増減し、上下限適用後の実増減を返す。敵と味方の変化は独立して呼び出す。
 * 日次実行や依頼完了との接続、保存は呼び出し側の責務とする。
 * @param {object} data 正規化済み国力。 @param {string} factionId 国家。 @param {number} delta 表示単位の増減。
 * @returns {number} 実際の増減。対象外は0。
 */
export function changeNationalPower(data, factionId, delta) {
  if (!isNationalPowerFaction(factionId)) return 0;
  const units = nationalPowerUnits(delta);
  const before = data.values[factionId];
  const after = Math.max(0, Math.min(nationalPowerUnits(CONFIG.max), before + units));
  data.values[factionId] = after;
  return (after - before) / CONFIG.precision;
}

/** @param {Array} settlements 所有拠点一覧。 @param {string} factionId 国家。 @returns {number} 上限適用前の季節回復量。状態は変更しない。 */
export function nationalPowerRecovery(settlements, factionId) {
  if (!isNationalPowerFaction(factionId)) return 0;
  return settlements.reduce((sum, s) => sum + (s.factionId === factionId && Object.hasOwn(CONFIG.recovery, s.kind) ? CONFIG.recovery[s.kind] : 0), 0);
}

/**
 * 整合性確認済みの前線件数から攻撃・防衛の消耗を加算する。日次処理自体は実行しない。
 * @param {number} attacks 攻撃件数。 @param {number} defenses 防衛件数。 @returns {number} 正値の消耗量。
 */
export function nationalPowerDailyCost(attacks, defenses) {
  if (![attacks, defenses].every(n => Number.isSafeInteger(n) && n >= 0)) throw new RangeError("前線件数が不正です。");
  return (attacks * nationalPowerUnits(CONFIG.dailyAttackCost) + defenses * nationalPowerUnits(CONFIG.dailyDefenseCost)) / CONFIG.precision;
}

/**
 * 第一国家を正方向として国力差を補正へ換算する。交戦判定・台帳への加算は呼び出し側で行う。
 * @param {object} data 国力。 @param {string} a 第一国家。 @param {string} b 第二国家。 @returns {number} 上限付き日次補正。
 */
export function nationalPowerWarBias(data, a, b) {
  if (!isNationalPowerFaction(a) || !isNationalPowerFaction(b) || a === b) return 0;
  const difference = getNationalPower(data, a) - getNationalPower(data, b);
  return Math.max(-1, Math.min(1, difference / CONFIG.warBias.referenceDifference)) * CONFIG.warBias.maxDaily;
}

/**
 * 任意の整数資金に対する提供予告を返す。内部単位未満は切り捨て、超過入力は拒否する。
 * 資金・国力を変更せず、資格と謁見状態の検証は操作層へ委ねる。
 * @param {object} data 国力。 @param {string} factionId 国家。 @param {number} funds 所持資金。
 * @param {number} amount 提供額。 @returns {object} 可否・最大額・表示単位の前後値。
 */
export function quoteNationalPowerDonation(data, factionId, funds, amount) {
  if (!isNationalPowerFaction(factionId)) return { error: "対象国家ではありません。" };
  const before = getNationalPower(data, factionId);
  const room = nationalPowerUnits(CONFIG.max) - data.values[factionId];
  const maxAmount = Math.min(Number.isSafeInteger(funds) && funds >= 0 ? funds : 0, Math.floor(room * CONFIG.donationFundsPerPoint / CONFIG.precision));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > maxAmount) return { error: "提供可能な範囲の正の整数資金を指定してください。", maxAmount };
  const units = Math.floor(amount * CONFIG.precision / CONFIG.donationFundsPerPoint);
  if (!Number.isSafeInteger(units) || units <= 0) return { error: "国力が増加する金額を指定してください。", maxAmount };
  return { maxAmount, amount, before, after: (data.values[factionId] + units) / CONFIG.precision, delta: units / CONFIG.precision };
}
