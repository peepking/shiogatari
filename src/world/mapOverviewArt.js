const INK = "#283b3d", IVORY = "#ddcb9e", GOLD = "#c5a460";
const KINDS = new Set(["town", "village", "pirateHarbor", "ship", "party", "wreck", "crate", "battlefield", "rumor", "altar", "inlet", "treasure", "bounty", "pirateLord", "pirateKing", "fish", "bell", "event", "storm", "lantern", "sinkingShip", "forest", "forestAlt", "mountain", "mountainAlt", "star", "shield", "triangle", "dot"]);

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {number[][]} points 頂点。 @param {string} fill 塗り。 @param {string} [stroke] 輪郭。 @returns {void} 輪郭付きの簡易図形を描く。 */
function polygon(ctx, points, fill, stroke = INK) {
  ctx.beginPath(); ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {number[][]} points 折れ線。 @param {string} color 色。 @returns {void} 小さな図柄でも残る線を描く。 */
function line(ctx, points, color = IVORY) {
  ctx.beginPath(); ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.strokeStyle = color; ctx.stroke();
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {number} x 中心横。 @param {number} y 中心縦。 @param {number} radius 半径。 @param {string} fill 塗り。 @param {string} [stroke] 輪郭。 @returns {void} 縁取りした円を描く。 */
function circle(ctx, x, y, radius, fill, stroke = INK) {
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {number} x 左。 @param {number} y 上。 @param {number} w 幅。 @param {number} h 高さ。 @param {string} fill 色。 @returns {void} 簡易図柄の矩形を描く。 */
function block(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = INK; ctx.strokeRect(x, y, w, h);
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {string} kind 地形。 @returns {void} 樹冠と稜線を少ない面で描く。 */
function terrainSymbol(ctx, kind) {
  if (kind.startsWith("forest")) {
    line(ctx, [[16, 18], [16, 28]], "#8d7651");
    polygon(ctx, [[12, 5], [21, 5], [21, 9], [25, 9], [25, 15], [28, 15], [28, 22], [23, 26], [9, 26], [5, 22], [5, 14], [9, 14], [9, 9], [12, 9]], "#46644a");
    polygon(ctx, [[12, 7], [20, 7], [20, 11], [12, 11], [12, 18], [7, 18], [7, 15], [10, 15], [10, 10], [12, 10]], "#80925b", "");
    line(ctx, [[12, 24], [23, 24], [26, 21]], "#334d3d");
  } else {
    polygon(ctx, [[3, 27], [13, 6], [21, 19], [25, 11], [30, 27]], "#9aaba8");
    polygon(ctx, [[13, 6], [13, 27], [25, 27]], "#617979", "");
    line(ctx, [[10, 12], [13, 6], [17, 13]], IVORY);
  }
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {string} kind 拠点。 @param {string} color 所属色。 @returns {void} 街・村・無法港を別の輪郭で描く。 */
function settlementSymbol(ctx, kind, color) {
  if (kind === "pirateHarbor") {
    polygon(ctx, [[3, 23], [29, 23], [25, 29], [7, 29]], "#a08357");
    line(ctx, [[10, 5], [10, 25]]);
    polygon(ctx, [[11, 5], [28, 7], [26, 18], [11, 16]], INK, IVORY);
    circle(ctx, 19, 11, 2.5, IVORY, "");
  } else if (kind === "town") {
    polygon(ctx, [[5, 10], [10, 10], [10, 14], [14, 14], [14, 7], [20, 7], [20, 14], [24, 14], [24, 10], [29, 10], [29, 28], [5, 28]], IVORY);
    ctx.fillStyle = "#ad9c7d"; ctx.fillRect(23, 17, 4, 9);
    block(ctx, 14, 21, 6, 7, INK);
  } else {
    block(ctx, 8, 16, 18, 12, IVORY);
    ctx.fillStyle = "#ad9c7d"; ctx.fillRect(22, 18, 3, 9);
    polygon(ctx, [[5, 16], [17, 5], [29, 16]], "#b66a4e");
    block(ctx, 15, 22, 5, 6, INK);
  }
  if (kind !== "pirateHarbor") {
    ctx.lineWidth = 3;
    line(ctx, [[3, 3], [3, 13]], IVORY);
    polygon(ctx, [[4, 3], [13, 5], [4, 10]], color || GOLD, INK);
  }
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {string} kind 船の種類。 @returns {void} 帆・船体・水線を残して船を描く。 */
function shipSymbol(ctx, kind) {
  const wreck = kind === "wreck", sinking = kind === "sinkingShip";
  polygon(ctx, [[4, 22], [29, 22], [24, 28], [9, 28]], sinking ? GOLD : "#a08357");
  line(ctx, [[17, 4], [17, 23]], IVORY);
  polygon(ctx, wreck ? [[17, 5], [6, 19], [12, 17], [16, 20]] : [[16, 5], [5, 20], [16, 20]], IVORY);
  if (sinking) line(ctx, [[3, 26], [11, 29], [21, 26], [29, 29]], "#9bdedb");
  else if (wreck) line(ctx, [[6, 23], [12, 28], [22, 23]], INK);
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {string} kind ピン形状。 @param {object} options ピン色。 @returns {void} 依頼・移動・配達・攻守の形と色を保つ。 */
function pinSymbol(ctx, kind, options) {
  const color = options.color || GOLD;
  ctx.lineWidth = 2.8;
  if (kind === "dot") {
    circle(ctx, 16, 16, 10, color, IVORY);
    circle(ctx, 13, 12, 2.5, "#ffffff90", "");
  } else if (kind === "triangle") {
    polygon(ctx, [[16, 3], [29, 28], [16, 24], [3, 28]], color, IVORY);
    line(ctx, [[16, 9], [16, 21]], "#ffffff70");
  } else if (kind === "shield") {
    polygon(ctx, [[5, 5], [27, 5], [26, 21], [16, 30], [6, 21]], color, "");
    if (options.defenderColor) polygon(ctx, [[16, 5], [27, 5], [26, 21], [16, 30]], options.defenderColor, "");
    ctx.strokeStyle = IVORY;
    ctx.beginPath(); ctx.moveTo(5, 5); ctx.lineTo(27, 5); ctx.lineTo(26, 21); ctx.lineTo(16, 30); ctx.lineTo(6, 21); ctx.closePath(); ctx.stroke();
    line(ctx, [[16, 7], [16, 25]], "#ffffff50");
  } else {
    const points = Array.from({ length: 10 }, (_, index) => {
      const angle = index * Math.PI / 5 - Math.PI / 2, radius = index % 2 ? 6.5 : 14;
      return [16 + Math.cos(angle) * radius, 16 + Math.sin(angle) * radius];
    });
    polygon(ctx, points, color, IVORY);
    line(ctx, [[16, 5], [16, 16], [23, 24]], "#ffffff50");
  }
}

/**
 * 全体地図の図柄は詳細画像を縮めず、32単位の少ない面に置き換える。
 * ユニットに合わせた少数の色面と短い線を使い、13pxでも種類の差を残す。
 * @param {CanvasRenderingContext2D} ctx 描画先。 @param {string} kind 図柄。
 * @param {number} x 左。 @param {number} y 上。 @param {number} size 幅。
 * @param {object} [options] 所属色と攻守色。 @returns {boolean} 対応する図柄を描けたか。
 */
export function drawOverviewSymbol(ctx, kind, x, y, size, options = {}) {
  if (!KINDS.has(kind)) return false;
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 32, size / 32);
  ctx.lineWidth = 2.4; ctx.lineJoin = "bevel"; ctx.lineCap = "butt";
  if (["star", "shield", "triangle", "dot"].includes(kind)) pinSymbol(ctx, kind, options);
  else if (kind.startsWith("forest") || kind.startsWith("mountain")) terrainSymbol(ctx, kind);
  else if (["town", "village", "pirateHarbor"].includes(kind)) settlementSymbol(ctx, kind, options.color);
  else if (["ship", "wreck", "sinkingShip"].includes(kind)) shipSymbol(ctx, kind);
  else if (kind === "party") {
    polygon(ctx, [[5, 15], [13, 15], [16, 27], [3, 27]], "#66734d");
    polygon(ctx, [[7, 15], [12, 15], [14, 25], [6, 25]], IVORY);
    line(ctx, [[8, 25], [8, 29]], "#765a3d"); line(ctx, [[12, 25], [12, 29]], "#765a3d");
    circle(ctx, 10, 10, 4, "#c8af82");
    line(ctx, [[6, 9], [7, 6], [12, 6], [14, 9]], "#795c3d");
    polygon(ctx, [[17, 14], [25, 14], [29, 28], [16, 28]], "#b66a4e");
    polygon(ctx, [[19, 14], [25, 14], [27, 25], [18, 25]], "#52758a");
    line(ctx, [[20, 25], [20, 29]], "#765a3d");
    circle(ctx, 22, 9, 4, "#c8af82");
    polygon(ctx, [[18, 7], [20, 4], [24, 4], [26, 7], [26, 9], [18, 9]], "#9aaba8");
    line(ctx, [[22, 7], [22, 12]], "#9aaba8");
    circle(ctx, 25, 21, 5, "#986a43"); circle(ctx, 25, 21, 1.5, "#9aaba8", "");
  } else if (kind === "crate" || kind === "storm") {
    block(ctx, 6, 9, 21, 19, "#b89765");
    line(ctx, [[7, 10], [26, 27], [26, 10], [7, 27]], "#71553d");
    if (kind === "storm") polygon(ctx, [[19, 1], [11, 13], [18, 13], [14, 23], [25, 9], [19, 9]], IVORY);
  } else if (kind === "battlefield") {
    line(ctx, [[12, 3], [12, 25]], "#a08357");
    polygon(ctx, [[13, 4], [29, 7], [25, 11], [28, 15], [13, 13]], "#b65349");
    polygon(ctx, [[3, 23], [4, 18], [8, 16], [12, 18], [13, 23]], "#9aaba8");
    line(ctx, [[3, 28], [17, 15]], IVORY);
    line(ctx, [[3, 24], [7, 28]], "#a08357");
    circle(ctx, 22, 23, 6, "#986a43"); circle(ctx, 22, 23, 2, "#9aaba8", "");
  } else if (kind === "rumor" || kind === "bounty") {
    polygon(ctx, [[6, 3], [25, 3], [28, 28], [4, 28]], IVORY);
    if (kind === "bounty") { circle(ctx, 16, 11, 4, "#984c45", ""); line(ctx, [[10, 20], [22, 25], [16, 22], [22, 20], [10, 25]], "#984c45"); }
    else { line(ctx, [[11, 10], [20, 16], [12, 23]], "#ad6048"); line(ctx, [[12, 16], [21, 24]], "#ad6048"); }
  } else if (kind === "altar") {
    block(ctx, 5, 25, 23, 4, "#9aaba8"); block(ctx, 8, 21, 17, 4, "#778d88");
    ctx.beginPath(); ctx.moveTo(13, 3); ctx.lineTo(20, 3); ctx.quadraticCurveTo(24, 3, 24, 7);
    ctx.lineTo(24, 21); ctx.lineTo(8, 21); ctx.lineTo(8, 8); ctx.quadraticCurveTo(8, 3, 13, 3);
    ctx.closePath(); ctx.fillStyle = "#9aaba8"; ctx.fill(); ctx.strokeStyle = INK; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(11, 15); ctx.quadraticCurveTo(13, 11, 16, 14); ctx.quadraticCurveTo(20, 17, 21, 12);
    ctx.strokeStyle = "#8bc0b4"; ctx.stroke();
    line(ctx, [[11, 18], [21, 18]], "#8bc0b4");
  } else if (kind === "inlet") {
    polygon(ctx, [[3, 27], [4, 10], [11, 3], [22, 3], [29, 12], [29, 27], [23, 25], [20, 12], [12, 12], [9, 25]], "#9aaba8");
    line(ctx, [[12, 24], [16, 27], [21, 24]], "#8bc0b4");
  } else if (kind === "treasure") {
    block(ctx, 4, 10, 25, 18, "#a08357");
    line(ctx, [[5, 17], [28, 17]], GOLD); block(ctx, 13, 14, 7, 8, GOLD);
  } else if (kind === "pirateLord" || kind === "pirateKing") {
    line(ctx, [[5, 4], [5, 29]], IVORY);
    polygon(ctx, [[6, 5], [28, 7], [26, 26], [16, 29], [6, 25]], kind === "pirateKing" ? INK : "#a6534d", GOLD);
    if (kind === "pirateKing") polygon(ctx, [[10, 11], [9, 4], [15, 8], [18, 2], [22, 8], [28, 4], [26, 12]], GOLD);
    circle(ctx, 17, 18, 4, IVORY, "");
  } else if (kind === "fish") {
    polygon(ctx, [[3, 16], [11, 9], [21, 10], [29, 5], [27, 16], [29, 27], [21, 22], [11, 23]], "#aac8c2");
    circle(ctx, 10, 15, 1.5, INK, "");
  } else if (kind === "bell" || kind === "lantern") {
    if (kind === "bell") {
      circle(ctx, 16, 6, 3, GOLD); polygon(ctx, [[5, 25], [9, 19], [10, 9], [22, 9], [23, 19], [28, 25]], "#98a682");
      circle(ctx, 16, 27, 2, GOLD, "");
    } else {
      circle(ctx, 16, 6, 4, GOLD); block(ctx, 8, 10, 16, 17, "#d3b76f");
      line(ctx, [[7, 9], [25, 9]], GOLD); line(ctx, [[7, 28], [25, 28]], GOLD); line(ctx, [[16, 13], [16, 24]], IVORY);
    }
  } else {
    polygon(ctx, [[16, 2], [30, 16], [16, 30], [2, 16]], GOLD);
    line(ctx, [[16, 9], [16, 18]], INK); circle(ctx, 16, 24, 1.5, INK, "");
  }
  ctx.restore();
  return true;
}
