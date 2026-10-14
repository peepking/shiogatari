const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadTestModule } = require("./helpers/module.cjs");
const { readSource } = require("./helpers/source.cjs");

/** @param {object} value 入力値。 @returns {object} 再帰的に変更を禁止した入力。 */
function freezeInput(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") freezeInput(child);
  }
  return Object.freeze(value);
}

/** @param {string} id 部隊ID。 @param {string} side 陣営。 @param {number} x 横位置。 @param {number} y 縦位置。 @param {string} [type] 兵種。 @returns {object} 描画と実戦闘計算に渡せる部隊。 */
function unit(id, side, x, y, type = "infantry") {
  return { id, side, x, y, type, name: "検証部隊", status: "active", count: 10, hp: 330, maxHp: 330,
    atk: 26, def: 18, spd: 2, range: type === "archer" ? 3 : 1, move: 1, role: type === "archer" ? "ranged" : "melee",
    terrain: { plain: 100 }, cooldown: 0, switchLock: 0, targetId: null, traits: [] };
}

/** @returns {object[]} 単体3台と全体2台を含む、装備順の支援射撃。 */
function equipment() {
  return [
    { id: "harpoon", interval: 1, power: 8 }, { id: "ballista", interval: 1, power: 12 },
    { id: "grape_ballista", interval: 1, power: 6, allEnemies: true },
    { id: "fire_grape_ballista", interval: 1, power: 8, allEnemies: true },
    { id: "cannon", interval: 1, power: 16 },
  ];
}

/** @param {number} size 盤面幅。 @param {number} limit 各軍の部隊数。 @returns {object} 各軍2列を上限まで埋めた状態。 */
function state(size, limit) {
  const units = [];
  for (const side of ["ally", "enemy"]) {
    for (let index = 0; index < limit; index += 1) {
      const depth = Math.floor(index / size);
      units.push(unit(`${side}-${index}`, side, side === "ally" ? depth : size - 1 - depth,
        index % size, ["infantry", "halberd", "shield", "archer"][index % 4]));
    }
  }
  const attacks = equipment();
  return { tick: 0, size, elapsedMs: 0, running: true, speed: 1, result: null, units,
    grid: Array.from({ length: size },
      /** @returns {string[]} 平地の行。 */
      function row() { return Array(size).fill("plain"); }),
    outfitting: { equipped: attacks.map(
      /** @param {object} attack 設備の攻撃。 @returns {string} 設備ID。 */
      function id(attack) { return attack.id; }), effects: { attacks } }, attackFx: [], moveFx: [] };
}

/**
 * 両軍全員の攻撃と2歩移動に加え、5設備を同tickで発動させる。
 * 通常の1tickを超える命中数を意図的に与え、表示上限と負荷時の寿命だけを検証する。
 * @param {number} size 盤面幅。 @param {number} limit 各軍の部隊数。 @returns {object} 変更禁止の負荷入力。
 */
function loadState(size, limit) {
  const snapshot = state(size, limit);
  snapshot.tick = 1;
  for (const actor of snapshot.units) {
    const direction = actor.side === "ally" ? 1 : -1;
    for (const step of [2, 1]) snapshot.moveFx.push({ id: actor.id, side: actor.side,
      fromX: actor.x + direction * step, fromY: actor.y,
      toX: actor.x + direction * (step - 1), toY: actor.y, ttl: 3 });
    for (const target of snapshot.units) {
      if (actor.side !== target.side) snapshot.attackFx.push({ from: actor.id, to: target.id, ttl: 2, impact: true });
    }
  }
  const enemies = snapshot.units.filter(
    /** @param {object} actor 部隊。 @returns {boolean} 敵軍の部隊か。 */
    function enemy(actor) { return actor.side === "enemy"; });
  for (const [index, attack] of snapshot.outfitting.effects.attacks.entries()) {
    for (const target of attack.allEnemies ? enemies : [enemies[index]]) {
      snapshot.attackFx.push({ support: true, equipmentId: attack.id, to: target.id, ttl: 2, impact: true });
    }
  }
  return freezeInput(snapshot);
}

/** @returns {object} 描画値の有限性と保存・復元を検証するCanvas。 */
function canvas() {
  const calls = [], stack = [];
  const values = { globalAlpha: 0.43, fillStyle: "original", strokeStyle: "original-line", lineWidth: 7,
    lineCap: "square", lineJoin: "bevel", shadowColor: "transparent", shadowBlur: 0,
    font: "10px serif", textAlign: "left", textBaseline: "alphabetic" };
  const initial = { ...values };
  const ctx = { canvas: { width: 480, height: 568 } };
  for (const property of Object.keys(values)) {
    Object.defineProperty(ctx, property, {
      /** @returns {*} 現在の描画状態。 */
      get() { return values[property]; },
      /** @param {*} value 次の描画状態。 @returns {void} 安全な数値を記録する。 */
      set(value) {
        if (typeof value === "number") assert.ok(Number.isFinite(value), `${property}は有限値`);
        if (property === "globalAlpha") assert.ok(value >= 0 && value <= 1, "不透明度は0〜1");
        values[property] = value; calls.push([property, value]);
      },
    });
  }
  /** @returns {void} 描画状態を保存する。 */
  ctx.save = function save() { stack.push({ ...values }); calls.push(["save"]); };
  /** @returns {void} 保存した描画状態へ戻す。 */
  ctx.restore = function restore() {
    assert.ok(stack.length, "保存していない描画状態へ戻さない");
    Object.assign(values, stack.pop()); calls.push(["restore"]);
  };
  for (const method of ["beginPath", "moveTo", "lineTo", "quadraticCurveTo", "closePath", "arc", "ellipse", "fill", "stroke",
    "fillRect", "strokeRect", "translate", "rotate", "scale", "rect", "clip", "fillText", "strokeText", "setLineDash"]) {
    /** @param {...*} args 描画引数。 @returns {void} 非有限な座標と負の半径を拒否する。 */
    ctx[method] = function record(...args) {
      for (const value of args) if (typeof value === "number") assert.ok(Number.isFinite(value), `${method}の引数は有限値`);
      if (method === "arc" || method === "ellipse") assert.ok(args[2] >= 0, "半径は負にしない");
      if (method === "ellipse") assert.ok(args[3] >= 0, "縦半径は負にしない");
      calls.push([method, ...args]);
    };
  }
  return { ctx, calls,
    /** @returns {void} 描画後に元の状態へ戻ったことを確認する。 */
    assertRestored() { assert.equal(stack.length, 0); assert.deepEqual(values, initial); },
  };
}

/** @param {object} pose 表示姿勢。 @returns {void} 集中攻撃でも兵の画像変形を上限内へ収める。 */
function assertPose(pose) {
  for (const [key, value] of Object.entries(pose)) {
    if (typeof value === "number") assert.ok(Number.isFinite(value), `${key}は有限値`);
  }
  assert.ok(Math.hypot(pose.attackX, pose.attackY) <= 0.220000001, "集中攻撃でも画像のずれを上限内へ収める");
  assert.ok(Math.abs(pose.attackAngle) <= 0.16, "集中攻撃で画像を回しすぎない");
  assert.ok(pose.attackScaleY >= 0.92 && pose.attackScaleY <= 1.04, "集中攻撃で画像を伸縮しすぎない");
  assert.ok(pose.hitFlash >= 0 && pose.hitFlash <= 0.8, "集中攻撃でも被弾の明滅を上限内へ収める");
}

/** @param {object} player 演出プレイヤー。 @param {object[]} units 部隊一覧。 @returns {void} 完了・初期化で兵が論理位置と静止姿勢へ戻ることを確認する。 */
function assertRest(player, units) {
  for (const actor of units) {
    const pose = player.unitPose(actor);
    assertPose(pose);
    assert.equal(pose.x, actor.x); assert.equal(pose.y, actor.y);
    assert.equal(pose.moving, false); assert.equal(pose.bob, 0); assert.equal(pose.angle, 0);
    assert.equal(pose.attackX, 0); assert.equal(pose.attackY, 0); assert.equal(pose.attackAngle, 0);
    assert.equal(pose.attackScaleY, 1); assert.equal(pose.hitFlash, 0);
  }
}

/** @param {Function} createPlayer プレイヤー生成関数。 @param {number} size 盤面幅。 @returns {object} 予約数を監視する手動時計。 */
function harness(createPlayer, size) {
  let time = 0, id = 0, renders = 0;
  const pending = new Map();
  const player = createPlayer({
    /** @returns {number} 現在の手動時計。 */
    now() { return time; },
    /** @returns {void} 最終フレームを含む描画を記録する。 */
    render() { renders += 1; },
    /** @param {Function} callback 次フレーム。 @returns {number} 予約番号。 */
    requestFrame(callback) {
      assert.equal(pending.size, 0, "兵・艤装・命中数によらずフレーム予約は最大1件");
      id += 1; pending.set(id, callback); return id;
    },
    /** @param {number} frameId 予約番号。 @returns {void} 予約を取り消す。 */
    cancelFrame(frameId) { pending.delete(frameId); },
  });
  player.setLayout(32, size);
  return { player, pending,
    /** @returns {number} 再描画回数。 */
    get renders() { return renders; },
    /** @param {number} ms 経過時間。 @returns {void} 実時間だけ進める。 */
    jump(ms) { time += ms; },
    /** @param {number} [ms] 次フレームまでの経過時間。 @returns {void} 1件の共有フレームを進める。 */
    frame(ms = 100) {
      assert.equal(pending.size, 1, "進行中の予約は1件");
      const [frameId, callback] = pending.entries().next().value;
      pending.delete(frameId); time += ms; callback(time);
      assert.ok(pending.size <= 1, "フレームを増殖させない");
    },
    /** @param {object[]} [units] 検証する部隊。 @returns {string} 現在の表示記録。 */
    draw(units = []) {
      const drawing = canvas();
      player.drawGround(drawing.ctx, 32); player.drawRigging(drawing.ctx, 32); player.draw(drawing.ctx, 32);
      drawing.assertRestored();
      for (const actor of units) assertPose(player.unitPose(actor));
      return JSON.stringify(drawing.calls);
    },
    /** @param {object[]} units 検証する部隊。 @param {number} [maxFrames] 有限停止の許容フレーム数。 @returns {number} 停止までのフレーム数。 */
    drain(units, maxFrames = 30) {
      let frames = 0;
      while (pending.size && frames < maxFrames) {
        this.frame(); this.draw(units); frames += 1;
      }
      assert.equal(pending.size, 0, "最終tickの弾・反動・煙を有限時間で収める");
      assertRest(player, units);
      return frames;
    },
  };
}

/** @param {object} player 演出プレイヤー。 @param {object[]} targets 標的一覧。 @returns {string[]} 現在命中反応が見える標的ID。 */
function reactingIds(player, targets) {
  return targets.filter(
    /** @param {object} target 標的。 @returns {boolean} 確定済みの命中が表示中か。 */
    function reacting(target) { return player.unitPose(target).hitFlash > 0; }).map(
    /** @param {object} target 標的。 @returns {string} 標的ID。 */
    function id(target) { return target.id; });
}

/** @param {Function} createRandom シード付き乱数の生成関数。 @param {number} seed シード。 @returns {object} 消費数も観測できるゲーム乱数。 */
function randomCounter(createRandom, seed) {
  const source = createRandom(seed);
  let calls = 0;
  return {
    /** @returns {number} ゲームが消費する次の乱数。 */
    random() { calls += 1; return source(); },
    /** @returns {number} 消費済み乱数数。 */
    get calls() { return calls; },
  };
}

/** @param {object} context VM文脈。 @returns {Promise<object>} 実ゲームの支援射撃と防御軽減。 */
async function supportDependencies(context) {
  const source = readSource("outfitting.js");
  for (const name of ["defendedDamage", "fireOutfitting"]) {
    const start = source.indexOf(`export function ${name}(`);
    const end = name === "defendedDamage" ? source.indexOf("\n", start) : source.indexOf("\n}", start) + 2;
    vm.runInContext(source.slice(start, end).replace("export ", ""), context);
  }
  return vm.runInContext("({ defendedDamage, fireOutfitting })", context);
}

/** @returns {Promise<void>} 最大編成・過剰入力・操作中の上限と実ゲーム計算の独立性を検証する。 */
async function main() {
  const deterministicMath = Object.create(Math);
  /** @returns {never} 演出がゲーム乱数を消費することを禁止する。 */
  deterministicMath.random = function random() { throw new Error("演出はゲーム乱数を消費しない"); };
  const context = vm.createContext({ Math: deterministicMath });
  const effects = await loadTestModule("battleEffects.js", context);
  const geometry = await loadTestModule("battleGeometry.js", context);
  const config = await loadTestModule("battleEffectConfig.js", context);
  const core = await loadTestModule("battleCore.js", context);
  const { createBattleEffectPlayer } = effects.namespace;
  const { battleDeploymentLimit } = geometry.namespace;
  const { BATTLE_EFFECT_RULES, MOVEMENT_EFFECT_RULES } = config.namespace;
  const sizes = [[8, 16], [10, 20], [12, 20], [15, 20]];

  for (const [size, limit] of sizes) {
    assert.equal(battleDeploymentLimit(size), limit, "実ゲームの各軍上限で負荷を検証する");
    const snapshot = loadState(size, limit);
    assert.equal(snapshot.units.length, limit * 2);
    assert.ok(snapshot.attackFx.length > BATTLE_EFFECT_RULES.maxClips, "表示上限を超える攻撃を入力する");
    const original = JSON.stringify(snapshot);
    const clock = harness(createBattleEffectPlayer, size);
    clock.player.sync(snapshot);
    const initial = clock.draw(snapshot.units);
    for (let repeat = 0; repeat < 20; repeat += 1) clock.player.sync(snapshot);
    assert.equal(clock.draw(snapshot.units), initial, "同tickの多数の再描画で移動・弾・艤装を重複登録しない");
    clock.frame();
    const beforePause = clock.draw(snapshot.units);
    clock.player.sync({ ...snapshot, running: false });
    assert.equal(clock.pending.size, 0, "最大編成の一時停止でも共有予約を解除する");
    clock.jump(10000);
    assert.equal(clock.draw(snapshot.units), beforePause, "一時停止中も最大編成の姿勢と煙を凍結する");
    clock.player.sync({ ...snapshot, speed: 2 });
    assert.equal(clock.draw(snapshot.units), beforePause, "再開と倍速変更で既存の姿勢を巻き戻さない");
    clock.frame(50);
    const beforeSpeedChange = clock.draw(snapshot.units);
    clock.player.sync({ ...snapshot, speed: 4, running: false, result: "win" });
    assert.equal(clock.draw(snapshot.units), beforeSpeedChange, "4倍速・勝敗確定でも現在の表示進捗を保つ");
    const beforeFinalRenders = clock.renders;
    assert.ok(clock.drain(snapshot.units) > 0, "最大編成の最終tickも最後まで表示する");
    assert.ok(clock.renders > beforeFinalRenders, "最終tickの尾部を再描画して消す");
    const finished = clock.draw(snapshot.units);
    clock.player.sync({ ...snapshot, speed: 4, running: false, result: "win" });
    assert.equal(clock.pending.size, 0, "終わった最終tickを再描画しても時計を再開しない");
    assert.equal(clock.draw(snapshot.units), finished);
    clock.player.clear();
    assert.equal(clock.player.hasRigging(), false);
    assertRest(clock.player, snapshot.units);
    assert.equal(clock.pending.size, 0);
    clock.player.sync(snapshot);
    assert.equal(clock.draw(snapshot.units), initial, "初期化後は最大編成でも同tickから新しい戦闘を開始できる");
    clock.player.clear();
    assert.equal(JSON.stringify(snapshot), original, "過剰入力でもHP・座標・攻撃・移動・艤装を変更しない");
  }

  {
    const snapshot = state(15, 1);
    snapshot.tick = 1; snapshot.units = [unit("archer", "ally", 1, 2, "archer")];
    snapshot.outfitting = { equipped: [], effects: { attacks: [] } };
    const targets = [];
    for (let index = 0; index < BATTLE_EFFECT_RULES.maxClips + 30; index += 1) {
      const target = unit(`target-${index}`, "enemy", 5 + index % 6, 1 + index % 12);
      targets.push(target); snapshot.units.push(target);
      snapshot.attackFx.push({ from: "archer", to: target.id, impact: true, ttl: 2 });
    }
    freezeInput(snapshot);
    const clock = harness(createBattleEffectPlayer, 15);
    clock.player.sync(snapshot); clock.frame(100); clock.frame(95);
    const reacting = reactingIds(clock.player, targets);
    assert.equal(reacting.length, BATTLE_EFFECT_RULES.maxClips, "過剰な入力でも命中反応を表示上限へ制限する");
    assert.ok(!reacting.includes(targets[0].id), "過負荷時は古い表示から省略する");
    assert.ok(reacting.includes(targets.at(-1).id), "過負荷時も新しい確定命中を表示する");
    for (let repeat = 0; repeat < 30; repeat += 1) clock.player.sync(snapshot);
    assert.deepEqual(reactingIds(clock.player, targets), reacting, "同tick再登録で表示上限を超えない");
    clock.player.pause(); clock.jump(10000);
    assert.deepEqual(reactingIds(clock.player, targets), reacting, "過剰入力の一時停止でも命中表示を凍結する");
    clock.player.sync({ ...snapshot, speed: 2 });
    assert.deepEqual(reactingIds(clock.player, targets), reacting, "速度変更でも命中対象を増やさない");
    clock.frame(52.5);
    assert.equal(clock.pending.size, 0, "上限まで表示した射撃も寿命で終了する");
    assertRest(clock.player, targets);
    clock.player.clear();
    assertRest(clock.player, targets);
  }

  {
    const base = loadState(15, 20);
    const snapshot = freezeInput({ ...base,
      units: base.units.map(
        /** @param {object} actor 部隊。 @returns {object} 射撃寿命を共通にした検証用部隊。 */
        function archer(actor) { return { ...actor, type: "archer" }; }),
      attackFx: [
        ...base.attackFx.filter(
          /** @param {object} fx 攻撃記録。 @returns {boolean} 先に並べて過負荷時に省略する艤装か。 */
          function support(fx) { return fx.support; }),
        ...base.attackFx.filter(
          /** @param {object} fx 攻撃記録。 @returns {boolean} 後に並べて表示を保つ通常攻撃か。 */
          function troop(fx) { return !fx.support; }),
      ],
    });
    const clock = harness(createBattleEffectPlayer, 15);
    clock.player.sync(snapshot);
    assert.equal(clock.player.hasRigging(), true, "攻撃を省略しても装備中の待機砲座は表示する");
    const movementMs = MOVEMENT_EFFECT_RULES.startMs + MOVEMENT_EFFECT_RULES.stepMs * 2 + MOVEMENT_EFFECT_RULES.settleMs;
    let remaining = movementMs + BATTLE_EFFECT_RULES.projectileMs - 1;
    while (remaining > 0) {
      const delta = Math.min(100, remaining);
      clock.frame(delta); clock.draw(snapshot.units); remaining -= delta;
    }
    assert.equal(clock.pending.size, 1, "残した通常射撃の終端直前までは描画する");
    clock.frame(1);
    assert.equal(clock.pending.size, 0, "上限超過で全省略した艤装の発射予約や余韻時計を残さない");
    assertRest(clock.player, snapshot.units);
  }

  const { stepBattle, battleResult, createBattleRandom, BATTLE_RULES } = core.namespace;
  const dependencies = await supportDependencies(context);
  const strategy = { targetMode: "type", kiteMode: "none", retreatThreshold: 30, chargeMode: "none" };
  for (const [size, limit] of sizes) {
    const direct = state(size, limit), shown = state(size, limit);
    const directRandom = randomCounter(createBattleRandom, 12345), shownRandom = randomCounter(createBattleRandom, 12345);
    shown.random = shownRandom.random;
    const clock = harness(createBattleEffectPlayer, size);
    let ended = false;
    while (!ended && direct.tick < BATTLE_RULES.maxTicks) {
      const expected = stepBattle(direct, strategy, { ...dependencies, random: directRandom.random });
      const actual = stepBattle(shown, strategy, { ...dependencies, random: shownRandom.random });
      assert.deepEqual(actual, expected, "演出の有無で戦闘ログ・観測・決着を変更しない");
      const before = JSON.stringify(shown);
      clock.player.sync({ ...shown, running: !actual.ended, result: actual.ended ? battleResult(shown.units, actual.forceDraw) : null });
      if (clock.pending.size) clock.frame();
      clock.draw(shown.units);
      assert.equal(JSON.stringify(shown), before, "実戦闘入力のHP・座標・士気・TTLを変更しない");
      assert.equal(JSON.stringify(shown), JSON.stringify(direct), "演出を挟んでも次tickへ渡す全ゲーム状態は一致する");
      assert.equal(shownRandom.calls, directRandom.calls, "演出は支援射撃に使うシード付き乱数を消費しない");
      ended = actual.ended;
    }
    assert.equal(ended, true, "最大編成の実戦闘も制限tick内で決着する");
    clock.drain(shown.units);
    assert.equal(shownRandom.calls, directRandom.calls, "最後の反動・煙もゲーム乱数を消費しない");
  }
  console.log("最大編成4サイズ・5艤装・攻撃上限・共有予約・操作・有限停止・実戦闘結果不変: 全項目成功");
}

main().catch(
  /** @param {Error} error 検証失敗。 @returns {void} 失敗を報告する。 */
  function report(error) { console.error(error); process.exitCode = 1; });
