import { PIXEL_SPRITES, PIXEL_EVENT_SPRITES, PIXEL_SPRITE_ATLAS_SIZE, PIXEL_EVENT_ATLAS_SIZE, PIXEL_PARTY_SPRITE, PIXEL_PARTY_ATLAS_SIZE } from "./mapSpriteBounds.js";

/** 地図専用の画像。UIの画像とは分け、四枚が揃ってから同時に切り替える。 */
const assets = {
  sprites: { file: "sprites-pixel.png?v=20261011-map-sprite-redraw", image: null, status: "idle" },
  terrain: { file: "terrain-pixel.png", image: null, status: "idle" },
  events: { file: "events-pixel.png?v=20261011-map-sprite-redraw", image: null, status: "idle" },
  party: { file: "party-norse-pixel.png", image: null, status: "idle" },
};
const listeners = new Set();
const terrainSurfaces = new Map();
const spriteSurfaces = new Map();

/** 四列六段の原画から測った図柄の範囲。配置のずれや隣の影を切り出さないよう個別に指定する。 */
const SPRITES = PIXEL_SPRITES;
/** 三列一段の追加原画から測った、危険海域の出来事ごとの範囲。 */
const EVENT_SPRITES = PIXEL_EVENT_SPRITES;
const TEXTURES = { sea: [0, 0], shoal: [1, 0], plain: [2, 0], forest: [0, 1], mountain: [1, 1], deck: [2, 1] };

/** @returns {boolean} 地形・地点・出来事・陸の一行の画像がすべて利用できるか。 */
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
 * 図柄は長辺40画素で再利用し、拡大時の補間を止めてユニットと近い粒度を保つ。
 * @param {CanvasRenderingContext2D} ctx 描画先。
 * @param {string} kind 図柄。
 * @param {number} x 左端。
 * @param {number} y 上端。
 * @param {number} size 幅。
 * @returns {boolean} 画像で描画できたか。
 */
export function drawMapSprite(ctx, kind, x, y, size) {
  const event = EVENT_SPRITES[kind];
  const party = kind === "party";
  const bounds = party ? PIXEL_PARTY_SPRITE : event || SPRITES[kind];
  if (!mapAssetsReady() || !bounds) return false;
  const image = assets[party ? "party" : event ? "events" : "sprites"].image;
  const [left, top, width, height] = bounds;
  const factor = size * 0.9 / Math.max(width, height);
  const drawWidth = width * factor, drawHeight = height * factor;
  const [atlasWidth, atlasHeight] = party ? PIXEL_PARTY_ATLAS_SIZE : event ? PIXEL_EVENT_ATLAS_SIZE : PIXEL_SPRITE_ATLAS_SIZE;
  const scaleX = image.naturalWidth / atlasWidth, scaleY = image.naturalHeight / atlasHeight;
  let surface = spriteSurfaces.get(kind);
  if (!surface && typeof document !== "undefined") {
    surface = makeSurface(Math.max(1, Math.round(width / Math.max(width, height) * 40)), Math.max(1, Math.round(height / Math.max(width, height) * 40)));
    const painter = surface.getContext("2d");
    painter.imageSmoothingEnabled = false;
    painter.drawImage(image, left * scaleX, top * scaleY, width * scaleX, height * scaleY, 0, 0, surface.width, surface.height);
    spriteSurfaces.set(kind, surface);
  }
  ctx.save(); ctx.imageSmoothingEnabled = false;
  if (surface) ctx.drawImage(surface, x + (size - drawWidth) / 2, y + (size - drawHeight) / 2, drawWidth, drawHeight);
  else ctx.drawImage(image, left * scaleX, top * scaleY, width * scaleX, height * scaleY,
    x + (size - drawWidth) / 2, y + (size - drawHeight) / 2, drawWidth, drawHeight);
  ctx.restore();
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
 * 一マス32画素の色面で継ぎ目を合わせ、拡大時は補間せず輪郭を保つ。
 * 海岸の曲線や水深マスクにはこの縮小を適用せず、接続の滑らかさを残す。
 * @param {HTMLImageElement} image 原画。 @param {number} column 列。 @param {number} row 行。
 * @param {number} columns 列数。 @param {number} rows 行数。
 * @returns {HTMLCanvasElement|null} 繰り返し用の描画面。
 */
export function makeRepeatingMapTexture(image, column, row, columns, rows) {
  if (typeof document === "undefined") return null;
  const original = makeSurface(128, 128), surface = makeSurface(128, 128);
  original.getContext("2d").drawImage(image, column * image.naturalWidth / columns, row * image.naturalHeight / rows,
    image.naturalWidth / columns, image.naturalHeight / rows, 0, 0, 128, 128);
  const target = surface.getContext("2d"); target.drawImage(original, 0, 0);
  for (const vertical of [false, true]) {
    if (vertical) original.getContext("2d").drawImage(surface, 0, 0);
    for (const end of [false, true]) {
      const strip = makeSurface(vertical ? 128 : 16, vertical ? 16 : 128);
      const painter = strip.getContext("2d");
      painter.save(); painter.scale(vertical ? 1 : -1, vertical ? -1 : 1);
      painter.drawImage(original, vertical ? 0 : end ? 0 : 112, vertical ? end ? 0 : 112 : 0,
        strip.width, strip.height, vertical ? 0 : -16, vertical ? -16 : 0, strip.width, strip.height);
      painter.restore();
      const fade = painter.createLinearGradient(0, 0, vertical ? 0 : 16, vertical ? 16 : 0);
      fade.addColorStop(0, end ? "#ffffff00" : "#ffffff80");
      fade.addColorStop(1, end ? "#ffffff80" : "#ffffff00");
      painter.globalCompositeOperation = "destination-in"; painter.fillStyle = fade;
      painter.fillRect(0, 0, strip.width, strip.height);
      target.drawImage(strip, vertical ? 0 : end ? 112 : 0, vertical ? end ? 112 : 0 : 0);
    }
  }
  const enlarged = makeSurface(512, 512), painter = enlarged.getContext("2d");
  painter.imageSmoothingEnabled = false;
  painter.drawImage(surface, 0, 0, 512, 512);
  return enlarged;
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
  ctx.save(); ctx.imageSmoothingEnabled = false;
  if (surface) ctx.drawImage(surface, -x * 128, -y * 128, 512, 512);
  else ctx.drawImage(image, column * width, row * height, width, height, -x * 128, -y * 128, 512, 512);
  ctx.restore();
}
