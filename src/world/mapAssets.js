/** 地図専用の画像。UIの画像とは分け、三枚が揃ってから同時に切り替える。 */
const assets = {
  sprites: { file: "sprites.png", image: null, status: "idle" },
  terrain: { file: "terrain.png", image: null, status: "idle" },
  events: { file: "events.png", image: null, status: "idle" },
};
const listeners = new Set();
const terrainSurfaces = new Map();

/** 四列六段の原画から測った図柄の範囲。配置のずれや隣の影を切り出さないよう個別に指定する。 */
const SPRITES = {
  town: [23, 60, 236, 213], village: [281, 58, 225, 214], pirateHarbor: [522, 40, 237, 238], ship: [790, 37, 214, 244],
  party: [33, 338, 205, 179], wreck: [264, 313, 245, 218], crate: [532, 374, 212, 145], battlefield: [778, 322, 218, 206],
  rumor: [28, 568, 228, 203], altar: [273, 576, 233, 201], inlet: [514, 580, 262, 192], treasure: [786, 586, 209, 183],
  bounty: [52, 799, 175, 213], pirateLord: [284, 808, 201, 215], pirateKing: [538, 790, 203, 235], fish: [782, 821, 211, 178],
  bell: [18, 1043, 239, 224], event: [310, 1074, 152, 158], star: [560, 1079, 159, 152], shield: [819, 1070, 143, 170],
  forest: [19, 1297, 244, 210], mountain: [264, 1305, 248, 207], forestAlt: [521, 1281, 243, 229], mountainAlt: [778, 1292, 228, 219],
};
/** 三列一段の追加原画から測った、危険海域の出来事ごとの範囲。 */
const EVENT_SPRITES = {
  storm: [23, 175, 683, 539],
  lantern: [761, 12, 609, 700],
  sinkingShip: [1451, 23, 698, 684],
};
const TEXTURES = { sea: [0, 0], shoal: [1, 0], plain: [2, 0], forest: [0, 1], mountain: [1, 1], deck: [2, 1] };

/** @returns {boolean} 地形・地点・出来事の画像がすべて利用できるか。 */
export function mapAssetsReady() {
  return Object.values(assets).every(asset => asset.status === "ready");
}

/** @returns {void} 読み込みが完了したら、登録済みの画面だけを一度再描画する。 */
function finishLoading() {
  if (Object.values(assets).some(asset => asset.status === "loading" || asset.status === "idle")) return;
  const callbacks = [...listeners];
  listeners.clear();
  for (const callback of callbacks) callback();
}

/**
 * 画像は初回だけ読み込み、同じ再描画関数の登録はまとめる。
 * 失敗した画像は再要求せず、従来の図形描画で地図の操作を続けられるようにする。
 * @param {Function} [onReady] 読み込み後の再描画。
 * @returns {void}
 */
export function prepareMapAssets(onReady) {
  if (typeof Image === "undefined" || mapAssetsReady()) return;
  if (onReady && Object.values(assets).some(asset => asset.status === "idle" || asset.status === "loading")) listeners.add(onReady);
  for (const asset of Object.values(assets)) {
    if (asset.status !== "idle") continue;
    asset.status = "loading";
    asset.image = new Image();
    asset.image.onload = () => { asset.status = "ready"; finishLoading(); };
    asset.image.onerror = () => { asset.status = "failed"; finishLoading(); };
    asset.image.src = new URL(`../../image/map/${asset.file}`, import.meta.url).href;
  }
}

/**
 * 図柄の実測範囲だけを切り出し、縦横比を保って指定マスの中央に収める。
 * 余白を揃えるため長辺をマス幅の九割とし、図柄が変わっても隣のマスへはみ出さない。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @param {string} kind 図柄。
 * @param {number} x 左端。
 * @param {number} y 上端。
 * @param {number} size 幅。
 * @returns {boolean} 画像で描画できたか。
 */
export function drawMapSprite(ctx, kind, x, y, size) {
  const event = EVENT_SPRITES[kind];
  const bounds = event || SPRITES[kind];
  if (!mapAssetsReady() || !bounds) return false;
  const image = assets[event ? "events" : "sprites"].image;
  const [left, top, width, height] = bounds;
  const factor = size * 0.9 / Math.max(width, height);
  const drawWidth = width * factor, drawHeight = height * factor;
  const scaleX = image.naturalWidth / (event ? 2172 : 1024), scaleY = image.naturalHeight / (event ? 724 : 1536);
  ctx.drawImage(image, left * scaleX, top * scaleY, width * scaleX, height * scaleY,
    x + (size - drawWidth) / 2, y + (size - drawHeight) / 2, drawWidth, drawHeight);
  return true;
}

/** @param {number} width 幅。 @param {number} height 高さ。 @returns {HTMLCanvasElement} 素材を合成する描画面。 */
function makeSurface(width, height) {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  return canvas;
}

/**
 * 模様の両端を薄く重ねて、繰り返しの境界に直線が出るのを防ぐ。
 * 左右を先に合わせ、その結果を上下で合わせるため四隅の色も連続する。
 * 元のPNGは変更せず、通常の地形と危険海域で同じ継ぎ目処理を使う。
 * @param {HTMLImageElement} image 原画。 @param {number} column 列。 @param {number} row 行。
 * @param {number} columns 列数。 @param {number} rows 行数。
 * @returns {HTMLCanvasElement|null} 繰り返し用の描画面。
 */
export function makeRepeatingMapTexture(image, column, row, columns, rows) {
  if (typeof document === "undefined") return null;
  const original = makeSurface(512, 512), surface = makeSurface(512, 512);
  original.getContext("2d").drawImage(image, column * image.naturalWidth / columns, row * image.naturalHeight / rows,
    image.naturalWidth / columns, image.naturalHeight / rows, 0, 0, 512, 512);
  const target = surface.getContext("2d"); target.drawImage(original, 0, 0);
  for (const vertical of [false, true]) {
    if (vertical) original.getContext("2d").drawImage(surface, 0, 0);
    for (const end of [false, true]) {
      const strip = makeSurface(vertical ? 512 : 64, vertical ? 64 : 512);
      const painter = strip.getContext("2d");
      painter.save(); painter.scale(vertical ? 1 : -1, vertical ? -1 : 1);
      painter.drawImage(original, vertical ? 0 : end ? 0 : 448, vertical ? end ? 0 : 448 : 0,
        strip.width, strip.height, vertical ? 0 : -64, vertical ? -64 : 0, strip.width, strip.height);
      painter.restore();
      const fade = painter.createLinearGradient(0, 0, vertical ? 0 : 64, vertical ? 64 : 0);
      fade.addColorStop(0, end ? "#ffffff00" : "#ffffff80");
      fade.addColorStop(1, end ? "#ffffff80" : "#ffffff00");
      painter.globalCompositeOperation = "destination-in"; painter.fillStyle = fade;
      painter.fillRect(0, 0, strip.width, strip.height);
      target.drawImage(strip, vertical ? 0 : end ? 448 : 0, vertical ? end ? 448 : 0 : 0);
    }
  }
  return surface;
}

/** @param {string} terrain 地形。 @returns {HTMLCanvasElement|null} 六種類の地形の繰り返し面を再利用する。 */
function terrainSurface(terrain) {
  if (typeof document === "undefined") return null;
  if (terrainSurfaces.has(terrain)) return terrainSurfaces.get(terrain);
  const [column, row] = TEXTURES[terrain] || TEXTURES.sea;
  const surface = makeRepeatingMapTexture(assets.terrain.image, column, row, 3, 2);
  terrainSurfaces.set(terrain, surface);
  return surface;
}

/**
 * 地形の模様を世界座標に合わせて四マス周期で描く。
 * マスごとに同じ画像を縮小しないため、隣接する同じ地形の模様が連続する。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @param {string} terrain 地形。
 * @param {number} gx 世界の横座標。
 * @param {number} gy 世界の縦座標。
 * @returns {void}
 */
export function drawTerrainTexture(ctx, terrain, gx, gy) {
  const image = assets.terrain.image;
  const [column, row] = TEXTURES[terrain] || TEXTURES.sea;
  const width = image.naturalWidth / 3, height = image.naturalHeight / 2;
  const x = ((gx % 4) + 4) % 4, y = ((gy % 4) + 4) % 4;
  const surface = terrainSurface(terrain);
  if (surface) ctx.drawImage(surface, -x * 128, -y * 128, 512, 512);
  else ctx.drawImage(image, column * width, row * height, width, height, -x * 128, -y * 128, 512, 512);
}
