import { DANGEROUS_SEA_EVENT_DEFS } from "./dangerousSeaEventConfig.js";
import { drawIllustratedSite } from "../world/mapSymbolArt.js";

const EVENT_ART = { storm_aftermath: "storm", fog_light: "lantern", fish_migration: "fish", sinking_treasure: "sinkingShip", seabed_bell: "bell" };

/** 発見済みの五種類の出来事を個別の絵で描く。全体表示はそれぞれ専用の輪郭にする。 @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} event 出来事。 @param {number} x 横。 @param {number} y 縦。 @param {number} size 一マス幅。 @param {boolean} [detailed] 詳細表示か。 @returns {void} */
export function drawDangerousSeaEvent(ctx, event, x, y, size, detailed = size > 20) {
  if (!DANGEROUS_SEA_EVENT_DEFS[event.kind]) return;
  const kind = EVENT_ART[event.kind] || "event";
  if (drawIllustratedSite(ctx, kind, x, y, size, detailed)) return;
  const centerX = x + size / 2, centerY = y + size / 2, radius = size * 0.38;
  ctx.save();
  ctx.fillStyle = event.kind === "fish_migration" ? "#78e6e9" : event.kind === "seabed_bell" ? "#ceadff" : "#ffe5a0";
  ctx.strokeStyle = "#153043"; ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.beginPath(); ctx.moveTo(centerX, centerY - radius); ctx.lineTo(centerX + radius, centerY);
  ctx.lineTo(centerX, centerY + radius); ctx.lineTo(centerX - radius, centerY); ctx.closePath(); ctx.fill(); ctx.stroke();
  if (size >= 20) {
    ctx.fillStyle = "#153043"; ctx.font = `bold ${Math.floor(size * 0.35)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(event.kind === "fish_migration" ? "魚" : event.kind === "seabed_bell" ? "鐘" : "!", centerX, centerY);
  }
  ctx.restore();
}
