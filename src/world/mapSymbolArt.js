import { drawMapSprite } from "./mapAssets.js";
import { drawOverviewSymbol } from "./mapOverviewArt.js";

const pinImages = new Map();

/**
 * 星と防衛盾を依頼色・攻守色で塗り直し、原画から明暗だけを戻す。
 * 右半分の防衛色には左半分の攻撃色を混ぜず、縮尺間でも所属色を一致させる。
 * 色ごとの小さな画像を再利用し、毎マスの描画で作り直さない。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @param {object} pin 種類と色。
 * @param {number} cx 中央の横座標。
 * @param {number} cy 中央の縦座標。
 * @param {number} radius 基準半径。
 * @param {boolean} [detailed] 詳細表示か。
 * @returns {boolean} 対応するピンを描けたか。
 */
export function drawIllustratedPin(ctx, pin, cx, cy, radius, detailed = true) {
  const size = radius * 2.8;
  if (!detailed || !["star", "shield"].includes(pin.shape) || typeof document === "undefined") {
    return drawOverviewSymbol(ctx, pin.shape, cx - size / 2, cy - size / 2, size, pin);
  }
  const key = `${pin.shape}:${pin.color}:${pin.defenderColor || ""}`;
  let image = pinImages.get(key);
  if (!image) {
    image = document.createElement("canvas"); image.width = 64; image.height = 64;
    const stamp = image.getContext("2d");
    if (!drawMapSprite(stamp, pin.shape, 0, 0, 64)) return drawOverviewSymbol(ctx, pin.shape, cx - size / 2, cy - size / 2, size, pin);
    stamp.globalCompositeOperation = "source-atop"; stamp.globalAlpha = 1;
    stamp.fillStyle = pin.color; stamp.fillRect(0, 0, 64, 64);
    if (pin.shape === "shield" && pin.defenderColor) {
      stamp.fillStyle = pin.defenderColor; stamp.fillRect(32, 0, 32, 64);
    }
    stamp.globalCompositeOperation = "luminosity"; stamp.globalAlpha = 0.45;
    drawMapSprite(stamp, pin.shape, 0, 0, 64);
    if (pinImages.size >= 48) pinImages.clear();
    pinImages.set(key, image);
  }
  ctx.save(); ctx.shadowColor = "#07172580"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 1;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, cx - size / 2, cy - size / 2, size, size);
  ctx.restore();
  return true;
}

/**
 * 地点の絵をマス内に配置する。全体表示は同じ配色の専用シルエットを使う。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @param {string} kind 種類。
 * @param {number} x 左端。
 * @param {number} y 上端。
 * @param {number} size 幅。
 * @param {boolean} [detailed] 詳細表示か。
 * @returns {boolean} 画像または簡易図柄で描画できたか。
 */
export function drawIllustratedSite(ctx, kind, x, y, size, detailed = size > 20) {
  if (!detailed) return drawOverviewSymbol(ctx, kind, x, y, size);
  ctx.save();
  ctx.shadowColor = "#07172580"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 1;
  const drawn = drawMapSprite(ctx, kind, x, y, size);
  ctx.restore();
  return drawn || drawOverviewSymbol(ctx, kind, x, y, size);
}

/**
 * 現在地を帆船または旅人として描く。地点や拠点と重なる場合は左下へ縮小する。
 * 縮小は一度だけ行い、無法港と探索地点が同時にある場合も図柄を読める大きさに保つ。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @param {object} cell 現在地。
 * @param {number} x 左端。
 * @param {number} y 上端。
 * @param {number} size 幅。
 * @param {boolean} [detailed] 詳細表示か。
 * @returns {boolean} 画像または簡易図柄で描画できたか。
 */
export function drawIllustratedPlayer(ctx, cell, x, y, size, detailed = size > 20) {
  const water = cell.terrain === "sea" || cell.terrain === "shoal";
  const crowded = cell.exploration || cell.settlement?.pirateHaven || cell.building === "town" || cell.building === "village";
  const scale = crowded ? (detailed ? 0.55 : 0.7) : 1;
  return drawIllustratedSite(ctx, water ? "ship" : "party", x, y + size * (crowded ? 1 - scale : 0), size * scale, detailed);
}
