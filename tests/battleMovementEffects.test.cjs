const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadTestModule } = require("./helpers/module.cjs");

/** @param {object} [changes] 上書き値。 @returns {object} 検証用の部隊。 */
function unit(changes = {}) {
  return { id: "walker", side: "ally", type: "infantry", status: "active", hp: 100,
    count: 10, x: 2, y: 2, traits: [], ...changes };
}

/** @param {string} id 部隊ID。 @param {number[]} from 移動元。 @param {number[]} to 移動先。 @param {object} [changes] 上書き値。 @returns {object} 確定済み移動。 */
function move(id, from, to, changes = {}) {
  return { id, side: "ally", fromX: from[0], fromY: from[1], toX: to[0], toY: to[1],
    ttl: 3, retreat: false, ...changes };
}

/** @param {object[]} [units] 部隊一覧。 @param {object[]} [moves] 確定済み移動。 @param {object} [changes] 上書き値。 @returns {object} 検証用戦闘状態。 */
function state(units = [unit()], moves = [move("walker", [1, 2], [2, 2])], changes = {}) {
  return { tick: 1, size: 8, running: true, speed: 1, result: null, units, moveFx: moves, attackFx: [],
    grid: Array.from({ length: 8 },
      /** @returns {string[]} 地形の行。 */
      function row() { return Array(8).fill("plain"); }), ...changes };
}

/** @param {object} value 入力値。 @returns {object} 再帰的に変更を禁止した入力。 */
function freezeInput(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") freezeInput(child);
  }
  return Object.freeze(value);
}

/** @param {number} actual 実際値。 @param {number} expected 期待値。 @param {string} message 検証内容。 @returns {void} 浮動小数の誤差内で一致することを確認する。 */
function near(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} / ${expected}`); }

/** @param {object} pose 表示姿勢。 @param {object} actor 部隊。 @returns {void} 論理座標と静止姿勢へ復帰したことを確認する。 */
function assertRest(pose, actor) {
  near(pose.x, actor.x, "静止時のXは論理座標");
  near(pose.y, actor.y, "静止時のYは論理座標");
  assert.equal(pose.angle, 0, "静止時に傾きを残さない");
  assert.equal(pose.bob, 0, "静止時に上下動を残さない");
  assert.equal(pose.scaleY, 1, "静止時に着地の変形を残さない");
  assert.equal(pose.alpha, 1, "静止時の不透明度を復元する");
  assert.equal(pose.moving, false, "終了した移動を表示し続けない");
}

/** @returns {object} 呼び出しと状態の漏れを記録するCanvas。 */
function canvas() {
  const calls = [];
  const stack = [];
  const values = { globalAlpha: 0.43, fillStyle: "original", strokeStyle: "original-line", lineWidth: 7 };
  const initial = { ...values };
  const ctx = {};
  for (const property of ["globalAlpha", "fillStyle", "strokeStyle", "lineWidth", "lineCap", "shadowColor", "shadowBlur"]) {
    Object.defineProperty(ctx, property, {
      /** @returns {*} 描画状態。 */
      get() { return values[property]; },
      /** @param {*} value 新しい描画状態。 @returns {void} */
      set(value) { values[property] = value; calls.push([property, value]); },
    });
  }
  /** @returns {void} 描画状態を保存する。 */
  ctx.save = function save() { stack.push({ ...values }); calls.push(["save"]); };
  /** @returns {void} 描画状態を復元する。 */
  ctx.restore = function restore() {
    assert.ok(stack.length, "保存されていない描画状態を復元しない");
    const restored = stack.pop();
    for (const property of Object.keys(values)) delete values[property];
    Object.assign(values, restored);
    calls.push(["restore"]);
  };
  for (const method of ["beginPath", "arc", "ellipse", "fill", "stroke", "moveTo", "lineTo", "quadraticCurveTo", "translate", "rotate", "scale", "closePath", "fillRect"]) {
    /** @param {...*} args 描画引数。 @returns {void} 引数を記録する。 */
    ctx[method] = function record(...args) {
      for (const value of args) if (typeof value === "number") assert.ok(Number.isFinite(value), "描画座標は有限値");
      calls.push([method, ...args]);
    };
  }
  return { ctx, calls,
    /** @returns {void} 足元描画がCanvasを汚さないことを確認する。 */
    assertRestored() { assert.equal(stack.length, 0); assert.deepEqual(values, initial); },
  };
}

/** @param {Function} createPlayer プレイヤー生成関数。 @returns {object} 手動時計つきのプレイヤー。 */
function harness(createPlayer) {
  let time = 0;
  let id = 0;
  let renders = 0;
  const pending = new Map();
  const player = createPlayer({
    /** @returns {number} 現在時刻。 */
    now() { return time; },
    /** @returns {void} 再描画回数を記録する。 */
    render() { renders += 1; },
    /** @param {Function} callback 次フレーム。 @returns {number} 予約番号。 */
    requestFrame(callback) { id += 1; pending.set(id, callback); return id; },
    /** @param {number} frameId 予約番号。 @returns {void} 予約を取り消す。 */
    cancelFrame(frameId) { pending.delete(frameId); },
  });
  player.setLayout(32, 8);
  return { player, pending,
    /** @returns {number} 再描画回数。 */
    get renders() { return renders; },
    /** @param {number} ms 経過時間。 @returns {void} 停止中などの時計だけを進める。 */
    jump(ms) { time += ms; },
    /** @param {number} ms 経過時間。 @returns {void} 予約した1フレームを進める。 */
    frame(ms) {
      assert.equal(pending.size, 1, "移動だけでも共有フレームを1件予約する");
      time += ms;
      const [frameId, callback] = pending.entries().next().value;
      pending.delete(frameId);
      callback(time);
      assert.ok(pending.size <= 1, "部隊数によらずフレーム予約を共有する");
    },
    /** @returns {number} 攻撃の可視図形数。 */
    attacks() {
      const drawing = canvas();
      player.draw(drawing.ctx, 32);
      drawing.assertRestored();
      return drawing.calls.filter(
        /** @param {Array} call 描画命令。 @returns {boolean} 実際の図形か。 */
        function visible(call) { return call[0] === "fill" || call[0] === "stroke"; }).length;
    },
  };
}

/** @returns {Promise<void>} 移動モデルと共通時計の受入条件を検証する。 */
async function main() {
  const deterministicMath = Object.create(Math);
  /** @returns {never} 表示側からゲームの乱数を消費することを禁止する。 */
  deterministicMath.random = function random() { throw new Error("移動演出はMath.randomを使わない"); };
  const context = vm.createContext({ Math: deterministicMath });
  const module = await loadTestModule("battleMovementEffects.js", context);
  const effects = await loadTestModule("battleEffects.js", context);
  const config = await loadTestModule("battleEffectConfig.js", context);
  const { createBattleMovementEffects } = module.namespace;
  const { createBattleEffectPlayer } = effects.namespace;
  const { MOVEMENT_EFFECT_RULES } = config.namespace;
  const oneStepMs = MOVEMENT_EFFECT_RULES.startMs + MOVEMENT_EFFECT_RULES.stepMs + MOVEMENT_EFFECT_RULES.settleMs;
  assert.equal(oneStepMs, 340, "1歩の表示時間");
  assert.equal(oneStepMs + MOVEMENT_EFFECT_RULES.stepMs, 520, "2歩の表示時間");

  {
    const movement = createBattleMovementEffects();
    const actor = unit();
    assertRest(movement.pose(actor), actor);
    assert.equal(movement.hasActive(), false);
    assert.equal(movement.remaining(actor.id), 0);
    movement.capture(state([actor]));
    assert.equal(movement.hasActive(), true);
    assert.equal(movement.remaining(actor.id), oneStepMs);
    near(movement.pose(actor).x, 1, "開始時は確定済み移動の出発点を表示する");
    movement.advance(150);
    const walking = movement.pose(actor);
    assert.ok(walking.x > 1 && walking.x < 2, "移動中はセル間を補間する");
    near(walking.y, 2, "横移動では経路のYを変えない");
    assert.equal(walking.moving, true);
    assert.ok(Number.isFinite(walking.angle) && Number.isFinite(walking.bob));
    movement.advance(189);
    assert.equal(movement.hasActive(), true, "着地の最終1msも保持する");
    movement.advance(1);
    assertRest(movement.pose(actor), actor);
    assert.equal(movement.remaining(actor.id), 0);
    assert.equal(movement.hasActive(), false);
  }

  {
    const actor = unit({ x: 2, y: 3 });
    const movement = createBattleMovementEffects();
    const snapshot = state([actor], [move(actor.id, [1, 2], [2, 2]), move(actor.id, [2, 2], [2, 3])]);
    movement.capture(snapshot);
    assert.equal(movement.remaining(actor.id), 520);
    movement.advance(150);
    const first = movement.pose(actor);
    assert.ok(first.x > 1 && first.x < 2, "曲がる前の1歩目を表示する");
    near(first.y, 2, "曲がる2歩を始点終点間の斜線で省略しない");
    movement.advance(180);
    const second = movement.pose(actor);
    near(second.x, 2, "2歩目は曲がり角から始まる");
    assert.ok(second.y > 2 && second.y < 3, "2歩目を別の区間として表示する");
    movement.advance(190);
    assertRest(movement.pose(actor), actor);
  }

  {
    const routed = unit({ id: "routed", status: "routing", x: 1, y: 2 });
    const friend = unit({ id: "friend", x: 3, y: 2 });
    const movement = createBattleMovementEffects();
    movement.capture(state([routed, friend], [
      move("routed", [3, 2], [2, 2], { retreat: true }),
      move("friend", [2, 2], [3, 2], { retreat: true }),
      move("routed", [2, 2], [1, 2], { retreat: true }),
    ]));
    assert.equal(movement.remaining("routed"), 520, "交換後の追加歩を配列順に連結する");
    assert.equal(movement.remaining("friend"), 340, "場所を譲った味方の移動は1歩");
    assert.equal(movement.pose(routed).routing, true);
    assert.equal(movement.pose(friend).routing, false, "場所譲りのretreatフラグを敗走と取り違えない");
    movement.advance(330);
    assert.ok(movement.pose(routed).x > 1 && movement.pose(routed).x < 2);
    near(movement.pose(friend).x, 3, "味方は交換先で着地する");
    movement.advance(190);
    assertRest(movement.pose(routed), routed);
    assertRest(movement.pose(friend), friend);
  }

  {
    const actor = unit();
    const movement = createBattleMovementEffects();
    const snapshot = state([actor]);
    movement.capture(snapshot);
    movement.advance(150);
    const before = movement.pose(actor);
    movement.capture(snapshot);
    near(movement.pose(actor).x, before.x, "同tickを取り込み直しても出発点へ戻らない");
    assert.equal(movement.remaining(actor.id), 190, "同tickの取り込みで寿命を延長しない");
    movement.capture(state([actor], [move(actor.id, [1, 2], [2, 2], { ttl: 2 })], { tick: 2 }));
    assert.equal(movement.remaining(actor.id), 190, "TTLが減った既存レコードを再登録しない");
    const next = unit({ x: 3 });
    movement.capture(state([next], [move(next.id, [2, 2], [3, 2])], { tick: 3 }));
    near(movement.pose(next).x, before.x, "未完の移動へ新tickを接続しても表示位置を跳ばさない");
    movement.advance(2000);
    assertRest(movement.pose(next), next);
    const returned = unit({ x: 2 });
    movement.capture(state([returned], [move(returned.id, [3, 2], [2, 2])], { tick: 4 }));
    movement.advance(150);
    assert.ok(movement.pose(returned).x > 2 && movement.pose(returned).x < 3, "戻る移動も始点から補間する");
    movement.clear();
    assertRest(movement.pose(returned), returned);
    assert.equal(movement.hasActive(), false);
    movement.capture(snapshot);
    assert.equal(movement.remaining(actor.id), oneStepMs, "clear後は同じtickも別の戦闘として登録できる");
  }

  {
    for (const invalid of [unit({ hp: 0 }), unit({ status: "destroyed" }), unit({ status: "reserve" })]) {
      const movement = createBattleMovementEffects();
      movement.capture(state([invalid]));
      assert.equal(movement.hasActive(), false, `${invalid.status}/${invalid.hp}の移動を表示しない`);
      assertRest(movement.pose(invalid), invalid);
    }
    const actor = unit();
    const movement = createBattleMovementEffects();
    movement.capture(state([actor]));
    movement.advance(150);
    const destroyed = unit({ hp: 0, status: "destroyed" });
    movement.capture(state([destroyed], [], { tick: 2 }));
    assert.equal(movement.hasActive(), false, "新tickで撃破された部隊の未完移動を破棄する");
    assertRest(movement.pose(destroyed), destroyed);
    const escaped = unit({ x: 0, status: "escaped" });
    movement.capture(state([escaped], [move(escaped.id, [1, 2], [0, 2], { retreat: true })], { tick: 3 }));
    assert.equal(movement.hasActive(), true, "同tickで端へ退出した兵の最後の移動を保持する");
    assert.equal(movement.pose(escaped).routing, true);
    movement.advance(300);
    assert.ok(movement.pose(escaped).alpha >= 0 && movement.pose(escaped).alpha < 1, "退出終盤は自然に薄くなる");
    movement.advance(40);
    assert.equal(movement.hasActive(), false, "退出した兵を残し続けない");
    assertRest(movement.pose(escaped), escaped);
  }

  {
    const snapshot = freezeInput(state());
    const before = JSON.stringify(snapshot);
    const first = createBattleMovementEffects();
    const second = createBattleMovementEffects();
    first.capture(snapshot);
    second.capture(snapshot);
    first.advance(150);
    second.advance(150);
    assert.deepEqual(first.pose(snapshot.units[0]), second.pose(snapshot.units[0]), "同IDの位相は再生ごとに変わらない");
    const drawing = canvas();
    first.drawGround(drawing.ctx, 32);
    drawing.assertRestored();
    assert.ok(drawing.calls.some(
      /** @param {Array} call 描画命令。 @returns {boolean} 足元の図形か。 */
      function visible(call) { return call[0] === "fill" || call[0] === "stroke"; }), "移動中の足元を描画する");
    const repeated = canvas();
    first.drawGround(repeated.ctx, 32);
    assert.deepEqual(repeated.calls, drawing.calls, "描画回数で砂埃の位置や進捗を変えない");
    first.clear();
    assert.equal(JSON.stringify(snapshot), before, "演出は入力の座標・HP・地形・TTLを変更しない");
  }

  {
    const poses = [];
    for (const changes of [{}, { type: "shield" }, { type: "cavalry", traits: ["mounted"] }]) {
      const actor = unit(changes);
      const movement = createBattleMovementEffects();
      movement.capture(state([actor]));
      movement.advance(150);
      poses.push(movement.pose(actor));
    }
    assert.ok(Math.abs(poses[1].bob) < Math.abs(poses[0].bob), "重装兵の上下動は歩兵より小さい");
    assert.ok(Math.abs(poses[2].bob) > Math.abs(poses[0].bob), "騎乗兵の上下動は歩兵より大きい");
    assert.ok(Math.abs(poses[1].angle) < Math.abs(poses[0].angle), "重装兵の前傾を抑える");
    assert.ok(Math.abs(poses[2].angle) > Math.abs(poses[0].angle), "騎乗兵は大きく前傾する");
    const actors = [unit(), unit({ id: "another", y: 4 })];
    const routes = [move(actors[0].id, [1, 2], [2, 2]), move(actors[1].id, [1, 4], [2, 4])];
    const first = createBattleMovementEffects();
    const reversed = createBattleMovementEffects();
    first.capture(state(actors, routes));
    reversed.capture(state([...actors].reverse(), [...routes].reverse()));
    first.advance(150);
    reversed.advance(150);
    assert.notEqual(first.pose(actors[0]).bob, first.pose(actors[1]).bob, "異なるIDは上下動の位相をずらす");
    assert.deepEqual(first.pose(actors[0]), reversed.pose(actors[0]), "部隊配列の順序を変えてもIDの位相を変えない");
  }

  {
    const groundCalls = new Map();
    for (const terrain of ["plain", "forest", "sea", "shoal", "deck"]) {
      const snapshot = state();
      snapshot.grid = snapshot.grid.map(
        /** @param {string[]} row 元の地形行。 @returns {string[]} 指定地形の行。 */
        function replace(row) { return row.map(
          /** @returns {string} 足元地形。 */
          function tile() { return terrain; }); });
      const movement = createBattleMovementEffects();
      movement.capture(freezeInput(snapshot));
      movement.advance(150);
      const drawing = canvas();
      movement.drawGround(drawing.ctx, 32);
      drawing.assertRestored();
      assert.ok(drawing.calls.length > 0, `${terrain}の足元演出を描く`);
      groundCalls.set(terrain, drawing.calls);
      movement.clear();
      const cleared = canvas();
      movement.drawGround(cleared.ctx, 32);
      assert.equal(cleared.calls.length, 0, "終了した移動の足元を残さない");
    }
    assert.notDeepEqual(groundCalls.get("plain"), groundCalls.get("forest"), "陸地の砂埃は地形色を反映する");
    assert.notDeepEqual(groundCalls.get("plain"), groundCalls.get("sea"), "水上では砂埃と異なる水紋を描く");
    assert.deepEqual(groundCalls.get("sea"), groundCalls.get("shoal"), "浅瀬も水紋の表現を共有する");
    assert.notDeepEqual(groundCalls.get("plain"), groundCalls.get("deck"), "甲板では短い踏み跡を描く");
  }

  {
    const actor = unit();
    const movement = createBattleMovementEffects();
    movement.capture(state([actor], [
      move(actor.id, [1, 2], [1, 2]),
      move(actor.id, [NaN, 2], [2, 2]),
      move(actor.id, [1, 2], [Infinity, 2]),
      move("missing", [1, 2], [2, 2]),
    ]));
    assert.equal(movement.hasActive(), false, "座標不正・移動距離ゼロ・部隊不在の記録を描かない");
    movement.capture(state([actor], undefined, { tick: 2 }));
    const before = movement.pose(actor);
    for (const elapsed of [0, -1, NaN, Infinity]) movement.advance(elapsed);
    assert.deepEqual(movement.pose(actor), before, "不正な経過時間で移動を進めない");
    const invalidCell = canvas();
    for (const cell of [0, -1, NaN, Infinity]) movement.drawGround(invalidCell.ctx, cell);
    assert.equal(invalidCell.calls.length, 0, "不正なセル幅の足元を描かない");
    movement.capture(state([], [], { tick: 3 }));
    assert.equal(movement.hasActive(), false, "一覧から除かれた兵の未完移動を破棄する");
  }

  {
    const snapshot = state();
    const clock = harness(createBattleEffectPlayer);
    clock.player.sync(snapshot);
    assert.equal(clock.pending.size, 1, "攻撃がないtickでも移動時計を開始する");
    near(clock.player.unitPose(snapshot.units[0]).x, 1, "共通プレイヤーから移動姿勢を取得する");
    clock.frame(100);
    clock.frame(50);
    const paused = clock.player.unitPose(snapshot.units[0]);
    clock.player.sync({ ...snapshot, running: false });
    assert.equal(clock.pending.size, 0, "移動も一時停止でフレームを解除する");
    clock.jump(10000);
    assert.deepEqual(clock.player.unitPose(snapshot.units[0]), paused, "停止中に表示姿勢を進めない");
    clock.player.sync(snapshot);
    assert.deepEqual(clock.player.unitPose(snapshot.units[0]), paused, "再開時に停止中の実時間を持ち越さない");
    clock.frame(100);
    clock.frame(89);
    const beforeFinishRenders = clock.renders;
    clock.frame(1);
    assertRest(clock.player.unitPose(snapshot.units[0]), snapshot.units[0]);
    assert.equal(clock.renders, beforeFinishRenders + 1, "最終フレームも再描画して着地変形を消す");
    assert.equal(clock.pending.size, 0, "移動完了で時計の予約を止める");
  }

  {
    for (const speed of [2, 4]) {
      const snapshot = state(undefined, undefined, { speed });
      const clock = harness(createBattleEffectPlayer);
      clock.player.sync(snapshot);
      const duration = oneStepMs / speed;
      if (duration > 100) clock.frame(100);
      clock.frame(duration > 100 ? duration - 101 : duration - 1);
      assert.equal(clock.player.unitPose(snapshot.units[0]).moving, true, `${speed}倍速でも終了1ms前まで移動を保持する`);
      clock.frame(1);
      assertRest(clock.player.unitPose(snapshot.units[0]), snapshot.units[0]);
      assert.equal(clock.pending.size, 0);
    }
    const snapshot = state();
    const clock = harness(createBattleEffectPlayer);
    clock.player.sync(snapshot);
    clock.frame(100);
    const before = clock.player.unitPose(snapshot.units[0]);
    clock.player.sync({ ...snapshot, speed: 2 });
    assert.deepEqual(clock.player.unitPose(snapshot.units[0]), before, "倍率変更で表示位置を戻さない");
    clock.frame(100);
    clock.frame(20);
    assertRest(clock.player.unitPose(snapshot.units[0]), snapshot.units[0]);
    const delayed = harness(createBattleEffectPlayer);
    const regular = harness(createBattleEffectPlayer);
    delayed.player.sync(snapshot);
    regular.player.sync(snapshot);
    delayed.frame(5000);
    regular.frame(100);
    assert.deepEqual(delayed.player.unitPose(snapshot.units[0]), regular.player.unitPose(snapshot.units[0]),
      "長いフレーム落ちでも移動は共通時計の最大100msだけ進む");
  }

  {
    const snapshot = freezeInput(state());
    const before = JSON.stringify(snapshot);
    const clock = harness(createBattleEffectPlayer);
    clock.player.sync(snapshot);
    clock.frame(100);
    clock.player.sync({ ...snapshot, running: false, result: "win" });
    assert.equal(clock.pending.size, 1, "勝敗確定後も最後の移動を再生する");
    const drawing = canvas();
    clock.player.drawGround(drawing.ctx, 32);
    drawing.assertRestored();
    clock.frame(100); clock.frame(100); clock.frame(40);
    assertRest(clock.player.unitPose(snapshot.units[0]), snapshot.units[0]);
    assert.equal(clock.pending.size, 0, "戦闘最終tickの移動が終わったら予約を止める");
    clock.player.clear();
    assert.equal(JSON.stringify(snapshot), before, "共通プレイヤーも確定済み戦闘入力を変更しない");
  }

  {
    const snapshot = state();
    const clock = harness(createBattleEffectPlayer);
    clock.player.sync(snapshot);
    clock.frame(100);
    clock.player.pause();
    const paused = clock.player.unitPose(snapshot.units[0]);
    clock.jump(10000);
    assert.deepEqual(clock.player.unitPose(snapshot.units[0]), paused, "明示的pauseも移動を凍結する");
    clock.player.sync(snapshot);
    clock.player.sync(snapshot, true);
    assert.equal(clock.pending.size, 0);
    assertRest(clock.player.unitPose(snapshot.units[0]), snapshot.units[0]);
    clock.player.sync(snapshot);
    assert.equal(clock.pending.size, 0, "非表示後に同tickの移動を再生し直さない");
    clock.player.sync({ ...snapshot, tick: 2 });
    assert.equal(clock.pending.size, 1, "再表示後の新tickで移動を再開する");
    clock.player.clear();
    assertRest(clock.player.unitPose(snapshot.units[0]), snapshot.units[0]);
    assert.equal(clock.pending.size, 0);
    clock.player.sync(snapshot);
    assert.equal(clock.pending.size, 1, "clear後は次の戦闘を同tickでも始められる");
  }

  {
    const attacker = unit({ type: "archer" });
    const target = unit({ id: "target", side: "enemy", x: 5 });
    const unrelated = unit({ id: "other", x: 7, y: 6 });
    const snapshot = state([attacker, target, unrelated], [
      move(attacker.id, [1, 2], [2, 2]),
      move(target.id, [5, 1], [5, 2]),
      move(unrelated.id, [5, 5], [6, 5]), move(unrelated.id, [6, 5], [7, 5]), move(unrelated.id, [7, 5], [7, 6]),
    ], { attackFx: [{ from: attacker.id, to: target.id, ttl: 2, impact: true }] });
    const clock = harness(createBattleEffectPlayer);
    clock.player.sync(snapshot);
    assert.equal(clock.attacks(), 0, "移動中の射手や標的の論理位置から先に発射しない");
    clock.frame(100); clock.frame(100); clock.frame(100); clock.frame(39);
    assert.equal(clock.attacks(), 0, "関連する移動が完了するまで射撃を待つ");
    clock.frame(1);
    assert.ok(clock.attacks() > 0, "無関係な長い移動は攻撃を待たせない");
    assert.equal(clock.player.unitPose(unrelated).moving, true);
    const support = harness(createBattleEffectPlayer);
    support.player.sync(state([target], [move(target.id, [5, 1], [5, 2])], {
      attackFx: [{ support: true, equipmentId: "cannon", to: target.id, ttl: 2, impact: true }],
    }));
    assert.equal(support.attacks(), 0, "艤装も移動中の標的への着弾を待つ");
    support.frame(100); support.frame(100); support.frame(100); support.frame(40);
    assert.equal(support.attacks(), 0, "艤装は標的の移動完了後も照準を待つ");
    support.frame(79);
    assert.equal(support.attacks(), 0, "照準終了の1ms前にはまだ発射しない");
    support.frame(1);
    assert.ok(support.attacks() > 0, "標的の移動完了と80ms照準の後で艤装攻撃を開始する");
    const longest = harness(createBattleEffectPlayer);
    longest.player.sync(state([attacker, target], [
      move(attacker.id, [1, 2], [2, 2]),
      move(target.id, [5, 0], [5, 1]), move(target.id, [5, 1], [5, 2]),
    ], { attackFx: [{ from: attacker.id, to: target.id, ttl: 2, impact: true }] }));
    for (let frame = 0; frame < 5; frame += 1) longest.frame(100);
    longest.frame(19);
    assert.equal(longest.attacks(), 0, "攻撃元が先に着地しても標的の2歩目の完了を待つ");
    longest.frame(1);
    assert.ok(longest.attacks() > 0, "始点終点のうち長い移動時間だけ待って攻撃する");
    const stationary = harness(createBattleEffectPlayer);
    stationary.player.sync(state([attacker, target, unrelated], [move(unrelated.id, [6, 6], [7, 6])], {
      attackFx: [{ from: attacker.id, to: target.id, ttl: 2, impact: true }],
    }));
    assert.ok(stationary.attacks() > 0, "始点終点が静止していれば無関係な移動を待たず攻撃する");
  }

  {
    const attacker = unit({ type: "archer" });
    const target = unit({ id: "target", side: "enemy", x: 5 });
    const attack = { from: attacker.id, to: target.id, ttl: 2, impact: true };
    const firstTick = freezeInput(state([attacker, target], undefined, { attackFx: [attack] }));
    const nextAttacker = unit({ type: "archer", x: 3 });
    for (const attackFx of [[], [attack]]) {
      const clock = harness(createBattleEffectPlayer);
      clock.player.sync(firstTick);
      clock.frame(100);
      clock.jump(900);
      const nextTick = freezeInput(state([nextAttacker, target], [move(attacker.id, [2, 2], [3, 2])],
        { tick: 2, attackFx }));
      const original = JSON.stringify(nextTick);
      clock.player.sync(nextTick);
      const continued = clock.player.unitPose(nextAttacker);
      assert.ok(continued.x > 1 && continued.x < 2, "新tickの前に最大100msだけ旧移動を進め、その位置から継続する");
      clock.frame(100);
      clock.frame(40);
      assert.equal(clock.attacks(), 0, "遅延した旧射撃を途中の旧終点から空中発射しない");
      clock.frame(100);
      clock.frame(79);
      assert.equal(clock.attacks(), 0, "新射撃も継続移動の最終到着まで待つ");
      clock.frame(1);
      assertRest(clock.player.unitPose(nextAttacker), nextAttacker);
      if (attackFx.length) {
        const drawing = canvas();
        clock.player.draw(drawing.ctx, 32);
        drawing.assertRestored();
        const fresh = harness(createBattleEffectPlayer);
        fresh.player.sync(state([nextAttacker, target], [], { attackFx: [attack] }));
        const expected = canvas();
        fresh.player.draw(expected.ctx, 32);
        assert.deepEqual(drawing.calls, expected.calls, "最終到着x=3から発射する現在tickの弾だけを残す");
        const muzzle = drawing.calls.find(
          /** @param {Array} call 描画命令。 @returns {boolean} 発射光か。 */
          function isMuzzle(call) { return call[0] === "arc"; });
        assert.ok(muzzle, "新しい発射光を描く");
        near(muzzle[1], (nextAttacker.x + 0.5) * 32, "発射光は新しい到着位置に一致する");
      } else {
        assert.equal(clock.attacks(), 0, "新tickに射撃がなければ古い弾を後から復活させない");
        assert.equal(clock.pending.size, 0, "破棄した古い射撃のために余分なフレームを残さない");
      }
      assert.equal(JSON.stringify(nextTick), original, "古い表示を省略しても確定済み攻撃やHPを変更しない");
    }

    const unrelated = unit({ id: "other", x: 7, y: 6 });
    const independent = harness(createBattleEffectPlayer);
    independent.player.sync(state([attacker, target, unrelated], undefined, { attackFx: [attack] }));
    independent.frame(100);
    independent.jump(900);
    independent.player.sync(state([attacker, target, unrelated], [
      move(attacker.id, [1, 2], [2, 2], { ttl: 2 }),
      move(unrelated.id, [6, 6], [7, 6]),
    ], { tick: 2 }));
    independent.frame(100);
    independent.frame(40);
    assert.ok(independent.attacks() > 0, "無関係な兵の新移動や前tickのTTL減少は待機中の射撃を消さない");
    assert.equal(independent.player.unitPose(unrelated).moving, true);

    const movingTarget = unit({ id: "target", side: "enemy", x: 5, y: 3 });
    for (const source of [attack, { support: true, equipmentId: "cannon", to: target.id, ttl: 2, impact: true }]) {
      const clock = harness(createBattleEffectPlayer);
      clock.player.sync(state([attacker, target], [move(target.id, [5, 1], [5, 2])], { attackFx: [source] }));
      clock.frame(100);
      clock.jump(900);
      clock.player.sync(state([attacker, movingTarget], [move(target.id, [5, 2], [5, 3])], { tick: 2 }));
      clock.frame(100);
      clock.frame(40);
      assert.equal(clock.attacks(), 0, "標的が再移動した場合も旧射撃・艤装着弾を旧位置へ表示しない");
    }
  }

  console.log("移動演出の経路・連結・退出・入力保護・足元描画・共有時計: 全項目成功");
}

main().catch(
  /** @param {Error} error 検証失敗。 @returns {void} */
  function report(error) { console.error(error); process.exitCode = 1; });
