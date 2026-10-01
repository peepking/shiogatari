/** 同時展開予定の多い側を基準にする初期調整表。予備隊は含めない。 */
export const BATTLE_SIZE_RULES = Object.freeze([
  { squads: 5, size: 8 }, { squads: 10, size: 10 }, { squads: 15, size: 12 }, { squads: 20, size: 15 },
]);

/** @param {number} squads 同時展開予定数。 @returns {number} 盤面の一辺。 */
export function selectBattleSize(squads) { return (BATTLE_SIZE_RULES.find(rule => squads <= rule.squads) || BATTLE_SIZE_RULES.at(-1)).size; }

/** @returns {number} 両端に確保する配置領域・甲板の奥行き。 */
export function deploymentDepth() { return 2; }

/** @param {number} size 盤面高。 @returns {number} 2列に収容できる各軍の盤上上限（最大20部隊）。 */
export function battleDeploymentLimit(size) { return Math.min(BATTLE_SIZE_RULES.at(-1).squads, deploymentDepth() * size); }

/** 表示倍率・スクロール・画面密度によらず、表示中の矩形からマス座標を得る。
 * @param {number} clientX 横位置。 @param {number} clientY 縦位置。 @param {object} rect 表示矩形。
 * @param {number} size 盤面。 @returns {{x:number,y:number}} マス座標。
 */
export function battleCellAt(clientX, clientY, rect, size) {
  return { x: Math.floor((clientX - rect.left) / rect.width * size), y: Math.floor((clientY - rect.top) / rect.height * size) };
}
