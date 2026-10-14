const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadTestModule } = require("./helpers/module.cjs");

/** @param {object} value 入力値。 @returns {object} 再帰的に変更を禁止した値。 */
function freezeInput(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") freezeInput(child);
  }
  return Object.freeze(value);
}

/** @returns {number} 静止標的は移動を待たない。 */
function noWait() { return 0; }

/** @returns {object} 描画引数の有限性と描画状態の復元を検証するCanvas。 */
function canvas() {
  const calls = [];
  const stack = [];
  const values = { globalAlpha: 0.43, fillStyle: "original", strokeStyle: "original-line", lineWidth: 7,
    lineCap: "square", shadowColor: "transparent", shadowBlur: 0 };
  const initial = { ...values };
  const ctx = {};
  for (const property of Object.keys(values)) {
    Object.defineProperty(ctx, property, {
      /** @returns {*} 現在の描画値。 */
      get() { return values[property]; },
      /** @param {*} value 新しい描画値。 @returns {void} 数値の安全性を確認して記録する。 */
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
  /** @returns {void} 描画状態を復元する。 */
  ctx.restore = function restore() {
    assert.ok(stack.length, "保存した状態だけを復元する");
    Object.assign(values, stack.pop());
    calls.push(["restore"]);
  };
  for (const method of ["beginPath", "moveTo", "lineTo", "quadraticCurveTo", "closePath", "arc", "ellipse", "fill", "stroke", "fillRect"]) {
    /** @param {...*} args 描画引数。 @returns {void} 非有限座標と負の半径を拒否する。 */
    ctx[method] = function record(...args) {
      for (const value of args) if (typeof value === "number") assert.ok(Number.isFinite(value), `${method}の引数は有限値`);
      if (method === "arc" || method === "ellipse") assert.ok(args[2] >= 0, "半径は負にしない");
      if (method === "ellipse") assert.ok(args[3] >= 0, "縦半径も負にしない");
      calls.push([method, ...args]);
    };
  }
  return { ctx, calls,
    /** @returns {void} 図形描画後に元の文脈へ戻ったことを確認する。 */
    assertRestored() { assert.equal(stack.length, 0); assert.deepEqual(values, initial); },
  };
}

/** @param {Array} calls 描画記録。 @param {string} name 命令名。 @returns {Array} 指定した描画命令。 */
function operations(calls, name) {
  return calls.filter(
    /** @param {Array} call 描画命令。 @returns {boolean} 一致する命令か。 */
    function matches(call) { return call[0] === name; });
}

/** @param {object} [changes] 上書き。 @returns {object} 描画用の確定済み攻撃。 */
function clip(changes = {}) {
  return { fromId: "attacker", toId: "target", fromX: 1, fromY: 2, toX: 5, toY: 2,
    color: "#ffd447", category: "slash", support: null, equipmentId: null, fire: false,
    crit: false, age: 182, duration: 260, muzzle: true, ...changes };
}

/** @param {Function} draw 描画関数。 @param {object} attack 確定済み攻撃。 @param {number} [cell] セル幅。 @returns {Array} 安全性確認済み描画。 */
function drawClip(draw, attack, cell = 32) {
  const drawing = canvas();
  draw(drawing.ctx, attack, cell);
  drawing.assertRestored();
  return drawing.calls;
}

/** @param {Array} calls 描画命令。 @returns {string} 色に依存しない図形の形状。 */
function shape(calls) {
  return JSON.stringify(calls.filter(
    /** @param {Array} call 描画命令。 @returns {boolean} 図形の形を指定する命令か。 */
    function geometry(call) { return ["moveTo", "lineTo", "quadraticCurveTo", "closePath", "arc", "ellipse", "fillRect"].includes(call[0]); }));
}

/** @param {object} [changes] 上書き。 @returns {object} 検証用の兵。 */
function unit(changes = {}) {
  return { id: "attacker", type: "infantry", side: "ally", status: "active", hp: 100,
    count: 10, x: 1, y: 2, traits: [], ...changes };
}

/** @param {string} [type] 攻撃側の兵種。 @param {object} [changes] 戦闘状態の上書き。 @returns {object} 攻撃1件を含む戦闘状態。 */
function state(type = "infantry", changes = {}) {
  return { tick: 1, size: 8, speed: 1, running: true, result: null, moveFx: [],
    units: [unit({ type }), unit({ id: "target", side: "enemy", x: 5 })],
    attackFx: [{ from: "attacker", to: "target", impact: true, ttl: 2 }], ...changes };
}

/** @param {Function} createPlayer 共通プレイヤーの生成関数。 @returns {object} 手動時計と描画観測。 */
function harness(createPlayer) {
  let time = 0;
  let id = 0;
  const pending = new Map();
  const player = createPlayer({
    /** @returns {number} 現在の手動時刻。 */
    now() { return time; },
    /** @returns {void} 再描画要求を受け取る。 */
    render() {},
    /** @param {Function} callback 次フレーム。 @returns {number} 予約番号。 */
    requestFrame(callback) { id += 1; pending.set(id, callback); return id; },
    /** @param {number} frameId 予約番号。 @returns {void} フレームを解除する。 */
    cancelFrame(frameId) { pending.delete(frameId); },
  });
  player.setLayout(32, 8);
  return { player, pending,
    /** @param {number} ms 経過時間。 @returns {void} 演出時計を進めず実時間だけ進める。 */
    jump(ms) { time += ms; },
    /** @param {number} ms 経過時間。 @returns {void} 100ms以下のフレームへ分割して進める。 */
    advance(ms) {
      let remaining = ms;
      while (remaining > 0) {
        assert.equal(pending.size, 1, "有効な攻撃のフレーム予約は1件");
        const elapsed = Math.min(100, remaining);
        const [frameId, callback] = pending.entries().next().value;
        pending.delete(frameId);
        time += elapsed;
        callback(time);
        remaining -= elapsed;
        assert.ok(pending.size <= 1, "攻撃数によらず時計を共有する");
      }
    },
    /** @returns {Array} 現在の攻撃描画。 */
    draw() { const drawing = canvas(); player.draw(drawing.ctx, 32); drawing.assertRestored(); return drawing.calls; },
  };
}

/** @param {object} pose 兵の姿勢。 @returns {void} 攻撃による変形が消えていることを確認する。 */
function assertRest(pose) {
  assert.equal(pose.attackX, 0, "静止時に攻撃の横ずれを残さない");
  assert.equal(pose.attackY, 0, "静止時に攻撃の縦ずれを残さない");
  assert.equal(pose.attackAngle, 0, "静止時に攻撃の傾きを残さない");
  assert.equal(pose.attackScaleY, 1, "静止時に攻撃の変形を残さない");
  assert.equal(pose.hitFlash, 0, "命中の明滅を残さない");
}

/** @returns {Promise<void>} 5形状の描画と共通時計へ合成した攻撃姿勢を検証する。 */
async function main() {
  const deterministicMath = Object.create(Math);
  /** @returns {never} 表示によるゲーム乱数の消費を禁止する。 */
  deterministicMath.random = function random() { throw new Error("攻撃演出はMath.randomを使わない"); };
  const context = vm.createContext({ Math: deterministicMath });
  const attackModule = await loadTestModule("battleAttackEffects.js", context);
  const riggingModule = await loadTestModule("battleRiggingEffects.js", context);
  const effectsModule = await loadTestModule("battleEffects.js", context);
  const configModule = await loadTestModule("battleEffectConfig.js", context);
  const { drawBattleAttack } = attackModule.namespace;
  const { createBattleRiggingEffects } = riggingModule.namespace;
  const { createBattleEffectPlayer } = effectsModule.namespace;
  const { ATTACK_EFFECT_STYLES, SUPPORT_EFFECT_STYLES, SUPPORT_ATTACK_CATEGORIES } = configModule.namespace;
  const categories = ["slash", "thrust", "strike", "projectile", "blast"];
  assert.deepEqual(Object.keys(ATTACK_EFFECT_STYLES), categories, "5カテゴリの調整値を共通設定へ集約する");
  assert.equal(SUPPORT_ATTACK_CATEGORIES.harpoon, "projectile");
  assert.equal(SUPPORT_ATTACK_CATEGORIES.ballista, "projectile");
  assert.equal(SUPPORT_ATTACK_CATEGORIES.grape_ballista, "projectile");
  for (const id of ["fire_ballista", "fire_grape_ballista", "cannon"]) assert.equal(SUPPORT_ATTACK_CATEGORIES[id], "blast");

  const shapes = new Set();
  for (const category of categories) {
    const attack = freezeInput(clip({ category }));
    const original = JSON.stringify(attack);
    const first = drawClip(drawBattleAttack, attack);
    assert.ok(operations(first, "fill").length + operations(first, "stroke").length > 0, `${category}は命中付近に図形を描く`);
    shapes.add(shape(first));
    assert.deepEqual(drawClip(drawBattleAttack, attack), first, `${category}は再描画で粒や進捗が変わらない`);
    assert.equal(JSON.stringify(attack), original, `${category}は確定済み情報を変更しない`);
    for (const cell of [20, 32, 48, 90]) {
      for (const progress of [-0.1, 0, 0.12, 0.35, 0.5, 0.7, 0.97, 1]) {
        const calls = drawClip(drawBattleAttack, freezeInput(clip({ category, age: 260 * progress })), cell);
        if (progress < 0) assert.equal(calls.length, 0, "移動を待つ攻撃は図形も状態変更も行わない");
      }
      for (const progress of [0.2, 0.7]) {
        drawClip(drawBattleAttack, freezeInput(clip({ category, fromX: 5, fromY: 2, age: 260 * progress })), cell);
      }
    }
  }
  assert.equal(shapes.size, 5, "同じ色でも5カテゴリの図形が区別できる");
  for (const category of ["unknown", "constructor", "toString", "__proto__"]) {
    assert.deepEqual(drawClip(drawBattleAttack, clip({ category })), drawClip(drawBattleAttack, clip()),
      "未知カテゴリは斬撃へ安全に戻す");
  }
  for (const invalid of [{ age: NaN }, { age: -1 }, { age: 260 }, { duration: 0 }, { fromX: Infinity }, { toY: NaN }]) {
    assert.equal(drawClip(drawBattleAttack, clip(invalid)).length, 0, "待機・終了・不正な記録を描かない");
  }
  for (const cell of [0, -1, NaN, Infinity]) assert.equal(drawClip(drawBattleAttack, clip(), cell).length, 0, "不正なセル幅を描かない");
  {
    const normal = operations(drawClip(drawBattleAttack, clip({ category: "blast" })), "arc")[0];
    const critical = operations(drawClip(drawBattleAttack, clip({ category: "blast", crit: true })), "arc")[0];
    assert.ok(Math.abs(critical[3] / normal[3] - 1.2) < 1e-8, "会心は共通図形を約1.2倍にする");
    const small = operations(drawClip(drawBattleAttack, clip({ category: "blast" }), 20), "arc")[0];
    const large = operations(drawClip(drawBattleAttack, clip({ category: "blast" }), 90), "arc")[0];
    assert.ok(Math.abs(large[3] / small[3] - 4.5) < 1e-8, "攻撃の図形サイズはセル幅へ比例する");
  }

  for (const [type, category] of [["infantry", "slash"], ["halberd", "thrust"], ["shield", "strike"],
    ["archer", "projectile"], ["crossbow", "projectile"], ["seaArcher", "projectile"], ["pirate_archer", "projectile"],
    ["unknown", "slash"], ["constructor", "slash"], ["toString", "slash"], ["__proto__", "slash"]]) {
    const clock = harness(createBattleEffectPlayer);
    clock.player.sync(state(type)); clock.advance(182);
    const duration = category === "projectile" ? 300 : 260;
    assert.deepEqual(clock.draw(), drawClip(drawBattleAttack, clip({ category, age: 182, duration })),
      `${type}の記録を${category}の共有図形へ接続する`);
  }
  for (const equipmentId of ["harpoon", "ballista", "grape_ballista", "fire_ballista", "fire_grape_ballista", "cannon", "unknown", "constructor", "toString", "__proto__"]) {
    const clock = harness(createBattleEffectPlayer);
    const snapshot = state("infantry", { attackFx: [{ support: true, equipmentId, to: "target", ttl: 2, impact: true }] });
    clock.player.sync(snapshot);
    clock.advance(80 + 294);
    const rigging = createBattleRiggingEffects();
    rigging.setLayout(32, 8); rigging.capture(snapshot, noWait);
    const origin = rigging.originFor(rigging.planFor(equipmentId).key);
    const style = Object.hasOwn(SUPPORT_EFFECT_STYLES, equipmentId) ? SUPPORT_EFFECT_STYLES[equipmentId] : SUPPORT_EFFECT_STYLES.harpoon;
    const category = Object.hasOwn(SUPPORT_ATTACK_CATEGORIES, equipmentId) ? SUPPORT_ATTACK_CATEGORIES[equipmentId] : "projectile";
    assert.deepEqual(clock.draw(), drawClip(drawBattleAttack, clip({ fromX: origin.x, fromY: origin.y, category, support: style,
      color: style.color, equipmentId, fire: equipmentId.startsWith("fire_"), age: 294, duration: 420, muzzle: false })),
    `${equipmentId}の艤装は対応する共有図形と炎へ接続する`);
  }

  {
    const right = drawClip(drawBattleAttack, clip({ category: "projectile", age: 78 }));
    const left = drawClip(drawBattleAttack, clip({ category: "projectile", fromX: 5, toX: 1, age: 78 }));
    const rightStart = operations(right, "moveTo")[0];
    const rightEnd = operations(right, "lineTo")[0];
    const leftStart = operations(left, "moveTo")[0];
    const leftEnd = operations(left, "lineTo")[0];
    assert.ok(rightStart && rightEnd && leftStart && leftEnd, "射撃は飛行中の軌跡を描く");
    assert.ok(rightEnd[1] > rightStart[1], "味方側の弾道は標的側へ進む");
    assert.ok(leftEnd[1] < leftStart[1], "敵側の弾道は逆向きに進む");
    for (const category of ["slash", "thrust", "strike"]) {
      const forward = drawClip(drawBattleAttack, clip({ category, age: 130 }));
      const reverse = drawClip(drawBattleAttack, clip({ category, fromX: 5, toX: 1, age: 130 }));
      assert.notEqual(shape(forward), shape(reverse), `${category}も敵側からの攻撃位置・向きを反映する`);
    }
  }

  {
    const attack = clip({ category: "blast", equipmentId: "cannon", support: SUPPORT_EFFECT_STYLES.cannon, age: 0, duration: 420 });
    assert.equal(operations(drawClip(drawBattleAttack, attack), "fill").length, 1, "艤装の最初の発射光は1回");
    assert.equal(operations(drawClip(drawBattleAttack, { ...attack, muzzle: false }), "fill").length, 0, "同じ斉射の2標的目は発射光を重ねない");
    const normal = drawClip(drawBattleAttack, { ...attack, age: 302.4 });
    const burning = drawClip(drawBattleAttack, freezeInput({ ...attack, age: 302.4, fire: true }));
    assert.notDeepEqual(burning, normal, "火属性は共通形状へ炎を追加する");
    const clock = harness(createBattleEffectPlayer);
    const snapshot = freezeInput(state("infantry", {
      units: [unit({ id: "target", side: "enemy", x: 5 }), unit({ id: "second", side: "enemy", x: 6, y: 4 })],
      attackFx: [{ support: true, equipmentId: "cannon", to: "target", impact: true, ttl: 2 },
        { support: true, equipmentId: "cannon", to: "second", impact: true, ttl: 2 }],
    }));
    clock.player.sync(snapshot);
    assert.equal(operations(clock.draw(), "fill").length, 0, "照準待ちの全体艤装は発射光を出さない");
    clock.advance(80);
    assert.equal(operations(clock.draw(), "fill").length, 1, "全体艤装はプレイヤー側でも発射光を集約する");
    clock.advance(302.4);
    const impacts = operations(clock.draw(), "arc");
    for (const target of snapshot.units) {
      assert.ok(impacts.some(
        /** @param {Array} call 円の描画命令。 @returns {boolean} 指定標的の着弾円か。 */
        function atTarget(call) { return Math.abs(call[1] - (target.x + 0.5) * 32) < 1e-8 && Math.abs(call[2] - (target.y + 0.5) * 32) < 1e-8; }), "全体艤装の着弾は標的ごとに残す");
    }
  }

  for (const reversed of [false, true]) {
    const records = [{ support: true, equipmentId: "cannon", to: "target", impact: true, ttl: 2 },
      { support: true, equipmentId: "cannon", to: "second", impact: true, ttl: 2 }];
    if (reversed) records.reverse();
    const snapshot = freezeInput(state("infantry", {
      units: [unit({ id: "target", side: "enemy", x: 5 }), unit({ id: "second", side: "enemy", x: 6, y: 4 })],
      moveFx: [{ id: "target", side: "enemy", fromX: 5, fromY: 1, toX: 5, toY: 2, ttl: 3 }],
      attackFx: records,
    }));
    const before = JSON.stringify(snapshot);
    const clock = harness(createBattleEffectPlayer);
    clock.player.sync(snapshot);
    assert.equal(clock.draw().length, 0, "全体艤装は静止標的だけ先に撃たず、移動中の同時標的を待つ");
    clock.advance(419);
    assert.equal(clock.draw().length, 0, "全体艤装は最長移動と照準の終了1ms前も両弾を待つ");
    clock.advance(1);
    assert.equal(operations(clock.draw(), "fill").length, 1, "全標的の到着後に艤装の発射光を1回だけ描く");
    clock.advance(100);
    assert.equal(operations(clock.draw(), "lineTo").length, 2, "同じ艤装の2発が発射光の後で一緒に飛ぶ");
    clock.advance(194);
    const impacts = operations(clock.draw(), "arc");
    for (const target of snapshot.units) {
      assert.ok(impacts.some(
        /** @param {Array} call 円の描画命令。 @returns {boolean} 移動後の標的への着弾か。 */
        function atTarget(call) { return Math.abs(call[1] - (target.x + 0.5) * 32) < 1e-8 && Math.abs(call[2] - (target.y + 0.5) * 32) < 1e-8; }),
      "待機した斉射も全標的の最終座標へ着弾する");
    }
    assert.equal(JSON.stringify(snapshot), before, "斉射の待機統一でも攻撃記録を変更しない");
  }

  for (const [type, category] of [["infantry", "slash"], ["halberd", "thrust"], ["shield", "strike"], ["archer", "projectile"]]) {
    const snapshot = freezeInput(state(type));
    const original = JSON.stringify(snapshot);
    const clock = harness(createBattleEffectPlayer);
    const attacker = snapshot.units[0];
    const target = snapshot.units[1];
    const duration = category === "projectile" ? 300 : 260;
    const style = ATTACK_EFFECT_STYLES[category];
    clock.player.sync(snapshot);
    assertRest(clock.player.unitPose(attacker));
    assertRest(clock.player.unitPose(target));
    clock.advance(duration * Math.max(style.windup * 0.6, 0.1));
    const anticipation = clock.player.unitPose(attacker);
    if (style.windup > 0) assert.ok(anticipation.attackX < 0 || anticipation.attackScaleY < 1, `${category}は踏み込みの前に構える`);
    clock.advance(duration * (style.impactAt - Math.max(style.windup * 0.6, 0.1)));
    const impact = clock.player.unitPose(attacker);
    assert.ok(impact.attackX > 0, `${category}は命中方向へ踏み込む`);
    assert.equal(impact.x, attacker.x, "踏み込みで論理セルや移動の座標を変えない");
    assert.ok(Number.isFinite(impact.attackAngle) && Number.isFinite(impact.attackScaleY));
    clock.advance(duration * 0.025);
    const hit = clock.player.unitPose(target);
    assert.ok(hit.hitFlash > 0 && hit.hitFlash <= 0.8, `${category}は命中時刻に短い明滅を出す`);
    clock.advance(duration * (1 - style.impactAt - 0.025));
    assertRest(clock.player.unitPose(attacker));
    assertRest(clock.player.unitPose(target));
    assert.equal(clock.pending.size, 0, "姿勢が戻った攻撃だけの時計を止める");
    assert.equal(JSON.stringify(snapshot), original, "攻撃姿勢でも戦闘入力を変更しない");
  }

  {
    const snapshot = state("halberd");
    const reverse = state("halberd", { units: [unit({ type: "halberd", side: "enemy", x: 5 }), unit({ id: "target", x: 1 })] });
    const right = harness(createBattleEffectPlayer);
    const left = harness(createBattleEffectPlayer);
    right.player.sync(snapshot); left.player.sync(reverse);
    right.advance(124.8); left.advance(124.8);
    assert.ok(right.player.unitPose(snapshot.units[0]).attackX > 0);
    assert.ok(left.player.unitPose(reverse.units[0]).attackX < 0, "敵兵の踏み込みも標的方向へ反転する");
    const vertical = state("halberd", { units: [unit({ type: "halberd" }), unit({ id: "target", x: 1, y: 6 })] });
    const down = harness(createBattleEffectPlayer);
    down.player.sync(vertical); down.advance(124.8);
    assert.ok(down.player.unitPose(vertical.units[0]).attackY > 0, "縦方向の標的にも踏み込む");
  }

  {
    const snapshot = state("halberd");
    for (let index = 0; index < 12; index += 1) {
      snapshot.units.push(unit({ id: `target-${index}`, side: "enemy", x: 5 }));
      snapshot.units.push(unit({ id: `attacker-${index}`, type: "halberd" }));
      snapshot.attackFx.push({ from: "attacker", to: `target-${index}`, impact: true, ttl: 2 });
      snapshot.attackFx.push({ from: `attacker-${index}`, to: "target", impact: true, ttl: 2 });
    }
    const many = harness(createBattleEffectPlayer);
    const one = harness(createBattleEffectPlayer);
    many.player.sync(freezeInput(snapshot)); one.player.sync(state("halberd"));
    many.advance(131.3); one.advance(131.3);
    const large = many.player.unitPose(snapshot.units[0]);
    const small = one.player.unitPose(snapshot.units[0]);
    assert.ok(Math.abs(large.attackX) <= Math.abs(small.attackX) + 1e-8, "同時攻撃で踏み込みを加算して画面外へ飛ばさない");
    assert.ok(Math.abs(large.attackAngle) <= Math.abs(small.attackAngle) + 1e-8, "同時攻撃で傾きを加算しない");
    assert.ok(Math.hypot(large.attackX, large.attackY) <= 0.22, "合成した画像のずれは0.22セル以下");
    assert.ok(Math.abs(large.attackAngle) <= 0.16, "合成した画像の傾きは0.16ラジアン以下");
    assert.ok(large.attackScaleY >= 0.92 && large.attackScaleY <= 1.04, "合成した画像の縦変形を抑える");
    assert.ok(many.player.unitPose(snapshot.units[1]).hitFlash <= 0.8, "集中攻撃の明滅にも上限を設ける");
    assert.equal(many.player.unitPose(snapshot.units[1]).hitFlash, one.player.unitPose(state("halberd").units[1]).hitFlash,
      "集中攻撃の明滅は最大値でまとめる");
  }

  {
    const snapshot = state("halberd", { moveFx: [{ id: "attacker", side: "ally", fromX: 0, fromY: 2, toX: 1, toY: 2, ttl: 3 }] });
    const clock = harness(createBattleEffectPlayer);
    clock.player.sync(snapshot); clock.advance(100);
    assertRest(clock.player.unitPose(snapshot.units[0]));
    assertRest(clock.player.unitPose(snapshot.units[1]));
    assert.equal(clock.draw().length, 0, "移動待ち中は攻撃の図形も出さない");
    clock.advance(240);
    clock.advance(124.8);
    assert.ok(clock.player.unitPose(snapshot.units[0]).attackX > 0, "移動到着後に構えと踏み込みを再生する");
    clock.player.pause();
    const paused = clock.player.unitPose(snapshot.units[0]);
    clock.jump(10000);
    assert.deepEqual(clock.player.unitPose(snapshot.units[0]), paused, "停止中は攻撃姿勢も進めない");
    clock.player.sync(snapshot);
    assert.deepEqual(clock.player.unitPose(snapshot.units[0]), paused, "停止中の実時間を姿勢へ持ち越さない");
    clock.player.sync(snapshot, true);
    assertRest(clock.player.unitPose(snapshot.units[0]));
    assert.equal(clock.pending.size, 0, "非表示で姿勢と時計を破棄する");
    clock.player.sync({ ...snapshot, tick: 2, moveFx: [] });
    clock.advance(100);
    clock.player.clear();
    assertRest(clock.player.unitPose(snapshot.units[0]));
  }

  {
    for (const invalid of [{ hp: 0 }, { status: "destroyed" }, { status: "reserve" }, { status: "escaped" }]) {
      const snapshot = state("halberd", { units: [unit({ type: "halberd", ...invalid }), unit({ id: "target", x: 5, ...invalid })] });
      const clock = harness(createBattleEffectPlayer);
      clock.player.sync(snapshot); clock.advance(131.3);
      for (const actor of snapshot.units) assertRest(clock.player.unitPose(actor));
      assert.ok(clock.draw().length > 0, "撃破済み兵でも確定した攻撃の図形は最後まで残す");
    }
    const snapshot = state("halberd", { attackFx: [{ support: true, equipmentId: "cannon", to: "target", impact: true, ttl: 2 }] });
    const clock = harness(createBattleEffectPlayer);
    clock.player.sync(snapshot); clock.advance(80 + 254.1);
    assertRest(clock.player.unitPose(snapshot.units[0]));
    assert.ok(clock.player.unitPose(snapshot.units[1]).hitFlash > 0, "艤装は兵の踏み込みを付けず着弾反応を付ける");
    const fast = harness(createBattleEffectPlayer);
    fast.player.sync(state("halberd", { speed: 4 }));
    fast.advance(65);
    assertRest(fast.player.unitPose(unit({ type: "halberd" })));
    assert.equal(fast.pending.size, 0, "4倍速では攻撃姿勢も共通時計で終了する");
  }
  console.log("攻撃5カテゴリの形状・反転・入力保護・姿勢・命中・待機・共有時計: 全項目成功");
}

main().catch(
  /** @param {Error} error 検証失敗。 @returns {void} 失敗を報告する。 */
  function report(error) { console.error(error); process.exitCode = 1; });
