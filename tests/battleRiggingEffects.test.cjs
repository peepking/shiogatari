const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadTestModule } = require("./helpers/module.cjs");

/** @param {object} value 入力値。 @returns {object} 再帰的に変更を禁止した入力。 */
function freezeInput(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") freezeInput(child);
  }
  return Object.freeze(value);
}

/** @param {number} actual 実際値。 @param {number} expected 期待値。 @param {string} message 検証内容。 @returns {void} 誤差内の一致を確認する。 */
function near(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} / ${expected}`); }

/** @returns {number} 静止標的は移動を待たない。 */
function noWait() { return 0; }

/** @returns {number} 1歩分の移動を待つ。 */
function oneStepWait() { return 340; }

/** @param {string} id 標的ID。 @returns {number} 標的ごとの残り移動時間。 */
function waitByTarget(id) { return id === "second" ? 520 : 340; }

/** @param {string} [equipmentId] 艤装ID。 @param {string} [to] 標的ID。 @param {object} [changes] 上書き。 @returns {object} 確定済みの艤装命中記録。 */
function shot(equipmentId = "cannon", to = "target", changes = {}) {
  return { support: true, equipmentId, to, ttl: 2, impact: true, ...changes };
}

/** @param {string[]} [equipped] 装備順。 @param {object} [changes] 上書き。 @returns {object} 艤装2台と標的2体を含む戦闘状態。 */
function state(equipped = ["cannon", "harpoon"], changes = {}) {
  return { tick: 1, size: 8, running: true, speed: 1, result: null, moveFx: [],
    units: [
      { id: "ally", type: "infantry", side: "ally", status: "active", hp: 100, x: 1, y: 2 },
      { id: "target", type: "infantry", side: "enemy", status: "active", hp: 100, x: 5, y: 2 },
      { id: "second", type: "infantry", side: "enemy", status: "destroyed", hp: 0, x: 6, y: 4 },
    ], outfitting: { equipped, effects: { attacks: equipped.map(
      /** @param {string} id 艤装ID。 @returns {object} 表示用の攻撃設定。 */
      function attack(id) { return { id }; }) } }, attackFx: [shot()], ...changes };
}

/** @returns {object} 数値の安全性と描画状態の保存・復元を確認するCanvas。 */
function canvas() {
  const calls = [], stack = [];
  const values = { globalAlpha: 0.43, fillStyle: "original", strokeStyle: "original-line", lineWidth: 7,
    lineCap: "square", lineJoin: "bevel", shadowColor: "transparent", shadowBlur: 0,
    font: "10px serif", textAlign: "left", textBaseline: "alphabetic" };
  const initial = { ...values };
  const ctx = { canvas: { width: 256, height: 344 } };
  for (const property of Object.keys(values)) {
    Object.defineProperty(ctx, property, {
      /** @returns {*} 現在の描画値。 */
      get() { return values[property]; },
      /** @param {*} value 新しい描画値。 @returns {void} 安全な値だけを記録する。 */
      set(value) {
        if (typeof value === "number") assert.ok(Number.isFinite(value), `${property}は有限値`);
        if (property === "globalAlpha") assert.ok(value >= 0 && value <= 1, "不透明度は0〜1");
        values[property] = value;
        calls.push([property, value]);
      },
    });
  }
  /** @returns {void} 描画状態を保存する。 */
  ctx.save = function save() { stack.push({ ...values }); calls.push(["save"]); };
  /** @returns {void} 保存した描画状態へ戻す。 */
  ctx.restore = function restore() {
    assert.ok(stack.length, "保存していない描画状態を復元しない");
    Object.assign(values, stack.pop());
    calls.push(["restore"]);
  };
  for (const method of ["beginPath", "moveTo", "lineTo", "quadraticCurveTo", "closePath", "arc", "ellipse", "fill", "stroke",
    "fillRect", "strokeRect", "translate", "rotate", "scale", "rect", "clip", "fillText", "strokeText", "setLineDash"]) {
    /** @param {...*} args 描画引数。 @returns {void} 非有限座標と負の半径を拒否する。 */
    ctx[method] = function record(...args) {
      for (const value of args) if (typeof value === "number") assert.ok(Number.isFinite(value), `${method}の引数は有限値`);
      if (method === "arc" || method === "ellipse") assert.ok(args[2] >= 0, "半径は負にしない");
      if (method === "ellipse") assert.ok(args[3] >= 0, "縦半径は負にしない");
      calls.push([method, ...args]);
    };
  }
  return { ctx, calls,
    /** @returns {void} 元の描画状態に戻ったことを確認する。 */
    assertRestored() { assert.equal(stack.length, 0); assert.deepEqual(values, initial); },
  };
}

/** @param {object} rigging 艤装モデル。 @param {string} method 描画の種類。 @param {number} [cell] セル幅。 @returns {Array} 描画命令。 */
function draw(rigging, method = "drawFire", cell = 32) {
  const drawing = canvas();
  rigging[method](drawing.ctx, cell);
  drawing.assertRestored();
  return drawing.calls;
}

/** @param {Array} calls 描画命令。 @param {string} name 命令名。 @returns {Array} 指定した種類の描画。 */
function operations(calls, name) {
  return calls.filter(
    /** @param {Array} call 描画命令。 @returns {boolean} 指定した種類か。 */
    function matches(call) { return call[0] === name; });
}

/** @param {Function} createPlayer プレイヤー生成関数。 @returns {object} 手動時計つきの演出プレイヤー。 */
function harness(createPlayer) {
  let time = 0, id = 0, renders = 0;
  const pending = new Map();
  const player = createPlayer({
    /** @returns {number} 現在の手動時計。 */
    now() { return time; },
    /** @returns {void} 再描画を記録する。 */
    render() { renders += 1; },
    /** @param {Function} callback 次フレーム。 @returns {number} 予約番号。 */
    requestFrame(callback) { id += 1; pending.set(id, callback); return id; },
    /** @param {number} frameId 予約番号。 @returns {void} フレームを取り消す。 */
    cancelFrame(frameId) { pending.delete(frameId); },
  });
  player.setLayout(32, 8);
  return { player, pending,
    /** @returns {number} 再描画回数。 */
    get renders() { return renders; },
    /** @param {number} ms 経過時間。 @returns {void} 実時間だけ進める。 */
    jump(ms) { time += ms; },
    /** @param {number} ms 経過時間。 @returns {void} 共有時計を100ms以下のフレームで進める。 */
    advance(ms) {
      let remaining = ms;
      while (remaining > 0) {
        assert.equal(pending.size, 1, "艤装もフレーム予約を1件だけ共有する");
        const elapsed = Math.min(100, remaining);
        const [frameId, callback] = pending.entries().next().value;
        pending.delete(frameId);
        time += elapsed;
        callback(time);
        remaining -= elapsed;
        assert.ok(pending.size <= 1, "演出数によらず予約を増殖させない");
      }
    },
    /** @param {boolean} [mounts] 砲座も含めるか。 @returns {Array} 現在の描画。 */
    draw(mounts = false) {
      const drawing = canvas();
      if (mounts) player.drawRigging(drawing.ctx, 32);
      player.draw(drawing.ctx, 32);
      drawing.assertRestored();
      return drawing.calls;
    },
  };
}

/** @returns {Promise<void>} 艤装の砲座・斉射・反動・時計・終了処理を検証する。 */
async function main() {
  const deterministicMath = Object.create(Math);
  /** @returns {never} 演出によるゲーム乱数の消費を禁止する。 */
  deterministicMath.random = function random() { throw new Error("艤装演出はMath.randomを使わない"); };
  const context = vm.createContext({ Math: deterministicMath });
  const module = await loadTestModule("battleRiggingEffects.js", context);
  const effects = await loadTestModule("battleEffects.js", context);
  const config = await loadTestModule("battleEffectConfig.js", context);
  const { createBattleRiggingEffects } = module.namespace;
  const { createBattleEffectPlayer } = effects.namespace;
  const { SUPPORT_RIGGING_RULES, BATTLE_EFFECT_RULES } = config.namespace;
  const { aimMs, staggerMs, recoilMs, returnMs, smokeMs } = SUPPORT_RIGGING_RULES;
  assert.equal(aimMs, 80); assert.equal(staggerMs, 70); assert.equal(recoilMs, 90);
  assert.equal(returnMs, 220); assert.equal(smokeMs, 180);
  const tailMs = BATTLE_EFFECT_RULES.supportMs + smokeMs;

  {
    const empty = createBattleRiggingEffects();
    empty.setLayout(32, 8);
    empty.configure(state([], { attackFx: [] }));
    assert.equal(empty.visible(), false, "装備0台では艤装帯を表示しない");
    assert.equal(empty.height(), 56, "帯の寸法は非表示でも計算できる");
    assert.equal(empty.hasActive(), false);
    assert.equal(draw(empty, "drawMounts").length, 0);
    const buffs = state(["armor", "medic_room"], { attackFx: [] });
    buffs.outfitting.effects.attacks = [];
    empty.configure(buffs);
    assert.equal(empty.visible(), false, "能力補助設備だけなら砲座を作らない");
    empty.configure(state(["cannon"], { attackFx: [] }));
    assert.equal(empty.visible(), true);
    assert.equal(empty.height(), 56, "小さな盤面でも帯の最小高さを確保する");
    assert.equal(empty.hasActive(), false, "待機中の砲座のために連続描画しない");
    assert.ok(draw(empty, "drawMounts").length > 0, "待機中でも砲座を描く");
    assert.equal(draw(empty).length, 0, "待機中には発射光や煙を出さない");
  }

  {
    const ids = ["cannon", "harpoon", "ballista", "fire_ballista", "grape_ballista", "fire_grape_ballista"];
    const rigging = createBattleRiggingEffects();
    rigging.setLayout(40, 10);
    rigging.configure(state(ids, { size: 10, attackFx: [] }));
    let previousX = -Infinity;
    for (const id of ids.slice(0, 5)) {
      const pose = rigging.mountPose(id);
      assert.ok(pose, `${id}を砲座へ割り当てる`);
      assert.ok(pose.x > previousX, "砲座は装備枠順に横並びにする");
      assert.ok(pose.x >= 0 && pose.x <= 400, "砲座は横幅からはみ出さない");
      assert.ok(pose.y >= 400 && pose.y <= 400 + rigging.height(), "砲座の中心を専用の帯へ置く");
      previousX = pose.x;
    }
    assert.ok(!rigging.mountPose(ids[5]), "砲座は最大5台に制限する");
    assert.equal(rigging.hasActive(), false);
    draw(rigging, "drawMounts", 40);
    rigging.setLayout(90, 10);
    assert.equal(rigging.height(), 88, "広い盤面では帯の最大高さを超えない");
    rigging.setLayout(60, 10);
    near(rigging.height(), 72, "中間幅では盤面幅の12%を使う");
  }

  {
    const snapshot = freezeInput(state(["harpoon", "cannon", "ballista"], {
      attackFx: [shot("ballista", "second"), shot("cannon"), shot("harpoon"), shot("cannon", "second")],
    }));
    const original = JSON.stringify(snapshot);
    const rigging = createBattleRiggingEffects();
    rigging.setLayout(32, 8); rigging.configure(snapshot);
    rigging.capture(snapshot, waitByTarget);
    const plans = ["harpoon", "cannon", "ballista"].map(
      /** @param {string} id 艤装ID。 @returns {object} 登録した射撃計画。 */
      function plan(id) { return rigging.planFor(id); });
    for (let rank = 0; rank < plans.length; rank += 1) {
      assert.ok(plans[rank]?.key, "発射元を参照できる斉射キーを作る");
      assert.equal(plans[rank].delay, 520 + aimMs + rank * staggerMs, "全発動艤装は全標的の最長移動後、装備順に発射する");
    }
    assert.notEqual(plans[0].key, plans[1].key, "装備ごとに斉射を区別する");
    assert.equal(operations(draw(rigging), "fill").length, 0, "移動・照準待ちに発射光を出さない");
    rigging.capture(snapshot, waitByTarget);
    assert.deepEqual(rigging.planFor("cannon"), plans[1], "同tickを重複登録しない");
    rigging.advance(plans[0].delay - 1);
    assert.equal(draw(rigging).length, 0, "最初の発射1ms前には光を出さない");
    rigging.advance(1);
    assert.equal(operations(draw(rigging), "fill").length, 1, "先頭の艤装だけが発射光を出す");
    const firstDraw = draw(rigging);
    assert.deepEqual(draw(rigging), firstDraw, "再描画で発射光の位置を変えない");
    rigging.advance(tailMs + staggerMs * 2);
    assert.equal(rigging.hasActive(), false, "最終斉射の煙も有限時間で消える");
    assert.equal(draw(rigging).length, 0);
    assert.equal(JSON.stringify(snapshot), original, "演出は撃破済み標的を含む確定状態を変更しない");
  }

  {
    const rigging = createBattleRiggingEffects();
    const snapshot = state(["cannon"], { attackFx: [shot(), shot("cannon", "second")] });
    rigging.setLayout(32, 8); rigging.configure(snapshot);
    const idle = rigging.mountPose("cannon");
    rigging.capture(snapshot, noWait);
    const plan = rigging.planFor("cannon");
    const origin = { ...rigging.originFor(plan.key) };
    rigging.advance(aimMs / 2);
    const aiming = rigging.mountPose("cannon");
    assert.notEqual(aiming.angle, idle.angle, "発射前に標的方向へ砲を旋回する");
    rigging.advance(aimMs / 2);
    const fired = rigging.mountPose("cannon");
    near((origin.x + 0.5) * 32, fired.muzzleX, "弾の始点と発射瞬間の砲口Xを一致させる");
    near((origin.y + 0.5) * 32, fired.muzzleY, "弾の始点と発射瞬間の砲口Yを一致させる");
    assert.equal(operations(draw(rigging), "fill").length, 1, "全体射撃でも砲口の発射光は一つ");
    rigging.advance(recoilMs);
    assert.ok(rigging.mountPose("cannon").recoil > 0, "発射後に砲身が後退する");
    near(rigging.originFor(plan.key).x, origin.x, "反動で飛翔中の弾の始点Xを動かさない");
    near(rigging.originFor(plan.key).y, origin.y, "反動で飛翔中の弾の始点Yを動かさない");
    rigging.advance(returnMs);
    near(rigging.mountPose("cannon").recoil, 0, "反動後は砲身が元へ戻る");
    rigging.advance(tailMs - recoilMs - returnMs - 1);
    assert.equal(rigging.hasActive(), true, "最後の煙が消える直前も共有時計を保つ");
    assert.ok(draw(rigging, "drawMounts").some(
      /** @param {Array} call 描画命令。 @returns {boolean} 薄い煙の色か。 */
      function isSmoke(call) { return call[0] === "fillStyle" && call[1] === "#b9c5ce"; }), "最後の煙は終端直前まで描画する");
    rigging.advance(1);
    assert.equal(rigging.hasActive(), false);
    assert.equal(draw(rigging).length, 0);
  }

  {
    for (const id of ["unknown", "constructor", "toString", "__proto__"]) {
      const snapshot = freezeInput(state([id], { attackFx: [shot(id)] }));
      const rigging = createBattleRiggingEffects();
      rigging.setLayout(32, 8); rigging.configure(snapshot); rigging.capture(snapshot, noWait);
      assert.ok(rigging.planFor(id), "未知の発射記録も安全な仮砲座へ割り当てる");
      rigging.advance(aimMs);
      const origin = rigging.originFor(rigging.planFor(id).key);
      assert.ok(Number.isFinite(origin.x) && Number.isFinite(origin.y));
      draw(rigging, "drawMounts"); draw(rigging);
    }
    for (const record of [shot("cannon", "missing"), shot("cannon", "target", { ttl: 1 }), shot("cannon", "target", { impact: false })]) {
      const rigging = createBattleRiggingEffects();
      const snapshot = state(["cannon"], { attackFx: [record] });
      rigging.setLayout(32, 8); rigging.configure(snapshot); rigging.capture(snapshot, noWait);
      assert.equal(rigging.hasActive(), false, "標的不在・持越しTTL・発射側だけの記録を再生しない");
    }
  }

  {
    const snapshot = state(["cannon"]);
    const rigging = createBattleRiggingEffects();
    rigging.setLayout(32, 8); rigging.configure(snapshot); rigging.capture(snapshot, oneStepWait);
    const plan = rigging.planFor("cannon");
    rigging.retain(new Set([plan.key]));
    assert.equal(rigging.hasActive(), true, "有効な攻撃クリップの発射予約は保つ");
    rigging.retain(new Set());
    assert.equal(rigging.hasActive(), false, "次の移動で省略した待機射撃の砲口光も取り消す");
    rigging.advance(1000);
    assert.equal(draw(rigging).length, 0, "取り消した発射を後から復活させない");
    rigging.clear(); rigging.configure(snapshot); rigging.capture(snapshot, noWait);
    rigging.advance(aimMs);
    rigging.retain(new Set());
    assert.equal(rigging.hasActive(), true, "発射済みなら攻撃クリップ削除後も反動・煙を収める");
    rigging.advance(tailMs);
    assert.equal(rigging.hasActive(), false, "発射済みの余韻も終了する");
    rigging.clear();
    assert.equal(rigging.visible(), false, "clearで以前の戦闘の装備を残さない");
    assert.equal(rigging.height(), 56, "clear後も帯の寸法は安全な値を返す");
    assert.equal(draw(rigging, "drawMounts").length, 0);
  }

  {
    const snapshot = freezeInput(state(["cannon"]));
    const rigging = createBattleRiggingEffects();
    rigging.setLayout(32, 8); rigging.configure(snapshot); rigging.capture(snapshot, noWait);
    rigging.advance(aimMs + 40);
    const plan = rigging.planFor("cannon");
    for (const [cell, size] of [[20, 8], [48, 12], [90, 16], [32, 8]]) {
      rigging.setLayout(cell, size);
      const origin = rigging.originFor(plan.key);
      const pose = rigging.mountPose("cannon");
      assert.ok(Number.isFinite(origin.x) && Number.isFinite(origin.y), "リサイズ後も弾の始点は有限値");
      assert.ok(pose.y >= size * cell && pose.y <= size * cell + rigging.height(), "リサイズ後も砲座を専用帯に収める");
      draw(rigging, "drawMounts", cell); draw(rigging, "drawFire", cell);
    }
    const before = draw(rigging);
    for (const delta of [0, -1, NaN, Infinity]) rigging.advance(delta);
    assert.deepEqual(draw(rigging), before, "不正な経過時間で反動・煙を進めない");
    for (const cell of [0, -1, NaN, Infinity]) {
      assert.equal(draw(rigging, "drawMounts", cell).length, 0, "不正なセル幅では砲座を描かない");
      assert.equal(draw(rigging, "drawFire", cell).length, 0, "不正なセル幅では発射光を描かない");
    }
    const standard = canvas(), highDensity = canvas();
    highDensity.ctx.canvas.width *= 2; highDensity.ctx.canvas.height *= 2;
    rigging.drawMounts(standard.ctx, 32); rigging.drawMounts(highDensity.ctx, 32);
    standard.assertRestored(); highDensity.assertRestored();
    assert.deepEqual(highDensity.calls, standard.calls, "DPR2のバッファでも同じ世界座標へ砲座と煙を描く");
  }

  {
    const snapshot = state(["cannon"]);
    const rigging = createBattleRiggingEffects();
    rigging.setLayout(32, 8); rigging.capture(snapshot, noWait);
    const plan = rigging.planFor("cannon");
    const origin = rigging.originFor(plan.key);
    snapshot.units[1].x = 1; snapshot.units[1].y = 6; snapshot.units[1].hp = 0;
    snapshot.attackFx[0].ttl = 1;
    rigging.capture(snapshot, noWait);
    assert.deepEqual(rigging.originFor(plan.key), origin, "同tickの標的移動・撃破・TTL更新後も最初の照準先を保持する");
    rigging.advance(aimMs);
    rigging.capture(state(["cannon"], { tick: 2, units: snapshot.units }), noWait);
    rigging.advance(aimMs);
    assert.deepEqual(rigging.originFor(plan.key), origin, "次tickの別照準と反動で前の弾の始点を変更しない");
    assert.notDeepEqual(rigging.originFor(rigging.planFor("cannon").key), origin, "新しい射撃は新しい標的座標へ照準する");
  }

  {
    const snapshot = freezeInput(state(["cannon"]));
    const original = JSON.stringify(snapshot);
    const clock = harness(createBattleEffectPlayer);
    clock.player.sync(snapshot);
    assert.equal(clock.player.hasRigging(), true);
    assert.equal(clock.player.riggingHeight(), 56);
    assert.equal(clock.draw().length, 0, "共通プレイヤーも照準時間を待つ");
    clock.advance(aimMs + 40);
    clock.player.pause();
    const paused = clock.draw(true);
    assert.equal(clock.pending.size, 0, "艤装の反動・煙も明示的な停止で予約を解除する");
    clock.jump(10000);
    assert.deepEqual(clock.draw(true), paused, "停止中に艤装の姿勢や煙を進めない");
    clock.player.sync(snapshot);
    assert.deepEqual(clock.draw(true), paused, "再開時に停止中の実時間を持ち越さない");
    clock.advance(BATTLE_EFFECT_RULES.supportMs - 40);
    assert.equal(clock.pending.size, 1, "着弾終了後も艤装の煙のために描画する");
    clock.advance(smokeMs - 1);
    assert.equal(clock.pending.size, 1);
    const rendered = clock.renders;
    clock.advance(1);
    assert.equal(clock.pending.size, 0, "最後の煙が消えると共有時計を止める");
    assert.equal(clock.renders, rendered + 1, "余韻の最終フレームも描画して画面から消す");
    assert.equal(clock.draw().length, 0);
    assert.equal(JSON.stringify(snapshot), original, "共有プレイヤーも艤装入力やHPを書き換えない");
  }

  for (const speed of [2, 4]) {
    const clock = harness(createBattleEffectPlayer);
    clock.player.sync(state(["cannon"], { speed }));
    const duration = (aimMs + tailMs) / speed;
    clock.advance(duration - 1);
    assert.equal(clock.pending.size, 1, `${speed}倍速でも艤装の最終フレームを残す`);
    clock.advance(1);
    assert.equal(clock.pending.size, 0, `${speed}倍速を照準・反動・煙へ同じように適用する`);
  }

  {
    const snapshot = state(["cannon"]);
    const clock = harness(createBattleEffectPlayer);
    clock.player.sync(snapshot); clock.advance(40);
    clock.player.sync(snapshot, true);
    assert.equal(clock.pending.size, 0, "非表示で待機射撃と余韻の予約を取り消す");
    assert.equal(clock.draw(true).length, 0, "非表示では前の戦闘の砲座も捨てる");
    clock.player.sync(snapshot);
    assert.equal(clock.pending.size, 0, "再表示で同tickの艤装を撃ち直さない");
    clock.player.sync({ ...snapshot, tick: 2 });
    assert.equal(clock.pending.size, 1, "再表示後の新tickは艤装を再開する");
    clock.advance(100);
    clock.player.clear();
    assert.equal(clock.pending.size, 0);
    assert.equal(clock.player.hasRigging(), false);
    assert.equal(clock.draw(true).length, 0);
    clock.player.sync(snapshot);
    assert.equal(clock.pending.size, 1, "clear後は同tickでも次の戦闘を開始できる");
    clock.player.sync({ ...snapshot, running: false, result: "win" });
    clock.advance(aimMs + tailMs);
    assert.equal(clock.pending.size, 0, "勝敗確定後も最後の艤装射撃を完了する");
  }

  {
    const snapshot = state(["cannon"], {
      moveFx: [{ id: "target", fromX: 5, fromY: 1, toX: 5, toY: 2, ttl: 3 }],
    });
    const clock = harness(createBattleEffectPlayer);
    clock.player.sync(snapshot); clock.advance(100); clock.jump(900);
    const next = state(["cannon"], { tick: 2, attackFx: [],
      moveFx: [{ id: "target", fromX: 5, fromY: 2, toX: 5, toY: 3, ttl: 3 }],
    });
    next.units[1].y = 3;
    clock.player.sync(next);
    for (let index = 0; index < 20 && clock.pending.size; index += 1) {
      clock.advance(100);
      assert.equal(clock.draw().length, 0, "標的の再移動で省略した旧射撃は照準後にも発射光を出さない");
    }
    assert.equal(clock.pending.size, 0, "省略した待機艤装のために余分な余韻時計を残さない");
  }
  console.log("艤装の装備順・砲口・照準・反動・全体斉射・余韻・入力保護・共有時計: 全項目成功");
}

main().catch(
  /** @param {Error} error 検証失敗。 @returns {void} 失敗を報告する。 */
  function report(error) { console.error(error); process.exitCode = 1; });
