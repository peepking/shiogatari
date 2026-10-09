import { drawMapTile } from "../world/mapArt.js";

const terrainCells = new Map();
const mapGrids = new WeakMap();

/**
 * 戦闘用の地形IDを、周辺地形も参照できる描画専用のマスへ変換する。
 * マスは地形ごとに共有し、配列は戦場ごとに再利用して再描画時の生成を抑える。
 * 甲板の再配置など同じ配列内の変更も反映するが、戦闘判定用の配列は変更しない。
 * @param {string[][]} grid 戦闘判定用の地形ID配列。
 * @param {number} size 戦場の一辺のマス数。
 * @returns {object[][]} マップ描画用のマス配列。
 */
function battleMapGrid(grid, size) {
  let mapped = mapGrids.get(grid);
  if (!mapped) { mapped = []; mapGrids.set(grid, mapped); }
  mapped.length = size;
  for (let y = 0; y < size; y++) {
    const row = mapped[y] || (mapped[y] = []);
    row.length = size;
    for (let x = 0; x < size; x++) {
      const terrain = grid[y]?.[x];
      if (!terrainCells.has(terrain)) terrainCells.set(terrain, Object.freeze({ terrain, building: "none" }));
      row[x] = terrainCells.get(terrain);
    }
  }
  return mapped;
}

/**
 * 戦場の水面を通常マップと同じ周辺地形の合成で描き、海と浅瀬の境界をつなぐ。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @param {string[][]} terrainGrid 戦闘判定用の地形ID配列。
 * @param {number} cellSize 一マスの描画幅。
 * @param {Function} onReady 素材の読み込み完了後の再描画。
 * @param {number} [size] 戦場の一辺のマス数。
 * @returns {void}
 */
export function drawBattleTerrain(ctx, terrainGrid, cellSize, onReady, size = terrainGrid.length) {
  const grid = battleMapGrid(terrainGrid, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    drawMapTile(ctx, grid[y][x], x * cellSize, y * cellSize, cellSize, true, null, (x + y) % 2, { gx: x, gy: y, grid, onReady });
  }
}
