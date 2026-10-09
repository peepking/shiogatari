import { drawTerrainTexture } from "./mapAssets.js";

const waterMasks = new Map();
const waterLayers = new Map();

/** @param {object} cell マス。 @returns {number|null} 海は0、浅瀬は1、陸は集計対象外。 */
function waterDepth(cell) {
  return cell?.terrain === "shoal" ? 1 : cell?.terrain === "sea" ? 0 : null;
}

/** @param {Array<object>} cells 周辺マス。 @param {number} fallback 水面がない場合の値。 @returns {number} 水面だけの平均水深色。 */
function meanDepth(cells, fallback = 0) {
  const values = cells.map(waterDepth).filter(value => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

/**
 * 辺の中央は両側、角は交わる四マスの水面だけを平均する。
 * 陸の下の水面にも同じ規則を使い、小島の切り抜きと隣の海を同じ色で接続する。
 * @param {string} terrain 中央の地形。
 * @param {object} neighbors 八方向の周辺マス。
 * @returns {number[]} 左上から行順の九つの浅瀬濃度。
 */
export function waterDepthField(terrain, neighbors) {
  const cell = { terrain };
  const { north, south, west, east, northwest, northeast, southwest, southeast } = neighbors;
  const center = waterDepth(cell) ?? meanDepth(Object.values(neighbors));
  return [
    meanDepth([cell, north, west, northwest], center), meanDepth([cell, north], center), meanDepth([cell, north, east, northeast], center),
    meanDepth([cell, west], center), center, meanDepth([cell, east], center),
    meanDepth([cell, south, west, southwest], center), meanDepth([cell, south], center), meanDepth([cell, south, east, southeast], center),
  ];
}

/**
 * 四分割した領域内で線形補間し、共有する辺と角の濃度を一致させる。
 * @param {number[]} field 九つの浅瀬濃度。
 * @param {number} x 横位置。0～1。
 * @param {number} y 縦位置。0～1。
 * @returns {number} 浅瀬の濃さ。
 */
function depthAt(field, x, y) {
  const col = x < 0.5 ? 0 : 1, row = y < 0.5 ? 0 : 1;
  const u = x * 2 - col, v = y * 2 - row, start = row * 3 + col;
  return (field[start] * (1 - u) + field[start + 1] * u) * (1 - v)
    + (field[start + 3] * (1 - u) + field[start + 4] * u) * v;
}

/** @param {number[]} field 九つの浅瀬濃度。 @returns {HTMLCanvasElement} 連続する水深の透過マスク。 */
function waterMask(field) {
  const key = field.join(":");
  if (waterMasks.has(key)) return waterMasks.get(key);
  const mask = document.createElement("canvas"); mask.width = 64; mask.height = 64;
  const painter = mask.getContext("2d"), pixels = painter.createImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const offset = (y * 64 + x) * 4;
    pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = 255;
    pixels.data[offset + 3] = Math.round(depthAt(field, x / 63, y / 63) * 255);
  }
  painter.putImageData(pixels, 0, 0);
  if (waterMasks.size >= 256) waterMasks.clear();
  waterMasks.set(key, mask);
  return mask;
}

/**
 * 世界座標を共通にして海と浅瀬を合成し、島の背景も周囲の水深へつなげる。
 * 合成画像は最大256枚まで保持し、移動によるメモリの増加を抑える。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @param {string} terrain 中央の地形。
 * @param {number} gx 世界横座標。 @param {number} gy 世界縦座標。
 * @param {object} neighbors 八方向の周辺マス。
 * @returns {void}
 */
export function drawWaterSurface(ctx, terrain, gx, gy, neighbors) {
  const field = waterDepthField(terrain, neighbors);
  if (typeof document === "undefined") {
    drawTerrainTexture(ctx, field[4] >= 0.5 ? "shoal" : "sea", gx, gy); return;
  }
  if (field.every(value => value === 1)) { drawTerrainTexture(ctx, "shoal", gx, gy); return; }
  drawTerrainTexture(ctx, "sea", gx, gy);
  if (field.every(value => value === 0)) return;
  const key = `${field.join(":")}:${gx % 4}:${gy % 4}`;
  let layer = waterLayers.get(key);
  if (!layer) {
    layer = document.createElement("canvas"); layer.width = 128; layer.height = 128;
    const painter = layer.getContext("2d");
    drawTerrainTexture(painter, "shoal", gx, gy);
    painter.globalCompositeOperation = "destination-in";
    painter.drawImage(waterMask(field), 0, 0, 128, 128);
    if (waterLayers.size >= 256) waterLayers.clear();
    waterLayers.set(key, layer);
  }
  ctx.drawImage(layer, 0, 0, 128, 128);
}

/**
 * 全体表示では画像を使わず、同じ水深分布を少数の色面へ置き換える。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @param {string} terrain 中央の地形。 @param {object} neighbors 八方向の周辺マス。
 * @param {object} colors 海と浅瀬の地形色。
 * @returns {void}
 */
export function drawOverviewWaterSurface(ctx, terrain, neighbors, colors) {
  const field = waterDepthField(terrain, neighbors);
  ctx.fillStyle = colors.sea; ctx.fillRect(0, 0, 128, 128);
  if (field.every(value => value === 0)) return;
  ctx.save(); ctx.fillStyle = colors.shoal;
  const divisions = field.every(value => value === field[0]) ? 1 : 4;
  const step = 128 / divisions;
  for (let y = 0; y < divisions; y++) for (let x = 0; x < divisions; x++) {
    ctx.globalAlpha = depthAt(field, (x + 0.5) / divisions, (y + 0.5) / divisions);
    ctx.fillRect(x * step, y * step, step, step);
  }
  ctx.restore();
}
