/**
 * 中央を軸に指定幅へ行位置を均等配分し、中央に近い順で返す。同距離なら上側を先にする。
 * @param {number} count 部隊数。
 * @param {number} width 展開幅。
 * @param {number} size 盤面の高さ。
 * @returns {number[]} 行位置。
 */
function formationRows(count, width, size) {
  if (!count) return [];
  const start = Math.floor((size - width) / 2);
  if (count === 1) return [Math.floor((size - 1) / 2)];
  const center = (size - 1) / 2;
  return Array.from({ length: count }, (_, index) => start + Math.round(index * (width - 1) / (count - 1)))
    .sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b);
}

/**
 * 役割で前後を分け、近接を前列、射撃・支援を後列へ配置する。役割未指定の旧データだけ射程で補完し、
 * 片列の定員超過分だけ反対列へ回す。短射程を前列に優先し、同射程は元の編成順を保つ。
 * 前後の振り分け後は各列を元の編成順に戻し、優先順位の高い部隊から中央へ配置する。
 * バランスは人数の多い列の幅に揃え、突撃は両列を中央へ密集させる。
 * 防御は前列を後列より2マス広げることを目指すが、前列の空き間隔は最大1マスに抑える。
 * @param {object[]} units 味方部隊。
 * @param {string} kind 配置種別。
 * @param {number} size 盤面サイズ。
 * @returns {{unit:object,x:number,y:number}[]} 部隊ごとの配置。
 */
export function planBattleFormation(units, kind, size) {
  const isFront = unit => unit.role ? unit.role === "melee" : (unit.range ?? 1) <= 2;
  const sorted = units.map((unit, index) => ({ unit, index }))
    .sort((a, b) => Number(isFront(b.unit)) - Number(isFront(a.unit)) || (a.unit.range ?? 1) - (b.unit.range ?? 1) || a.index - b.index);
  // 小さい盤面で準備開始後に増員しても、3列目を使って重複なく配置する。
  if (units.length > size * 2) {
    const rows = formationRows(size, size, size);
    return sorted.slice(0, size).map(({ unit }, row) => ({ unit, x: 2, y: rows[row] }))
      .concat(planBattleFormation(sorted.slice(size).map(item => item.unit), kind, size));
  }
  const preferred = sorted.filter(({ unit }) => isFront(unit)).length;
  const frontCount = Math.max(sorted.length - size, Math.min(size, preferred));
  const front = sorted.slice(0, frontCount);
  const back = sorted.slice(frontCount);
  const commonWidth = Math.max(front.length, back.length);
  const frontWidth = kind === "balance" ? commonWidth : kind === "defense"
    ? Math.min(size, Math.max(1, front.length * 2 - 1), Math.max(front.length, back.length + 2))
    : front.length;
  const backWidth = kind === "balance" ? commonWidth : back.length;
  return [front, back].flatMap((column, index) => {
    const rows = formationRows(column.length, index === 0 ? frontWidth : backWidth, size);
    return column.sort((a, b) => a.index - b.index)
      .map(({ unit }, row) => ({ unit, x: index === 0 ? 1 : 0, y: rows[row] }));
  });
}
