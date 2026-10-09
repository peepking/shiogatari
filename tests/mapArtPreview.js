import { drawMapTile, drawMapPlayer, drawExplorationSite, drawChartSite } from "../src/world/mapArt.js";
import { mapAssetsReady } from "../src/world/mapAssets.js";
import { drawIllustratedSite, drawIllustratedPin } from "../src/world/mapSymbolArt.js";
import { drawBountySite } from "../src/bounty/bountyMapArt.js";
import { drawDangerousSeaTile } from "../src/dangerousSeas/dangerousSeaMapArt.js";
import { drawDangerousSeaEvent } from "../src/dangerousSeas/dangerousSeaEventMapArt.js";
import { drawPirateStorySite } from "../src/pirates/pirateKingMapArt.js";
import { drawBattleTerrain } from "../src/battle/battleTerrainArt.js";

const terrainKeys = { s: "sea", h: "shoal", p: "plain", f: "forest", m: "mountain" };
const rows = ["ffmmphsss", "fmmpphsss", "fmpphhsss", "ffpphssss", "ppphhssss", "pphhsssss", "phhssshph", "hhsssshpf", "sssssshhh"];
const grid = rows.map(row => [...row].map(key => ({ terrain: terrainKeys[key], building: "none" })));
grid[1][3].building = "village";
grid[4][2].building = "town";
grid[6][7] = { terrain: "shoal", building: "village", settlement: { pirateHaven: true } };
const symbols = [
  ["town", "街"], ["village", "村"], ["pirateHarbor", "無法港"], ["ship", "帆船"],
  ["party", "部隊"], ["wreck", "難破船"], ["crate", "漂流物"], ["battlefield", "戦場跡"],
  ["rumor", "海図"], ["altar", "祭壇"], ["inlet", "入り江"], ["treasure", "宝箱"],
  ["bounty", "賞金首"], ["pirateLord", "五列強"], ["pirateKing", "海賊王"], ["fish", "魚群"],
  ["bell", "海底の鐘"], ["event", "出来事"], ["star", "依頼ピン"], ["shield", "防衛ピン"],
];
const coverage = [
  { type: "terrain", kind: "sea", label: "深海" },
  { type: "terrain", kind: "shoal", label: "浅瀬" },
  { type: "terrain", kind: "plain", label: "平原" },
  { type: "terrain", kind: "forest", label: "森" },
  { type: "terrain", kind: "mountain", label: "山" },
  { type: "terrain", kind: "deck", label: "甲板" },
  { type: "settlement", kind: "town", label: "街", terrain: "plain" },
  { type: "settlement", kind: "village", label: "村", terrain: "plain" },
  { type: "settlement", kind: "pirateHarbor", label: "無法港" },
  { type: "player", kind: "ship", label: "帆船" },
  { type: "player", kind: "party", label: "部隊", terrain: "plain" },
  { type: "exploration", kind: "wreck", label: "難破船" },
  { type: "exploration", kind: "drift", label: "漂流物" },
  { type: "exploration", kind: "battlefield", label: "戦場跡", terrain: "plain" },
  { type: "chart", kind: "rumor", label: "海図の噂" },
  { type: "chart", kind: "altar", label: "祭壇" },
  { type: "chart", kind: "inlet", label: "入り江" },
  { type: "chart", kind: "treasure", label: "宝箱" },
  { type: "bounty", kind: "bounty", label: "賞金首" },
  { type: "story", kind: "pirateLord", label: "五列強" },
  { type: "story", kind: "pirateKing", label: "海賊王" },
  { type: "event", kind: "fish_migration", label: "巨大魚の回遊" },
  { type: "event", kind: "seabed_bell", label: "海底からの鐘" },
  { type: "event", kind: "storm_aftermath", label: "嵐の置き土産" },
  { type: "event", kind: "fog_light", label: "霧中の灯火" },
  { type: "event", kind: "sinking_treasure", label: "沈みかけた宝船" },
  { type: "pin", kind: "star", label: "討伐・賞金首ピン" },
  { type: "pin", kind: "shield", label: "防衛ピン" },
  { type: "pin", kind: "triangle", label: "移動ピン" },
  { type: "pin", kind: "dot", label: "配達ピン" },
];

/**
 * 三つの島を持つ確認用の50×50地形を座標から固定生成する。
 * 乱数は使わず、同じ座標には常に同じ地形を置く。
 * @returns {Array<Array<object>>} 全体表示用の地形。
 */
function createOverviewGrid() {
  const islands = [[12, 13, 10, 11], [37, 11, 8, 8], [28, 36, 17, 10]];
  const world = [];
  for (let y = 0; y < 50; y++) {
    const row = [];
    for (let x = 0; x < 50; x++) {
      const distance = Math.min(...islands.map(([cx, cy, rx, ry]) => Math.hypot((x - cx) / rx, (y - cy) / ry)));
      const edge = distance + Math.sin(x * 0.8 + y * 0.5) * 0.035;
      let terrain = edge > 1.14 ? "sea" : edge > 0.93 ? "shoal" : "plain";
      if (edge < 0.76 && (x * 7 + y * 11) % 8 < 3) terrain = "forest";
      if (edge < 0.48 && (x * 3 + y * 5) % 7 < 3) terrain = "mountain";
      row.push({ terrain, building: "none" });
    }
    world.push(row);
  }
  for (const [x, y, building] of [[7, 10, "town"], [16, 14, "village"], [36, 7, "town"], [40, 14, "village"], [20, 34, "town"], [34, 38, "village"]]) {
    world[y][x] = { terrain: "plain", building };
  }
  world[24][44] = { terrain: "shoal", building: "town", settlement: { pirateHaven: true } };
  return world;
}

const overviewGrid = createOverviewGrid();

/**
 * 2×2マスの一角だけが海になるL字陸地を回転し、海岸の両側の角を固定配置する。
 * @param {number} rotation 時計回りの回転数。
 * @returns {Array<Array<object>>} 四方を海に囲まれたL字の島。
 */
function createCoastCornerGrid(rotation) {
  const world = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ({ terrain: "sea", building: "none" })));
  for (const point of [[1, 1], [2, 1], [1, 2]]) {
    let [x, y] = point;
    for (let turn = 0; turn < rotation; turn++) [x, y] = [3 - y, x];
    world[y][x].terrain = "plain";
  }
  return world;
}

/**
 * 1マスの島を同じ水深、または左右で異なる水深の水面で囲む。
 * @param {string} terrain 島の地形。
 * @param {string} building 島の建物。
 * @param {string} water 周囲の水面の種類。
 * @returns {Array<Array<object>>} 孤島を中央に置いた3×3マス。
 */
function createIslandWaterGrid(terrain, building, water) {
  const world = Array.from({ length: 3 }, (_, y) => Array.from({ length: 3 }, (_, x) => ({
    terrain: water === "mixed" ? (x > 1 || (x === 1 && y === 0) ? "shoal" : "sea") : water,
    building: "none",
  })));
  world[1][1] = { terrain, building };
  return world;
}

const coastCornerGrids = [0, 1, 2, 3].map(createCoastCornerGrid);
const islandWaterKinds = [
  { terrain: "plain", building: "village", label: "村" },
  { terrain: "plain", building: "town", label: "街" },
  { terrain: "plain", building: "none", label: "平原" },
  { terrain: "forest", building: "none", label: "森" },
  { terrain: "mountain", building: "none", label: "山" },
];
const islandWaterSamples = ["sea", "shoal", "mixed"].map(water => islandWaterKinds.map(kind => createIslandWaterGrid(kind.terrain, kind.building, water)));

/**
 * 水上拠点とL字甲板を配置し、陸地の海岸線が誤って適用されないことを確認する。
 * @param {string} kind 水上構造物の種類。
 * @param {string} water 周囲の水面の種類。
 * @returns {Array<Array<object>>} 構造物を置いた4×4マス。
 */
function createWaterStructureGrid(kind, water) {
  const world = Array.from({ length: 4 }, () => Array.from({ length: 4 }, (_, x) => ({
    terrain: water === "mixed" ? (x > 1 ? "shoal" : "sea") : water,
    building: "none",
  })));
  if (kind === "pirateHarbor") {
    world[1][1] = { terrain: water, building: "town", settlement: { pirateHaven: true } };
  } else {
    for (const [x, y] of [[1, 1], [2, 1], [1, 2]]) world[y][x].terrain = "deck";
  }
  return world;
}

const waterStructureSamples = [
  { label: "無法港・海", world: createWaterStructureGrid("pirateHarbor", "sea") },
  { label: "無法港・浅瀬", world: createWaterStructureGrid("pirateHarbor", "shoal") },
  { label: "甲板・海", world: createWaterStructureGrid("deck", "sea") },
  { label: "甲板・混在", world: createWaterStructureGrid("deck", "mixed") },
];

/**
 * ゲームと同じ地形描画へ周囲のマスを渡し、詳細と簡易表示を同じ条件で確認する。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @param {Array<Array<object>>} world 確認する地形。
 * @param {number} left 左端。
 * @param {number} top 上端。
 * @param {number} size 1マスの幅。
 * @returns {void}
 */
function drawCoastSample(ctx, world, left, top, size) {
  for (let y = 0; y < world.length; y++) for (let x = 0; x < world[y].length; x++) {
    drawMapTile(ctx, world[y][x], left + x * size, top + y * size, size, size > 14, "#75b9d7", 0, { gx: x, gy: y, grid: world, onReady: renderPreview });
  }
}

/** @returns {void} 内側の角の四方向と、全地形の孤島を三種類の周囲の水面で比較する。 */
function renderCoastChanges() {
  const corners = document.getElementById("previewCoastCorners").getContext("2d");
  corners.clearRect(0, 0, 1080, 234);
  corners.fillStyle = "#eee3c6"; corners.font = "14px system-ui";
  for (const [index, world] of coastCornerGrids.entries()) {
    const left = index * 270;
    corners.fillText(["右下が海", "左下が海", "左上が海", "右上が海"][index], left + 2, 17);
    drawCoastSample(corners, world, left + 2, 30, 48);
    drawCoastSample(corners, world, left + 206, 30, 14);
  }
  const islands = document.getElementById("previewIslandWater").getContext("2d");
  islands.clearRect(0, 0, 1080, 552);
  islands.fillStyle = "#eee3c6"; islands.font = "14px system-ui";
  for (const [row, samples] of islandWaterSamples.entries()) for (const [column, world] of samples.entries()) {
    const left = column * 216, top = row * 184;
    islands.fillText(`${islandWaterKinds[column].label}・${["海", "浅瀬", "混在"][row]}`, left + 2, top + 17);
    drawCoastSample(islands, world, left + 2, top + 30, 48);
    drawCoastSample(islands, world, left + 158, top + 30, 14);
  }
  const structures = document.getElementById("previewWaterStructures").getContext("2d");
  structures.clearRect(0, 0, 1080, 234);
  structures.fillStyle = "#eee3c6"; structures.font = "14px system-ui";
  for (const [index, { label, world }] of waterStructureSamples.entries()) {
    const left = index * 270;
    structures.fillText(label, left + 2, 17);
    drawCoastSample(structures, world, left + 2, 30, 48);
    drawCoastSample(structures, world, left + 206, 30, 14);
  }
}

/**
 * 戦闘の甲板二列と、浅瀬・深海が入り組む海面を固定生成する。
 * 乱数を使わず座標の周期で水深を決め、単独の深海と連続した境界の両方を含める。
 * @returns {Array<Array<string>>} 戦闘用の文字列地形。
 */
function createBattlePreviewGrid() {
  return Array.from({ length: 17 }, (_, y) => Array.from({ length: 17 }, (_, x) => {
    if (x < 2 || x > 14) return "deck";
    return (x * 7 + y * 11) % 13 < 4 || (x + y) % 9 === 0 ? "sea" : "shoal";
  }));
}

const battlePreviewGrid = createBattlePreviewGrid();
const roughSeaGrid = Array.from({ length: 7 }, (_, y) => Array.from({ length: 7 }, (_, x) => ({
  terrain: x + y < 2 ? "shoal" : "sea", building: "none",
})));
roughSeaGrid[3][2] = { terrain: "sea", building: "village", settlement: { pirateHaven: true } };

/**
 * 左上の通常海から右下の核心へ、同じ位置関係で危険度を高める。
 * 範囲外は通常海とし、海域の外縁のなめらかな接続も確認する。
 * @param {string} regionId 危険海域の種類。
 * @param {{x:number,y:number}} position マス座標。
 * @returns {object|null} 海域属性。
 */
function previewSeaAt(regionId, { x, y }) {
  if (x < 0 || y < 0 || x > 6 || y > 6 || x + y < 3) return null;
  return { regionId, level: x + y > 6 ? "core" : "outer" };
}

/** @param {{x:number,y:number}} position マス座標。 @returns {object|null} 南西の海域属性。 */
function southwestSeaAt(position) {
  return previewSeaAt("sw", position);
}

/** @param {{x:number,y:number}} position マス座標。 @returns {object|null} 南東の海域属性。 */
function southeastSeaAt(position) {
  return previewSeaAt("se", position);
}

/** @param {{x:number,y:number}} position マス座標。 @returns {object|null} 全体表示の海域属性。 */
function overviewSeaAt({ x, y }) {
  if (!overviewGrid[y]?.[x] || !["sea", "shoal"].includes(overviewGrid[y][x].terrain) || y <= 30 || (x >= 11 && x <= 44)) return null;
  return { regionId: x < 11 ? "sw" : "se", level: y > 39 ? "core" : "outer" };
}

/** @param {{x:number,y:number}} position マス座標。 @returns {object|null} 拡大地図の海域属性。 */
function detailSeaAt({ x, y }) {
  if (!grid[y]?.[x] || x <= 6 || y <= 6 || !["sea", "shoal"].includes(grid[y][x].terrain)) return null;
  return { regionId: "se", level: "core" };
}

/**
 * 本番と同じく地形の後・建物の前に荒海を描き、無法港の背景と隣接水面をつなぐ。
 * @param {CanvasRenderingContext2D} ctx マス内の座標へ変換済みの描画先。
 * @param {number} units マス内の座標の一辺。
 * @param {object} options 海域・世界座標・縮尺・再描画関数。
 * @returns {void}
 */
function drawPreviewSeaSurface(ctx, units, options) {
  drawDangerousSeaTile(ctx, options.sea, 0, 0, units, options);
}

/**
 * 危険海域の水面を詳細と全体表示の実寸で描き、主要な地点とピンを重ねる。
 * @param {string} id 描画先の識別子。
 * @param {Function} seaAt マス座標から危険海域を得る関数。
 * @param {number} size マス幅。
 * @returns {void}
 */
function renderRoughSeaSample(id, seaAt, size) {
  const ctx = document.getElementById(id).getContext("2d");
  const detailed = size > 14;
  ctx.clearRect(0, 0, size * 7, size * 7);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    drawMapTile(ctx, roughSeaGrid[y][x], x * size, y * size, size, detailed, null, 0, {
      gx: x, gy: y, grid: roughSeaGrid, onReady: renderPreview,
      drawSurface: drawPreviewSeaSurface, sea: seaAt({ x, y }), seaAt, detailed,
    });
  }
  drawChartSite(ctx, "rumor", size, size * 3, size - 1, detailed);
  drawExplorationSite(ctx, "wreck", size * 3, size * 2, size - 1, detailed);
  drawDangerousSeaEvent(ctx, { kind: "seabed_bell" }, size * 5, size * 5, size - 1, detailed);
  drawMapPlayer(ctx, roughSeaGrid[4][4], size * 4, size * 4, size - 1, detailed);
  ctx.strokeStyle = "#e8efff"; ctx.lineWidth = detailed ? 2 : 1.2;
  ctx.strokeRect(size * 4 + 0.7, size * 4 + 0.7, size - 1.4, size - 1.4);
  drawIllustratedPin(ctx, { shape: "star", color: "#ff9b3a" }, size * 5.5, size * 1.5, size * 0.24, detailed);
}

/** @returns {void} 戦闘と危険海域に共通する本番の描画処理を確認する。 */
function renderSeaChanges() {
  renderRoughSeaSample("previewSouthwestSea", southwestSeaAt, 64);
  renderRoughSeaSample("previewSoutheastSea", southeastSeaAt, 64);
  renderRoughSeaSample("previewSouthwestSeaMini", southwestSeaAt, 14);
  renderRoughSeaSample("previewSoutheastSeaMini", southeastSeaAt, 14);
  const ctx = document.getElementById("previewBattleSea").getContext("2d");
  ctx.clearRect(0, 0, 544, 544);
  drawBattleTerrain(ctx, battlePreviewGrid, 32, renderPreview);
}

/**
 * 各種類を実際の公開描画関数で描く。詳細と簡易の双方で同じ分類を使う。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @param {object} symbol 種類と背景。
 * @param {number} x 左端。
 * @param {number} y 上端。
 * @param {number} size マス幅。
 * @param {boolean} detailed 詳細表示か。
 * @param {boolean} [background=true] 比較欄の地形も描くか。
 * @returns {void}
 */
function drawPreviewSymbol(ctx, symbol, x, y, size, detailed, background = true) {
  const cell = { terrain: symbol.terrain || "sea", building: "none" };
  if (symbol.type === "terrain") cell.terrain = symbol.kind;
  if (symbol.type === "settlement") {
    cell.building = symbol.kind === "pirateHarbor" ? "town" : symbol.kind;
    if (symbol.kind === "pirateHarbor") cell.settlement = { pirateHaven: true };
  }
  if (background) drawMapTile(ctx, cell, x, y, size, detailed, "#75b9d7", 0);
  if (symbol.type === "player") drawMapPlayer(ctx, cell, x, y, size, detailed);
  if (symbol.type === "exploration") drawExplorationSite(ctx, symbol.kind, x, y, size, detailed);
  if (symbol.type === "chart") drawChartSite(ctx, symbol.kind, x, y, size, detailed);
  if (symbol.type === "bounty") drawBountySite(ctx, x, y, size, detailed);
  if (symbol.type === "story") drawPirateStorySite(ctx, { id: symbol.kind === "pirateKing" ? "olav" : "lord" }, x, y, size, detailed);
  if (symbol.type === "event") drawDangerousSeaEvent(ctx, { kind: symbol.kind }, x, y, size, detailed);
  if (symbol.type === "pin") {
    const colors = { star: "#e69745", shield: "#e3a39a", triangle: "#ff66b3", dot: "#977bd3" };
    drawIllustratedPin(ctx, { shape: symbol.kind, color: colors[symbol.kind], defenderColor: "#75b9d7" }, x + size / 2, y + size / 2, size * (detailed ? 0.28 : 0.24), detailed);
  }
}

/** @returns {void} 50×50マスを実寸で描き、すべての地点・ピンと重複する現在地を確認する。 */
function renderOverview() {
  const ctx = document.getElementById("previewOverview").getContext("2d");
  ctx.clearRect(0, 0, 700, 700);
  for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) {
    drawMapTile(ctx, overviewGrid[y][x], x * 14, y * 14, 14, false, "#75b9d7", (x * 7 + y * 11) % 3 === 0 ? 1 : 0, {
      gx: x, gy: y, grid: overviewGrid, onReady: renderPreview,
      drawSurface: drawPreviewSeaSurface, sea: overviewSeaAt({ x, y }), seaAt: overviewSeaAt, detailed: false,
    });
  }
  const sites = coverage.filter(symbol => ["exploration", "chart", "bounty", "story", "event", "pin"].includes(symbol.type));
  const positions = [[5,26],[10,26],[18,34],[15,26],[20,26],[25,26],[30,26],[35,26],[40,26],[45,26],
    [5,32],[9,36],[5,40],[9,44],[45,39],[36,7],[40,14],[20,34],[34,38]];
  for (const [index, symbol] of sites.entries()) {
    const [x, y] = positions[index];
    drawPreviewSymbol(ctx, symbol, x * 14, y * 14, 13, false, false);
  }
  for (const [x, y, crowded] of [[25, 17, false], [12, 14, false], [44, 24, true], [7, 10, true]]) {
    drawMapPlayer(ctx, { ...overviewGrid[y][x], exploration: crowded }, x * 14, y * 14, 13, false);
    ctx.strokeStyle = "#e8efff"; ctx.lineWidth = 1.2;
    ctx.strokeRect(x * 14 + 0.6, y * 14 + 0.6, 12, 12);
  }
}

/** @returns {void} 三十種類を詳細・13pxの実寸簡易・同じ画素の4倍拡大で比較する。 */
function renderCoverage() {
  const ctx = document.getElementById("previewCoverage").getContext("2d");
  ctx.clearRect(0, 0, 1120, 1236);
  ctx.textAlign = "center"; ctx.font = "12px system-ui"; ctx.fillStyle = "#aabdd0";
  for (let column = 0; column < 4; column++) {
    const x = column * 280;
    ctx.fillText("詳細", x + 52, 21); ctx.fillText("簡易・13px", x + 143, 21); ctx.fillText("簡易・4倍", x + 227, 21);
  }
  const sample = document.createElement("canvas"); sample.width = 13; sample.height = 13;
  const painter = sample.getContext("2d");
  for (const [index, symbol] of coverage.entries()) {
    const x = index % 4 * 280, y = 36 + Math.floor(index / 4) * 150;
    ctx.fillStyle = "#162439"; ctx.fillRect(x + 1, y, 270, 140);
    ctx.fillStyle = "#eee3c6"; ctx.font = "14px system-ui"; ctx.textAlign = "left";
    ctx.fillText(symbol.label, x + 10, y + 22);
    drawPreviewSymbol(ctx, symbol, x + 10, y + 39, 84, true);
    painter.clearRect(0, 0, 13, 13); drawPreviewSymbol(painter, symbol, 0, 0, 13, false);
    ctx.drawImage(sample, x + 137, y + 75);
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sample, x + 201, y + 55, 52, 52); ctx.restore();
  }
}

/** @returns {void} 実際の描画関数で地形・海岸・現在地・地点を確認する。 */
function renderPreview() {
  renderCoastChanges();
  renderSeaChanges();
  const ctx = document.getElementById("previewMap").getContext("2d");
  ctx.clearRect(0, 0, 720, 720);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    drawMapTile(ctx, grid[y][x], x * 80, y * 80, 80, true, "#75b9d7", (x + y) % 3 === 0 ? 1 : 0, {
      gx: x, gy: y, grid, onReady: renderPreview,
      drawSurface: drawPreviewSeaSurface, sea: detailSeaAt({ x, y }), seaAt: detailSeaAt, detailed: true,
    });
  }
  drawExplorationSite(ctx, "wreck", 7 * 80, 3 * 80, 80, true);
  drawExplorationSite(ctx, "drift", 6 * 80, 0, 80, true);
  drawChartSite(ctx, "altar", 2 * 80, 7 * 80, 80, true);
  drawBountySite(ctx, 0, 5 * 80, 80);
  drawMapPlayer(ctx, grid[4][5], 5 * 80, 4 * 80, 80);
  ctx.lineWidth = 2; ctx.strokeStyle = "#e8efff"; ctx.strokeRect(5 * 80 + 1, 4 * 80 + 1, 78, 78);
  ctx.strokeStyle = "#ffd27a"; ctx.strokeRect(6 * 80 + 1, 2 * 80 + 1, 78, 78);
  const terrain = document.getElementById("previewTerrain").getContext("2d");
  terrain.clearRect(0, 0, 720, 112); terrain.textAlign = "center"; terrain.font = "16px system-ui";
  for (const [i, [key, label]] of [["sea", "深海"], ["shoal", "浅瀬"], ["plain", "平原"], ["forest", "森"], ["mountain", "山"], ["deck", "甲板"]].entries()) {
    drawMapTile(terrain, { terrain: key }, i * 120 + 15, 0, 86, true, null, 0);
    terrain.fillStyle = "#b8cadb"; terrain.fillText(label, i * 120 + 58, 108);
  }
  if (!mapAssetsReady()) return;
  renderOverview();
  renderCoverage();
  const gallery = document.getElementById("previewSymbols").getContext("2d");
  gallery.clearRect(0, 0, 480, 800); gallery.textAlign = "center"; gallery.font = "17px system-ui";
  for (const [i, [kind, label]] of symbols.entries()) {
    const x = (i % 4) * 120, y = Math.floor(i / 4) * 158;
    if (kind === "star" || kind === "shield") drawIllustratedPin(gallery, { shape: kind, color: "#d8b76e", defenderColor: "#75b9d7" }, x + 60, y + 59, 37);
    else drawIllustratedSite(gallery, kind, x + 4, y + 3, 112);
    gallery.fillStyle = "#b8cadb"; gallery.fillText(label, x + 60, y + 141);
  }
}

renderPreview();
