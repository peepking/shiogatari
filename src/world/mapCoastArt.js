const COAST_RADIUS = 46;
const TILE_SIZE = 128;
const INLET_CORNERS = {
  tl: { start: [0, COAST_RADIUS], control: [0, 0], end: [COAST_RADIUS, 0] },
  tr: { start: [TILE_SIZE - COAST_RADIUS, 0], control: [TILE_SIZE, 0], end: [TILE_SIZE, COAST_RADIUS] },
  br: { start: [TILE_SIZE, TILE_SIZE - COAST_RADIUS], control: [TILE_SIZE, TILE_SIZE], end: [TILE_SIZE - COAST_RADIUS, TILE_SIZE] },
  bl: { start: [COAST_RADIUS, TILE_SIZE], control: [0, TILE_SIZE], end: [0, TILE_SIZE - COAST_RADIUS] },
};

/**
 * 海に面する二辺の交点だけを丸め、隣接する陸とはマス境界で接続する。
 * 描画用の輪郭だけを変更し、移動判定に使う地形は変更しない。
 * @param {CanvasRenderingContext2D} ctx 128単位へ変換済みの描画先。
 * @param {object} coast 海に面する上下左右の方向。
 * @returns {void}
 */
export function groundOutline(ctx, coast) {
  const tl = coast.north && coast.west ? COAST_RADIUS : 0;
  const tr = coast.north && coast.east ? COAST_RADIUS : 0;
  const br = coast.south && coast.east ? COAST_RADIUS : 0;
  const bl = coast.south && coast.west ? COAST_RADIUS : 0;
  ctx.beginPath();
  ctx.moveTo(tl, 0);
  ctx.lineTo(TILE_SIZE - tr, 0);
  ctx.quadraticCurveTo(TILE_SIZE, 0, TILE_SIZE, tr);
  ctx.lineTo(TILE_SIZE, TILE_SIZE - br);
  ctx.quadraticCurveTo(TILE_SIZE, TILE_SIZE, TILE_SIZE - br, TILE_SIZE);
  ctx.lineTo(bl, TILE_SIZE);
  ctx.quadraticCurveTo(0, TILE_SIZE, 0, TILE_SIZE - bl);
  ctx.lineTo(0, tl);
  ctx.quadraticCurveTo(0, 0, tl, 0);
  ctx.closePath();
}

/**
 * 波の淡い縁と砂浜を同じ輪郭へ重ね、色と太さを外角・内角で揃える。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @returns {void}
 */
function strokeShoreline(ctx) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#b9e3d94a";
  ctx.lineWidth = 12;
  ctx.stroke();
  ctx.strokeStyle = "#d8c798";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
}

/**
 * 海に接する辺だけに海岸線を描き、内角へ続く端は曲線の半径ぶん短くする。
 * 外角は上下左右の海判定、内角の端は各辺の両端に指定された判定を使う。
 * @param {CanvasRenderingContext2D} ctx 128単位へ変換済みの描画先。
 * @param {object} coast 海に面する方向と、短くする端の northWest 等の真偽値。
 * @returns {void}
 */
export function drawCoast(ctx, coast) {
  const tl = coast.north && coast.west;
  const tr = coast.north && coast.east;
  const br = coast.south && coast.east;
  const bl = coast.south && coast.west;
  ctx.beginPath();
  if (coast.north) {
    ctx.moveTo(tl || coast.northWest ? COAST_RADIUS : 0, 0);
    ctx.lineTo(TILE_SIZE - (tr || coast.northEast ? COAST_RADIUS : 0), 0);
    if (tr) ctx.quadraticCurveTo(TILE_SIZE, 0, TILE_SIZE, COAST_RADIUS);
  }
  if (coast.east) {
    ctx.moveTo(TILE_SIZE, tr || coast.eastNorth ? COAST_RADIUS : 0);
    ctx.lineTo(TILE_SIZE, TILE_SIZE - (br || coast.eastSouth ? COAST_RADIUS : 0));
    if (br) ctx.quadraticCurveTo(TILE_SIZE, TILE_SIZE, TILE_SIZE - COAST_RADIUS, TILE_SIZE);
  }
  if (coast.south) {
    ctx.moveTo(TILE_SIZE - (br || coast.southEast ? COAST_RADIUS : 0), TILE_SIZE);
    ctx.lineTo(bl || coast.southWest ? COAST_RADIUS : 0, TILE_SIZE);
    if (bl) ctx.quadraticCurveTo(0, TILE_SIZE, 0, TILE_SIZE - COAST_RADIUS);
  }
  if (coast.west) {
    ctx.moveTo(0, TILE_SIZE - (bl || coast.westSouth ? COAST_RADIUS : 0));
    ctx.lineTo(0, tl || coast.westNorth ? COAST_RADIUS : 0);
    if (tl) ctx.quadraticCurveTo(0, 0, COAST_RADIUS, 0);
  }
  strokeShoreline(ctx);
}

/**
 * 水マスの隅へ陸を延長する小さな領域を作り、入り江の直角を丸める。
 * @param {CanvasRenderingContext2D} ctx 128単位へ変換済みの描画先。
 * @param {string} corner 対象の隅。tl・tr・bl・br。
 * @returns {void}
 */
export function inletCornerOutline(ctx, corner) {
  const shape = INLET_CORNERS[corner];
  if (!shape) return;
  ctx.beginPath();
  ctx.moveTo(...shape.start);
  ctx.quadraticCurveTo(...shape.control, ...shape.end);
  ctx.lineTo(...shape.control);
  ctx.closePath();
}

/**
 * 入り江の曲線だけに海岸線を描き、隣接する陸との直線部分には縁を付けない。
 * @param {CanvasRenderingContext2D} ctx 128単位へ変換済みの描画先。
 * @param {string} corner 対象の隅。tl・tr・bl・br。
 * @returns {void}
 */
export function drawInletCoast(ctx, corner) {
  const shape = INLET_CORNERS[corner];
  if (!shape) return;
  ctx.beginPath();
  ctx.moveTo(...shape.start);
  ctx.quadraticCurveTo(...shape.control, ...shape.end);
  strokeShoreline(ctx);
}
