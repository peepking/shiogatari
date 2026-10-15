const { readSource } = require("./helpers/source.cjs");
const assert = require("node:assert/strict");
const vm = require("node:vm");

/** @returns {Promise<void>} 戦闘描画へ周辺地形を渡し、再描画や甲板の変更を正しく反映するか検証する。 */
async function checkBattleTerrain() {
  const calls = [];
  const mapArt = new vm.SyntheticModule(["drawMapTile"], function () {
    this.setExport("drawMapTile", (...args) => calls.push(args));
  });
  const terrainArt = new vm.SourceTextModule(await readSource("battleTerrainArt.js"));
  await terrainArt.link(() => mapArt); await terrainArt.evaluate();
  const grid = [["shoal", "sea"], ["deck", "sea"]];
  const original = JSON.stringify(grid);
  const ctx = { setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const context = vm.createContext({
    document: { hidden: false }, battleEffects: { sync() {}, draw() {}, drawGround() {}, setLayout() {} }, renderBattleRigging() {},
    elements: { battleCanvas: { width: 80 } }, battleState: { size: 2, grid, ctx, units: [] },
    resizeBattleCanvas() {}, isBattleOnBoard() {}, drawBattleTerrain: terrainArt.namespace.drawBattleTerrain,
    drawTacticalOverlay() {}, getUnitById() { return null; },
  });
  const source = await readSource("battle.js"), start = source.indexOf("function renderBattle(");
  vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
  vm.runInContext("renderBattle()", context);
  assert.equal(calls.length, 4);
  const rendered = calls[0][8].grid, row = rendered[0], sea = rendered[0][1];
  assert.equal(calls[0][1], rendered[0][0]);
  assert.equal(rendered[0][0].terrain, "shoal");
  assert.equal(rendered[0][1].terrain, "sea", "浅瀬から隣接する海を参照できる");
  assert.equal(rendered[1][0].terrain, "deck");
  assert.equal(rendered[1][1], sea, "同じ地形の描画用マスを共有する");
  assert.ok(Object.isFrozen(sea));
  calls.forEach((call, index) => {
    const x = index % 2, y = Math.floor(index / 2), options = call[8];
    assert.equal(call[2], x * 40); assert.equal(call[3], y * 40);
    assert.equal(options.gx, x); assert.equal(options.gy, y);
    assert.equal(options.grid, rendered); assert.equal(typeof options.onReady, "function");
  });
  assert.equal(JSON.stringify(grid), original, "描画で戦闘判定用の地形を変更しない");
  calls.length = 0; vm.runInContext("renderBattle()", context);
  assert.equal(calls[0][8].grid, rendered); assert.equal(rendered[0], row);
  assert.equal(calls[1][1], sea, "再描画で地形オブジェクトを作り直さない");
  grid[0][0] = "sea"; grid[1] = ["forest", "shoal"];
  calls.length = 0; vm.runInContext("renderBattle()", context);
  assert.equal(calls[0][1], sea, "同じ戦場配列の地形変更を反映する");
  assert.equal(rendered[1][0].terrain, "forest"); assert.equal(rendered[1][1].terrain, "shoal");
}

/** @param {string} source 戦闘UIのソース。 @param {string} name 関数名。 @returns {string} 実描画の検証へ使う関数本体。 */
function battleDrawingFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name}を実ソースから検証できる`);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}

/**
 * Canvasの保存・復帰と座標変換を再現し、画像と情報表示の描画状態を記録する。
 * @param {Array<object>} calls 描画記録。 @returns {object} 実renderBattleへ渡す検証用の描画先。
 */
function battleDrawingContext(calls) {
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const ctx = {
    globalAlpha: 1, filter: "none", fillStyle: "", strokeStyle: "", lineJoin: "miter",
    shadowColor: "rgba(0,0,0,0)", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    setTransform(...values) { matrix = values; },
    save() { stack.push({ matrix: [...matrix], alpha: ctx.globalAlpha, filter: ctx.filter,
      fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle, lineJoin: ctx.lineJoin,
      shadowColor: ctx.shadowColor, shadowBlur: ctx.shadowBlur,
      shadowOffsetX: ctx.shadowOffsetX, shadowOffsetY: ctx.shadowOffsetY }); },
    restore() {
      const saved = stack.pop();
      assert.ok(saved, "描画状態の復帰は保存と対になる");
      matrix = saved.matrix; ctx.globalAlpha = saved.alpha; ctx.filter = saved.filter;
      ctx.fillStyle = saved.fillStyle; ctx.strokeStyle = saved.strokeStyle; ctx.lineJoin = saved.lineJoin;
      ctx.shadowColor = saved.shadowColor; ctx.shadowBlur = saved.shadowBlur;
      ctx.shadowOffsetX = saved.shadowOffsetX; ctx.shadowOffsetY = saved.shadowOffsetY;
    },
    translate(x, y) { matrix = [matrix[0], matrix[1], matrix[2], matrix[3],
      matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]; },
    rotate(angle) {
      const cosine = Math.cos(angle), sine = Math.sin(angle);
      matrix = [matrix[0] * cosine + matrix[2] * sine, matrix[1] * cosine + matrix[3] * sine,
        matrix[2] * cosine - matrix[0] * sine, matrix[3] * cosine - matrix[1] * sine, matrix[4], matrix[5]];
    },
    scale(x, y) { matrix = [matrix[0] * x, matrix[1] * x, matrix[2] * y, matrix[3] * y, matrix[4], matrix[5]]; },
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    arc(...args) { record("arc", args); },
    drawImage(...args) { record("image", args); },
    fillText(...args) { record("text", args); },
    strokeText(...args) { record("textStroke", args); },
    fillRect(...args) { record("rect", args); },
  };
  /** @param {string} kind 描画種別。 @param {Array} args 描画座標。 @returns {void} その時点の表示状態を複製する。 */
  function record(kind, args) {
    calls.push({ kind, args, matrix: [...matrix], alpha: ctx.globalAlpha, filter: ctx.filter, color: ctx.fillStyle,
      strokeColor: ctx.strokeStyle, shadowColor: ctx.shadowColor, shadowBlur: ctx.shadowBlur,
      shadowOffsetX: ctx.shadowOffsetX, shadowOffsetY: ctx.shadowOffsetY });
  }
  return ctx;
}

/** @param {number} actual 実測値。 @param {number} expected 期待値。 @param {string} message 検証内容。 @returns {void} 浮動小数の変換結果を比較する。 */
function closeDrawingValue(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 1e-9, message); }

/**
 * 実戦場描画で攻撃の上にHP・陣形・選択・敗走を残し、攻撃姿勢を兵画像だけへ適用する。
 * 退出中の兵は画像と情報の両方を同じ濃さでフェードし、移動終了後と撃破済みは除く。
 * @returns {Promise<void>}
 */
async function checkBattleStatusLayers() {
  const calls = [], cell = 40, dpr = 2;
  const renderCounts = { resize: 0, sync: 0 };
  const ctx = battleDrawingContext(calls);
  const active = { id: "active", type: "infantry", side: "ally", x: 1, y: 1,
    hp: 60, maxHp: 100, status: "active", shaken: true };
  const escaped = { id: "escaped", type: "scout", side: "ally", x: -1, y: 2,
    hp: 20, maxHp: 50, status: "escaped" };
  const poses = {
    active: { x: 1.25, y: 1.5, angle: 0.1, bob: -0.03, scaleY: 0.94, alpha: 1,
      moving: true, routing: false, attackX: 0.12, attackY: -0.09, attackAngle: 0.08,
      attackScaleY: 0.96, hitFlash: 0.6 },
    escaped: { x: -0.2, y: 2, angle: -0.07, bob: -0.02, scaleY: 1, alpha: 0.35,
      moving: true, routing: true, attackX: 0, attackY: 0, attackAngle: 0,
      attackScaleY: 1, hitFlash: 0 },
    finished: { x: -1, y: 3, alpha: 0, moving: false },
  };
  const images = { infantry: { complete: true, naturalWidth: 32, naturalHeight: 32, id: active.id },
    scout: { complete: true, naturalWidth: 32, naturalHeight: 32, id: escaped.id } };
  const units = [active, escaped, { ...escaped, id: "finished", y: 3 }, { ...active, id: "dead", hp: 0 }];
  const before = JSON.stringify(units);
  const context = vm.createContext({
    document: { hidden: false }, elements: { battleCanvas: { width: cell * 4 * dpr }, battleBlock: { hidden: false } },
    battleState: { size: 4, dpr, ctx, units, grid: [], selectedId: escaped.id },
    battleEffects: { setLayout() {}, sync() { renderCounts.sync++; }, drawGround() {},
      unitPose(unit) { return poses[unit.id]; }, draw() { calls.push({ kind: "attack" }); } },
    resizeBattleCanvas() { renderCounts.resize++; }, drawBattleTerrain() {}, renderBattleRigging() {},
    drawTacticalOverlay() {}, getUnitById() { return null; },
    isBattleOnBoard(unit) { return unit.hp > 0 && unit.status === "active"; },
    getUnitImage(type) { return images[type]; },
    unitFormation(unit) { return { mark: unit.id === active.id ? "隊A" : "隊B" }; },
  });
  const source = await readSource("battle.js");
  for (const name of ["drawBattleUnitStatus", "renderBattle"]) vm.runInContext(battleDrawingFunction(source, name), context);
  vm.runInContext("renderBattle()", context);
  const attackIndex = calls.findIndex(call => call.kind === "attack");
  const imageCalls = calls.filter(call => call.kind === "image");
  const statusCalls = calls.filter(call => call.kind === "text" || call.kind === "textStroke" || call.kind === "rect"
    || (call.kind === "arc" && call.args[2] === cell * 0.38));
  assert.deepEqual(imageCalls.map(call => call.args[0].id), [active.id, escaped.id], "退出移動終了済みと撃破済みの画像は残さない");
  assert.ok(imageCalls.every(call => calls.indexOf(call) < attackIndex), "全兵画像の上へ攻撃エフェクトを描く");
  assert.ok(statusCalls.length > 0 && statusCalls.every(call => calls.indexOf(call) > attackIndex),
    "HP・陣形・選択・敗走表示は攻撃エフェクトより後に描く");
  assert.deepEqual(calls.filter(call => call.kind === "text").map(call => call.args[0]).sort(), ["!", "逃", "隊A", "隊B"].sort(),
    "生存兵と退出中の兵へ陣形・動揺・敗走を表示する");
  for (const text of calls.filter(call => call.kind === "text")) {
    const outline = calls.find(call => call.kind === "textStroke" && call.args[0] === text.args[0]);
    assert.ok(outline && calls.indexOf(outline) < calls.indexOf(text), "陣形・状態文字は塗りの前に縁取りを描く");
    assert.deepEqual(outline.args, text.args, "縁取りは文字と同じ位置で読みやすさを保つ");
    assert.equal(outline.alpha, text.alpha, "縁取りも退出フェードを共有する");
  }
  const activeImage = imageCalls[0], pose = poses.active;
  closeDrawingValue(activeImage.matrix[4], ((pose.x + 0.5 + pose.attackX) * cell) * dpr, "兵画像だけが攻撃方向へ踏み込む");
  closeDrawingValue(activeImage.matrix[5], ((pose.y + 0.5 + pose.bob + pose.attackY) * cell) * dpr, "兵画像へ上下動と攻撃変位を合成する");
  closeDrawingValue(activeImage.matrix[0], Math.cos(pose.angle + pose.attackAngle) * dpr, "兵画像へ移動と攻撃の角度を合成する");
  closeDrawingValue(activeImage.matrix[3], Math.cos(pose.angle + pose.attackAngle) * pose.scaleY * pose.attackScaleY * dpr,
    "兵画像へ攻撃時の圧縮を合成する");
  assert.notEqual(activeImage.filter, "none", "被弾の明滅は兵画像へ適用する");
  for (const call of statusCalls) {
    assert.deepEqual(call.matrix, [dpr, 0, 0, dpr, 0, 0], "情報表示へ兵画像の変位・回転・圧縮を持ち越さない");
    assert.equal(call.filter, "none", "情報表示へ被弾の明滅を持ち越さない");
  }
  const formation = calls.find(call => call.kind === "text" && call.args[0] === "隊A");
  closeDrawingValue(formation.args[1], (pose.x + 0.5) * cell - cell / 2 + 2, "陣形表示は攻撃変位を除いた移動中心に追従する");
  const health = calls.filter(call => call.kind === "rect" && call.color === "#8bc5dd");
  assert.equal(health.length, 2);
  closeDrawingValue(health[0].args[0], (pose.x + 0.5) * cell - cell * 0.25, "HPバーは踏込みで揺れない");
  closeDrawingValue(health[0].args[1], (pose.y + 0.5) * cell + cell * 0.22, "HPバーへ画像の上下動を適用しない");
  closeDrawingValue(health[0].args[2], cell * 0.5 * active.hp / active.maxHp, "HPバー幅は現在HPの比率を保つ");
  assert.equal(imageCalls[1].alpha, poses.escaped.alpha, "退出中の兵画像を移動姿勢の濃さで描く");
  assert.equal(health[1].alpha, poses.escaped.alpha, "退出中のHPも画像と同じ濃さで消える");
  for (const call of calls.filter(call => call.kind === "text" && ["隊B", "逃"].includes(call.args[0])))
    assert.equal(call.alpha, poses.escaped.alpha, "退出中の陣形・敗走表示のフェードを維持する");
  const selection = calls.filter(call => call.kind === "arc" && call.args[2] === cell * 0.38);
  assert.equal(selection.length, 1, "選択した退出中の兵へ選択円を一つ描く");
  assert.equal(selection[0].alpha, poses.escaped.alpha, "退出中の選択円も同じ濃さで消える");
  closeDrawingValue(selection[0].args[0], (poses.escaped.x + 0.5) * cell, "選択円の中心は移動先を追従する");
  assert.equal(ctx.globalAlpha, 1, "全兵を描いた後はフェード状態を持ち越さない");
  assert.equal(ctx.filter, "none", "全兵を描いた後は明滅状態を持ち越さない");
  assert.equal(JSON.stringify(units), before, "表示層の変更で戦闘状態を書き換えない");
  const visibleDrawCount = calls.length, visibleRenderCounts = { ...renderCounts };
  context.elements.battleBlock.hidden = true;
  vm.runInContext("renderBattle()", context);
  assert.equal(calls.length, visibleDrawCount, "画面終了後に画像の完了通知が来ても非表示の戦場を描き直さない");
  assert.deepEqual(renderCounts, visibleRenderCounts, "非表示の戦場ではCanvasのサイズ更新も演出同期も再開しない");
}

/** @returns {Promise<void>} 全サイズの配置と、拡大・スクロール時の選択位置を検証する。 */
async function main() {
  await checkBattleTerrain();
  await checkBattleStatusLayers();
  const geometry = new vm.SourceTextModule(await readSource("battleGeometry.js"));
  const formation = new vm.SourceTextModule(await readSource("battleFormation.js"));
  await geometry.link(() => {}); await geometry.evaluate(); await formation.link(() => {}); await formation.evaluate();
  const { selectBattleSize, deploymentDepth, battleDeploymentLimit, battleCellAt } = geometry.namespace;
  const modules = { "./battleGeometry.js": geometry };
  for (const name of ["battleTacticalOrders", "battleTacticalAI", "battleRegroup", "battleUnitFormation", "battleTarget", "battleCore", "battleMorale", "battleMovement", "battleReinforcements"])
    modules[`./${name}.js`] = new vm.SourceTextModule(await readSource(`${name}.js`));
  await modules["./battleCore.js"].link(name => modules[name]); await modules["./battleCore.js"].evaluate();
  const battle = await readSource("battle.js");
  const context = vm.createContext({ ...geometry.namespace, DECK_KEY: "deck", battleState: { fieldRandom: () => 0.5 } });
  vm.runInContext(battle.match(/const TERRAIN_WEIGHTS_BY_BASE = \{[\s\S]*?\n\};/)[0], context);
  for (const name of ["buildBattleGrid", "buildDeploySlots"]) {
    const start = battle.indexOf(`function ${name}(`);
    vm.runInContext(battle.slice(start, battle.indexOf("\n}", start) + 2), context);
  }
  assert.deepEqual([0, 5, 6, 10, 11, 15, 16, 20].map(selectBattleSize), [8, 8, 10, 10, 12, 12, 15, 15]);
  for (const size of [8, 10, 12, 15]) {
    const limit = size === 8 ? 16 : 20;
    assert.equal(deploymentDepth(size), 2);
    assert.equal(battleDeploymentLimit(size), limit);
    context.size = size;
    for (const side of ["ally", "enemy"]) {
      context.side = side;
      const slots = vm.runInContext("buildDeploySlots(side, size)", context);
      assert.equal(slots.length, size * 2);
      assert.equal(new Set(slots.map(p => p.x)).size, 2);
    }
    for (const terrain of ["sea", "shoal"]) {
      context.terrain = terrain;
      const grid = vm.runInContext("buildBattleGrid(size, terrain)", context);
      assert.ok(grid.every(row => row.every((cell, x) => (cell === "deck") === (x < 2 || x >= size - 2))), "海戦の甲板は全サイズで両端2列");
    }
    for (const kind of ["balance", "assault", "defense"]) for (let total = 1; total <= 20; total++) for (let melee = 0; melee <= total; melee++) {
      const units = Array.from({ length: total }, (_, id) => ({ id, role: id < melee ? "melee" : "ranged", range: id < melee ? 1 : 4 }));
      const positions = formation.namespace.planBattleFormation(units, kind, size);
      assert.equal(positions.length, Math.min(total, limit));
      assert.equal(new Set(positions.map(p => `${p.x},${p.y}`)).size, Math.min(total, limit));
      assert.ok(positions.every(p => p.unit.id < limit), "上限超過は編成順の後ろから除外する");
      assert.ok(positions.every(p => p.x >= 0 && p.x < deploymentDepth(size) && p.y >= 0 && p.y < size));
      assert.ok(positions.every(p => size - 1 - p.x >= deploymentDepth(size)), "両陣営の初期配置領域が重ならない");
    }
    for (const width of [280, 360, 640, 720]) {
      const rect = { left: -217, top: -49, width, height: width };
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const hit = battleCellAt(rect.left + (x + 0.5) * width / size, rect.top + (y + 0.5) * width / size, rect, size);
        assert.equal(hit.x, x); assert.equal(hit.y, y);
      }
    }
    const units = ["ally", "enemy"].flatMap(side => {
      const army = Array.from({ length: limit }, (_, index) => ({ id: `${side}-${index}`, name: "兵", side,
        role: index < 12 ? "melee" : "ranged", range: index < 12 ? 1 : 4, count: 10,
        hp: 150, maxHp: 150, atk: 20, def: 10, spd: 2, move: 1, cooldown: 0, status: "active" }));
      return formation.namespace.planBattleFormation(army, "balance", size).map(p => ({ ...p.unit, x: side === "ally" ? p.x : size - 1 - p.x, y: p.y }));
    });
    const state = { units, size, tick: 0, elapsedMs: 0, grid: Array.from({ length: size }, () => Array(size).fill("plain")), outfitting: { effects: { attacks: [] } } };
    let result;
    do {
      result = modules["./battleCore.js"].namespace.stepBattle(state, { kiteMode: "kite" }, { defendedDamage: () => 10, fireOutfitting: () => [] });
      const board = units.filter(modules["./battleMorale.js"].namespace.isBattleOnBoard);
      assert.equal(new Set(board.map(u => `${u.x},${u.y}`)).size, board.length);
      assert.ok(board.every(u => u.x >= 0 && u.x < size && u.y >= 0 && u.y < size));
    } while (!result.ended && state.tick < 60);
    assert.equal(result.ended, true, `${size}マスの混成${limit}対${limit}が制限時間内に決着する`);
  }
  console.log("可変戦場: 地形描画・攻撃上の情報表示・画像専用姿勢・退出フェード・サイズ境界・全編成の重複なし・2列配置と盤上上限・拡大/スクロール時のマス選択: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
