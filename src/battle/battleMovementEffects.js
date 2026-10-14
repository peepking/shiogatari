import { BATTLE_RULES } from "./battleCore.js";
import { MOVEMENT_EFFECT_RULES } from "./battleEffectConfig.js";

/** 更新が集中しても、表示用の過去経路は有限に保つ。 */
const MAX_PATH_POINTS = 16;

/**
 * 確定した移動を表示座標へ補間する。戦闘状態・イベント・乱数源へは書き込まない。
 * 新tickだけ取り込み、同部隊の交換と追加移動もイベントの配列順でつなぐ。
 * @returns {object} 表示時計から進める移動演出。
 */
export function createBattleMovementEffects() {
  const clips = new Map();
  let lastTick = null;
  let grid = [];

  /**
   * 新しい移動を複製する。再更新時は現在の表示位置から残り経路を引き継ぐ。
   * 敗走はstatusで判断し、場所譲りのretreatフラグを敗走扱いしない。
   * @param {object} state 読み取り専用の戦闘状態。
   * @returns {void}
   */
  function capture(state) {
    const units = new Map((state.units || []).map(unit => [unit.id, unit]));
    for (const [id, clip] of clips) {
      const unit = units.get(id);
      if (!canAnimate(unit)) clips.delete(id);
      else {
        clip.routing = unit.status === "routing" || unit.status === "escaped";
        clip.escaped = unit.status === "escaped";
      }
    }
    if (state.tick === lastTick) return;
    lastTick = state.tick;
    grid = (state.grid || []).map(row => [...row]);
    const routes = new Map();
    for (const fx of state.moveFx || []) {
      if (fx.ttl !== BATTLE_RULES.moveFxTtl || !canAnimate(units.get(fx.id))) continue;
      const from = { x: fx.fromX, y: fx.fromY };
      const to = { x: fx.toX, y: fx.toY };
      if (!isPoint(from) || !isPoint(to) || samePoint(from, to)) continue;
      if (!routes.has(fx.id)) routes.set(fx.id, []);
      const route = routes.get(fx.id);
      appendPoint(route, from);
      appendPoint(route, to);
    }
    for (const [id, route] of routes) {
      const old = clips.get(id);
      const points = [];
      if (old) {
        const sample = sampleClip(old);
        appendPoint(points, sample);
        for (const point of old.points.slice(sample.segment + 1)) appendPoint(points, point);
      }
      for (const point of route) appendPoint(points, point);
      // 現在位置を保ちつつ、異常に積み重なった古い経路だけを省略する。
      if (points.length > MAX_PATH_POINTS) points.splice(1, points.length - MAX_PATH_POINTS);
      const clip = makeClip(units.get(id), points, old ? 0 : MOVEMENT_EFFECT_RULES.startMs);
      if (clip) clips.set(id, clip);
    }
  }

  /** @param {number} deltaMs 倍率適用済みの表示時間。 @returns {void} 終了済みの移動は保持しない。 */
  function advance(deltaMs) {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    for (const [id, clip] of clips) {
      clip.age += deltaMs;
      if (clip.age >= clip.duration) clips.delete(id);
    }
  }

  /** @param {object} unit 実部隊。 @returns {object} 兵絵と足元へ使用する表示姿勢。 */
  function pose(unit) {
    const clip = clips.get(unit.id);
    if (!clip || !canAnimate(unit)) return restingPose(unit);
    const sample = sampleClip(clip);
    return {
      x: sample.x, y: sample.y, angle: sample.angle, bob: sample.bob,
      scaleY: sample.scaleY, alpha: sample.alpha, moving: true,
      routing: unit.status === "routing" || unit.status === "escaped",
    };
  }

  /** @param {string} id 部隊ID。 @returns {number} 攻撃開始までに残る移動表示時間。 */
  function remaining(id) {
    const clip = clips.get(id);
    return clip ? Math.max(0, clip.duration - clip.age) : 0;
  }

  /** @returns {boolean} 停止時の沈み込みも含め、表示する移動が残るか。 */
  function hasActive() { return clips.size > 0; }

  /**
   * 足元だけに小さい砂埃・水紋・踏み跡を描く。粒数と位相は固定で乱数を使わない。
   * @param {CanvasRenderingContext2D} ctx 描画先。
   * @param {number} cell セル幅。
   * @returns {void}
   */
  function drawGround(ctx, cell) {
    if (!Number.isFinite(cell) || cell <= 0) return;
    for (const clip of clips.values()) {
      const sample = sampleClip(clip);
      if (sample.groundStrength <= 0) continue;
      const terrain = grid[Math.round(sample.y)]?.[Math.round(sample.x)] || "plain";
      ctx.save();
      if (terrain === "sea" || terrain === "shoal") drawWater(ctx, clip, sample, cell);
      else if (terrain === "deck") drawFootprints(ctx, clip, sample, cell);
      else drawDust(ctx, clip, sample, cell, terrain);
      ctx.restore();
    }
  }

  /** @returns {void} 初期化・画面終了時は履歴と表示座標を破棄する。 */
  function clear() {
    clips.clear();
    lastTick = null;
    grid = [];
  }

  return { capture, advance, pose, remaining, hasActive, drawGround, clear };
}

/** @param {object} unit 部隊。 @returns {boolean} 退出直前まで表示可能な生存部隊か。 */
function canAnimate(unit) {
  return Boolean(unit && unit.hp > 0 && (!unit.status
    || ["active", "routing", "escaped"].includes(unit.status)));
}

/** @param {object} point 座標。 @returns {boolean} 有限の表示座標か。 */
function isPoint(point) { return Number.isFinite(point.x) && Number.isFinite(point.y); }

/** @param {object} a 座標。 @param {object} b 座標。 @returns {boolean} 同じ地点か。 */
function samePoint(a, b) { return Math.abs(a.x - b.x) < 0.000001 && Math.abs(a.y - b.y) < 0.000001; }

/** @param {Array} points 保存先。 @param {object} point 座標。 @returns {void} 隣り合う重複を除いて複製する。 */
function appendPoint(points, point) {
  if (!points.length || !samePoint(points[points.length - 1], point)) points.push({ x: point.x, y: point.y });
}

/** @param {object} unit 部隊。 @returns {object} 未登録・終了時の実座標と標準姿勢。 */
function restingPose(unit) {
  return { x: unit.x, y: unit.y, angle: 0, bob: 0, scaleY: 1, alpha: 1,
    moving: false, routing: unit.status === "routing" };
}

/** @param {string} id 部隊ID。 @returns {number} 同時上下動をずらす決定的な位相。 */
function unitPhase(id) {
  let hash = 2166136261;
  for (const char of String(id)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash / 4294967296 * Math.PI * 2;
}

/**
 * 騎乗・重装の表現を選び、移動距離に比例した表示時間を作る。
 * @param {object} unit 部隊。 @param {Array} points 複製済み経路。
 * @param {number} startMs 開始姿勢の時間。 @returns {object|null} 表示用移動。
 */
function makeClip(unit, points, startMs) {
  const distances = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const distance = distances.reduce((sum, value) => sum + value, 0);
  if (!distance) return null;
  const mounted = unit.traits?.includes("mounted");
  const heavy = unit.traits?.includes("steadfast") || ["cavalier", "pirate_shield", "shield"].includes(unit.type);
  const bob = heavy ? MOVEMENT_EFFECT_RULES.heavyBob : mounted ? MOVEMENT_EFFECT_RULES.mountedBob : MOVEMENT_EFFECT_RULES.walkBob;
  const lean = heavy ? MOVEMENT_EFFECT_RULES.heavyLean : mounted ? MOVEMENT_EFFECT_RULES.mountedLean : MOVEMENT_EFFECT_RULES.walkLean;
  const travelMs = distance * MOVEMENT_EFFECT_RULES.stepMs;
  return { points, distances, distance, startMs, travelMs, age: 0, bob, lean,
    duration: startMs + travelMs + MOVEMENT_EFFECT_RULES.settleMs,
    phase: unitPhase(unit.id), routing: unit.status === "routing" || unit.status === "escaped",
    escaped: unit.status === "escaped" };
}

/** @param {number} value 0〜1の進捗。 @returns {number} 姿勢を滑らかに戻す補間。 */
function smooth(value) { return value * value * (3 - 2 * value); }

/**
 * 経路に沿う線形移動と、開始・停止姿勢を表示専用に計算する。
 * @param {object} clip 保存した移動。 @returns {object} 描画と継続位置に使う補間結果。
 */
function sampleClip(clip) {
  const travelAge = Math.max(0, Math.min(clip.travelMs, clip.age - clip.startMs));
  const travelled = travelAge / MOVEMENT_EFFECT_RULES.stepMs;
  let rest = travelled;
  let segment = 0;
  while (segment < clip.distances.length - 1 && rest >= clip.distances[segment]) {
    rest -= clip.distances[segment];
    segment++;
  }
  const from = clip.points[segment], to = clip.points[segment + 1];
  const ratio = Math.min(1, rest / clip.distances[segment]);
  const dx = (to.x - from.x) / clip.distances[segment];
  const dy = (to.y - from.y) / clip.distances[segment];
  const stride = travelAge / MOVEMENT_EFFECT_RULES.stepMs * Math.PI * 2 + clip.phase;
  const settle = Math.max(0, Math.min(1, (clip.age - clip.startMs - clip.travelMs) / MOVEMENT_EFFECT_RULES.settleMs));
  const starting = clip.startMs > 0 && clip.age < clip.startMs;
  const finishing = clip.age >= clip.startMs + clip.travelMs;
  const envelope = Math.sin(Math.PI * Math.min(1, travelAge / clip.travelMs));
  const leanStrength = starting ? smooth(clip.age / clip.startMs)
    : finishing ? 1 - smooth(settle) : 1;
  const lean = clip.lean * (clip.routing ? 1.12 : 1);
  return {
    x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio,
    segment, dx, dy, stride,
    angle: (dx + dy * 0.35) * lean * leanStrength,
    bob: finishing ? Math.sin(settle * Math.PI) * MOVEMENT_EFFECT_RULES.settleScale * 0.5
      : starting ? 0 : -Math.abs(Math.sin(stride)) * clip.bob * envelope,
    scaleY: finishing ? 1 - Math.sin(settle * Math.PI) * MOVEMENT_EFFECT_RULES.settleScale : 1,
    alpha: clip.escaped && finishing ? 1 - settle : 1,
    groundStrength: starting ? 0 : (finishing ? 1 - settle : Math.min(1, travelled / 0.2)),
  };
}

/** @param {object} sample 補間結果。 @param {number} cell セル幅。 @returns {object} 足元中心のピクセル座標。 */
function groundCenter(sample, cell) { return { x: (sample.x + 0.5) * cell, y: (sample.y + 0.74) * cell }; }

/** @param {number} value 位相。 @returns {number} 0以上1未満の繰り返し進捗。 */
function cycle(value) { return value - Math.floor(value); }

/**
 * @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} clip 保存した移動。
 * @param {object} sample 補間結果。 @param {number} cell セル幅。 @param {string} terrain 地形キー。
 * @returns {void} 地形色に合わせた3粒だけの砂埃。
 */
function drawDust(ctx, clip, sample, cell, terrain) {
  const center = groundCenter(sample, cell);
  ctx.fillStyle = terrain === "forest" ? "#a8b18a" : terrain === "mountain" ? "#beb7ac" : "#c9b58d";
  for (let index = 0; index < 3; index++) {
    const progress = cycle(sample.stride / (Math.PI * 2) + index / 3);
    const spread = Math.sin(clip.phase + index * 2.3) * 0.055;
    ctx.globalAlpha = sample.groundStrength * sample.alpha * (1 - progress) * 0.24;
    ctx.beginPath();
    ctx.arc(center.x - sample.dx * cell * (0.06 + progress * 0.18) - sample.dy * spread * cell,
      center.y - sample.dy * cell * (0.06 + progress * 0.18) + sample.dx * spread * cell - progress * cell * 0.04,
      cell * (0.025 + progress * 0.035), 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} clip 保存した移動。
 * @param {object} sample 補間結果。 @param {number} cell セル幅。
 * @returns {void} 小さい水紋2個と、控えめな水滴2個。
 */
function drawWater(ctx, clip, sample, cell) {
  const center = groundCenter(sample, cell);
  ctx.strokeStyle = "#c4eaff";
  ctx.fillStyle = "#c4eaff";
  ctx.lineWidth = Math.max(0.65, cell * 0.012);
  for (let index = 0; index < 2; index++) {
    const progress = cycle(sample.stride / (Math.PI * 2) + index * 0.5);
    const radius = cell * (0.04 + progress * 0.12);
    ctx.globalAlpha = sample.groundStrength * sample.alpha * (1 - progress) * 0.32;
    ctx.beginPath();
    ctx.ellipse(center.x - sample.dx * cell * progress * 0.12, center.y - sample.dy * cell * progress * 0.12,
      radius, radius * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
    const spread = (index ? 1 : -1) * (0.03 + progress * 0.06);
    ctx.beginPath();
    ctx.arc(center.x - sample.dy * cell * spread, center.y + sample.dx * cell * spread
      - Math.sin(progress * Math.PI) * cell * (0.06 + clip.bob), cell * 0.013, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} clip 保存した移動。
 * @param {object} sample 補間結果。 @param {number} cell セル幅。
 * @returns {void} 甲板では砂埃を使わず、短い踏み跡2本に抑える。
 */
function drawFootprints(ctx, clip, sample, cell) {
  const center = groundCenter(sample, cell);
  ctx.strokeStyle = "#594b3c";
  ctx.lineWidth = Math.max(0.8, cell * 0.025);
  ctx.lineCap = "round";
  for (let index = 0; index < 2; index++) {
    const progress = cycle(sample.stride / (Math.PI * 2) + index * 0.5);
    const side = (index ? 1 : -1) * 0.035;
    const x = center.x - sample.dx * cell * progress * 0.17 - sample.dy * cell * side;
    const y = center.y - sample.dy * cell * progress * 0.17 + sample.dx * cell * side;
    ctx.globalAlpha = sample.groundStrength * sample.alpha * (1 - progress) * (0.13 + clip.bob);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + sample.dx * cell * 0.035, y + sample.dy * cell * 0.035);
    ctx.stroke();
  }
}
