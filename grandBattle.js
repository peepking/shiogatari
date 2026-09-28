import { REINFORCEMENT_RULES } from "./battleReinforcements.js";

/** 前衛と同じ兵種・レベル候補から均等抽選し、半数の人数を最大10部隊にまとめる。
 * @param {Array} front 前衛。 @param {Function} random 乱数。 @returns {Array} 固定予備隊。
 */
export function buildGrandReserve(front, random = Math.random) {
  let remaining = Math.min(REINFORCEMENT_RULES.reserveLimit * 10,
    Math.floor(front.reduce((sum, entry) => sum + entry.count, 0) * REINFORCEMENT_RULES.enemyRatio));
  const reserve = [];
  while (remaining > 0 && front.length) {
    const source = front[Math.floor(random() * front.length)];
    const count = Math.min(10, remaining);
    reserve.push({ type: source.type, level: source.level, count }); remaining -= count;
  }
  return reserve;
}

/** 保存編成を元レベルで待機兵から差し引く。人数不足・上限違反なら入力を変更せず復元を拒否する。
 * @param {object} standby 待機兵。 @param {object} saved 保存編成。 @returns {object|null} 復元した編成。
 */
export function restoreGrandRoster(standby, saved) {
  if (!Array.isArray(saved?.sortie) || !Array.isArray(saved?.reserve)
    || saved.sortie.length > REINFORCEMENT_RULES.onBoardLimit || saved.reserve.length > REINFORCEMENT_RULES.reserveLimit) return null;
  const next = JSON.parse(JSON.stringify(standby));
  for (const entry of [...saved.sortie, ...saved.reserve]) {
    if (!Number.isInteger(entry.count) || entry.count < 1 || entry.count > 10 || !entry.sources
      || Object.values(entry.sources).reduce((sum, n) => sum + n, 0) !== entry.count) return null;
    for (const [level, count] of Object.entries(entry.sources)) {
      const row = next[entry.type]?.find(bucket => bucket.level === Number(level));
      if (!row || !Number.isInteger(Number(level)) || Number(level) < 1 || Number(level) > 5 || !Number.isInteger(count) || count < 0 || row.count < count) return null;
      row.count -= count;
    }
  }
  const restored = { standby: next, sortie: JSON.parse(JSON.stringify(saved.sortie)), reserve: JSON.parse(JSON.stringify(saved.reserve)) };
  for (const entry of [...restored.sortie, ...restored.reserve])
    entry.level = Math.round(Object.entries(entry.sources).reduce((sum, [level, count]) => sum + Number(level) * count, 0) / entry.count * 10) / 10;
  return restored;
}
