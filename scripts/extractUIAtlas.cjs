/* eslint-env node */
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

/**
 * 透過で分かれた図柄の範囲を調べ、生成時にずれたセルの切り出し位置を確認する。
 * @param {string} source アトラスのパス。
 * @returns {Promise<void>}
 */
async function inspectAtlas(source) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const visited = new Uint8Array(info.width * info.height);
  const queue = new Int32Array(visited.length);
  const parts = [];
  for (let start = 0; start < visited.length; start++) {
    if (visited[start] || data[start * 4 + 3] < 100) continue;
    let head = 0, tail = 1, left = info.width, top = info.height, right = 0, bottom = 0;
    queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const point = queue[head++], x = point % info.width, y = Math.floor(point / info.width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * info.width + nx;
        if (nx < 0 || nx >= info.width || ny < 0 || ny >= info.height || visited[next] || data[next * 4 + 3] < 100) continue;
        visited[next] = 1; queue[tail++] = next;
      }
    }
    if (tail > 300) parts.push({ pixels: tail, bounds: [left, top, right - left + 1, bottom - top + 1] });
  }
  console.log(JSON.stringify({ width: info.width, height: info.height, parts }, null, 2));
}

/**
 * 切り出し内で最も大きい図柄だけを残し、隣セルから入り込んだ独立した画素を除く。
 * アルファが0より大きい画素を8近傍でまとめ、最多画素の領域を選ぶ。同数なら先に見つけた領域を優先する。
 * 選んだ領域の色とアルファはそのまま保持し、それ以外を透過にする。
 * @param {Buffer} crop 切り出した透過PNG。
 * @returns {Promise<Buffer>} 図柄を分離した透過PNG。
 */
async function isolateCrop(crop) {
  const { data, info } = await sharp(crop).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const labels = new Uint32Array(info.width * info.height);
  const queue = new Int32Array(labels.length);
  let label = 0, largestLabel = 0, largestSize = 0;
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || data[start * 4 + 3] === 0) continue;
    label++;
    let head = 0, tail = 1;
    queue[0] = start; labels[start] = label;
    while (head < tail) {
      const point = queue[head++], x = point % info.width, y = Math.floor(point / info.width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * info.width + nx;
        if (nx < 0 || nx >= info.width || ny < 0 || ny >= info.height || labels[next] || data[next * 4 + 3] === 0) continue;
        labels[next] = label; queue[tail++] = next;
      }
    }
    if (tail > largestSize) { largestLabel = label; largestSize = tail; }
  }
  for (let point = 0; point < labels.length; point++) {
    if (labels[point] !== largestLabel) data.fill(0, point * 4, point * 4 + 4);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/**
 * 生成済みアトラスの指定範囲を切り出し、透過付きの表示素材にする。保持指定では切り出し画素をそのまま埋め込む。
 * @param {object} config アトラスと出力の指定。
 * @returns {Promise<void>}
 */
async function extractAtlas(config) {
  const source = path.resolve(config.atlas);
  const metadata = await sharp(source).metadata();
  for (const icon of config.icons) {
    const column = icon.cell % config.columns;
    const row = Math.floor(icon.cell / config.columns);
    const left = Math.round(column * metadata.width / config.columns);
    const top = Math.round(row * metadata.height / config.rows);
    const bounds = icon.bounds || [left, top,
      Math.round((column + 1) * metadata.width / config.columns) - left,
      Math.round((row + 1) * metadata.height / config.rows) - top];
    const [width, height] = icon.size || [128, 128];
    const padding = icon.padding ?? 8;
    let crop = await sharp(source)
      .extract({ left: bounds[0], top: bounds[1], width: bounds[2], height: bounds[3] }).png().toBuffer();
    if (icon.isolate) crop = await isolateCrop(crop);
    const png = icon.preserve ? crop : await sharp(crop)
      .trim()
      .resize(width - padding * 2, height - padding * 2, {
        fit: "contain", kernel: "nearest", background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .extend({ top: padding, bottom: padding, left: padding, right: padding,
        background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
    const output = path.resolve(icon.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    if (output.endsWith(".svg")) {
      const [viewWidth, viewHeight] = icon.viewBox || [24, 24];
      const clip = icon.clip === "circle"
        ? `<defs><clipPath id="art"><ellipse cx="${viewWidth / 2}" cy="${viewHeight / 2}" rx="${viewWidth * .44}" ry="${viewHeight * .44}"/></clipPath></defs>` : "";
      await fs.writeFile(output, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} ${viewHeight}">${clip}<image width="${viewWidth}" height="${viewHeight}"${clip ? ' clip-path="url(#art)"' : ""} href="data:image/png;base64,${png.toString("base64")}"/></svg>\n`, "utf8");
    } else {
      await fs.writeFile(output, png);
    }
    console.log(icon.output);
  }
}

/** @returns {Promise<void>} 指定した記録から切り出しを再現する。 */
async function main() {
  if (process.argv[2] === "--inspect") return inspectAtlas(process.argv[3]);
  const config = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
  await extractAtlas(config);
}

/** @param {Error} error 失敗の内容。 @returns {void} 失敗を終了コードへ反映する。 */
function reportFailure(error) { console.error(error); process.exitCode = 1; }
main().catch(reportFailure);
