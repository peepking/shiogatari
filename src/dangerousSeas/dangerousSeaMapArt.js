/**
 * 海の通常描画に薄い警戒色と核心の斜線を重ね、地形や既存の地点記号を変更しない。
 * @param {CanvasRenderingContext2D} ctx 描画先。 @param {object|null} sea 海域属性。
 * @param {number} x 描画左端。 @param {number} y 上端。 @param {number} size セル幅。 @returns {void}
 */
export function drawDangerousSeaTile(ctx, sea, x, y, size) {
  if (!sea) return;
  ctx.save();
  ctx.fillStyle = sea.regionId === "sw" ? "rgba(210, 85, 50, 0.28)" : "rgba(150, 85, 210, 0.30)";
  ctx.fillRect(x, y, size, size);
  if (sea.level === "core") {
    ctx.strokeStyle = "rgba(255, 160, 150, 0.55)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 1, y + size - 1); ctx.lineTo(x + size - 1, y + 1); ctx.stroke();
  }
  ctx.restore();
}
