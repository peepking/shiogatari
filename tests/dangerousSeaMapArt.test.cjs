/* eslint-env node */
const assert = require("node:assert/strict");
const vm = require("node:vm");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { readSource } = require("./helpers/source.cjs");

/** @returns {object} 描画状態・切り抜き・画像合成を記録する描画先。 */
function makeContext() {
  const calls = [], operations = [], strokes = [], stack = [];
  let points = [];
  return {
    calls, operations, strokes, globalAlpha: 1, globalCompositeOperation: "source-over",
    /** @returns {number} 保存状態の残数。 */
    get depth() { return stack.length; },
    /** @returns {void} 次のマスへ持ち越してはいけない描画状態を保存する。 */
    save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); operations.push(["save"]); },
    /** @returns {void} 保存状態を復元する。 */
    restore() { assert.ok(stack.length > 0); Object.assign(this, stack.pop()); operations.push(["restore"]); },
    /** @param {number[]} args 平行移動量。 @returns {void} 描画位置を記録する。 */
    translate(...args) { operations.push(["translate", ...args]); },
    /** @param {number[]} args 拡大率。 @returns {void} 縮尺を記録する。 */
    scale(...args) { operations.push(["scale", ...args]); },
    /** @param {number[]} args 矩形。 @returns {void} 切り抜き範囲を記録する。 */
    rect(...args) { operations.push(["rect", ...args]); },
    /** @returns {void} 切り抜きを記録する。 */
    clip() { operations.push(["clip"]); },
    /** @returns {void} 曲線の記録を始める。 */
    beginPath() { points = []; },
    /** @param {number[]} args 開始点。 @returns {void} 曲線の開始を記録する。 */
    moveTo(...args) { points.push(args); },
    /** @param {number[]} args 制御点と終点。 @returns {void} 潮流の曲線を記録する。 */
    bezierCurveTo(...args) { points.push(args); },
    /** @returns {void} 波の色と形を記録する。 */
    stroke() { strokes.push({ color: this.strokeStyle, points: [...points] }); },
    /** @param {number[]} args 矩形。 @returns {void} 下地と合成の塗りを記録する。 */
    fillRect(...args) { operations.push(["fillRect", this.globalCompositeOperation, this.fillStyle, ...args]); },
    /** @param {Array} args 原画と描画範囲。 @returns {void} 画像の参照と合成方法を記録する。 */
    drawImage(...args) { calls.push(args); operations.push(["drawImage", this.globalCompositeOperation, this.globalAlpha]); },
    /** @param {number} width 幅。 @param {number} height 高さ。 @returns {object} 透過マスクの画素。 */
    createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
    /** @param {object} pixels 画素。 @returns {void} マスクの実際の透過値を保持する。 */
    putImageData(pixels) { this.pixels = pixels.data; },
    /** @returns {object} 継ぎ目合成の濃淡を記録する。 */
    createLinearGradient() {
      const stops = [];
      return {
        stops,
        /** @param {number} offset 位置。 @param {string} color 色。 @returns {void} 濃淡の設定を記録する。 */
        addColorStop(offset, color) { stops.push([offset, color]); },
      };
    },
  };
}

/** @returns {object} 描画面と実際の画素を保持する仮の文書。 */
function makeDocument() {
  const canvases = [];
  return {
    canvases,
    /** @param {string} tag 要素名。 @returns {object} 原画の接続と透過範囲を検証する描画面。 */
    createElement(tag) {
      assert.equal(tag, "canvas");
      const painter = makeContext();
      const canvas = {
        painter,
        /** @param {string} kind 描画方式。 @returns {object} 同じ描画先を返す。 */
        getContext(kind) { assert.equal(kind, "2d"); return painter; },
      };
      canvases.push(canvas);
      return canvas;
    },
  };
}

/** @returns {Promise<object>} 実装の三モジュールと、読み込み結果を操作できる画像環境。 */
async function loadArt() {
  const images = [], document = makeDocument();
  class MockImage {
    /** @returns {void} 新しい画像要求を記録する。 */
    constructor() { images.push(this); this.naturalWidth = 1774; this.naturalHeight = 887; }
  }
  const context = vm.createContext({ Image: MockImage, URL, document });
  const modules = new Map();
  for (const [file, directory] of [["mapAssets.js", "world"], ["dangerousSeaSurface.js", "dangerousSeas"], ["dangerousSeaMapArt.js", "dangerousSeas"]]) {
    modules.set(file, new vm.SourceTextModule(readSource(file), {
      context,
      /** @param {object} meta モジュールの場所。 @returns {void} ブラウザと同じ画像相対パスを使う。 */
      initializeImportMeta(meta) { meta.url = pathToFileURL(path.resolve(__dirname, "../src", directory, file)).href; },
    }));
  }
  const art = modules.get("dangerousSeaMapArt.js");
  await art.link(specifier => modules.get(path.basename(specifier)));
  await art.evaluate();
  return { context, document, images, tile: art.namespace.drawDangerousSeaTile, surface: modules.get("dangerousSeaSurface.js").namespace, assets: modules.get("mapAssets.js").namespace };
}

/** @param {object} art 描画環境。 @param {object} sea 海域。 @param {number} size 幅。 @param {object} [options] 描画条件。 @returns {object} 描画先と合成済みの海面。 */
function drawTile(art, sea, size, options = {}) {
  const ctx = makeContext();
  art.tile(ctx, sea, 17, 23, size, { gx: 2, gy: 3, ...options });
  return { ctx, layer: ctx.calls.at(-1)?.[0] };
}

/** @returns {void} 区域外の透明化と核心・外縁の実画素の接続を確認する。 */
function verifyRegionalMasks() {
  const document = makeDocument(), context = vm.createContext({ document, masks: new Map() });
  const source = readSource("dangerousSeaMapArt.js"), start = source.indexOf("function regionalMask(");
  vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
  const mask = vm.runInContext("regionalMask", context);
  const core = Object.freeze({ regionId: "sw", level: "core" }), fringe = Object.freeze({ regionId: "sw", level: "fringe" });
  const coreNeighbors = Object.freeze([core, fringe, core, core]);
  const fringeNeighbors = Object.freeze([core, fringe, fringe, fringe]);
  const before = JSON.stringify([core, fringe, coreNeighbors, fringeNeighbors]);
  const coreMask = mask(core, coreNeighbors), fringeMask = mask(fringe, fringeNeighbors);
  /** @param {object} canvas マスク。 @param {number} x 横。 @param {number} y 縦。 @returns {number} 実際の透過値。 */
  const alpha = (canvas, x, y) => canvas.painter.pixels[(y * 64 + x) * 4 + 3];
  for (let x = 0; x < 64; x++) assert.equal(alpha(coreMask, x, 63), alpha(fringeMask, x, 0), "核心と外縁の共有辺を同じ濃さにつなぐ");
  assert.equal(alpha(coreMask, 32, 32), Math.round(0.92 * 255));
  assert.equal(alpha(fringeMask, 32, 32), Math.round(0.58 * 255));
  assert.ok(alpha(coreMask, 32, 32) > alpha(fringeMask, 32, 32), "核心中央を外縁より荒くする");
  assert.equal(mask(core, coreNeighbors), coreMask, "同じ接続の透過範囲を再利用する");
  const outside = mask(core, [null, null, null, { regionId: "se", level: "core" }]);
  for (let i = 0; i < 64; i++) {
    for (const [x, y] of [[i, 0], [i, 63], [0, i], [63, i]]) assert.equal(alpha(outside, x, y), 0, "区域外や別海域へ波を漏らさない");
  }
  assert.ok(alpha(outside, 32, 32) > 0, "区域の中央は残す");
  assert.equal(JSON.stringify([core, fringe, coreNeighbors, fringeNeighbors]), before, "描画は海域と隣接条件を変更しない");
}

/** @param {object} art 読み込み済みの描画環境。 @returns {void} 地域・濃さ・縮尺・隣接条件による合成を確認する。 */
function verifyTiles(art) {
  for (const regionId of ["sw", "se"]) for (const level of ["fringe", "core"]) {
    const sea = Object.freeze({ regionId, level });
    for (const size of [14, 700 / 19, 700 / 9]) {
      const { ctx, layer } = drawTile(art, sea, size);
      assert.deepEqual(ctx.operations.slice(0, 5), [["save"], ["translate", 17, 23], ["scale", size / 128, size / 128], ["rect", 0, 0, 128, 128], ["clip"]]);
      assert.equal(ctx.operations.at(-1)[0], "restore");
      assert.equal(ctx.depth, 0, `${regionId}/${level}/${size}の切り抜きと縮尺を復元する`);
      assert.equal(ctx.globalAlpha, 1);
      assert.equal(ctx.globalCompositeOperation, "source-over");
      assert.equal(layer.width, 128); assert.equal(layer.height, 128);
      assert.equal(layer.painter.operations.at(-1)[1], "destination-in", "最後に海域の透過範囲を適用する");
      if (size === 14) {
        assert.ok(layer.painter.strokes.length > 0, "全体地図では専用の波形を残す");
        const base = layer.painter.operations.find(operation => operation[0] === "fillRect");
        assert.equal(base[2], regionId === "sw" ? "#244638" : "#303857", "簡易表示でも南西の緑灰と南東の紫藍を区別する");
      } else assert.equal(layer.painter.strokes.length, 0, "詳細地図では原画の連続した荒海を使う");
    }
  }
  const sea = { regionId: "sw", level: "core" }, first = drawTile(art, sea, 700 / 19).layer;
  assert.equal(drawTile(art, sea, 700 / 19).layer, first, "同じ海面は合成済み画像を再利用する");
  assert.equal(drawTile(art, sea, 700 / 9).layer, first, "二つの詳細縮尺で同じ海面を共有する");
  for (const [changedSea, options, size] of [[{ regionId: "se", level: "core" }, {}, 700 / 19], [{ regionId: "sw", level: "fringe" }, {}, 700 / 19], [sea, { gx: 3 }, 700 / 19], [sea, { gy: 2 }, 700 / 19], [sea, { seaAt: () => null }, 700 / 19], [sea, {}, 14]]) {
    assert.notEqual(drawTile(art, changedSea, size, options).layer, first, "地域・濃さ・世界座標・隣接条件・簡易表示を混ぜない");
  }
  const a = makeContext(), b = makeContext(), alternate = makeContext();
  art.surface.drawDangerousSeaSurface(a, "sw", 2, 3);
  art.surface.drawDangerousSeaSurface(b, "sw", 6, 7);
  art.surface.drawDangerousSeaSurface(alternate, "se", 2, 3);
  assert.equal(a.calls[0][0], b.calls[0][0], "同じ地域の繰り返し面を再利用する");
  assert.deepEqual(a.calls[0].slice(1), b.calls[0].slice(1), "海面模様を世界座標の四マス周期で揃える");
  assert.notEqual(a.calls[0][0], alternate.calls[0][0], "二地域の原画を分けて保持する");
  const stormTint = a.calls[0][0].painter.operations.filter(operation => operation[0] === "fillRect" && operation[1] === "color");
  assert.deepEqual(stormTint, [["fillRect", "color", "#47745b", 0, 0, 512, 512]], "南西の色合いだけを一度変換して白波の明暗を保つ");
  assert.equal(a.calls[0][0].painter.globalCompositeOperation, "source-over", "色合成を次の描画へ持ち越さない");
  assert.equal(alternate.calls[0][0].painter.operations.some(operation => operation[0] === "fillRect" && operation[1] === "color"), false, "南東の原画には南西の緑灰を混ぜない");
  const cutouts = art.document.canvases.flatMap(canvas => canvas.painter.calls).filter(call => call[0] === art.images[0]);
  assert.deepEqual(cutouts.map(call => call.slice(1, 5)).sort((left, right) => left[0] - right[0]), [[0, 0, 887, 887], [887, 0, 887, 887]], "実寸の左右二面を一度ずつ切り出す");
}

/** @returns {Promise<void>} 独立読み込み・代替表示・透過境界・合成の再利用を検証する。 */
async function main() {
  const art = await loadArt();
  assert.equal(art.images.length, 0, "モジュールを読むだけでは画像を要求しない");
  for (const sea of [null, { regionId: "unknown", level: "core" }]) {
    const { ctx } = drawTile(art, sea, 14);
    assert.equal(ctx.operations.length, 0, "危険海域でないマスには描画しない");
  }
  assert.equal(art.images.length, 0);
  const sea = { regionId: "sw", level: "core" };
  let readyCount = 0;
  /** @returns {void} 再描画の重複を数える。 */
  const onReady = () => { readyCount++; };
  const pending = drawTile(art, sea, 700 / 19, { onReady });
  const pendingAgain = drawTile(art, sea, 700 / 19, { onReady });
  assert.notEqual(pending.layer, pendingAgain.layer, "画像待機中の詳細代替を固定しない");
  assert.ok(pending.layer.painter.strokes.length > 0, "画像待機中も荒波を描く");
  for (let i = 0; i < 5; i++) art.surface.prepareDangerousSeaSurface(onReady);
  assert.equal(art.images.length, 1, "荒海だけを一枚遅延要求する");
  assert.match(art.images[0].src, /\/image\/map\/dangerous-seas\.png$/);
  assert.equal(art.assets.mapAssetsReady(), false, "通常三枚の要求や完了を荒海に連動させない");
  assert.equal(readyCount, 0);
  art.images[0].onload();
  assert.equal(readyCount, 1, "同じ再描画を一度だけ呼ぶ");
  art.surface.prepareDangerousSeaSurface(onReady);
  assert.equal(art.images.length, 1, "完了後は追加要求しない");
  assert.equal(readyCount, 1, "完了後の登録では再描画しない");
  const ready = drawTile(art, sea, 700 / 19);
  assert.notEqual(ready.layer, pending.layer, "画像完了後は待機中の代替を置き換える");
  assert.equal(ready.layer.painter.strokes.length, 0);
  verifyTiles(art);
  art.assets.prepareMapAssets();
  assert.equal(art.images.length, 4, "通常の三枚は別の操作で要求する");
  assert.deepEqual(art.images.slice(1).map(image => path.basename(new URL(image.src).pathname)).sort(), ["events.png", "sprites.png", "terrain.png"]);
  for (const image of art.images.slice(1)) image.onload();
  assert.equal(art.assets.mapAssetsReady(), true);
  assert.equal(drawTile(art, sea, 700 / 19).layer, ready.layer, "通常素材の完了は荒海の再合成を起こさない");
  const failed = await loadArt();
  let failedCount = 0;
  /** @returns {void} 失敗時の再描画を数える。 */
  const onFailed = () => { failedCount++; };
  for (let i = 0; i < 4; i++) failed.surface.prepareDangerousSeaSurface(onFailed);
  failed.images[0].onerror();
  assert.equal(failedCount, 1);
  failed.surface.prepareDangerousSeaSurface(onFailed);
  assert.equal(failed.images.length, 1, "失敗した原画は再要求しない");
  assert.equal(failed.surface.drawDangerousSeaSurface(makeContext(), "sw", 0, 0, onFailed), false);
  for (const regionId of ["sw", "se"]) for (const size of [14, 700 / 19, 700 / 9]) {
    const { ctx, layer } = drawTile(failed, { regionId, level: "core" }, size, { onReady: onFailed });
    assert.ok(layer.painter.strokes.length > 0, "原画の失敗後も各縮尺で地域の波形を残す");
    assert.equal(ctx.depth, 0);
  }
  assert.equal(failed.images.length, 1); assert.equal(failedCount, 1);
  verifyRegionalMasks();
  console.log("荒海の独立読み込み・二地域三縮尺・透過境界・核心濃淡・画像失敗の代替・合成再利用: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
