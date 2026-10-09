import { drawIllustratedSite } from "../world/mapSymbolArt.js";

/** マス内に手配書を描く。全体表示と読み込み中は専用の輪郭で代替する。 @param {CanvasRenderingContext2D} ctx 描画先。 @param {number} x 左。 @param {number} y 上。 @param {number} size 幅。 @param {boolean} [detailed] 詳細表示か。 @returns {void} */
export function drawBountySite(ctx, x, y, size, detailed = size > 20) {
  if (drawIllustratedSite(ctx, "bounty", x, y, size, detailed)) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 32, size / 32);
  ctx.lineWidth = 2; ctx.strokeStyle = "#482c2a"; ctx.fillStyle = "#edc79b";
  ctx.fillRect(6, 3, 20, 26); ctx.strokeRect(6, 3, 20, 26);
  ctx.fillStyle = "#8d3937"; ctx.beginPath(); ctx.arc(16, 12, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#8d3937"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(10, 19); ctx.lineTo(22, 25); ctx.moveTo(22, 19); ctx.lineTo(10, 25); ctx.stroke(); ctx.restore();
}
