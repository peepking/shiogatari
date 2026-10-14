import { BATTLE_RULES } from "./battleCore.js";
import { createBattleMovementEffects } from "./battleMovementEffects.js";
import { createBattleRiggingEffects } from "./battleRiggingEffects.js";
import { drawBattleAttack } from "./battleAttackEffects.js";
import { BATTLE_EFFECT_RULES, TROOP_ATTACK_CATEGORIES, SUPPORT_EFFECT_STYLES, SUPPORT_ATTACK_CATEGORIES, ATTACK_EFFECT_STYLES, ATTACK_EFFECT_COLORS } from "./battleEffectConfig.js";

/**
 * 確定済みの移動と攻撃を表示専用の時計で再生する。戦闘状態・乱数源には書き込まない。
 * 同tickの発射・命中レコードのうち命中側だけを取り込み、TTL更新時のコピーも再生し直さない。
 * @param {object} dependencies 描画とフレーム予約、単調増加時計。
 * @returns {object} 戦闘画面へ接続する演出プレイヤー。
 */
export function createBattleEffectPlayer({ render, requestFrame, cancelFrame, now }) {
  const movement = createBattleMovementEffects();
  const rigging = createBattleRiggingEffects();
  let clips = [];
  let lastTick = -1;
  let frameId = null;
  let lastTime = null;
  let playing = false;
  let speed = 1;

  /** @returns {void} 予約を取り消し、停止中の実時間を演出へ持ち越さない。 */
  function cancel() {
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;
    lastTime = null;
  }

  /** @param {number} timestamp 描画時計。 @returns {void} 前回以降を現在の倍率で進める。 */
  function advanceTo(timestamp) {
    if (lastTime !== null && playing) {
      const elapsed = Math.min(BATTLE_EFFECT_RULES.maxFrameMs, Math.max(0, timestamp - lastTime));
      movement.advance(elapsed * speed);
      rigging.advance(elapsed * speed);
      for (const clip of clips) clip.age += elapsed * speed;
      clips = clips.filter(clip => clip.age < clip.duration);
    }
    lastTime = timestamp;
  }

  /** @returns {void} 再生中の演出がある間だけ、1件の描画を予約する。 */
  function schedule() {
    if (!playing || (!clips.length && !movement.hasActive() && !rigging.hasActive()) || frameId !== null) return;
    if (lastTime === null) lastTime = now();
    frameId = requestFrame(onFrame);
  }

  /** @param {number} timestamp 描画時計。 @returns {void} 1フレームを進めて画面へ反映する。 */
  function onFrame(timestamp) {
    frameId = null;
    if (!playing) return;
    advanceTo(timestamp);
    render();
    schedule();
    if (!clips.length && !movement.hasActive() && !rigging.hasActive()) lastTime = null;
  }

  /**
   * 新しいtickの命中レコードを座標ごと複製する。撃破・相打ちの攻撃も保持する。
   * 全体艤装の発射光は装備ごとに一度、着弾は標的ごとに残す。過負荷時は古い演出から落とす。
   * 次の移動と競合する過去の攻撃は省略し、現在の移動先へ到着してから新しい攻撃を表示する。
   * @param {object} state 読み取り専用の戦闘状態。
   * @returns {void}
   */
  function capture(state) {
    if (state.tick === lastTick) return;
    lastTick = state.tick;
    // 描画が遅れたときは、次の移動と競合する古い攻撃だけ省略して空中発射を防ぐ。
    const movingIds = new Set((state.moveFx || []).filter(fx => fx.ttl === BATTLE_RULES.moveFxTtl).map(fx => fx.id));
    clips = clips.filter(clip => !movingIds.has(clip.fromId) && !movingIds.has(clip.toId));
    rigging.retain(new Set(clips.map(clip => clip.riggingKey).filter(Boolean)));
    movement.capture(state);
    rigging.capture(state, movement.remaining);
    const units = new Map(state.units.map(unit => [unit.id, unit]));
    for (const fx of state.attackFx || []) {
      if (!fx.impact || fx.ttl !== BATTLE_RULES.attackFxTtl) continue;
      const plan = fx.support ? rigging.planFor(fx.equipmentId) : null;
      const origin = plan ? rigging.originFor(plan.key) : null;
      const from = fx.support ? origin && { ...origin, side: "ally" } : units.get(fx.from);
      const to = units.get(fx.to);
      if (!from || !to) continue;
      const support = fx.support ? (Object.hasOwn(SUPPORT_EFFECT_STYLES, fx.equipmentId)
        ? SUPPORT_EFFECT_STYLES[fx.equipmentId] : SUPPORT_EFFECT_STYLES.harpoon) : null;
      const category = support ? (Object.hasOwn(SUPPORT_ATTACK_CATEGORIES, fx.equipmentId)
        ? SUPPORT_ATTACK_CATEGORIES[fx.equipmentId] : "projectile")
        : Object.hasOwn(TROOP_ATTACK_CATEGORIES, from.type) ? TROOP_ATTACK_CATEGORIES[from.type] : "slash";
      clips.push({
        fromId: fx.from, toId: fx.to,
        fromX: from.x, fromY: from.y, toX: to.x, toY: to.y,
        color: support?.color || ATTACK_EFFECT_COLORS[from.side] || ATTACK_EFFECT_COLORS.ally,
        category, support, equipmentId: fx.equipmentId, riggingKey: plan?.key,
        fire: Boolean(support && fx.equipmentId?.startsWith("fire_")), crit: Boolean(fx.crit),
        // 移動後に確定した攻撃は、関係する兵が表示上の終点へ到着してから見せる。
        age: -(support ? plan.delay : Math.max(movement.remaining(fx.from), movement.remaining(fx.to))),
        muzzle: !support,
        duration: support ? BATTLE_EFFECT_RULES.supportMs
          : category === "projectile" ? BATTLE_EFFECT_RULES.projectileMs : BATTLE_EFFECT_RULES.attackMs,
      });
    }
    clips = clips.slice(-BATTLE_EFFECT_RULES.maxClips);
    rigging.retain(new Set(clips.map(clip => clip.riggingKey).filter(Boolean)));
  }

  /**
   * 再描画では同じ攻撃を再登録しない。倍率変更前の時間だけ旧倍率で確定する。
   * 一時停止は凍結、戦闘終了は確定済みの演出だけ最後まで再生する。非表示時は破棄する。
   * @param {object} state 戦闘状態。
   * @param {boolean} [hidden=false] 戦闘画面またはタブが非表示か。
   * @returns {void}
   */
  function sync(state, hidden = false) {
    rigging.configure(state);
    const nextSpeed = [1, 2, 4].includes(state.speed) ? state.speed : 1;
    const nextPlaying = !hidden && Boolean(state.running || state.result);
    // 新攻撃を足す前に既存分だけ進め、発生前の待ち時間を新しい弾へ加算しない。
    if (state.tick !== lastTick || playing !== nextPlaying || speed !== nextSpeed) advanceTo(now());
    speed = nextSpeed;
    playing = nextPlaying;
    if (hidden) {
      clips = [];
      movement.clear();
      rigging.clear();
      lastTick = state.tick;
    } else {
      capture(state);
    }
    if (!playing) cancel();
    else schedule();
  }

  /** @returns {void} 一時停止時は直前まで進め、再開まで時計を止める。 */
  function pause() {
    advanceTo(now());
    playing = false;
    cancel();
  }

  /** @returns {void} 画面終了・初期化時に全演出と予約を破棄する。 */
  function clear() {
    cancel();
    clips = [];
    movement.clear();
    rigging.clear();
    lastTick = -1;
    playing = false;
    speed = 1;
  }

  /** @param {CanvasRenderingContext2D} ctx 描画先。 @param {number} cell セル幅。 @returns {void} 保存した攻撃だけを描く。 */
  function draw(ctx, cell) {
    for (const clip of clips) {
      const origin = clip.riggingKey ? rigging.originFor(clip.riggingKey) : null;
      if (clip.riggingKey && !origin) continue;
      drawBattleAttack(ctx, origin ? { ...clip, fromX: origin.x, fromY: origin.y } : clip, cell);
    }
    rigging.drawFire(ctx, cell);
  }


  /**
   * 攻撃の構え・踏込み・被弾は兵画像だけへ合成する。重複攻撃は加算せず最大の表現を選ぶ。
   * 姿勢が操作やHP表示を揺らさないよう表示中心を保ち、合成後のずれにも上限を設ける。
   * @param {object} unit 表示する部隊。
   * @returns {object} 移動姿勢と画像専用の攻撃姿勢。
   */
  function unitPose(unit) {
    const pose = { ...movement.pose(unit), attackX: 0, attackY: 0, attackAngle: 0, attackScaleY: 1, hitFlash: 0 };
    if (unit.hp <= 0 || ["reserve", "destroyed", "escaped"].includes(unit.status)) return pose;
    let attackAmount = 0, hitAmount = 0, hitX = 0, hitY = 0;
    for (const clip of clips) {
      if (clip.age < 0 || clip.age >= clip.duration) continue;
      if (clip.fromId !== unit.id && clip.toId !== unit.id) continue;
      const style = Object.hasOwn(ATTACK_EFFECT_STYLES, clip.category)
        ? ATTACK_EFFECT_STYLES[clip.category] : ATTACK_EFFECT_STYLES.slash;
      const progress = clip.age / clip.duration;
      const origin = clip.riggingKey ? rigging.originFor(clip.riggingKey) : null;
      const fromX = origin?.x ?? clip.fromX, fromY = origin?.y ?? clip.fromY;
      const distance = Math.hypot(clip.toX - fromX, clip.toY - fromY);
      const dx = distance ? (clip.toX - fromX) / distance : unit.side === "enemy" ? -1 : 1;
      const dy = distance ? (clip.toY - fromY) / distance : 0;
      const strength = clip.crit ? 1.2 : 1;
      if (!clip.support && clip.fromId === unit.id && !pose.moving) {
        const action = attackEnvelope(progress, style);
        const amount = action * style.lunge * strength;
        if (Math.abs(amount) > attackAmount) {
          attackAmount = Math.abs(amount);
          pose.attackX = dx * amount;
          pose.attackY = dy * amount;
          pose.attackAngle = (dx + dy * 0.35) * style.tilt * action * strength;
          pose.attackScaleY = clip.category === "strike" ? 1 - Math.max(0, action) * 0.05 : 1;
        }
      }
      const hitProgress = (progress - style.impactAt) / Math.min(0.26, 1 - style.impactAt);
      if (clip.toId === unit.id && hitProgress >= 0 && hitProgress < 1) {
        const flash = Math.sin(hitProgress * Math.PI) * 0.75;
        const shake = Math.sin(hitProgress * Math.PI * 4) * (1 - hitProgress) * style.hit * strength;
        pose.hitFlash = Math.max(pose.hitFlash, flash);
        if (Math.abs(shake) > hitAmount) {
          hitAmount = Math.abs(shake);
          hitX = dx * shake;
          hitY = dy * shake;
        }
      }
    }
    pose.attackX += hitX;
    pose.attackY += hitY;
    const offset = Math.hypot(pose.attackX, pose.attackY);
    if (offset > 0.22) { pose.attackX *= 0.22 / offset; pose.attackY *= 0.22 / offset; }
    pose.attackAngle = Math.max(-0.16, Math.min(0.16, pose.attackAngle));
    pose.hitFlash = Math.min(0.8, pose.hitFlash);
    pose.attackScaleY = Math.max(0.92, Math.min(1.04, pose.attackScaleY * (1 - pose.hitFlash * 0.06)));
    return pose;
  }

  return { sync, draw, pause, clear, unitPose, drawGround: movement.drawGround,
    setLayout: rigging.setLayout, drawRigging: rigging.drawMounts, riggingHeight: rigging.height, hasRigging: rigging.visible };
}

/** @param {number} value 0〜1の進捗。 @returns {number} 滑らかな構え・復帰の補間値。 */
function smoothAttack(value) { return value * value * (3 - 2 * value); }

/** @param {number} progress 攻撃の進捗。 @param {object} style カテゴリ設定。 @returns {number} 構えで後退し、命中へ踏み込んで戻る量。 */
function attackEnvelope(progress, style) {
  if (progress < style.windup) return -0.2 * smoothAttack(progress / style.windup);
  if (progress < style.impactAt) {
    const start = style.windup > 0 ? -0.2 : 0;
    return start + (1 - start) * smoothAttack((progress - style.windup) / (style.impactAt - style.windup));
  }
  return 1 - smoothAttack((progress - style.impactAt) / (1 - style.impactAt));
}
