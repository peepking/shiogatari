/**
 * 高レベル順に待機兵を取り出し、平均レベルと元の人数内訳を返す。
 * @param {object} standby 兵種別の待機兵。
 * @param {string} type 兵種。
 * @param {number} amount 人数。
 * @returns {object} 編成情報。
 */
export function takeBattlePersonnel(standby, type, amount) {
  const list = standby[type] || [];
  list.sort((a, b) => b.level - a.level);
  let remain = Math.max(0, Math.floor(amount)), count = 0, weighted = 0;
  const sources = {};
  while (remain > 0 && list.length) {
    const bucket = list[0], take = Math.min(bucket.count, remain);
    sources[bucket.level] = (sources[bucket.level] || 0) + take;
    count += take; weighted += take * bucket.level;
    bucket.count -= take; remain -= take;
    if (bucket.count <= 0) list.shift();
  }
  if (!list.length) delete standby[type];
  return { count, level: count ? Math.round(weighted / count * 10) / 10 : 1, sources };
}

/** 元レベルの内訳で待機へ戻す。平均レベルの兵を新たに作らない。
 * @param {object} standby 待機兵。 @param {string} type 兵種。 @param {object} sources 元内訳。
 */
export function returnBattlePersonnel(standby, type, sources) {
  const list = standby[type] ||= [];
  for (const [level, count] of Object.entries(sources)) {
    if (count <= 0) continue;
    const bucket = list.find(row => row.level === Number(level));
    if (bucket) bucket.count += count;
    else list.push({ level: Number(level), count });
  }
  list.sort((a, b) => b.level - a.level);
}

/** @param {object} unit 部隊。 @returns {boolean} 一度でも投入されたか。 */
export function wasBattleDeployed(unit) {
  return unit.status !== "reserve" && (unit.deployedAt != null || !unit.status);
}

/** 人数加重で候補を1件選ぶ。 @param {Array} rows 候補。 @param {Function} random 乱数。 @returns {object|undefined} 候補。 */
function pickPersonnel(rows, random) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (!total) return undefined;
  let roll = random() * total;
  return rows.find(row => (roll -= row.count) < 0) || rows[rows.length - 1];
}

/**
 * 戦後兵員をコピー上で精算する。損耗は撃破部隊の元レベル内で人数加重抽選し、
 * 損耗・救済後の全保有兵から人数加重で昇級候補を抽選する。待機兵・未投入予備隊も含め、後から得る捕虜は含めない。
 * 同じ兵の複数昇級を許可し、Lv5を上限とする。入力不足・二重割当は反映前に拒否する。
 * @param {object} troops 保有兵。
 * @param {Array} units 戦闘部隊。
 * @param {object} options 損耗率・救済率・勝利・昇級回数。
 * @param {Function} random 乱数源。
 * @returns {object} 更新後保有兵、損耗、昇級内訳。
 */
export function settleBattlePersonnel(troops, units, { lossProb, rescue = 0, won = false, upgrades = 0 }, random = Math.random) {
  const next = Object.fromEntries(Object.entries(troops).map(([type, levels]) => [type,
    typeof levels === "number" ? { 1: levels } : { ...levels }]));
  const allocated = {}, ids = new Set(), participants = [];
  for (const unit of units.filter(u => u.side === "ally")) {
    if (ids.has(unit.id)) throw new Error("戦闘部隊のIDが重複しています");
    ids.add(unit.id);
    const sources = { ...unit.sources };
    if (Object.values(sources).reduce((sum, n) => sum + n, 0) !== unit.count)
      throw new Error("出撃元の兵員内訳が一致しません");
    for (const [level, count] of Object.entries(sources)) {
      if (!Number.isInteger(Number(level)) || Number(level) < 1 || Number(level) > 5 || !Number.isInteger(count) || count < 0)
        throw new Error("出撃元のレベルまたは人数が不正です");
      const key = `${unit.type}|${level}`;
      allocated[key] = (allocated[key] || 0) + count;
      if (allocated[key] > (next[unit.type]?.[level] || 0)) throw new Error("同じ兵員が重複して割り当てられています");
    }
    if (wasBattleDeployed(unit)) participants.push({ unit, sources });
  }
  const losses = {}, promotions = [];
  for (const { unit, sources } of participants) {
    let lost = unit.hp <= 0 ? Math.round(unit.count * lossProb) : 0;
    if (won && rescue > 0) {
      let remaining = 0;
      for (let i = 0; i < lost; i++) if (random() >= rescue) remaining++;
      lost = remaining;
    }
    for (let i = 0; i < lost; i++) {
      const row = pickPersonnel(Object.entries(sources).filter(([, count]) => count > 0)
        .map(([level, count]) => ({ level, count })), random);
      sources[row.level]--; next[unit.type][row.level]--;
      losses[unit.type] = (losses[unit.type] || 0) + 1;
    }
  }
  let leveled = 0;
  for (let i = 0; i < upgrades; i++) {
    const rows = Object.entries(next).flatMap(([type, levels]) => Object.entries(levels)
      .filter(([level, count]) => Number(level) < 5 && count > 0)
      .map(([level, count]) => ({ type, level: Number(level), count })));
    const selected = pickPersonnel(rows, random);
    if (!selected) break;
    const { type, level } = selected;
    next[type][level]--;
    next[type][level + 1] = (next[type][level + 1] || 0) + 1;
    const promotion = promotions.find(p => p.type === type && p.from === level);
    if (promotion) promotion.count++;
    else promotions.push({ type, from: level, to: level + 1, count: 1 });
    leveled++;
  }
  for (const [type, levels] of Object.entries(next)) {
    for (const [level, count] of Object.entries(levels)) if (!count) delete levels[level];
    if (!Object.keys(levels).length) delete next[type];
  }
  return { troops: next, losses, promotions, leveled };
}
