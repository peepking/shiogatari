/* eslint-env node */
const assert = require("node:assert/strict");
const vm = require("node:vm");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { readSource } = require("./helpers/source.cjs");

const SPRITE_KINDS = ["town", "village", "pirateHarbor", "ship", "party", "wreck", "crate", "battlefield", "rumor", "altar", "inlet", "treasure", "bounty", "pirateLord", "pirateKing", "fish", "bell", "event", "star", "shield", "forest", "mountain", "forestAlt", "mountainAlt", "storm", "lantern", "sinkingShip"];
const SITE_KINDS = ["wreck", "crate", "battlefield", "rumor", "altar", "inlet", "treasure", "bounty", "pirateLord", "pirateKing", "fish", "bell", "event", "storm", "lantern", "sinkingShip"];

/** @returns {Promise<object>} 読み込み順と画像失敗を操作できる描画環境を作る。 */
async function loadArt() {
  const images = [];
  class MockImage {
    /** @returns {void} 実際の画像と同じ切り出し寸法を保持する。 */
    constructor() {
      images.push(this);
      [this.naturalWidth, this.naturalHeight] = [[1024, 1536], [1536, 1024], [2172, 724]][images.length - 1];
    }
  }
  const context = vm.createContext({ Image: MockImage, URL });
  const assets = new vm.SourceTextModule(readSource("mapAssets.js"), {
    context,
    /** @param {object} meta モジュールの参照先。 @returns {void} ブラウザと同じ画像相対パスを検証する。 */
    initializeImportMeta(meta) { meta.url = pathToFileURL(path.resolve(__dirname, "../src/world/mapAssets.js")).href; },
  });
  const modules = new Map([["mapAssets.js", assets]]);
  for (const file of ["mapOverviewArt.js", "mapCoastArt.js", "mapWaterArt.js", "mapTerrainArt.js", "mapSymbolArt.js", "mapArt.js", "bountyMapArt.js", "pirateKingMapArt.js", "dangerousSeaEventConfig.js", "dangerousSeaEventMapArt.js", "mapViewport.js"]) {
    modules.set(file, new vm.SourceTextModule(readSource(file), { context }));
  }
  for (const module of modules.values()) {
    if (module.status === "unlinked") await module.link(specifier => modules.get(path.basename(specifier)));
    if (module.status === "linked") await module.evaluate();
  }
  return {
    context, images, assets: assets.namespace,
    terrain: modules.get("mapTerrainArt.js").namespace, symbols: modules.get("mapSymbolArt.js").namespace,
    water: modules.get("mapWaterArt.js").namespace,
    map: modules.get("mapArt.js").namespace, bounty: modules.get("bountyMapArt.js").namespace,
    story: modules.get("pirateKingMapArt.js").namespace, events: modules.get("dangerousSeaEventMapArt.js").namespace,
    viewport: modules.get("mapViewport.js").namespace,
  };
}

/** @returns {object} 保存復元・画像の切り出し・海岸の線を記録する描画先。 */
function makeContext() {
  const calls = [], strokes = [], shapes = [];
  let depth = 0, points = [];
  /** @returns {void} 検証対象外の描画操作を受け取る。 */
  const noop = () => {};
  return {
    calls, strokes, shapes, globalAlpha: 1, globalCompositeOperation: "source-over",
    /** @returns {number} 保存状態の残数。 */
    get depth() { return depth; },
    /** @returns {void} 描画状態を保存する。 */
    save() { depth++; },
    /** @returns {void} 描画状態を復元する。 */
    restore() { assert.ok(depth > 0); depth--; },
    translate: noop, scale: noop, rect: noop, clip: noop, closePath: noop, ellipse: noop, setTransform: noop, clearRect: noop,
    /** @param {number[]} args 矩形。 @returns {void} 地形の塗りを記録する。 */
    fillRect(...args) { shapes.push(["fillRect", this.fillStyle, ...args]); },
    /** @param {number[]} args 矩形。 @returns {void} 矩形の輪郭を記録する。 */
    strokeRect(...args) { shapes.push(["strokeRect", this.strokeStyle, ...args]); },
    /** @returns {void} 新しい輪郭の記録を始める。 */
    beginPath() { points = []; },
    /** @param {number[]} args 座標。 @returns {void} 開始点を記録する。 */
    moveTo(...args) { points.push(args); },
    /** @param {number[]} args 座標。 @returns {void} 線分を記録する。 */
    lineTo(...args) { points.push(args); },
    /** @param {number[]} args 制御点と終点。 @returns {void} 曲線を記録する。 */
    quadraticCurveTo(...args) { points.push(args); },
    /** @param {number[]} args 中心と半径。 @returns {void} 円の輪郭を記録する。 */
    arc(...args) { points.push(args); },
    /** @returns {void} 輪郭の塗りを記録する。 */
    fill() { shapes.push(["fill", this.fillStyle, [...points]]); },
    /** @returns {void} 輪郭と線の色を記録する。 */
    stroke() { strokes.push({ color: this.strokeStyle, points: [...points] }); shapes.push(["stroke", this.strokeStyle, [...points]]); },
    /** @param {Array} args 切り出しと描画位置。 @returns {void} 画像描画を記録する。 */
    drawImage(...args) { calls.push(args); },
    /** @returns {object} 描画環境に依存しないグラデーション。 */
    createLinearGradient() { return { addColorStop: noop }; },
  };
}

/** @param {object[][]} grid 地形配列。 @param {number} x 横座標。 @param {number} y 縦座標。 @returns {object} 八方向の隣接マス。 */
function neighborsAt(grid, x, y) {
  return {
    north: grid[y - 1]?.[x], south: grid[y + 1]?.[x], west: grid[y]?.[x - 1], east: grid[y]?.[x + 1],
    northwest: grid[y - 1]?.[x - 1], northeast: grid[y - 1]?.[x + 1], southwest: grid[y + 1]?.[x - 1], southeast: grid[y + 1]?.[x + 1],
  };
}

/** @returns {void} 深海・浅瀬・小島の共有辺と四隅を、実際に生成した透過画素で検証する。 */
function verifyWaterMasks() {
  const context = vm.createContext({
    document: {
      /** @returns {object} 透過マスクの画素を保持する描画面。 */
      createElement() {
        const surface = {};
        surface.getContext = () => ({
          /** @param {number} width 幅。 @param {number} height 高さ。 @returns {object} 画素配列。 */
          createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
          /** @param {object} pixels 画素。 @returns {void} 透過マスクを記録する。 */
          putImageData(pixels) { surface.pixels = pixels.data; },
        });
        return surface;
      },
    },
  });
  const source = readSource("mapWaterArt.js").replace(/^import .*;$/gm, "").replace(/^export /gm, "");
  vm.runInContext(source, context);
  const sea = { terrain: "sea" }, shoal = { terrain: "shoal" }, land = { terrain: "plain" };
  const sides = ["north", "south", "west", "east", "northwest", "northeast", "southwest", "southeast"];
  for (const [terrain, cell, alpha] of [["sea", sea, 0], ["shoal", shoal, 255], ["plain", sea, 0], ["plain", shoal, 255]]) {
    const field = context.waterDepthField(terrain, Object.fromEntries(sides.map(side => [side, cell])));
    const mask = context.waterMask(field);
    for (let offset = 0; offset < mask.pixels.length; offset += 4) {
      assert.deepEqual(Array.from(mask.pixels.slice(offset, offset + 4)), [255, 255, 255, alpha], `${terrain}と周囲の${cell.terrain}に合う水深色を使う`);
    }
    assert.equal(context.waterMask(field), mask, "同じ九点の水深分布は透過マスクを再利用する");
  }
  const grid = [
    [sea, shoal, land, sea, sea], [sea, land, shoal, sea, shoal],
    [shoal, sea, land, shoal, sea], [sea, shoal, sea, land, shoal], [land, sea, shoal, sea, sea],
  ];
  const masks = grid.map((row, y) => row.map((cell, x) => context.waterMask(context.waterDepthField(cell.terrain, neighborsAt(grid, x, y)))));
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
    const center = masks[y][x];
    for (let offset = 0; offset < 64; offset++) {
      if (x + 1 < grid[y].length && (grid[y][x] !== land || grid[y][x + 1] !== land)) {
        assert.equal(center.pixels[(offset * 64 + 63) * 4 + 3], masks[y][x + 1].pixels[offset * 64 * 4 + 3], "海・浅瀬・島の左右の共有辺を四隅まで同じ濃さにする");
      }
      if (y + 1 < grid.length && (grid[y][x] !== land || grid[y + 1][x] !== land)) {
        assert.equal(center.pixels[(63 * 64 + offset) * 4 + 3], masks[y + 1][x].pixels[offset * 4 + 3], "海・浅瀬・島の上下の共有辺を四隅まで同じ濃さにする");
      }
    }
  }
  const mixedNeighbors = Object.fromEntries(sides.map(side => [side, sea]));
  mixedNeighbors.east = mixedNeighbors.northeast = mixedNeighbors.southeast = shoal;
  const mixed = context.waterMask(context.waterDepthField("sea", mixedNeighbors));
  assert.equal(mixed.pixels[(31 * 64 + 31) * 4 + 3], 0, "深海の中央には浅瀬を重ねない");
  assert.equal(mixed.pixels[(31 * 64 + 63) * 4 + 3], 128, "浅瀬との境界では両水深を半分ずつ重ねる");
  assert.ok(mixed.pixels[(31 * 64 + 48) * 4 + 3] > 0 && mixed.pixels[(31 * 64 + 48) * 4 + 3] < 128, "深海の中央から浅瀬との境界まで段差なく補間する");
}

/**
 * 入り江の四隅で曲線が出ることと、隣接する陸の海岸線へ端点が接続することを確認する。
 * @param {object} art 読み込み済みの描画モジュール。
 * @returns {void}
 */
function verifyInletCoasts(art) {
  const cases = [
    { corner: "tl", land: [[0, -1], [-1, 0], [-1, -1]], curve: [[0, 46], [0, 0, 46, 0]] },
    { corner: "tr", land: [[0, -1], [1, 0], [1, -1]], curve: [[82, 0], [128, 0, 128, 46]] },
    { corner: "bl", land: [[0, 1], [-1, 0], [-1, 1]], curve: [[46, 128], [0, 128, 0, 82]] },
    { corner: "br", land: [[0, 1], [1, 0], [1, 1]], curve: [[128, 82], [128, 128, 82, 128]] },
  ];
  for (const detailed of [false, true]) for (const entry of cases) {
    const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ terrain: "sea", building: "none" })));
    for (const [dx, dy] of entry.land) grid[2 + dy][2 + dx] = { terrain: "plain", building: "none" };
    const before = JSON.stringify(grid), water = makeContext();
    art.terrain.drawIllustratedTile(water, grid[2][2], 0, 0, detailed ? 80 : 14, detailed, null, 0, { gx: 2, gy: 2, grid });
    const inlet = water.strokes.find(stroke => stroke.color === "#d8c798");
    assert.deepEqual(inlet?.points, entry.curve, `${entry.corner}の入り江は外角と同じ半径46の曲線にする`);
    const neighborEnds = [];
    for (const [dx, dy] of entry.land.slice(0, 2)) {
      const ctx = makeContext();
      art.terrain.drawIllustratedTile(ctx, grid[2 + dy][2 + dx], 0, 0, detailed ? 80 : 14, detailed, null, 0, { gx: 2 + dx, gy: 2 + dy, grid });
      const beach = ctx.strokes.find(stroke => stroke.color === "#d8c798");
      neighborEnds.push(...beach.points.map(point => [point.at(-2) + dx * 128, point.at(-1) + dy * 128]));
      assert.equal(ctx.depth, 0, "隣接する陸の海岸描画状態を復元する");
    }
    for (const end of [entry.curve[0], entry.curve[1].slice(-2)]) {
      assert.ok(neighborEnds.some(point => point[0] === end[0] && point[1] === end[1]), `${entry.corner}の曲線端を隣の陸の海岸線へ隙間なくつなぐ`);
    }
    assert.equal(water.depth, 0, "入り江の切り抜きと海岸描画状態を復元する");
    assert.equal(JSON.stringify(grid), before, "入り江を丸めても地形や移動判定は変更しない");
  }
}

/**
 * 村・街・草地・森・山の単独島で、水面の背景を周囲の海または浅瀬に揃える。
 * @param {object} art 読み込み済みの描画モジュール。
 * @returns {void}
 */
function verifyIslandBackgrounds(art) {
  const cells = [
    { terrain: "plain", building: "village" }, { terrain: "plain", building: "town" },
    ...["plain", "forest", "mountain"].map(terrain => ({ terrain, building: "none" })),
  ];
  for (const detailed of [false, true]) for (const surrounding of ["sea", "shoal"]) for (const cell of cells) {
    const grid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ terrain: surrounding, building: "none" })));
    grid[1][1] = cell;
    const ctx = makeContext();
    art.terrain.drawIllustratedTile(ctx, cell, 0, 0, detailed ? 80 : 14, detailed, null, 0, { gx: 1, gy: 1, grid });
    const label = `${cell.building === "none" ? cell.terrain : cell.building}/${detailed ? "詳細" : "簡易"}/${surrounding}`;
    const field = Array.from(art.water.waterDepthField(cell.terrain, neighborsAt(grid, 1, 1)));
    assert.ok(field.every(value => value === (surrounding === "sea" ? 0 : 1)), `${label}: 島の背景を周囲の水深に一致させる`);
    if (detailed) {
      assert.equal(ctx.calls[0][0], art.images[1], `${label}: 最初に背景の水面を描く`);
      assert.equal(ctx.calls[0][1], surrounding === "sea" ? 0 : 512, `${label}: 周囲の水深に対応する画像を使う`);
      if (surrounding === "sea") {
        assert.ok(!ctx.calls.some(call => call[0] === art.images[1] && call[1] === 512 && call[2] === 0), `${label}: 深海の中の島に浅瀬の四角い背景を付けない`);
      }
    } else {
      assert.equal(ctx.calls.length, 0, `${label}: 簡易表示は画像を使わない`);
      assert.equal(ctx.shapes[0][0], "fillRect", `${label}: 最初に背景の水面を塗る`);
      assert.equal(ctx.shapes[0][1], "#1b526d", `${label}: 背景の基底を海色にする`);
      assert.equal(ctx.shapes.some(shape => shape[0] === "fillRect" && shape[1] === "#438d99"), surrounding === "shoal", `${label}: 浅瀬は周囲に実在するときだけ重ねる`);
    }
    assert.equal(ctx.depth, 0, `${label}: 描画状態を復元する`);
  }
}

/**
 * 画像の状態に関係なく全体地図の全分類を専用の輪郭で描けることを確認する。
 * 公開描画関数も検証し、種類や縮尺の転送漏れを検出する。
 * @param {object} art 検証する描画モジュール。
 * @param {string} phase 画像の状態。
 * @returns {void}
 */
function verifyOverviewCoverage(art, phase) {
  /** @param {string} label 種類。 @param {Function} draw 描画。 @returns {object} 図形を記録した描画先。 */
  function assertOutline(label, draw) {
    const ctx = makeContext();
    const result = draw(ctx);
    if (result !== undefined) assert.equal(result, true, `${phase}: ${label}に対応する`);
    assert.equal(ctx.calls.length, 0, `${phase}: ${label}の簡易表示に画像を使わない`);
    assert.ok(ctx.shapes.length > 0, `${phase}: ${label}の輪郭または地形色を描く`);
    assert.equal(ctx.depth, 0, `${phase}: ${label}の保存状態を復元する`);
    return ctx;
  }
  for (const size of [14, 13]) {
    for (const terrain of ["sea", "shoal", "plain", "forest", "mountain", "deck"]) {
      assertOutline(`${terrain}/${size}`, ctx => art.map.drawMapTile(ctx, { terrain, building: "none" }, 0, 0, size, false, "#aabbcc", 0));
    }
    for (const cell of [{ terrain: "plain", building: "town" }, { terrain: "plain", building: "village" }, { terrain: "shoal", building: "town", settlement: { pirateHaven: true } }]) {
      assertOutline(`${cell.settlement ? "pirateHarbor" : cell.building}/${size}`, ctx => art.map.drawMapTile(ctx, cell, 0, 0, size, false, "#aabbcc", 0));
    }
    for (const kind of SITE_KINDS) {
      assertOutline(`${kind}/${size}`, ctx => art.symbols.drawIllustratedSite(ctx, kind, 0, 0, size, false));
    }
    for (const terrain of ["sea", "plain"]) {
      for (const crowded of [false, true]) {
        assertOutline(`${terrain}の現在地/${crowded}/${size}`, ctx => art.map.drawMapPlayer(ctx, { terrain, exploration: crowded, building: crowded ? "town" : "none" }, 0, 0, size, false));
      }
    }
    for (const shape of ["star", "shield", "triangle", "dot"]) {
      const ctx = assertOutline(`${shape}/${size}`, target => art.symbols.drawIllustratedPin(target, { shape, color: "#aa0000", defenderColor: "#0000aa" }, size / 2, size / 2, size * 0.24, false));
      if (shape === "shield") {
        assert.ok(ctx.shapes.some(call => call[0] === "fill" && call[1] === "#aa0000"), "全体表示の盾に攻撃色を残す");
        assert.ok(ctx.shapes.some(call => call[0] === "fill" && call[1] === "#0000aa"), "全体表示の盾に防衛色を残す");
      }
    }
  }
  const wrappers = [
    ...["wreck", "drift", "battlefield"].map(kind => ({ kind: kind === "drift" ? "crate" : kind, draw: ctx => art.map.drawExplorationSite(ctx, kind, 0, 0, 13, false) })),
    ...["rumor", "altar", "inlet", "treasure"].map(kind => ({ kind, draw: ctx => art.map.drawChartSite(ctx, kind, 0, 0, 13, false) })),
    { kind: "bounty", draw: ctx => art.bounty.drawBountySite(ctx, 0, 0, 13, false) },
    { kind: "pirateLord", draw: ctx => art.story.drawPirateStorySite(ctx, { id: "lord" }, 0, 0, 13, false) },
    { kind: "pirateKing", draw: ctx => art.story.drawPirateStorySite(ctx, { id: "olav" }, 0, 0, 13, false) },
    ...Object.entries({ fish_migration: "fish", seabed_bell: "bell", storm_aftermath: "storm", fog_light: "lantern", sinking_treasure: "sinkingShip" })
      .map(([event, kind]) => ({ kind, draw: ctx => art.events.drawDangerousSeaEvent(ctx, { kind: event }, 0, 0, 13, false) })),
  ];
  for (const { kind, draw } of wrappers) {
    const actual = assertOutline(`${kind}の公開関数`, draw);
    const expected = makeContext();
    art.symbols.drawIllustratedSite(expected, kind, 0, 0, 13, false);
    assert.deepEqual(actual.shapes, expected.shapes, `${kind}の公開関数が対応する専用輪郭を使う`);
  }
}

/**
 * 地図の海面を地形の後・港の図柄の前に重ね、画像待機や失敗でも描画順を守る。
 * @param {object} art 描画モジュール。 @param {string} phase 画像の状態。 @returns {void}
 */
function verifyHarborSurface(art, phase) {
  for (const terrain of ["sea", "shoal"]) for (const [size, detailed] of [[14, false], [700 / 19, true], [700 / 9, true]]) {
    const ctx = makeContext(), sea = { regionId: "sw", level: "outer" }, hooks = [];
    const cell = { terrain, building: "village", settlement: { pirateHaven: true } };
    /** @returns {object} 同じ描画用海域を返す。 */
    const seaAt = () => sea;
    /** @returns {void} 画像読込み後の再描画先。 */
    const onReady = () => {};
    const options = {
      gx: 4, gy: 45, sea, seaAt, onReady, detailed,
      /** @param {object} target 描画先。 @param {number} units 基準幅。 @param {object} forwarded 海域属性。 @returns {void} 海面を重ねる時点を記録する。 */
      drawSurface(target, units, forwarded) { hooks.push({ target, units, options: forwarded, images: ctx.calls.length, shapes: ctx.shapes.length }); },
    };
    art.map.drawMapTile(ctx, cell, 5, 7, size, detailed, null, 0, options);
    const label = `${phase}/${terrain}/${size}`;
    assert.equal(hooks.length, 1, `${label}: 港の海面を一度だけ重ねる`);
    const hook = hooks[0], illustrated = !detailed || art.assets.mapAssetsReady();
    assert.equal(hook.target, ctx, `${label}: 同じ描画先へ水面を渡す`);
    assert.equal(hook.units, illustrated ? 128 : 32, `${label}: 地形と同じ座標幅で水面を描く`);
    for (const key of ["sea", "seaAt", "onReady", "gx", "gy", "detailed"]) assert.equal(hook.options[key], options[key], `${label}: 海面へ${key}を渡す`);
    if (detailed && illustrated) {
      assert.ok(hook.images > 0, `${label}: 通常地形の後に危険海面を描く`);
      assert.equal(ctx.calls.slice(0, hook.images).some(call => call[0] === art.images[0]), false, `${label}: 海面より先に港を描かない`);
      assert.equal(ctx.calls.slice(hook.images).filter(call => call[0] === art.images[0]).length, 1, `${label}: 危険海面の上に港の画像を残す`);
    } else {
      assert.ok(hook.shapes > 0, `${label}: 背景の海色の後に危険海面を描く`);
      const harborColor = detailed ? "#98724f" : "#b59162";
      assert.ok(ctx.shapes.findIndex(shape => shape[0] === "fill" && shape[1] === harborColor) >= hook.shapes, `${label}: 危険海面の上に港の輪郭を残す`);
    }
    assert.equal(ctx.depth, 0, `${label}: 海面と港の描画状態を復元する`);
  }
}

/**
 * 実際の地図描画で全体・周辺・拡大のすべてに現在地と地点を渡すことを確認する。
 * ゲーム状態だけを置き換え、地形・地点・ピンは本体の描画を実行する。
 * @param {object} art 読み込み済みの描画モジュール。
 * @returns {void}
 */
function verifyRenderMap(art) {
  const ctx = makeContext(), calls = [], tiles = [], surfaces = [];
  /** @returns {void} 状態更新と情報欄の検証対象外の処理を受け取る。 */
  const noop = () => {};
  /** @param {string} name 分類。 @param {Function} draw 本体の描画。 @returns {Function} 縮尺を記録して本体へ渡す描画。 */
  function recordRenderer(name, draw) {
    /** @param {Array} args 描画引数。 @returns {void} 公開関数に渡した縮尺を記録する。 */
    return (...args) => { calls.push({ name, detailed: args.at(-1) }); draw(...args); };
  }
  const position = { x: 25, y: 25 };
  const sea = { regionId: "sw", level: "outer" };
  /** @param {object} point 世界座標。 @returns {object|null} 港を含む描画用の海域属性。 */
  const seaAt = point => point.x === position.x && point.y === position.y ? sea : null;
  const mapData = Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => ({ terrain: "sea", building: "none" })));
  mapData[position.y][position.x] = { terrain: "shoal", building: "village", settlement: { pirateHaven: true } };
  const game = {
    position, mapMode: "full", selectedPosition: null,
    expansion: { exploration: { sites: [{ kind: "wreck", position }] } },
    dangerousSeas: { regions: {}, bounties: { active: [] } },
    bounties: { active: [{ position }] }, pirateKingStory: { active: { id: "olav", position } },
  };
  const context = vm.createContext({
    state: game, MAP_CELL: 14, MAP_PAD: 4,
    elements: { mapCanvas: { getContext: () => ctx }, mapPosLabel: {} },
    mapData,
    FACTIONS: [], pinCache: { list: [{ ...position, shape: "shield", color: "#aa0000", defenderColor: "#0000aa" }], byPos: new Map([["25,25", [{ shape: "shield" }]]]) },
    refreshSettlementDemandIfNeeded: noop, refreshPinCache: noop, refreshMapInfo: noop,
    mapViewport: art.viewport.mapViewport, dangerousSeaAt: () => null, dangerousSeaMapAt: seaAt,
    /** @param {Array} args 描画引数。 @returns {void} 地形から呼ばれた危険海面の属性を記録する。 */
    drawDangerousSeaTile(...args) { if (args[1]) surfaces.push(args); },
    visibleChartSites: () => [{ kind: "altar", position }], visibleDangerousSeaEvents: () => [{ kind: "fog_light", position }],
    /** @param {Array} args 地形の描画引数。 @returns {void} 本体へ渡す海面属性を記録する。 */
    drawMapTile(...args) { tiles.push(args); art.map.drawMapTile(...args); },
    drawMapPlayer: recordRenderer("player", art.map.drawMapPlayer),
    drawExplorationSite: recordRenderer("exploration", art.map.drawExplorationSite),
    drawChartSite: recordRenderer("chart", art.map.drawChartSite),
    drawBountySite: recordRenderer("bounty", art.bounty.drawBountySite),
    drawPirateStorySite: recordRenderer("story", art.story.drawPirateStorySite),
    drawDangerousSeaEvent: recordRenderer("event", art.events.drawDangerousSeaEvent),
    drawIllustratedPin: recordRenderer("pin", art.symbols.drawIllustratedPin),
  });
  const source = readSource("map.js");
  for (const name of ["pinsAt", "drawPin", "drawMapSeaSurface", "renderMap"]) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
  }
  for (const mode of ["full", "nearby", "zoom"]) {
    game.mapMode = mode; calls.length = 0; tiles.length = 0; surfaces.length = 0;
    const imageCount = ctx.calls.length;
    vm.runInContext("renderMap()", context);
    assert.deepEqual(calls.map(call => call.name).sort(), ["bounty", "chart", "event", "exploration", "pin", "player", "story"], `${mode}でも現在地と全地点分類を描く`);
    assert.ok(calls.every(call => call.detailed === (mode !== "full")), `${mode}の縮尺を各描画関数へ渡す`);
    assert.ok(tiles.every(args => args.at(-1).drawSurface === context.drawMapSeaSurface), `${mode}の全マスを地形内の海面描画につなぐ`);
    assert.equal(surfaces.length, 1, `${mode}でも危険判定から除外された港の海面を描く`);
    const [target, actualSea, x, y, units, options] = surfaces[0];
    assert.equal(target, ctx); assert.equal(actualSea, sea);
    assert.equal(x, 0); assert.equal(y, 0); assert.equal(units, 128);
    assert.equal(options.gx, position.x); assert.equal(options.gy, position.y);
    assert.equal(options.detailed, mode !== "full", `${mode}の縮尺を危険海面にも明示する`);
    assert.equal(options.seaAt, seaAt, `${mode}の港と隣接海の接続に描画用の索引を使う`);
    assert.equal(options.onReady, context.renderMap, `${mode}で海面画像の読込み後にも再描画する`);
    assert.equal(ctx.depth, 0, `${mode}の描画状態を復元する`);
    if (mode === "full") assert.equal(ctx.calls.length, imageCount, "50×50の全体地図は画像の縮小を使わない");
  }
}

/** @returns {Promise<void>} 画像待機・失敗時の代替・全縮尺・海岸境界・重複地点を検証する。 */
async function main() {
  const art = await loadArt();
  let readyCount = 0;
  /** @returns {void} 読み込み完了の再描画回数を記録する。 */
  const onReady = () => { readyCount++; };
  for (let i = 0; i < 10; i++) art.assets.prepareMapAssets(onReady);
  assert.equal(art.images.length, 3, "同じ地図の再描画で画像を追加要求しない");
  assert.match(art.images[0].src, /\/image\/map\/sprites\.png$/);
  assert.match(art.images[1].src, /\/image\/map\/terrain\.png$/);
  assert.match(art.images[2].src, /\/image\/map\/events\.png$/);
  const ctx = makeContext();
  verifyOverviewCoverage(art, "未読込み");
  verifyHarborSurface(art, "未読込み");
  assert.equal(art.assets.drawMapSprite(ctx, "ship", 0, 0, 32), false);
  art.images[0].onload();
  assert.equal(readyCount, 0, "画像が一枚だけ揃っても描画を切り替えない");
  assert.equal(art.assets.mapAssetsReady(), false);
  art.images[1].onload();
  assert.equal(readyCount, 0, "画像が二枚でも出来事画像を待つ");
  assert.equal(art.assets.mapAssetsReady(), false);
  assert.equal(art.assets.drawMapSprite(ctx, "storm", 0, 0, 32), false);
  art.images[2].onload();
  assert.equal(readyCount, 1, "全画像が揃ったときに一度だけ再描画する");
  assert.equal(art.assets.mapAssetsReady(), true);
  verifyOverviewCoverage(art, "読込み完了");
  verifyHarborSurface(art, "読込み完了");
  const rectangles = new Set();
  for (const size of [14, 700 / 19, 700 / 9]) {
    for (const kind of SPRITE_KINDS) {
      assert.equal(art.assets.drawMapSprite(ctx, kind, 10, 20, size), true);
      const [image, sx, sy, sw, sh, dx, dy, dw, dh] = ctx.calls.at(-1);
      assert.ok(sx >= 0 && sy >= 0 && sx + sw <= image.naturalWidth && sy + sh <= image.naturalHeight, "切り出しは各原画の内側に収める");
      assert.ok(dx >= 10 && dy >= 20 && dx + dw <= 10 + size && dy + dh <= 20 + size, "図柄は三縮尺ともマスの内側に収める");
      assert.ok(Math.abs(dw / dh - sw / sh) < 0.00001, "図柄の縦横比を変えない");
      assert.equal(image, art.images[["storm", "lantern", "sinkingShip"].includes(kind) ? 2 : 0], `${kind}を対応する原画から切り出す`);
      rectangles.add([image.src, sx, sy, sw, sh].join(","));
      const detailed = makeContext();
      assert.equal(art.symbols.drawIllustratedSite(detailed, kind, 0, 0, size, true), true);
      assert.equal(detailed.calls.length, 1, `${kind}の詳細表示は画像を使う`);
      assert.equal(detailed.depth, 0);
    }
  }
  assert.equal(rectangles.size, 27, "二十七種類をそれぞれ独立して切り出す");
  assert.equal(art.assets.drawMapSprite(ctx, "unknown", 0, 0, 32), false);
  const water = { terrain: "shoal", building: "none" }, land = { terrain: "plain", building: "none" };
  const grid = [[land, water, land], [land, land, land], [land, land, land]];
  const before = JSON.stringify(grid);
  for (const size of [14, 700 / 19, 700 / 9]) {
    const cells = [
      ...["sea", "shoal", "plain", "forest", "mountain", "deck"].map(terrain => ({ terrain, building: "none" })),
      { terrain: "plain", building: "town" }, { terrain: "plain", building: "village" },
      { terrain: "shoal", building: "town", settlement: { pirateHaven: true } },
    ];
    for (const cell of cells) {
      const detailed = makeContext();
      assert.equal(art.terrain.drawIllustratedTile(detailed, cell, 4, 4, size, true, "#aabbcc", 1, { gx: 1, gy: 1, grid }), true);
      assert.ok(detailed.calls.length > 0, "六地形・三拠点の詳細表示に画像を使う");
      assert.equal(detailed.depth, 0, "地形描画の変換や切り抜きを次のマスへ持ち越さない");
    }
    for (const terrain of ["sea", "plain"]) {
      const player = makeContext();
      art.map.drawMapPlayer(player, { terrain, building: "none" }, 0, 0, size, true);
      assert.equal(player.calls.length, 1, "海上・陸上の現在地の詳細表示は画像を使う");
      assert.equal(player.depth, 0);
    }
  }
  assert.equal(JSON.stringify(grid), before, "描画は隣接判定に使う地形を変更しない");
  const coastCtx = makeContext();
  art.terrain.drawIllustratedTile(coastCtx, land, 0, 0, 64, true, null, 0, { gx: 1, gy: 1, grid });
  const beach = coastCtx.strokes.find(stroke => stroke.color === "#d8c798");
  assert.deepEqual(beach?.points, [[46, 0], [82, 0]], "北だけ海なら、左右の入り江へ続く海岸線を境界上で短くし、陸地同士の境界へは描かない");
  verifyInletCoasts(art);
  verifyIslandBackgrounds(art);
  art.symbols.drawIllustratedPlayer(ctx, { ...water, exploration: true, settlement: { pirateHaven: true } }, 0, 0, 80);
  assert.ok(ctx.calls.at(-1)[7] > 32 && ctx.calls.at(-1)[7] <= 44, "現在地が複数の地点と重なっても縮小は一度だけにする");
  assert.equal(ctx.depth, 0);
  verifyRenderMap(art);
  const stamps = [], fills = [], composites = [];
  art.context.document = {
    /** @returns {object} ピンの画像合成と攻守配色を記録する。 */
    createElement() {
      const stamp = makeContext();
      /** @param {number[]} args 塗りの範囲。 @returns {void} 色と合成方法を記録する。 */
      stamp.fillRect = (...args) => { fills.push([stamp.fillStyle, stamp.globalCompositeOperation, stamp.globalAlpha, ...args]); };
      /** @param {Array} args 原画と範囲。 @returns {void} 盾の明暗を戻す合成方法を記録する。 */
      stamp.drawImage = (...args) => { stamp.calls.push(args); composites.push([stamp.globalCompositeOperation, stamp.globalAlpha]); };
      stamps.push(stamp);
      return { getContext: () => stamp };
    },
  };
  for (const size of [700 / 19, 700 / 9]) {
    const radius = Math.max(3, size * 0.1);
    art.symbols.drawIllustratedPin(ctx, { shape: "shield", color: "#aa0000", defenderColor: "#0000aa" }, size * 0.81, size * 0.2, radius, true);
    const [, x, y, width, height] = ctx.calls.at(-1);
    assert.ok(x > 0 && y > 0 && x + width < size && y + height < size, "画像の防衛盾を二つの詳細縮尺ともマス内に収める");
  }
  assert.equal(stamps.length, 1, "同じ攻守配色のピンは合成済み画像を使う");
  assert.deepEqual(fills, [["#aa0000", "source-atop", 1, 0, 0, 64, 64], ["#0000aa", "source-atop", 1, 32, 0, 32, 64]], "防衛色は攻撃色を混ぜず、右半分だけに不透明で塗る");
  assert.deepEqual(composites, [["source-over", 1], ["luminosity", 0.45]], "原画の色を戻さず、無彩色の明暗だけを戻す");
  verifyWaterMasks();
  for (let failedIndex = 0; failedIndex < 3; failedIndex++) {
    const failed = await loadArt();
    let failedCount = 0;
    failed.assets.prepareMapAssets(() => { failedCount++; });
    failed.images[failedIndex].onerror();
    const remaining = failed.images.filter((image, index) => index !== failedIndex);
    remaining[0].onload();
    assert.equal(failedCount, 0, "一枚の失敗後も残る画像の結果を待つ");
    remaining[1].onload();
    assert.equal(failedCount, 1);
    assert.equal(failed.assets.mapAssetsReady(), false);
    failed.assets.prepareMapAssets(onReady);
    assert.equal(failed.images.length, 3, "失敗時に画像要求のループを作らない");
    assert.equal(failed.terrain.drawIllustratedTile(ctx, land, 0, 0, 64, true, null, 0), false, "読み込み失敗時は従来描画へ戻せる");
    verifyOverviewCoverage(failed, `画像${failedIndex + 1}の失敗`);
    verifyHarborSurface(failed, `画像${failedIndex + 1}の失敗`);
  }
  console.log("地図画像三枚の一括切替・27図柄・全種類の13px簡易表示・3縮尺・全体地図の現在地・四方向の入り江接続・孤島の水深背景・共有辺の透過画素・画像失敗の代替・無法港の危険海面と描画順: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
