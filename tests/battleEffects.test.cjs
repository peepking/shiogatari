const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadTestModule } = require("./helpers/module.cjs");

/**
 * 描画命令を記録し、描画先の状態も保存・復元する検証用Canvasを作る。
 * @returns {object} 描画文脈と記録。
 */
function createCanvas() {
  const calls = [];
  const values = {};
  const stack = [];
  const ctx = { canvas: { width: 320, height: 320 } };
  const properties = ["globalAlpha", "strokeStyle", "fillStyle", "lineWidth", "lineCap", "shadowColor", "shadowBlur"];
  for (const property of properties) {
    Object.defineProperty(ctx, property, {
      /** @returns {*} 現在の描画値。 */
      get() { return values[property]; },
      /** @param {*} value 描画値。 @returns {void} */
      set(value) { values[property] = value; calls.push([property, value]); },
    });
  }
  /** @returns {void} 描画状態を保存する。 */
  ctx.save = function save() { stack.push({ ...values }); calls.push(["save"]); };
  /** @returns {void} 描画状態を復元する。 */
  ctx.restore = function restore() {
    assert.ok(stack.length, "saveなしのrestoreを呼ばない");
    const restored = stack.pop();
    for (const property of properties) values[property] = restored[property];
    calls.push(["restore"]);
  };
  for (const name of ["beginPath", "moveTo", "lineTo", "quadraticCurveTo", "closePath", "stroke", "arc", "ellipse", "fill", "fillRect"]) {
    /** @param {...*} args 描画引数。 @returns {void} */
    ctx[name] = function record(...args) { calls.push([name, ...args]); };
  }
  return { ctx, calls, stack };
}

/**
 * 時刻と予約フレームを手動で進める演出プレイヤーを作る。
 * @param {Function} createPlayer 演出プレイヤーの生成関数。
 * @returns {object} プレイヤー・手動時計・描画観測。
 */
function createHarness(createPlayer) {
  let time = 0;
  let nextId = 1;
  let renders = 0;
  const pending = new Map();
  const cancelled = [];
  const canvas = createCanvas();
  const player = createPlayer({
    /** @returns {void} 再描画要求を記録する。 */
    render() { renders += 1; },
    /** @returns {number} 検証時計の時刻。 */
    now() { return time; },
    /** @param {Function} callback 次フレームの処理。 @returns {number} 予約番号。 */
    requestFrame(callback) { const id = nextId++; pending.set(id, callback); return id; },
    /** @param {number} id 予約番号。 @returns {void} */
    cancelFrame(id) { cancelled.push(id); pending.delete(id); },
  });
  player.setLayout(32, 10);
  return {
    player, pending, cancelled,
    /** @returns {number} 再描画要求の回数。 */
    get renders() { return renders; },
    /** @param {number} ms 経過時間。 @returns {void} */
    jump(ms) { time += ms; },
    /** @param {number} ms 次フレームまでの時間。 @returns {void} */
    frame(ms) {
      assert.equal(pending.size, 1, "有効な演出はフレームを1件だけ予約する");
      time += ms;
      const [id, callback] = pending.entries().next().value;
      pending.delete(id);
      callback(time);
      assert.ok(pending.size <= 1, "予約フレームを増殖させない");
    },
    /** @returns {Array} 現時点の描画命令。 */
    draw() {
      canvas.calls.length = 0;
      player.draw(canvas.ctx, 32);
      assert.equal(canvas.stack.length, 0, "描画後にCanvas状態を復元する");
      return canvas.calls.map(
        /** @param {Array} call 描画命令。 @returns {Array} 複製した命令。 */
        function copy(call) { return [...call]; });
    },
  };
}

/** @param {Array} calls 描画命令。 @returns {number} 実際に描いた図形数。 */
function visibleCount(calls) {
  return calls.filter(
    /** @param {Array} call 描画命令。 @returns {boolean} 塗りまたは線の描画か。 */
    function isVisible(call) { return call[0] === "stroke" || call[0] === "fill"; }).length;
}

/** @param {Array} calls 描画命令。 @param {string} name 命令名。 @returns {number} 一致する命令数。 */
function countOperation(calls, name) {
  return calls.filter(
    /** @param {Array} call 描画命令。 @returns {boolean} 指定命令か。 */
    function matches(call) { return call[0] === name; }).length;
}

/** @param {string} type 攻撃側の兵種。 @returns {object} 検証用の戦闘状態。 */
function createState(type = "infantry") {
  return {
    tick: 1, size: 10, running: true, speed: 1, result: null,
    units: [
      { id: "ally", side: "ally", type, x: 1, y: 3, hp: 100, count: 10 },
      { id: "enemy", side: "enemy", type: "infantry", x: 7, y: 4, hp: 100, count: 10 },
    ],
    attackFx: [
      { from: "ally", to: "enemy", ttl: 2 },
      { from: "ally", to: "enemy", ttl: 2, impact: true, crit: false },
    ],
  };
}

/** @param {object} value 入力値。 @returns {object} 再帰的に変更を禁止した値。 */
function freezeInput(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") freezeInput(child);
  }
  return Object.freeze(value);
}

/**
 * ゲーム計算から独立した演出の寿命・停止・描画スナップショットを検証する。
 * @returns {Promise<void>} 検証完了。
 */
async function main() {
  const context = vm.createContext({});
  const effectsModule = await loadTestModule("battleEffects.js", context);
  const configModule = await loadTestModule("battleEffectConfig.js", context);
  const { createBattleEffectPlayer } = effectsModule.namespace;
  const { BATTLE_EFFECT_RULES } = configModule.namespace;
  assert.equal(BATTLE_EFFECT_RULES.attackMs, 260);
  assert.equal(BATTLE_EFFECT_RULES.projectileMs, 300);
  assert.equal(BATTLE_EFFECT_RULES.supportMs, 420);
  assert.equal(BATTLE_EFFECT_RULES.maxFrameMs, 100);

  for (const type of ["archer", "crossbow", "seaArcher", "pirate_archer"]) {
    const harness = createHarness(createBattleEffectPlayer);
    harness.player.sync(createState(type));
    assert.ok(visibleCount(harness.draw()) > 0, `${type}は発射直後から見える`);
    harness.frame(100);
    harness.frame(100);
    harness.frame(99);
    assert.ok(visibleCount(harness.draw()) > 0, `${type}の射撃は299msまで残る`);
    harness.frame(1);
    assert.equal(visibleCount(harness.draw()), 0, `${type}の射撃は300msで終わる`);
    assert.equal(harness.pending.size, 0, "演出がなければフレームを予約しない");
  }

  {
    const harness = createHarness(createBattleEffectPlayer);
    const state = createState();
    harness.player.sync(state);
    const initial = harness.draw();
    harness.player.sync(state);
    assert.deepEqual(harness.draw(), initial, "同tickの再描画で通常攻撃を重複登録しない");
    const single = createHarness(createBattleEffectPlayer);
    single.player.sync({ ...state, attackFx: [state.attackFx[1]] });
    assert.deepEqual(single.draw(), initial, "通常攻撃の軌跡とimpactの2レコードを1演出にまとめる");
    harness.frame(100);
    harness.frame(100);
    harness.frame(59);
    assert.ok(visibleCount(harness.draw()) > 0, "通常攻撃は259msまで残る");
    harness.frame(1);
    assert.equal(visibleCount(harness.draw()), 0, "通常攻撃は260msで終わる");
    harness.player.sync({ ...state, tick: 2, attackFx: [{ ...state.attackFx[1], ttl: 1 }] });
    assert.equal(visibleCount(harness.draw()), 0, "次tickへ持ち越したttl=1の攻撃を再生し直さない");
    assert.equal(harness.pending.size, 0);
    harness.player.sync({ ...state, tick: 3 });
    assert.ok(visibleCount(harness.draw()) > 0, "新tickの新しい攻撃は登録する");
    const noImpact = createHarness(createBattleEffectPlayer);
    noImpact.player.sync({ ...state, attackFx: [state.attackFx[0]] });
    assert.equal(visibleCount(noImpact.draw()), 0, "impactのない記録だけでは攻撃を登録しない");
  }

  {
    const harness = createHarness(createBattleEffectPlayer);
    const state = createState();
    state.attackFx = [{ support: true, equipmentId: "cannon", to: "enemy", ttl: 2, impact: true }];
    harness.player.sync(state);
    assert.equal(visibleCount(harness.draw()), 0, "艤装射撃は80msの照準を待つ");
    harness.frame(80);
    for (let frame = 0; frame < 4; frame += 1) harness.frame(100);
    harness.frame(19);
    assert.ok(visibleCount(harness.draw()) > 0, "艤装射撃は発射後419msまで残る");
    harness.frame(1);
    assert.equal(visibleCount(harness.draw()), 0, "艤装の弾と着弾は発射後420msで終わる");
    assert.equal(harness.pending.size, 1, "着弾後も砲座の煙のために共通時計を保持する");
    harness.frame(100); harness.frame(79);
    assert.equal(harness.pending.size, 1, "艤装の余韻は終端直前まで残る");
    harness.frame(1);
    assert.equal(harness.pending.size, 0, "80msの照準と420msの射撃と180msの余韻が終われば時計を止める");
  }

  {
    const harness = createHarness(createBattleEffectPlayer);
    const state = createState();
    harness.player.sync(state);
    harness.frame(100);
    harness.player.sync({ ...state, running: false });
    const paused = harness.draw();
    assert.equal(harness.pending.size, 0, "一時停止で予約フレームを解除する");
    harness.jump(10000);
    assert.deepEqual(harness.draw(), paused, "一時停止中は描画時刻が進まない");
    harness.player.sync(state);
    assert.deepEqual(harness.draw(), paused, "再開時に壁時計の10秒分を加算しない");
    harness.frame(100);
    harness.frame(59);
    assert.ok(visibleCount(harness.draw()) > 0, "再開後も残りの寿命を保持する");
    harness.frame(1);
    assert.equal(visibleCount(harness.draw()), 0);
  }

  {
    const harness = createHarness(createBattleEffectPlayer);
    const state = createState();
    harness.player.sync(state);
    harness.frame(100);
    harness.player.pause();
    const paused = harness.draw();
    assert.equal(harness.pending.size, 0, "明示的なpauseも予約を解除する");
    harness.jump(10000);
    assert.deepEqual(harness.draw(), paused, "明示的なpauseでも描画を凍結する");
    harness.player.sync(state);
    assert.deepEqual(harness.draw(), paused);
    harness.frame(100);
    assert.ok(visibleCount(harness.draw()) > 0);
  }

  for (const speed of [2, 4]) {
    const harness = createHarness(createBattleEffectPlayer);
    harness.player.sync({ ...createState(), speed });
    const duration = BATTLE_EFFECT_RULES.attackMs / speed;
    if (duration > BATTLE_EFFECT_RULES.maxFrameMs) harness.frame(BATTLE_EFFECT_RULES.maxFrameMs);
    harness.frame(duration > 100 ? duration - 101 : duration - 1);
    assert.ok(visibleCount(harness.draw()) > 0, `${speed}倍速は終了1ms前まで残る`);
    harness.frame(1);
    assert.equal(visibleCount(harness.draw()), 0, `${speed}倍速で演出時間を短縮する`);
  }

  {
    const harness = createHarness(createBattleEffectPlayer);
    const state = createState();
    harness.player.sync(state);
    harness.frame(100);
    const before = harness.draw();
    harness.player.sync({ ...state, speed: 2 });
    assert.deepEqual(harness.draw(), before, "速度変更時に既存の進捗を巻き戻さない");
    harness.frame(79);
    assert.ok(visibleCount(harness.draw()) > 0, "変更前100msは旧速度で保持する");
    harness.frame(1);
    assert.equal(visibleCount(harness.draw()), 0, "変更後80msだけ2倍速で進める");
  }

  {
    const harness = createHarness(createBattleEffectPlayer);
    const state = createState();
    harness.player.sync(state);
    harness.frame(100);
    harness.jump(20);
    harness.player.sync({ ...state, speed: 2 });
    harness.frame(69);
    assert.ok(visibleCount(harness.draw()) > 0, "速度変更前のフレーム間20msは旧速度で計上する");
    harness.frame(1);
    assert.equal(visibleCount(harness.draw()), 0, "速度変更時点より前を新速度で進め直さない");
  }

  {
    const harness = createHarness(createBattleEffectPlayer);
    const state = { ...createState(), speed: 4 };
    harness.player.sync(state);
    harness.frame(10);
    harness.jump(240);
    harness.player.sync({ ...state, tick: 2 });
    harness.frame(1);
    const fresh = createHarness(createBattleEffectPlayer);
    fresh.player.sync(state);
    fresh.frame(1);
    assert.ok(visibleCount(harness.draw()) > 0, "新tickの攻撃に誕生前の待ち時間を加算して消さない");
    assert.deepEqual(harness.draw(), fresh.draw(), "古い攻撃が終わっても新しい攻撃は誕生後の1msだけ進む");
  }

  {
    const harness = createHarness(createBattleEffectPlayer);
    harness.player.sync(createState());
    harness.frame(5000);
    assert.ok(visibleCount(harness.draw()) > 0, "長時間のフレーム落ちでも演出を一瞬で消さない");
    harness.frame(100);
    harness.frame(59);
    assert.ok(visibleCount(harness.draw()) > 0, "5秒の遅延を最大100msだけ進める");
    harness.frame(1);
    assert.equal(visibleCount(harness.draw()), 0);
  }

  {
    const harness = createHarness(createBattleEffectPlayer);
    const state = createState("archer");
    harness.player.sync(state);
    harness.frame(100);
    const before = harness.draw();
    state.units[0].x = 4;
    state.units[1].x = 2;
    state.units[0].hp = 0;
    state.units[1].hp = 0;
    state.units[0].count = 0;
    state.units[1].count = 0;
    harness.player.sync(state);
    assert.deepEqual(harness.draw(), before, "相打ち・移動後も発射時の両座標を保持する");
    harness.player.sync({ ...state, units: [] });
    assert.deepEqual(harness.draw(), before, "攻撃元と対象を一覧から除いても演出は消えない");
    const alreadyDead = createHarness(createBattleEffectPlayer);
    alreadyDead.player.sync(state);
    assert.ok(visibleCount(alreadyDead.draw()) > 0, "取り込み時点ですでに撃破された両者の攻撃も表示する");
  }

  {
    const harness = createHarness(createBattleEffectPlayer);
    const state = createState();
    harness.player.sync(state);
    harness.frame(100);
    harness.player.sync(state, true);
    assert.equal(harness.pending.size, 0, "非表示の戦闘画面ではフレームを予約しない");
    assert.equal(visibleCount(harness.draw()), 0, "非表示時は未完の演出を破棄する");
    harness.player.sync(state);
    assert.equal(visibleCount(harness.draw()), 0, "再表示で非表示前の同tickの攻撃を再生し直さない");
    harness.player.sync({ ...state, tick: 2 });
    assert.ok(visibleCount(harness.draw()) > 0, "再表示後の新tickから演出を再開する");
  }

  {
    const harness = createHarness(createBattleEffectPlayer);
    const state = createState();
    state.units.push({ id: "second", side: "enemy", type: "infantry", x: 5, y: 7, hp: 100 });
    state.attackFx = [
      { support: true, equipmentId: "cannon", to: "enemy", ttl: 2, impact: true },
      { support: true, equipmentId: "cannon", to: "second", ttl: 2, impact: true },
    ];
    harness.player.sync(state);
    harness.frame(80);
    const volley = harness.draw();
    assert.equal(countOperation(volley, "fill"), 1, "全体艤装は複数標的でも発射光を1回にまとめる");
    const single = createHarness(createBattleEffectPlayer);
    single.player.sync({ ...state, attackFx: [state.attackFx[0]] });
    single.frame(80);
    assert.equal(countOperation(volley, "stroke"), countOperation(single.draw(), "stroke") * 2,
      "全体艤装の着弾は標的ごとに表示する");
    const differentEquipment = createHarness(createBattleEffectPlayer);
    differentEquipment.player.sync({ ...state, attackFx: [state.attackFx[0], { ...state.attackFx[1], equipmentId: "harpoon" }] });
    differentEquipment.frame(80);
    const firstFlash = differentEquipment.draw();
    assert.equal(countOperation(firstFlash, "fill"), 1, "先頭艤装の発射光を表示する");
    differentEquipment.frame(75);
    const nextFlash = differentEquipment.draw();
    assert.equal(countOperation(nextFlash, "ellipse"), 1, "70ms遅れた次の艤装の発射光を表示する");
    assert.notDeepEqual(nextFlash, firstFlash, "異なる砲座の発射光は同じ位置へ重ねない");
  }

  {
    const harness = createHarness(createBattleEffectPlayer);
    const state = createState();
    harness.player.sync(state);
    harness.frame(100);
    harness.player.sync({ ...state, running: false, result: "win" });
    assert.equal(harness.pending.size, 1, "勝敗確定後も残った演出のフレームを予約する");
    harness.frame(100);
    harness.frame(60);
    assert.equal(visibleCount(harness.draw()), 0, "勝敗表示後に残った攻撃を最後まで再生する");
    assert.equal(harness.pending.size, 0, "終了後の演出が尽きたら予約を止める");
  }

  {
    const harness = createHarness(createBattleEffectPlayer);
    const state = createState();
    harness.player.sync(state);
    assert.equal(harness.pending.size, 1);
    harness.player.clear();
    assert.equal(harness.pending.size, 0, "clearで予約を取り消す");
    assert.ok(harness.cancelled.length > 0, "clearは実際の予約番号をキャンセルする");
    assert.equal(visibleCount(harness.draw()), 0, "clearで表示中の演出を捨てる");
    harness.player.sync(state);
    assert.ok(visibleCount(harness.draw()) > 0, "clear後は同tickを新規戦闘として受け取れる");
  }

  {
    const harness = createHarness(createBattleEffectPlayer);
    const state = freezeInput(createState());
    const before = JSON.stringify(state);
    harness.player.sync(state);
    harness.frame(100);
    harness.draw();
    harness.player.pause();
    harness.player.clear();
    assert.equal(JSON.stringify(state), before, "演出はtick・HP・位置・攻撃記録を書き換えない");
    assert.ok(harness.renders > 0, "有効なフレームから再描画を要求する");
  }

  {
    const atLimit = createHarness(createBattleEffectPlayer);
    const overLimit = createHarness(createBattleEffectPlayer);
    const state = createState("archer");
    state.attackFx = [];
    for (let index = 0; index < BATTLE_EFFECT_RULES.maxClips + 30; index += 1) {
      const id = `target-${index}`;
      state.units.push({ id, side: "enemy", type: "infantry", x: 4 + index % 4, y: 1 + index % 7, hp: 100 });
      state.attackFx.push({ from: "ally", to: id, ttl: 2, impact: true });
    }
    atLimit.player.sync({ ...state, attackFx: state.attackFx.slice(0, BATTLE_EFFECT_RULES.maxClips) });
    overLimit.player.sync(state);
    assert.ok(visibleCount(atLimit.draw()) > 0, "設定上限まで攻撃を表示する");
    assert.equal(visibleCount(overLimit.draw()), visibleCount(atLimit.draw()), "設定上限を超えて描画負荷を増やさない");
    overLimit.frame(100);
    assert.equal(overLimit.pending.size, 1, "多数の攻撃でも予約フレームは1本を共有する");
  }
  console.log("戦闘演出の寿命・重複抑止・停止再開・倍速・撃破・上限: 全項目成功");
}

main().catch(
  /** @param {Error} error 検証失敗。 @returns {void} */
  function report(error) { console.error(error); process.exitCode = 1; });
