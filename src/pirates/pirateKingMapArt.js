/** 五列強は赤い旗、海賊王は金の冠を描き、通常賞金首の手配書と区別する。
 * @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} site 対象。
 * @param {number} x 左。 @param {number} y 上。 @param {number} size 幅。 @returns {void}
 */
export function drawPirateStorySite(ctx, site, x, y, size) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 32, size / 32);
  ctx.fillStyle = "#2a2028"; ctx.strokeStyle = "#edc79b"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(16, 16, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = site.id === "olav" ? "#ffd27a" : "#df7770";
  ctx.beginPath(); ctx.moveTo(9, 22); ctx.lineTo(9, 10); ctx.lineTo(24, 12); ctx.lineTo(24, 20); ctx.lineTo(9, 18); ctx.fill();
  ctx.strokeStyle = "#edc79b"; ctx.beginPath(); ctx.moveTo(8, 7); ctx.lineTo(8, 26); ctx.stroke();
  if (site.id === "olav") { ctx.beginPath(); ctx.moveTo(11, 9); ctx.lineTo(10, 5); ctx.lineTo(15, 7); ctx.lineTo(18, 3); ctx.lineTo(21, 7); ctx.lineTo(26, 5); ctx.lineTo(25, 9); ctx.fill(); }
  ctx.restore();
}
