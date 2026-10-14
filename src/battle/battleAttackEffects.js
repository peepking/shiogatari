import { ATTACK_EFFECT_STYLES } from "./battleEffectConfig.js";

/**
 * 確定した攻撃を5種類の形で描く。保存情報・戦闘状態・乱数源は変更しない。
 * 粒数と軌道は固定し、会心だけを約1.2倍にする。待機中・終了済みは描かない。
 * @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} clip 攻撃の保存情報。
 * @param {number} cell セル幅。 @returns {void}
 */
export function drawBattleAttack(ctx, clip, cell) {
  if (!Number.isFinite(cell) || cell <= 0 || !Number.isFinite(clip.age)
    || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.age < 0 || clip.age >= clip.duration
    || ![clip.fromX, clip.fromY, clip.toX, clip.toY].every(Number.isFinite)) return;
  const category = Object.prototype.hasOwnProperty.call(ATTACK_EFFECT_STYLES, clip.category) ? clip.category : "slash";
  const style = ATTACK_EFFECT_STYLES[category];
  const fromX = (clip.fromX + 0.5) * cell, fromY = (clip.fromY + 0.5) * cell;
  const toX = (clip.toX + 0.5) * cell, toY = (clip.toY + 0.5) * cell;
  const distance = Math.hypot(toX - fromX, toY - fromY);
  const dx = distance > 0 ? (toX - fromX) / distance : 1;
  const dy = distance > 0 ? (toY - fromY) / distance : 0;
  const scale = clip.crit ? 1.2 : 1;
  const frame = { clip, style, cell, fromX, fromY, toX, toY, distance, dx, dy,
    angle: Math.atan2(dy, dx), progress: clip.age / clip.duration,
    size: cell * (clip.support?.radius || style.size) * scale,
    width: Math.max(0.8, cell * style.width * scale) };
  ctx.save();
  try {
    ctx.strokeStyle = clip.color;
    ctx.fillStyle = clip.color;
    ctx.lineWidth = frame.width;
    ctx.lineCap = "round";
    ctx.globalAlpha = 1;
    if (clip.support) { ctx.shadowColor = clip.color; ctx.shadowBlur = Math.min(clip.support.glow, cell * 0.2); }
    drawMuzzle(ctx, frame, scale);
    // 発射直後は発射光だけにし、全体艤装の発射光集約を崩さない。
    if (frame.progress === 0) return;
    if (category === "slash") drawSlash(ctx, frame);
    else if (category === "thrust") drawThrust(ctx, frame);
    else if (category === "strike") drawStrike(ctx, frame);
    else if (category === "projectile") drawProjectile(ctx, frame);
    else drawBlast(ctx, frame);
    if (clip.fire) drawEmbers(ctx, frame, category);
  } finally {
    ctx.restore();
  }
}

/** @param {number} value 補間値。 @returns {number} 0〜1に収めた値。 */
function clamp(value) { return Math.max(0, Math.min(1, value)); }

/** @param {object} frame 攻撃の表示値。 @returns {number} 命中後の進捗。 */
function impactProgress(frame) { return clamp((frame.progress - frame.style.impactAt) / (1 - frame.style.impactAt)); }

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} frame 表示値。 @param {number} scale 会心倍率。 @returns {void} 小さな発射光を一度だけ描く。 */
function drawMuzzle(ctx, frame, scale) {
  if (!frame.clip.muzzle || frame.progress >= 0.17) return;
  ctx.globalAlpha = 1 - frame.progress / 0.17;
  ctx.beginPath();
  ctx.arc(frame.fromX, frame.fromY, frame.cell * (frame.clip.support ? 0.09 : 0.045) * scale
    * (1 - frame.progress / 0.17), 0, Math.PI * 2);
  ctx.fill();
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} frame 表示値。 @returns {void} 標的の周囲だけを横切る三日月と細い残光を描く。 */
function drawSlash(ctx, frame) {
  if (frame.progress < frame.style.windup) return;
  const swing = clamp((frame.progress - frame.style.windup) / (frame.style.impactAt - frame.style.windup));
  const fade = frame.progress < frame.style.impactAt ? 1 : 1 - impactProgress(frame);
  const start = frame.angle - 1.45 + swing * 0.65, end = start + 1.65;
  const x = frame.toX - frame.dx * frame.size * 0.12, y = frame.toY - frame.dy * frame.size * 0.12;
  ctx.globalAlpha = fade * 0.76;
  ctx.beginPath();
  ctx.arc(x, y, frame.size, start, end);
  ctx.arc(x, y, frame.size * (0.76 + swing * 0.08), end, start, true);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = fade * 0.32;
  ctx.lineWidth = frame.width * 0.45;
  ctx.beginPath();
  ctx.arc(x, y, frame.size * 1.08, start - 0.15, end - 0.15);
  ctx.stroke();
  if (frame.progress >= frame.style.impactAt) drawSparks(ctx, frame, impactProgress(frame), 2, 0.75);
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} frame 表示値。 @returns {void} 短い直線と穂先が標的へ伸びて戻る。 */
function drawThrust(ctx, frame) {
  if (frame.progress < frame.style.windup) return;
  const impact = impactProgress(frame);
  const reach = frame.progress < frame.style.impactAt
    ? Math.sin(clamp((frame.progress - frame.style.windup) / (frame.style.impactAt - frame.style.windup)) * Math.PI / 2)
    : 1 - impact;
  const x = frame.toX - frame.dx * frame.size * (1 - reach), y = frame.toY - frame.dy * frame.size * (1 - reach);
  const length = frame.size * (0.4 + reach * 0.9);
  ctx.globalAlpha = 0.86 * (1 - impact);
  ctx.beginPath();
  ctx.moveTo(x - frame.dx * length, y - frame.dy * length);
  ctx.lineTo(x, y);
  ctx.stroke();
  drawArrowhead(ctx, x, y, frame.dx, frame.dy, frame.size * 0.35, frame.size * 0.15);
  if (frame.progress >= frame.style.impactAt) drawSparks(ctx, frame, impact, 3, 0.8);
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} frame 表示値。 @returns {void} 圧縮した打点が丸い衝撃波と3片の破片へ広がる。 */
function drawStrike(ctx, frame) {
  if (frame.progress < frame.style.windup) return;
  if (frame.progress < frame.style.impactAt) {
    const charge = clamp((frame.progress - frame.style.windup) / (frame.style.impactAt - frame.style.windup));
    ctx.globalAlpha = 0.35 + charge * 0.3;
    ctx.beginPath();
    ctx.ellipse(frame.toX - frame.dx * frame.size * 0.2, frame.toY - frame.dy * frame.size * 0.2,
      frame.size * 0.55, frame.size * (0.13 + charge * 0.12), frame.angle, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const impact = impactProgress(frame);
  ctx.globalAlpha = (1 - impact) * 0.8;
  ctx.lineWidth = frame.width * (1 - impact * 0.55);
  ctx.beginPath();
  ctx.arc(frame.toX, frame.toY, frame.size * (0.3 + impact * 0.75), 0, Math.PI * 2);
  ctx.stroke();
  for (let index = 0; index < 3; index++) {
    const angle = frame.angle + 0.6 + index * Math.PI * 2 / 3;
    const distance = frame.size * (0.35 + impact * 0.85);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    drawArrowhead(ctx, frame.toX + dx * distance, frame.toY + dy * distance,
      dx, dy, frame.size * 0.2, frame.size * 0.08);
  }
  drawSparks(ctx, frame, impact, 3, 0.6);
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} frame 表示値。 @returns {void} 短い尾を持つ矢と小さい着弾火花を描く。 */
function drawProjectile(ctx, frame) {
  const flight = clamp(frame.progress / frame.style.impactAt);
  if (flight >= 1) { drawSparks(ctx, frame, impactProgress(frame), 5, 1); return; }
  const x = frame.fromX + (frame.toX - frame.fromX) * flight;
  const y = frame.fromY + (frame.toY - frame.fromY) * flight;
  const tail = Math.min(frame.distance * flight, frame.cell * 0.24);
  ctx.globalAlpha = 0.38;
  ctx.lineWidth = frame.width * 0.7;
  ctx.beginPath();
  ctx.moveTo(x - frame.dx * tail, y - frame.dy * tail);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.globalAlpha = 0.94;
  ctx.lineWidth = frame.width;
  ctx.beginPath();
  ctx.moveTo(x - frame.dx * Math.min(tail, frame.cell * 0.13), y - frame.dy * Math.min(tail, frame.cell * 0.13));
  ctx.lineTo(x, y);
  ctx.stroke();
  drawArrowhead(ctx, x, y, frame.dx, frame.dy, frame.size * 0.5, frame.size * 0.22);
}

/** @param {object} frame 表示値。 @param {number} flight 飛翔の進捗。 @returns {object} 短い放物線上の弾位置。 */
function blastPosition(frame, flight) {
  return { x: frame.fromX + (frame.toX - frame.fromX) * flight,
    y: frame.fromY + (frame.toY - frame.fromY) * flight
      - Math.sin(flight * Math.PI) * Math.min(frame.cell * 0.6, frame.distance * 0.12) };
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} frame 表示値。 @returns {void} 放物線の弾が膨らむ爆発と薄い煙へ変わる。 */
function drawBlast(ctx, frame) {
  const flight = clamp(frame.progress / frame.style.impactAt);
  if (flight < 1) {
    const head = blastPosition(frame, flight), tail = blastPosition(frame, Math.max(0, flight - 0.1));
    ctx.globalAlpha = 0.44;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.arc(head.x, head.y, frame.size * 0.22, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const impact = impactProgress(frame), radius = frame.size * (0.28 + impact * 0.95);
  ctx.globalAlpha = (1 - impact) * 0.58;
  ctx.beginPath();
  ctx.arc(frame.toX, frame.toY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = (1 - impact) * 0.76;
  ctx.beginPath();
  ctx.arc(frame.toX, frame.toY, radius * 1.14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#aab0bc";
  ctx.globalAlpha = (1 - impact) * 0.17;
  for (let index = 0; index < 3; index++) {
    const angle = index * Math.PI * 2 / 3;
    ctx.beginPath();
    ctx.arc(frame.toX + Math.cos(angle) * radius * 0.6,
      frame.toY + Math.sin(angle) * radius * 0.4 - frame.size * impact * 0.4,
      frame.size * (0.17 + impact * 0.3), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {number} x 先端X。 @param {number} y 先端Y。 @param {number} dx 方向X。 @param {number} dy 方向Y。 @param {number} length 長さ。 @param {number} width 半幅。 @returns {void} 回転変換せず小さい三角形を描く。 */
function drawArrowhead(ctx, x, y, dx, dy, length, width) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - dx * length - dy * width, y - dy * length + dx * width);
  ctx.lineTo(x - dx * length + dy * width, y - dy * length - dx * width);
  ctx.closePath();
  ctx.fill();
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} frame 表示値。 @param {number} impact 命中後の進捗。 @param {number} rays 火花数。 @param {number} spread 大きさの倍率。 @returns {void} 命中位置だけに固定本数の細い火花を描く。 */
function drawSparks(ctx, frame, impact, rays, spread) {
  ctx.globalAlpha = (1 - impact) * 0.9;
  ctx.lineWidth = Math.max(0.65, frame.width * 0.55);
  for (let index = 0; index < rays; index++) {
    const angle = frame.angle + 0.65 + index * Math.PI * 2 / rays;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const inner = frame.size * spread * 0.12, outer = frame.size * spread * (0.35 + impact * 0.65);
    ctx.beginPath();
    ctx.moveTo(frame.toX + dx * inner, frame.toY + dy * inner);
    ctx.lineTo(frame.toX + dx * outer, frame.toY + dy * outer);
    ctx.stroke();
  }
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} frame 表示値。 @param {string} category 攻撃の形。 @returns {void} 基本形を残し、炎だけを固定3粒で重ねる。 */
function drawEmbers(ctx, frame, category) {
  const flight = clamp(frame.progress / frame.style.impactAt);
  const center = category === "blast" && flight < 1 ? blastPosition(frame, flight)
    : category === "projectile" && flight < 1
      ? { x: frame.fromX + (frame.toX - frame.fromX) * flight, y: frame.fromY + (frame.toY - frame.fromY) * flight }
      : { x: frame.toX, y: frame.toY };
  ctx.shadowBlur = 0;
  for (let index = 0; index < 3; index++) {
    const phase = (frame.progress + index / 3) % 1, angle = frame.angle + index * 2.4;
    ctx.fillStyle = index === 1 ? "#ffe8a3" : "#ff7a39";
    ctx.globalAlpha = (1 - frame.progress) * (1 - phase) * 0.7;
    ctx.beginPath();
    ctx.arc(center.x + Math.cos(angle) * frame.size * (0.25 + phase * 0.6),
      center.y + Math.sin(angle) * frame.size * 0.4 - frame.size * phase * 0.6,
      Math.max(0.5, frame.cell * 0.015) * (1 - phase * 0.4), 0, Math.PI * 2);
    ctx.fill();
  }
}
