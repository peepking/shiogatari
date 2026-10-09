const INK = "#142e38", IVORY = "#f5e7c4", GOLD = "#dfb45f";
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
    line(ctx, [[16, 18], [16, 28]], "#b9a779");
    polygon(ctx, [[16, 5], [6, 19], [10, 25], [24, 25], [28, 18], [23, 12]], "#2b5642", "#90a66c");
    polygon(ctx, [[12, 7], [6, 17], [17, 16]], "#78975b", "");
  } else {
    polygon(ctx, [[3, 27], [13, 6], [21, 19], [25, 11], [30, 27]], "#a5b1a5");
    polygon(ctx, [[13, 6], [13, 27], [25, 27]], "#5a7376", "");
    line(ctx, [[10, 12], [13, 6], [17, 13]], IVORY);
  }
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {string} kind 拠点。 @param {string} color 所属色。 @returns {void} 街・村・無法港を別の輪郭で描く。 */
function settlementSymbol(ctx, kind, color) {
  if (kind === "pirateHarbor") {
    polygon(ctx, [[3, 23], [29, 23], [25, 29], [7, 29]], "#b59162");
    line(ctx, [[10, 5], [10, 25]]);
    polygon(ctx, [[11, 5], [28, 7], [26, 18], [11, 16]], "#282b37", IVORY);
    circle(ctx, 19, 11, 2.5, IVORY, "");
  } else if (kind === "town") {
    polygon(ctx, [[5, 10], [10, 10], [10, 14], [14, 14], [14, 7], [20, 7], [20, 14], [24, 14], [24, 10], [29, 10], [29, 28], [5, 28]], IVORY);
    block(ctx, 14, 21, 6, 7, INK);
  } else {
    block(ctx, 8, 16, 18, 12, IVORY);
    polygon(ctx, [[5, 16], [17, 5], [29, 16]], "#c88b64");
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
  polygon(ctx, [[4, 22], [29, 22], [24, 28], [9, 28]], sinking ? GOLD : "#b69162");
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
 * すべて同じ暗い輪郭・象牙色・真鍮色を使い、13pxでも種類の差を残す。
 * @param {CanvasRenderingContext2D} ctx 描画先。 @param {string} kind 図柄。
 * @param {number} x 左。 @param {number} y 上。 @param {number} size 幅。
 * @param {object} [options] 所属色と攻守色。 @returns {boolean} 対応する図柄を描けたか。
 */
export function drawOverviewSymbol(ctx, kind, x, y, size, options = {}) {
  if (!KINDS.has(kind)) return false;
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 32, size / 32);
  ctx.lineWidth = 2.4; ctx.lineJoin = "round"; ctx.lineCap = "round";
  if (["star", "shield", "triangle", "dot"].includes(kind)) pinSymbol(ctx, kind, options);
  else if (kind.startsWith("forest") || kind.startsWith("mountain")) terrainSymbol(ctx, kind);
  else if (["town", "village", "pirateHarbor"].includes(kind)) settlementSymbol(ctx, kind, options.color);
  else if (["ship", "wreck", "sinkingShip"].includes(kind)) shipSymbol(ctx, kind);
  else if (kind === "party") {
    polygon(ctx, [[4, 28], [8, 16], [14, 16], [18, 28]], "#a6c8c6");
    polygon(ctx, [[14, 29], [18, 14], [25, 14], [30, 29]], IVORY);
    circle(ctx, 11, 11, 4, IVORY); circle(ctx, 22, 9, 4.5, IVORY);
  } else if (kind === "crate" || kind === "storm") {
    block(ctx, 6, 9, 21, 19, "#c99b64");
    line(ctx, [[7, 10], [26, 27], [26, 10], [7, 27]], "#71553d");
    if (kind === "storm") polygon(ctx, [[19, 1], [11, 13], [18, 13], [14, 23], [25, 9], [19, 9]], IVORY);
  } else if (kind === "battlefield") {
    line(ctx, [[5, 4], [27, 28]], IVORY); line(ctx, [[27, 4], [5, 28]], IVORY);
    polygon(ctx, [[10, 12], [23, 12], [22, 23], [16, 29], [11, 23]], "#b7c9c3");
  } else if (kind === "rumor" || kind === "bounty") {
    polygon(ctx, [[6, 3], [25, 3], [28, 28], [4, 28]], IVORY);
    if (kind === "bounty") { circle(ctx, 16, 11, 4, "#984c45", ""); line(ctx, [[10, 20], [22, 25], [16, 22], [22, 20], [10, 25]], "#984c45"); }
    else { line(ctx, [[11, 10], [20, 16], [12, 23]], "#ad6048"); line(ctx, [[12, 16], [21, 24]], "#ad6048"); }
  } else if (kind === "altar") {
    block(ctx, 5, 24, 23, 5, "#b8c8b5"); block(ctx, 9, 15, 15, 9, "#91aaa0");
    polygon(ctx, [[16, 2], [23, 10], [16, 17], [9, 10]], "#9ce4df");
  } else if (kind === "inlet") {
    polygon(ctx, [[3, 27], [4, 10], [11, 3], [22, 3], [29, 12], [29, 27], [23, 25], [20, 12], [12, 12], [9, 25]], "#a4b691");
    line(ctx, [[12, 24], [16, 27], [21, 24]], "#a4e0db");
  } else if (kind === "treasure") {
    block(ctx, 4, 10, 25, 18, "#b78b54");
    line(ctx, [[5, 17], [28, 17]], GOLD); block(ctx, 13, 14, 7, 8, GOLD);
  } else if (kind === "pirateLord" || kind === "pirateKing") {
    line(ctx, [[5, 4], [5, 29]], IVORY);
    polygon(ctx, [[6, 5], [28, 7], [26, 26], [16, 29], [6, 25]], kind === "pirateKing" ? "#292d38" : "#b84f49", GOLD);
    if (kind === "pirateKing") polygon(ctx, [[10, 11], [9, 4], [15, 8], [18, 2], [22, 8], [28, 4], [26, 12]], GOLD);
    circle(ctx, 17, 18, 4, IVORY, "");
  } else if (kind === "fish") {
    polygon(ctx, [[3, 16], [11, 9], [21, 10], [29, 5], [27, 16], [29, 27], [21, 22], [11, 23]], "#b8e1df");
    circle(ctx, 10, 15, 1.5, INK, "");
  } else if (kind === "bell" || kind === "lantern") {
    if (kind === "bell") {
      circle(ctx, 16, 6, 3, GOLD); polygon(ctx, [[5, 25], [9, 19], [10, 9], [22, 9], [23, 19], [28, 25]], "#aeb994");
      circle(ctx, 16, 27, 2, GOLD, "");
    } else {
      circle(ctx, 16, 6, 4, GOLD); block(ctx, 8, 10, 16, 17, "#f1cd77");
      line(ctx, [[7, 9], [25, 9]], GOLD); line(ctx, [[7, 28], [25, 28]], GOLD); line(ctx, [[16, 13], [16, 24]], IVORY);
    }
  } else {
    polygon(ctx, [[16, 2], [30, 16], [16, 30], [2, 16]], GOLD);
    line(ctx, [[16, 9], [16, 18]], INK); circle(ctx, 16, 24, 1.5, INK, "");
  }
  ctx.restore();
  return true;
}
