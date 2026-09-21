const TERRAIN_COLORS = {
  sea: "#124674", shoal: "#207f92", plain: "#7c9b5a", forest: "#42663e", mountain: "#64736b", deck: "#80664a",
};

/**
 * 頂点列から塗りと輪郭を持つ図形を描く。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[][]} points
 * @param {string} fill
 * @param {string} [stroke]
 * @returns {void}
 */
function polygon(ctx, points, fill, stroke = "#263c39") {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

/**
 * 一筆の模様を描く。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[][]} points
 * @param {string} color
 * @returns {void}
 */
function line(ctx, points, color) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.strokeStyle = color;
  ctx.stroke();
}

/**
 * 拡大マップ用の地形模様を32単位の正方形内に描く。
 * 座標の偶奇だけで模様をずらし、再描画で変化する乱数は使わない。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} terrain
 * @param {number} variant
 * @returns {void}
 */
function drawTerrainPattern(ctx, terrain, variant) {
  ctx.lineWidth = 0.65;
  if (terrain === "sea" || terrain === "shoal") {
    const color = terrain === "sea" ? "#78b4ce" : "#99d7d9";
    const shift = variant ? 2 : -1;
    for (const [x, y] of [[7 + shift, 11], [17 - shift, 22]]) {
      line(ctx, [[x, y], [x+2, y-1], [x+4, y+1], [x+6, y]], color);
    }
  } else if (terrain === "deck") {
    for (const y of [8, 16, 24]) line(ctx, [[1,y],[31,y]], "#4e4034");
    for (const [x,y] of [[11,0],[23,8],[9,16],[21,24]]) {
      line(ctx, [[x,y+1],[x,y+7]], "#4e4034");
      line(ctx, [[x+3,y+3],[x+8,y+3]], "#a48963");
    }
  } else if (terrain === "plain") {
    for (const [x, y] of [[9, 11], [22, 23], [8, 25]]) {
      line(ctx, [[x-2, y-3], [x, y], [x, y-5]], "#466638");
      line(ctx, [[x, y], [x+2, y-3]], "#466638");
    }
  } else if (terrain === "forest") {
    for (const [x, y] of [[8, 21], [16, 13], [24, 23]]) {
      line(ctx, [[x, y], [x, y+3]], "#c0af82");
      polygon(ctx, [[x,y-11],[x-3,y-5],[x-2,y-5],[x-4,y],[x,y+1],[x+4,y],[x+2,y-5],[x+3,y-5]], "#294e36", "#1a382b");
      line(ctx, [[x,y-8],[x-2,y-3]], "#668651");
    }
  } else if (terrain === "mountain") {
    polygon(ctx, [[13,23],[22,7],[29,23]], "#9fa7a0");
    polygon(ctx, [[22,7],[22,23],[29,23]], "#586568", "");
    polygon(ctx, [[3,26],[12,10],[23,26]], "#b5b9ad");
    polygon(ctx, [[12,10],[14,26],[23,26]], "#69757a", "");
    line(ctx, [[8,17],[12,10],[15,16]], "#d8dccb");
  }
}

/**
 * 村の家1軒を描く。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @returns {void}
 */
function drawHouse(ctx, x, y) {
  polygon(ctx, [[x,y],[x+8,y],[x+8,y+9],[x,y+9]], "#ead7ac");
  polygon(ctx, [[x-1,y],[x+4,y-6],[x+9,y]], "#bb6552");
  ctx.fillStyle = "#354343";
  ctx.fillRect(x+3, y+4, 2, 5);
  ctx.fillStyle = "#f5e6b5";
  ctx.fillRect(x+1, y+2, 2, 2);
}

/**
 * 拡大時の街・村を1マス内に描く。所属勢力は小旗の色で示す。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} building
 * @param {string} factionColor
 * @returns {void}
 */
function drawSettlement(ctx, building, factionColor) {
  ctx.fillStyle = "#22362744";
  ctx.fillRect(4, 25, 24, 2);
  ctx.lineWidth = 0.7;
  if (building === "town") {
    polygon(ctx, [[6,17],[26,17],[26,27],[6,27]], "#babfaf");
    for (const [x, y] of [[5,15],[21,15],[13,9]]) {
      polygon(ctx, [[x,y],[x+6,y],[x+6,y+12],[x,y+12]], "#d9d8c2");
      polygon(ctx, [[x-1,y],[x+3,y-6],[x+7,y]], "#ae5b4e");
      ctx.fillStyle = "#3c5155";
      ctx.fillRect(x+2, y+3, 2, 3);
    }
    polygon(ctx, [[13,27],[13,22],[16,20],[19,22],[19,27]], "#30464b");
  } else {
    drawHouse(ctx, 5, 17);
    drawHouse(ctx, 18, 19);
  }
  line(ctx, [[3,4],[3,12]], "#e2dcb8");
  polygon(ctx, [[3,4],[7,5],[3,7]], factionColor || "#d9bf7b", "");
}

/**
 * 既存の地形・拠点データを正方形タイルとして描画する。
 * 拡大時のみ模様と建物を描き、全体表示では街を四角、村を丸に簡略化する。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} cell
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {boolean} detailed
 * @param {string} factionColor
 * @param {number} variant
 * @returns {void}
 */
export function drawMapTile(ctx, cell, x, y, size, detailed, factionColor, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 32, size / 32);
  ctx.beginPath(); ctx.rect(0, 0, 32, 32); ctx.clip();
  ctx.fillStyle = TERRAIN_COLORS[cell.terrain] || TERRAIN_COLORS.sea;
  ctx.fillRect(0, 0, 32, 32);
  const settlement = cell.building === "town" || cell.building === "village";
  if (detailed) {
    if (!settlement) drawTerrainPattern(ctx, cell.terrain, variant);
    else if (cell.settlement?.pirateHaven) drawPirateHarbor(ctx);
    else drawSettlement(ctx, cell.building, factionColor);
    ctx.lineWidth = 0.45;
    ctx.strokeStyle = "#b9d5d533";
    ctx.strokeRect(0.3, 0.3, 31.4, 31.4);
  } else if (settlement) {
    ctx.fillStyle = factionColor || "#f0dbb0";
    ctx.strokeStyle = "#f5eed2";
    ctx.lineWidth = 2;
    if (cell.settlement?.pirateHaven) {
      polygon(ctx, [[6,24],[26,24],[23,28],[9,28]], "#dbb98b", "#172333");
      line(ctx, [[14,5],[14,24]], "#f5eed2");
      polygon(ctx, [[15,5],[27,8],[15,15]], "#292b39", "#edb0a2");
    } else if (cell.building === "town") {
      ctx.fillRect(8,8,16,16); ctx.strokeRect(8,8,16,16);
    } else {
      ctx.beginPath(); ctx.arc(16,16,6,0,Math.PI*2); ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @returns {void} マスの内側に桟橋と黒旗の無法港を描く。 */
function drawPirateHarbor(ctx) {
  polygon(ctx, [[3,24],[29,24],[27,28],[5,28]], "#98724f", "#18313b");
  polygon(ctx, [[5,14],[15,14],[15,24],[5,24]], "#d0bd93", "#24313b");
  polygon(ctx, [[3,14],[10,7],[17,14]], "#5a5963", "#24313b");
  line(ctx, [[20,4],[20,24]], "#e4cfaa");
  polygon(ctx, [[21,4],[30,7],[28,14],[21,12]], "#242837", "#d9978d");
  ctx.fillStyle = "#eee0c5";
  ctx.beginPath(); ctx.arc(25,8,2,0,Math.PI*2); ctx.fill();
  line(ctx, [[24,11],[27,12]], "#eee0c5");
  line(ctx, [[9,27],[9,30]], "#decaa3");
  line(ctx, [[25,27],[25,30]], "#decaa3");
}

/**
 * 現在地の中央に海上では帆船、陸上では3人の部隊を枠なしで描く。
 * 街・村では建物を中央に残し、同じ部隊の図柄を縮小して左下に描く。
 * 部隊は暗い輪郭と明るい衣服で、地形の模様から区別する。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} cell
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @returns {void}
 */
export function drawMapPlayer(ctx, cell, x, y, size) {
  ctx.save(); ctx.translate(x,y); ctx.scale(size/32,size/32);
  if (cell.exploration) { ctx.translate(-1, 17); ctx.scale(0.48, 0.48); }
  ctx.lineWidth = 0.9;
  if (cell.terrain === "sea" || cell.terrain === "shoal") {
    if (cell.settlement?.pirateHaven) { ctx.translate(-1,17); ctx.scale(0.48,0.48); }
    polygon(ctx, [[7,23],[26,23],[22,28],[11,28]], "#dfdfcd", "#193d58");
    polygon(ctx, [[16,5],[16,21],[5,21]], "#f7f0d9", "#193d58");
    polygon(ctx, [[18,9],[25,20],[18,20]], "#d0e2e4", "#193d58");
    line(ctx, [[17,4],[17,24]], "#fff1c5");
  } else {
    if (cell.building === "town" || cell.building === "village") {
      ctx.translate(-1, 17);
      ctx.scale(0.48, 0.48);
    }
    ctx.fillStyle = "#152a3444";
    ctx.beginPath(); ctx.ellipse(16, 27, 11, 2, 0, 0, Math.PI * 2); ctx.fill();
    for (const [x, y, color] of [[9,16,"#d0e2e4"], [23,16,"#d0e2e4"], [16,13,"#f7f0d9"]]) {
      polygon(ctx, [[x-2,y+3],[x+2,y+3],[x+4,y+11],[x-4,y+11]], color, "#193d58");
      ctx.fillStyle = "#f7f0d9";
      ctx.strokeStyle = "#193d58";
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      line(ctx, [[x,y+7],[x,y+11]], "#718b91");
    }
  }
  ctx.restore();
}

/**
 * 自然探索地点を地形と同じ画風で描く。全体表示は種別記号に簡略化する。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @param {string} kind 種別。
 * @param {number} x 左端。
 * @param {number} y 上端。
 * @param {number} size マス幅。
 * @param {boolean} detailed 拡大表示か。
 * @returns {void}
 */
export function drawExplorationSite(ctx, kind, x, y, size, detailed) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 32, size / 32);
  ctx.lineWidth = detailed ? 1 : 2;
  if (!detailed) {
    polygon(ctx, [[16,4],[28,16],[16,28],[4,16]], kind === "wreck" ? "#e6b3a0" : "#e8d8b4", "#253547");
    if (kind === "wreck") line(ctx, [[10,19],[16,9],[22,19]], "#253547");
    else if (kind === "battlefield") line(ctx, [[10,10],[22,22],[16,16],[22,10],[10,22]], "#253547");
    else line(ctx, [[9,16],[23,16]], "#253547");
  } else if (kind === "wreck") {
    polygon(ctx, [[5,20],[15,22],[18,18],[27,21],[23,28],[17,25],[11,27]], "#ae7c52", "#223747");
    line(ctx, [[15,22],[20,6]], "#dfc295");
    polygon(ctx, [[20,7],[18,17],[23,14],[27,17],[24,8]], "#d9d7bd", "#29424d");
    line(ctx, [[8,24],[13,25]], "#eed1a0");
  } else if (kind === "battlefield") {
    line(ctx, [[12,24],[18,6]], "#e0c39e");
    polygon(ctx, [[18,6],[27,8],[23,11],[26,14],[16,12]], "#b7675c", "#283843");
    polygon(ctx, [[10,15],[20,17],[18,25],[14,28],[9,23]], "#bdc6c1", "#293e43");
    line(ctx, [[14,17],[14,24]], "#627c7d");
  } else {
    polygon(ctx, [[8,11],[23,9],[26,22],[11,25]], "#c99c68", "#243b43");
    line(ctx, [[8,11],[26,22],[23,9],[11,25]], "#6e503c");
    line(ctx, [[7,28],[17,27],[26,29]], "#8dc5cb");
  }
  ctx.restore();
}
/**
 * 海図地点を枠なしの紙片・祭壇・入り江・宝箱として描く。全体地図では輪郭を簡略化する。
 * @param {CanvasRenderingContext2D} ctx 描画先。 @param {string} kind 種類。
 * @param {number} x 左端。 @param {number} y 上端。 @param {number} size マス幅。
 * @param {boolean} detailed 拡大表示か。 @returns {void}
 */
export function drawChartSite(ctx, kind, x, y, size, detailed) {
  ctx.save(); ctx.translate(x + size / 2, y + size / 2); ctx.scale(size / 64, size / 64);
  ctx.lineWidth = detailed ? 2 : 4; ctx.strokeStyle = "#394439";
  ctx.shadowColor = "#0b182b"; ctx.shadowBlur = detailed ? 3 : 1;
  if (kind === "rumor") {
    ctx.fillStyle = "#e4d3a7";
    ctx.beginPath(); ctx.moveTo(-17, -21); ctx.lineTo(7, -22); ctx.lineTo(18, -9); ctx.lineTo(14, 21); ctx.lineTo(-18, 18); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#8b6648"; ctx.beginPath(); ctx.moveTo(-10, -9); ctx.lineTo(5, -6); ctx.lineTo(-4, 5); ctx.lineTo(8, 12); ctx.stroke();
    ctx.strokeStyle = "#a34c43"; ctx.beginPath(); ctx.moveTo(4, 8); ctx.lineTo(12, 16); ctx.moveTo(12, 8); ctx.lineTo(4, 16); ctx.stroke();
  } else if (kind === "altar") {
    ctx.fillStyle = "#a7b5a5"; ctx.fillRect(-21, 15, 42, 7); ctx.strokeRect(-21, 15, 42, 7);
    ctx.fillRect(-14, -9, 28, 24); ctx.strokeRect(-14, -9, 28, 24);
    ctx.fillStyle = "#cbd1b6"; ctx.fillRect(-20, -15, 40, 7); ctx.strokeRect(-20, -15, 40, 7);
    ctx.fillStyle = "#c0e3cf"; ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(7, -21); ctx.lineTo(0, -16); ctx.lineTo(-7, -21); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#627b70"; ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(5, 8); ctx.moveTo(5, -4); ctx.lineTo(-5, 8); ctx.stroke();
  } else if (kind === "inlet") {
    ctx.fillStyle = "#799679"; ctx.beginPath(); ctx.moveTo(-24, 20); ctx.lineTo(-23, -10); ctx.lineTo(-12, -25); ctx.lineTo(5, -26); ctx.lineTo(22, -12); ctx.lineTo(25, 20); ctx.lineTo(13, 17); ctx.lineTo(8, -7); ctx.lineTo(-7, -8); ctx.lineTo(-13, 18); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#b9dae0"; ctx.beginPath(); ctx.moveTo(-9, 12); ctx.lineTo(0, 16); ctx.lineTo(8, 12); ctx.moveTo(-9, 22); ctx.lineTo(0, 26); ctx.lineTo(8, 22); ctx.stroke();
  } else {
    ctx.fillStyle = "#916343"; ctx.fillRect(-21, -6, 42, 26); ctx.strokeRect(-21, -6, 42, 26);
    ctx.fillStyle = "#ba9157"; ctx.beginPath(); ctx.moveTo(-21, -6); ctx.quadraticCurveTo(-21, -25, 0, -25); ctx.quadraticCurveTo(21, -25, 21, -6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#e5d3a0"; ctx.fillRect(-13, -6, 4, 26); ctx.fillRect(9, -6, 4, 26); ctx.fillRect(-4, -8, 8, 12);
  }
  ctx.restore();
}
