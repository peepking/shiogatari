/* eslint-env node */
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

/**
 * セル内の不透明な輪郭を実測し、生成時の微小な透過ハローを切り出し範囲へ含めない。
 * アルファ128以上の全画素を囲むため、離れた武具や波も欠落させない。
 * @param {string} source 原画。
 * @param {number[]} cell セルの位置と大きさ。
 * @returns {Promise<number[]>} 原画内の切り出し範囲。
 */
async function measureBounds(source, cell) {
  const [left, top, width, height] = cell;
  const { data, info } = await sharp(source).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * info.channels + 3] < 128) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (maxX < 0) throw new Error(`図柄がありません: ${source}`);
  return [left + minX, top + minY, maxX - minX + 1, maxY - minY + 1];
}

/**
 * 既存の承認済み図柄は色・透過・画素寸法を変えず、新しい原画だけを最近傍で収める。
 * 配置は指定順の等間隔セルとし、全図柄の範囲を別記録へ出力する。
 * @param {object} atlas アトラスの出力指定。
 * @returns {Promise<object>} 図柄ごとの実測範囲。
 */
async function packAtlas(atlas) {
  const pixels = Buffer.alloc(atlas.width * atlas.height * 4), bounds = {};
  const cellWidth = atlas.width / atlas.columns, cellHeight = atlas.height / atlas.rows;
  for (const [index, item] of atlas.icons.entries()) {
    const source = path.resolve(item.source);
    const sourceBounds = item.bounds || await measureBounds(source, item.cell);
    const [left, top, width, height] = sourceBounds;
    let crop = await sharp(source).extract({ left, top, width, height }).png().toBuffer();
    if (!item.preserve) crop = await sharp(crop).resize(atlas.maxSize, atlas.maxSize, { fit: "inside", kernel: "nearest" }).png().toBuffer();
    const metadata = await sharp(crop).metadata();
    const x = index % atlas.columns * cellWidth + Math.floor((cellWidth - metadata.width) / 2);
    const y = Math.floor(index / atlas.columns) * cellHeight + Math.floor((cellHeight - metadata.height) / 2);
    const retained = await sharp(crop).ensureAlpha().raw().toBuffer();
    for (let row = 0; row < metadata.height; row++) {
      const start = row * metadata.width * 4;
      retained.copy(pixels, ((y + row) * atlas.width + x) * 4, start, start + metadata.width * 4);
    }
    bounds[item.kind] = [x, y, metadata.width, metadata.height];
    if (item.preserve) {
      const original = await sharp(source).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer();
      if (!original.equals(retained)) throw new Error(`保持図柄の画素が変化しました: ${item.kind}`);
    }
  }
  await sharp(pixels, { raw: { width: atlas.width, height: atlas.height, channels: 4 } }).png().toFile(atlas.output);
  return bounds;
}

/** @returns {Promise<void>} 保存した制作指定から本番の二枚と切り出し記録を再現する。 */
async function main() {
  const config = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
  const result = {};
  for (const atlas of config.atlases) result[atlas.output] = await packAtlas(atlas);
  await fs.writeFile(config.boundsOutput, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
}

/** @param {Error} error 失敗内容。 @returns {void} 処理失敗を呼び出し元へ伝える。 */
function reportFailure(error) { console.error(error); process.exitCode = 1; }
main().catch(reportFailure);
