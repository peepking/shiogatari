import { drawMapSprite, drawTerrainTexture, mapAssetsReady, prepareMapAssets } from "./mapAssets.js";
import { drawOverviewSymbol } from "./mapOverviewArt.js";
import { drawCoast, drawInletCoast, groundOutline, inletCornerOutline } from "./mapCoastArt.js";
import { drawOverviewWaterSurface, drawWaterSurface } from "./mapWaterArt.js";

const WATER = new Set(["sea", "shoal"]);
const OVERVIEW_COLORS = { sea: "#1b526d", shoal: "#438d99", plain: "#8a9b67", forest: "#526f4f", mountain: "#7a8980", deck: "#9c8057" };

/** @param {object} cell マス。 @returns {boolean} 海か浅瀬か。 */
function isWater(cell) {
  return Boolean(cell && WATER.has(cell.terrain));
}

/** @param {object} cell マス。 @returns {boolean} 地続きの陸か。 */
function isLand(cell) {
  return Boolean(cell && !isWater(cell) && cell.terrain !== "deck");
}

/** @param {object} neighbors 八方向の周辺マス。 @returns {object} 海に面する辺と入り江へ続く端。 */
function coastDirections(neighbors) {
  const { north, south, west, east, northwest, northeast, southwest, southeast } = neighbors;
  return {
    north: isWater(north), south: isWater(south), west: isWater(west), east: isWater(east),
    northWest: isLand(west) && isLand(northwest), northEast: isLand(east) && isLand(northeast),
    eastNorth: isLand(north) && isLand(northeast), eastSouth: isLand(south) && isLand(southeast),
    southWest: isLand(west) && isLand(southwest), southEast: isLand(east) && isLand(southeast),
    westNorth: isLand(north) && isLand(northwest), westSouth: isLand(south) && isLand(southwest),
  };
}

/**
 * 三方向が陸の水マスの隅へ陸を延長し、岸の直線を入り江の曲線につなぐ。
 * 拠点や樹木は延長せず、描画用の地面だけを隣接する陸から引き継ぐ。
 * @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} neighbors 八方向の周辺マス。
 * @param {boolean} detailed 詳細表示か。 @param {number} gx 世界横。 @param {number} gy 世界縦。
 * @returns {void}
 */
function drawInletCorners(ctx, neighbors, detailed, gx, gy) {
  const { north, south, west, east, northwest, northeast, southwest, southeast } = neighbors;
  const corners = [["tl", north, west, northwest], ["tr", north, east, northeast], ["bl", south, west, southwest], ["br", south, east, southeast]];
  for (const [corner, first, second, diagonal] of corners) {
    if (![first, second, diagonal].every(isLand)) continue;
    ctx.save(); inletCornerOutline(ctx, corner); ctx.clip();
    if (detailed) {
      drawTerrainTexture(ctx, "plain", gx, gy);
      ctx.fillStyle = "#102b2a18"; ctx.fillRect(0, 0, 128, 128);
    } else {
      ctx.fillStyle = OVERVIEW_COLORS[diagonal.terrain] || OVERVIEW_COLORS.plain;
      ctx.fillRect(0, 0, 128, 128);
    }
    ctx.restore(); drawInletCoast(ctx, corner);
  }
}

/**
 * 拠点の所属旗を地形の模様より明るく描く。色だけでなく旗竿と輪郭を残す。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @param {string} color 所属色。
 * @param {boolean} small 全体表示か。
 * @returns {void}
 */
function drawFactionFlag(ctx, color, small) {
  const x = small ? 22 : 17, y = small ? 9 : 13;
  ctx.lineWidth = small ? 5 : 2;
  ctx.strokeStyle = "#f2e1b7";
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 34); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 2, y); ctx.lineTo(x + 27, y + 5);
  ctx.lineTo(x + 23, y + 18); ctx.lineTo(x + 2, y + 15); ctx.closePath();
  ctx.fillStyle = color || "#d8b76e"; ctx.fill();
  ctx.lineWidth = small ? 4 : 1.5; ctx.strokeStyle = "#fff0c8"; ctx.stroke();
}

/**
 * 全体表示は静かな地形色と専用の輪郭で描き、細かな画像の縮小による潰れを防ぐ。
 * 海岸の形は詳細表示と共有し、海・浅瀬・陸地の位置を両表示で一致させる。
 * @param {CanvasRenderingContext2D} ctx 128単位へ変換済みの描画先。
 * @param {object} cell マス。 @param {object} coast 海岸の方向。
 * @param {boolean} coastal 海岸を持つか。 @param {string} factionColor 所属色。
 * @param {object} neighbors 八方向の周辺マス。
 * @param {object} options 地形の上に描く水面などの追加描画。
 * @param {number} gx 世界横。 @param {number} gy 世界縦。 @returns {void}
 */
function drawOverviewTile(ctx, cell, coast, coastal, factionColor, neighbors, options, gx, gy) {
  if (coastal || isWater(cell)) drawOverviewWaterSurface(ctx, cell.terrain, neighbors, OVERVIEW_COLORS);
  if (!isWater(cell)) {
    groundOutline(ctx, coastal ? coast : {});
    ctx.fillStyle = OVERVIEW_COLORS[cell.terrain] || OVERVIEW_COLORS.sea; ctx.fill();
  }
  if (isWater(cell)) drawInletCorners(ctx, neighbors, false, gx, gy);
  if (coastal) drawCoast(ctx, coast);
  options.drawSurface?.(ctx, 128, { ...options, detailed: false });
  const settlement = cell.building === "town" || cell.building === "village";
  if (settlement) {
    drawOverviewSymbol(ctx, cell.settlement?.pirateHaven ? "pirateHarbor" : cell.building, 0, 0, 128, { color: factionColor });
  } else if (cell.terrain === "forest" || cell.terrain === "mountain") {
    drawOverviewSymbol(ctx, cell.terrain, 8, 4, 112);
  } else if (isWater(cell) && (gx + gy * 3) % 4 === 0) {
    ctx.strokeStyle = cell.terrain === "sea" ? "#7eb5c333" : "#c0dfcf44"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(30, 72); ctx.quadraticCurveTo(48, 59, 65, 72); ctx.quadraticCurveTo(82, 85, 100, 72); ctx.stroke();
  } else if (cell.terrain === "deck") {
    ctx.strokeStyle = "#5e513955"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, 42); ctx.lineTo(128, 42); ctx.moveTo(0, 86); ctx.lineTo(128, 86); ctx.stroke();
  }
}

/**
 * 同じ地形の模様・海岸・立体物・拠点を統一した縮尺で描く。
 * 座標から木と岩の二種類を選ぶため、再描画しても模様は変わらない。
 * 全体表示では画像の細部を省き、地形色と拠点の輪郭を優先する。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @param {object} cell マス。
 * @param {number} x 左端。
 * @param {number} y 上端。
 * @param {number} size マス幅。
 * @param {boolean} detailed 詳細表示か。
 * @param {string} factionColor 所属色。
 * @param {number} variant 模様の種類。
 * @param {object} [options] 世界座標・周辺地形・再描画関数・拠点の下へ重ねる水面。
 * @returns {boolean} 新しい素材で描けたか。
 */
export function drawIllustratedTile(ctx, cell, x, y, size, detailed, factionColor, variant, options = {}) {
  prepareMapAssets(options.onReady);
  if (detailed && !mapAssetsReady()) return false;
  const { gx = variant || 0, gy = 0, grid } = options;
  const neighbors = {
    north: grid?.[gy - 1]?.[gx], south: grid?.[gy + 1]?.[gx],
    west: grid?.[gy]?.[gx - 1], east: grid?.[gy]?.[gx + 1],
    northwest: grid?.[gy - 1]?.[gx - 1], northeast: grid?.[gy - 1]?.[gx + 1],
    southwest: grid?.[gy + 1]?.[gx - 1], southeast: grid?.[gy + 1]?.[gx + 1],
  };
  const coast = coastDirections(neighbors);
  const coastal = isLand(cell) && [coast.north, coast.south, coast.west, coast.east].some(Boolean);
  const settlement = cell.building === "town" || cell.building === "village";
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 128, size / 128);
  ctx.beginPath(); ctx.rect(0, 0, 128, 128); ctx.clip();
  if (!detailed) {
    drawOverviewTile(ctx, cell, coast, coastal, factionColor, neighbors, options, gx, gy);
    ctx.restore(); return true;
  }
  if (coastal) {
    drawWaterSurface(ctx, cell.terrain, gx, gy, neighbors);
    ctx.fillStyle = "#17486a38"; ctx.fillRect(0, 0, 128, 128);
  }
  ctx.save();
  groundOutline(ctx, coastal ? coast : {}); ctx.clip();
  const rockyOrWooded = cell.terrain === "forest" || cell.terrain === "mountain";
  if (isWater(cell)) drawWaterSurface(ctx, cell.terrain, gx, gy, neighbors);
  else drawTerrainTexture(ctx, rockyOrWooded ? "plain" : cell.terrain, gx, gy);
  if (rockyOrWooded) {
    ctx.save(); ctx.globalAlpha = 0.32;
    ctx.beginPath(); ctx.ellipse(64, 76, 60, 48, 0, 0, Math.PI * 2); ctx.clip();
    drawTerrainTexture(ctx, cell.terrain, gx, gy);
    ctx.restore();
  }
  ctx.fillStyle = isWater(cell) ? "#17486a38" : "#102b2a18"; ctx.fillRect(0, 0, 128, 128);
  ctx.restore();
  if (isWater(cell)) drawInletCorners(ctx, neighbors, true, gx, gy);
  if (coastal) drawCoast(ctx, coast);
  options.drawSurface?.(ctx, 128, { ...options, detailed });
  if (!settlement) {
    if (cell.terrain === "forest") drawMapSprite(ctx, variant ? "forestAlt" : "forest", -2, -3, 132);
    if (cell.terrain === "mountain") drawMapSprite(ctx, variant ? "mountainAlt" : "mountain", -2, -6, 132);
  }
  if (detailed) {
    ctx.strokeStyle = "#d1e3d325"; ctx.lineWidth = 128 / size * 0.55;
    ctx.strokeRect(0, 0, 128, 128);
  }
  if (settlement) {
    ctx.shadowColor = "#071a2bb0"; ctx.shadowBlur = detailed ? 2 : 5;
    drawMapSprite(ctx, cell.settlement?.pirateHaven ? "pirateHarbor" : cell.building, -3, -3, 134);
    ctx.shadowBlur = 0;
    if (!cell.settlement?.pirateHaven) drawFactionFlag(ctx, factionColor, !detailed);
  }
  ctx.restore();
  return true;
}
