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
    else drawSettlement(ctx, cell.building, factionColor);
    ctx.lineWidth = 0.45;
    ctx.strokeStyle = "#b9d5d533";
    ctx.strokeRect(0.3, 0.3, 31.4, 31.4);
  } else if (settlement) {
    ctx.fillStyle = factionColor || "#f0dbb0";
    ctx.strokeStyle = "#f5eed2";
    ctx.lineWidth = 2;
    if (cell.building === "town") {
      ctx.fillRect(8,8,16,16); ctx.strokeRect(8,8,16,16);
    } else {
      ctx.beginPath(); ctx.arc(16,16,6,0,Math.PI*2); ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
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
  ctx.lineWidth = 0.9;
  if (cell.terrain === "sea" || cell.terrain === "shoal") {
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
