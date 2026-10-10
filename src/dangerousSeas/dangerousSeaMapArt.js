import { drawDangerousSeaSurface, prepareDangerousSeaSurface } from "./dangerousSeaSurface.js";

const layers = new Map(), masks = new Map();
const SIDES = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/**
 * 区域外へは透明、核心と外縁の共有辺では同じ濃さになる透過範囲を作る。
 * 角では区域外への減衰を掛け合わせ、内外判定や保存される海域は変更しない。
 * @param {object} sea 現在の海域。 @param {Array} neighbors 隣接海域。
 * @returns {HTMLCanvasElement} 濃さを保持する画像。
 */
function regionalMask(sea, neighbors) {
  const codes = neighbors.map(neighbor => neighbor?.regionId !== sea.regionId ? 0 : neighbor.level === "core" ? 2 : 1);
  const key = `${sea.level}:${codes.join("")}`;
  if (masks.has(key)) return masks.get(key);
  const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext("2d"), pixels = ctx.createImageData(64, 64);
  const core = sea.level === "core";
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    let strength = core ? 1 : 0, fade = 1;
    for (const [index, distance] of [y, 63 - y, x, 63 - x].entries()) {
      const weight = Math.max(0, 1 - distance / 20), code = codes[index];
      if (!code) fade *= 1 - weight;
      else if (core && code === 1) strength = Math.min(strength, 1 - weight * 0.5);
      else if (!core && code === 2) strength = Math.max(strength, weight * 0.5);
    }
    const offset = (y * 64 + x) * 4;
    pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = 255;
    pixels.data[offset + 3] = Math.round((0.58 + strength * 0.34) * fade * 255);
  }
  ctx.putImageData(pixels, 0, 0);
  if (masks.size >= 128) masks.clear();
  masks.set(key, canvas);
  return canvas;
}

/**
 * 南西は暗い緑灰の海と風向きの揃った砕け波、南東は曲がる潮筋と霧を描く。
 * 全体表示と画像待機中にも地域の違いを残し、模様は世界座標から固定する。
 * @param {CanvasRenderingContext2D} ctx 128単位の描画先。 @param {object} sea 海域。
 * @param {number} gx 世界横。 @param {number} gy 世界縦。 @param {boolean} detailed 詳細表示。
 * @returns {void}
 */
function drawRegionalWaves(ctx, sea, gx, gy, detailed) {
  const storm = sea.regionId === "sw", core = sea.level === "core";
  ctx.fillStyle = storm ? "#30564c" : "#354765"; ctx.fillRect(0, 0, 128, 128);
  const shift = ((((gx % 4) + 4) % 4) * 11 + (((gy % 4) + 4) % 4) * 7) % 18;
  ctx.lineCap = "butt"; ctx.lineJoin = "miter";
  for (const row of detailed ? [30, 66, 102] : [43, 91]) {
    ctx.beginPath();
    if (storm) {
      ctx.moveTo(8, row + shift + 8); ctx.lineTo(30, row + shift + 8); ctx.lineTo(30, row + shift);
      ctx.lineTo(52, row + shift); ctx.lineTo(52, row + shift - 8); ctx.lineTo(78, row + shift - 8);
      ctx.moveTo(90, row + shift - 16); ctx.lineTo(106, row + shift - 16); ctx.lineTo(106, row + shift - 24); ctx.lineTo(122, row + shift - 24);
    } else {
      ctx.moveTo(10, row + shift); ctx.lineTo(10, row + shift - 12); ctx.lineTo(34, row + shift - 12);
      ctx.lineTo(34, row + shift - 20); ctx.lineTo(82, row + shift - 20); ctx.lineTo(82, row + shift - 12);
      ctx.lineTo(106, row + shift - 12); ctx.lineTo(106, row + shift + 4); ctx.lineTo(84, row + shift + 4);
      ctx.lineTo(84, row + shift + 12); ctx.lineTo(58, row + shift + 12);
    }
    ctx.strokeStyle = storm ? "#173a3380" : "#1f2d4a80"; ctx.lineWidth = detailed ? 9 : 12; ctx.stroke();
    ctx.strokeStyle = storm ? "#c3d6c6" : "#8caeba"; ctx.lineWidth = detailed ? (core ? 4 : 3) : 6; ctx.stroke();
  }
  if (!storm && detailed) {
    ctx.fillStyle = "#8caeba30";
    ctx.fillRect(0, 20, 34, 12); ctx.fillRect(34, 28, 42, 12); ctx.fillRect(76, 20, 52, 12);
  }
}

/**
 * 南西の荒波と南東の霧の潮流を、周囲の通常海面へなじませて描く。
 * 詳細表示は四マスにまたがる原画、全体表示は専用の波形を使い、地点は後段に残す。
 * 世界の外側は現在の海域が続くものとして扱い、地図端では通常海へ減衰させない。
 * @param {CanvasRenderingContext2D} ctx 描画先。 @param {object|null} sea 海域属性。
 * @param {number} x 左端。 @param {number} y 上端。 @param {number} size マス幅。
 * @param {object} [options] 世界座標・海域検索・再描画・詳細表示の指定。 @returns {void}
 */
export function drawDangerousSeaTile(ctx, sea, x, y, size, options = {}) {
  if (!sea || !["sw", "se"].includes(sea.regionId)) return;
  const { gx = 0, gy = 0, grid, seaAt, onReady, detailed = size > 14 } = options;
  prepareDangerousSeaSurface(onReady);
  const neighbors = SIDES.map(([dx, dy]) => {
    const position = { x: gx + dx, y: gy + dy };
    if (grid && (position.y < 0 || position.y >= grid.length || position.x < 0 || position.x >= grid[position.y].length)) return sea;
    return seaAt ? seaAt(position) : sea;
  });
  const key = `${sea.regionId}:${sea.level}:${neighbors.map(neighbor => neighbor ? `${neighbor.regionId}${neighbor.level}` : "-").join(":")}:${gx % 4}:${gy % 4}:${detailed}`;
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 128, size / 128); ctx.imageSmoothingEnabled = false;
  ctx.beginPath(); ctx.rect(0, 0, 128, 128); ctx.clip();
  if (typeof document === "undefined") {
    ctx.globalAlpha = sea.level === "core" ? 0.92 : 0.58;
    drawRegionalWaves(ctx, sea, gx, gy, detailed);
  } else {
    let layer = layers.get(key);
    if (!layer) {
      layer = document.createElement("canvas"); layer.width = 128; layer.height = 128;
      const painter = layer.getContext("2d");
      const illustrated = detailed && drawDangerousSeaSurface(painter, sea.regionId, gx, gy, onReady);
      if (!illustrated) drawRegionalWaves(painter, sea, gx, gy, detailed);
      painter.globalCompositeOperation = "destination-in";
      painter.drawImage(regionalMask(sea, neighbors), 0, 0, 128, 128);
      if (layers.size >= 256) layers.clear();
      if (illustrated || !detailed) layers.set(key, layer);
    }
    ctx.drawImage(layer, 0, 0, 128, 128);
  }
  ctx.restore();
}
