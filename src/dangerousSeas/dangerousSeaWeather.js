/** 斥候の実効人数による察知・回避効果。人数は既存の艤装集計から受け取る。 */
export const DANGEROUS_SCOUT_RULES = [
  { min: 10, lead: 10, waveAvoidance: 0.4, raidReduction: 0.3, detection: 0.7, evasion: 0.7 },
  { min: 5, lead: 8, waveAvoidance: 0.3, raidReduction: 0.2, detection: 0.5, evasion: 0.55 },
  { min: 1, lead: 5, waveAvoidance: 0.15, raidReduction: 0.1, detection: 0.25, evasion: 0.35 },
  { min: 0, lead: 3, waveAvoidance: 0, raidReduction: 0, detection: 0, evasion: 0 },
];

/** @param {number} scouts 実効人数。 @returns {object} 上限10人の段階効果。 */
export function dangerousScoutRules(scouts = 0) {
  return DANGEROUS_SCOUT_RULES.find(row => Math.min(10, Math.max(0, scouts)) >= row.min);
}

/**
 * 次の荒波は前回日から12～18日の整数日を均等抽選する。回避用乱数も一度だけ固定する。
 * @param {number} previous 前回日または初期化日。 @param {Function} random 乱数源。
 * @returns {object} 海域外でも進行する天候予定。
 */
function nextWeather(previous, random) {
  return { day: previous + 12 + Math.min(6, Math.floor(random() * 7)), safeRoll: random(), known: false, avoided: false };
}

/**
 * 絶対日の周期を進める。予報は斥候を減らしても消さず、安全航路は同じ固定乱数で改善だけ許す。
 * 海域外・未解決戦闘中も日程を進め、帰還や編成変更で日程・回避を再抽選しない。
 * @param {object} data 危険海域状態。 @param {number} today 通算日。
 * @param {number} scouts 実効斥候人数。 @param {Function} [random=Math.random] 乱数源。
 * @param {boolean} [advance=true] 日次で周期を進めるか。表示同期は予定を消費しない。
 * @returns {Array} この日が荒波だった海域。過去日の分は再発させない。
 */
export function updateDangerousWeather(data, today, scouts = 0, random = Math.random, advance = true) {
  const due = [], rules = dangerousScoutRules(scouts);
  for (const [regionId, region] of Object.entries(data.regions)) {
    if (!region.weather) {
      region.weather = region.forecast ? { day: region.forecast.day, safeRoll: random(), known: true, avoided: false }
        : nextWeather(today, random);
    }
    while (advance && region.weather.day <= today) {
      const current = region.weather;
      current.avoided ||= current.safeRoll < rules.waveAvoidance;
      if (current.day === today) due.push({ regionId, avoided: current.avoided });
      region.lastWaveAbs = current.day;
      region.weather = nextWeather(current.day, random);
      region.forecast = null;
    }
    const weather = region.weather;
    if (weather.day - today <= rules.lead) weather.known = true;
    if (weather.known) {
      weather.avoided ||= weather.safeRoll < rules.waveAvoidance;
      region.forecast = { day: weather.day, avoided: weather.avoided };
    }
  }
  return due;
}

/**
 * 保存天候の識別子・固定乱数を検証する。未対応の旧予報は初回更新で引き継ぐ。
 * @param {*} raw 保存値。 @returns {object|null} 復元予定。
 */
export function normalizeDangerousWeather(raw) {
  if (!Number.isSafeInteger(raw?.day) || !Number.isFinite(raw?.safeRoll) || raw.safeRoll < 0 || raw.safeRoll >= 1) return null;
  return { day: raw.day, safeRoll: raw.safeRoll, known: raw.known === true, avoided: raw.avoided === true };
}
