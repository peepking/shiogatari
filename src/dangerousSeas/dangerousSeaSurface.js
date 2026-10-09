import { makeRepeatingMapTexture } from "../world/mapAssets.js";

const surfaces = new Map(), listeners = new Set();
let image = null, status = "idle";
const STORM_COLOR = "#47745b";

/**
 * 荒海の原画は初回だけ読み込み、失敗時は波の図形表示を継続する。
 * 通常地形の読み込みとは独立させ、危険海域の画像待ちで通常地図を止めない。
 * @param {Function} [onReady] 読み込み後の再描画。 @returns {void}
 */
export function prepareDangerousSeaSurface(onReady) {
  if (status === "ready" || status === "failed" || typeof Image === "undefined") return;
  if (onReady) listeners.add(onReady);
  if (status === "loading") return;
  status = "loading"; image = new Image();
  image.onload = () => finishSurface("ready");
  image.onerror = () => finishSurface("failed");
  image.src = new URL("../../image/map/dangerous-seas.png", import.meta.url).href;
}

/** @param {string} result 読み込み結果。 @returns {void} 完了した画面だけを一度再描画する。 */
function finishSurface(result) {
  status = result;
  const callbacks = [...listeners]; listeners.clear();
  for (const callback of callbacks) callback();
}

/**
 * 世界座標に固定した四マス周期の白波・霧・潮筋を128単位のマス内へ描く。
 * 南西は原画の明暗を保って緑灰に染め、白波と波の陰影を残す。
 * 南西・南東の二面だけを保持し、移動や再描画で画像を増やさない。
 * @param {CanvasRenderingContext2D} ctx 変換済みの描画先。 @param {string} regionId 海域。
 * @param {number} gx 世界横。 @param {number} gy 世界縦。 @param {Function} [onReady] 再描画。
 * @returns {boolean} 原画を描けたか。
 */
export function drawDangerousSeaSurface(ctx, regionId, gx, gy, onReady) {
  prepareDangerousSeaSurface(onReady);
  if (status !== "ready") return false;
  const column = regionId === "sw" ? 0 : 1;
  let surface = surfaces.get(regionId);
  if (!surface) {
    surface = makeRepeatingMapTexture(image, column, 0, 2, 1);
    if (surface) {
      if (regionId === "sw") {
        const painter = surface.getContext("2d");
        painter.save(); painter.globalCompositeOperation = "color"; painter.fillStyle = STORM_COLOR;
        painter.fillRect(0, 0, surface.width, surface.height); painter.restore();
      }
      surfaces.set(regionId, surface);
    }
  }
  const x = ((gx % 4) + 4) % 4, y = ((gy % 4) + 4) % 4;
  if (surface) ctx.drawImage(surface, -x * 128, -y * 128, 512, 512);
  else {
    ctx.drawImage(image, column * image.naturalWidth / 2, 0, image.naturalWidth / 2, image.naturalHeight, -x * 128, -y * 128, 512, 512);
    if (regionId === "sw") {
      ctx.save(); ctx.globalCompositeOperation = "color"; ctx.fillStyle = STORM_COLOR;
      ctx.fillRect(0, 0, 128, 128); ctx.restore();
    }
  }
  return true;
}
