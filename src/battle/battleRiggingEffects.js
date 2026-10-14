import { BATTLE_RULES } from "./battleCore.js";
import { BATTLE_EFFECT_RULES, SUPPORT_RIGGING_RULES, SUPPORT_EFFECT_STYLES } from "./battleEffectConfig.js";

/** 台の形と反動の重さだけを変え、射撃能力や発動間隔は扱わない。 */
const MOUNT_STYLES = Object.freeze({
  harpoon: Object.freeze({ label: "モリ", kind: "harpoon", kick: 0.10, weight: 0.65 }),
  ballista: Object.freeze({ label: "バリスタ", kind: "bow", kick: 0.17, weight: 0.85 }),
  fire_ballista: Object.freeze({ label: "火炎弩", kind: "bow", kick: 0.19, weight: 0.9 }),
  grape_ballista: Object.freeze({ label: "散弾", kind: "bow", kick: 0.13, weight: 0.75 }),
  fire_grape_ballista: Object.freeze({ label: "火炎散弾", kind: "bow", kick: 0.16, weight: 0.8 }),
  cannon: Object.freeze({ label: "砲撃", kind: "cannon", kick: 0.28, weight: 1.15 }),
});

/**
 * 装備枠順の艤装を戦場外の帯へ置き、確定済みの射撃だけを照準・反動へ変換する。
 * 全標的の移動完了を共通に待ち、同じ艤装の全体射撃は一つの砲口と発射時計を共有する。
 * 戦闘状態・乱数源を変更せず、未発射の取消と有限の煙だけを表示時計で管理する。
 * @returns {object} 演出プレイヤーから利用する艤装表示。
 */
export function createBattleRiggingEffects() {
  let layout = { cell: 1, size: 8 };
  let mounts = [];
  let volleys = [];
  let plans = new Map();
  let authoritative = false;
  let lastTick = null;
  let sequence = 0;

  /** @param {number} cell セル幅。 @param {number} size 盤面の一辺。 @returns {void} リサイズ時だけ表示の縮尺を更新する。 */
  function setLayout(cell, size) {
    if (Number.isFinite(cell) && cell > 0 && Number.isFinite(size) && size > 0) layout = { cell, size };
  }

  /** @returns {number} 戦場直下の艤装帯の高さ。 */
  function height() {
    return Math.max(SUPPORT_RIGGING_RULES.minHeight, Math.min(SUPPORT_RIGGING_RULES.maxHeight,
      layout.cell * layout.size * SUPPORT_RIGGING_RULES.heightRatio));
  }

  /** @returns {boolean} 射撃艤装の台が一つでもあるか。 */
  function visible() { return mounts.length > 0; }

  /**
   * 戦闘開始時の装備と射撃効果から台だけを構成する。この操作では射撃しない。
   * 明示された装備があればその枠順を使い、旧状態では有効な射撃記録から台を補う。
   * @param {object} state 読み取り専用の戦闘状態。 @returns {void}
   */
  function configure(state) {
    if (Number.isFinite(state.size) && state.size > 0) layout.size = state.size;
    if (state.outfitting) {
      authoritative = true;
      const attacks = state.outfitting.effects?.attacks;
      const attackIds = Array.isArray(attacks)
        ? uniqueIds(attacks.map(attack => typeof attack === "string" ? attack : attack?.id ?? attack?.equipmentId)) : null;
      const equipped = state.outfitting.equipped;
      const ids = Array.isArray(equipped)
        ? uniqueIds(equipped).filter(id => attackIds ? attackIds.includes(id) : Object.hasOwn(MOUNT_STYLES, id))
        : attackIds || [];
      replaceMounts(ids.slice(0, SUPPORT_RIGGING_RULES.maxMounts));
      const allowed = new Set(mounts.map(mount => mount.equipmentId));
      volleys = volleys.filter(volley => volley.age >= 0 || allowed.has(volley.equipmentId));
    } else if (!authoritative) {
      const ids = mounts.map(mount => mount.equipmentId);
      const units = new Map((state.units || []).map(unit => [unit.id, unit]));
      for (const fx of state.attackFx || []) {
        if (validSupport(fx, units) && !ids.includes(fx.equipmentId)) ids.push(fx.equipmentId);
      }
      replaceMounts(ids.slice(0, SUPPORT_RIGGING_RULES.maxMounts));
    }
  }

  /** @param {Array<string>} ids 射撃設備IDの枠順。 @returns {void} 同じ台の照準角度を保持して配置を更新する。 */
  function replaceMounts(ids) {
    const previous = new Map(mounts.map(mount => [mount.equipmentId, mount]));
    mounts = ids.map((equipmentId, index) => ({ equipmentId, index, count: ids.length,
      angle: previous.get(equipmentId)?.angle ?? -Math.PI / 2 }));
  }

  /**
   * 新tickの命中記録を台ごとに一度だけ複製し、装備順の時間差を発射計画へ固定する。
   * 撃破済み標的も有限座標があれば扱い、全体射撃の各弾は同じ計画キーを使う。
   * @param {object} state 読み取り専用の戦闘状態。
   * @param {Function} [waitForUnit] 標的部隊の残り移動時間。 @returns {void}
   */
  function capture(state, waitForUnit = () => 0) {
    configure(state);
    if (state.tick === lastTick) return;
    lastTick = state.tick;
    plans = new Map();
    const units = new Map((state.units || []).map(unit => [unit.id, unit]));
    const targets = new Map();
    let globalWait = 0;
    for (const fx of state.attackFx || []) {
      if (!validSupport(fx, units) || !mounts.some(mount => mount.equipmentId === fx.equipmentId)) continue;
      const unit = units.get(fx.to);
      if (!targets.has(fx.equipmentId)) targets.set(fx.equipmentId, []);
      targets.get(fx.equipmentId).push({ x: unit.x, y: unit.y });
      const wait = waitForUnit(fx.to);
      if (Number.isFinite(wait)) globalWait = Math.max(globalWait, wait);
    }
    let rank = 0;
    for (const mount of mounts) {
      const points = targets.get(mount.equipmentId);
      if (!points?.length) continue;
      const delay = globalWait + SUPPORT_RIGGING_RULES.aimMs + rank * SUPPORT_RIGGING_RULES.staggerMs;
      const key = `rigging:${++sequence}:${String(state.tick)}:${mount.equipmentId}`;
      const current = mountPose(mount.equipmentId);
      const target = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length,
        y: sum.y + point.y / points.length }), { x: 0, y: 0 });
      volleys.push({ key, equipmentId: mount.equipmentId, index: mount.index, count: mount.count,
        fromAngle: current.angle, target, age: -delay, delay });
      plans.set(mount.equipmentId, { key, delay });
      rank++;
    }
    volleys = volleys.slice(-SUPPORT_RIGGING_RULES.maxVolleys);
  }

  /** @param {string} equipmentId 艤装ID。 @returns {object|null} 今tickに確定した共通発射計画。 */
  function planFor(equipmentId) {
    const plan = plans.get(equipmentId);
    return plan ? { ...plan } : null;
  }

  /**
   * 発射時の前方端を返す。反動や後続照準では飛翔中の始点を動かさず、リサイズだけ追従する。
   * @param {string} key 共通発射計画キー。 @returns {object|null} 兵と共有するセル座標。
   */
  function originFor(key) {
    const volley = volleys.find(entry => entry.key === key);
    if (!volley) return null;
    const geometry = geometryFor(volley, layout, height());
    const angle = targetAngle(volley.target, geometry, layout.cell);
    return { x: (geometry.x + Math.cos(angle) * geometry.length) / layout.cell - 0.5,
      y: (geometry.y + Math.sin(angle) * geometry.length) / layout.cell - 0.5 };
  }

  /** @param {number} deltaMs 倍率適用済みの表示時間。 @returns {void} 反動復帰と薄い煙が終われば射撃履歴を破棄する。 */
  function advance(deltaMs) {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    for (const volley of volleys) {
      volley.age += deltaMs;
      if (volley.age >= 0) {
        const mount = mounts.find(entry => entry.equipmentId === volley.equipmentId);
        if (mount) mount.angle = targetAngle(volley.target, geometryFor(volley, layout, height()), layout.cell);
      }
    }
    volleys = volleys.filter(volley => volley.age < BATTLE_EFFECT_RULES.supportMs + SUPPORT_RIGGING_RULES.smokeMs);
  }

  /** @returns {boolean} 待機・発射・反動・煙の有限な表示が残るか。 */
  function hasActive() { return volleys.length > 0; }

  /**
   * 遅れた攻撃の省略に合わせ、飛ぶ予定がなくなった未発射台だけを取り消す。
   * 発射済みの反動と煙は有限の終点まで残す。
   * @param {Set<string>} keys 現在の攻撃表示が保持する計画キー。 @returns {void}
   */
  function retain(keys) {
    volleys = volleys.filter(volley => volley.age >= 0 || keys.has(volley.key));
    const remaining = new Set(volleys.map(volley => volley.key));
    for (const [id, plan] of plans) if (!remaining.has(plan.key)) plans.delete(id);
  }

  /** @returns {void} 戦闘終了・非表示時は台、計画、反動とtick履歴をすべて破棄する。 */
  function clear() {
    mounts = [];
    volleys = [];
    plans = new Map();
    authoritative = false;
    lastTick = null;
    sequence = 0;
  }

  /**
   * 台の中心・砲口・照準・反動をピクセル世界座標で返す。発射瞬間は固定始点と砲口が一致する。
   * @param {string} equipmentId 艤装ID。 @returns {object|null} 描画・検証用の表示姿勢。
   */
  function mountPose(equipmentId) {
    const mount = mounts.find(entry => entry.equipmentId === equipmentId);
    if (!mount) return null;
    const volley = [...volleys].reverse().find(entry => entry.equipmentId === equipmentId
      && entry.age >= -SUPPORT_RIGGING_RULES.aimMs);
    const geometry = geometryFor(volley || mount, layout, height());
    const aimed = volley ? targetAngle(volley.target, geometry, layout.cell) : mount.angle;
    const angle = volley && volley.age < 0
      ? volley.fromAngle + shortAngle(aimed - volley.fromAngle) * smooth(1 + volley.age / SUPPORT_RIGGING_RULES.aimMs) : aimed;
    const recoil = volley ? recoilAt(volley.age) * geometry.length * mountStyle(equipmentId).kick : 0;
    const muzzleX = geometry.x + Math.cos(angle) * (geometry.length - recoil);
    const muzzleY = geometry.y + Math.sin(angle) * (geometry.length - recoil);
    return { ...geometry, equipmentId, angle, recoil, muzzleX, muzzleY,
      originX: geometry.x + Math.cos(aimed) * geometry.length,
      originY: geometry.y + Math.sin(aimed) * geometry.length,
      age: volley?.age ?? null, phase: !volley ? "idle" : volley.age < 0 ? "aim"
        : volley.age < SUPPORT_RIGGING_RULES.recoilMs ? "recoil"
          : volley.age < SUPPORT_RIGGING_RULES.recoilMs + SUPPORT_RIGGING_RULES.returnMs ? "return" : "smoke" };
  }

  /** @param {CanvasRenderingContext2D} ctx 世界座標の描画先。 @param {number} cell セル幅。 @returns {void} 台・砲身・ラベルと控えめな煙を描く。 */
  function drawMounts(ctx, cell) {
    if (!Number.isFinite(cell) || cell <= 0 || (!mounts.length && !volleys.some(volley => volley.age >= 0))) return;
    ctx.save();
    try {
      for (const mount of mounts) drawMount(ctx, mountPose(mount.equipmentId), mountStyle(mount.equipmentId), height());
      for (const volley of volleys) drawSmoke(ctx, volley, geometryFor(volley, layout, height()), layout.cell);
    } finally { ctx.restore(); }
  }

  /** @param {CanvasRenderingContext2D} ctx 世界座標の描画先。 @param {number} cell セル幅。 @returns {void} 全体射撃も各台一つの発射光だけを描く。 */
  function drawFire(ctx, cell) {
    if (!Number.isFinite(cell) || cell <= 0) return;
    const flashMs = BATTLE_EFFECT_RULES.supportMs * 0.17;
    const firing = volleys.filter(volley => volley.age >= 0 && volley.age < flashMs);
    if (!firing.length) return;
    ctx.save();
    try {
      for (const volley of firing) {
        const origin = originFor(volley.key), progress = volley.age / flashMs;
        const geometry = geometryFor(volley, layout, height());
        const angle = targetAngle(volley.target, geometry, layout.cell);
        const color = effectStyle(volley.equipmentId).color;
        const radius = Math.min(height() * 0.16, cell * 0.1) * mountStyle(volley.equipmentId).weight * (1 - progress);
        const x = (origin.x + 0.5) * cell, y = (origin.y + 0.5) * cell;
        ctx.fillStyle = color;
        ctx.globalAlpha = (1 - progress) * 0.9;
        ctx.shadowColor = color;
        ctx.shadowBlur = Math.min(10, radius * 1.4);
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(angle) * radius * 0.3, y + Math.sin(angle) * radius * 0.3,
          radius * 1.5, radius * 0.75, angle, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    } finally { ctx.restore(); }
  }

  return { setLayout, configure, capture, planFor, originFor, advance, drawMounts, drawFire,
    hasActive, height, visible, retain, clear, mountPose };
}

/** @param {Array} ids 設備候補。 @returns {Array<string>} 有効なIDの重複を枠順のまま除く。 */
function uniqueIds(ids) { return [...new Set(ids.filter(id => typeof id === "string" && id.length > 0))]; }

/** @param {object} fx 攻撃記録。 @param {Map} units 部隊一覧。 @returns {boolean} 新しい支援命中と有限な標的座標があるか。 */
function validSupport(fx, units) {
  const unit = units.get(fx.to);
  return Boolean(fx.support && fx.impact && fx.ttl === BATTLE_RULES.attackFxTtl
    && typeof fx.equipmentId === "string" && fx.equipmentId.length && unit
    && Number.isFinite(unit.x) && Number.isFinite(unit.y));
}

/** @param {string} id 艤装ID。 @returns {object} 未知の設備も安全なモリ台へまとめた形。 */
function mountStyle(id) { return Object.hasOwn(MOUNT_STYLES, id) ? MOUNT_STYLES[id] : MOUNT_STYLES.harpoon; }

/** @param {string} id 艤装ID。 @returns {object} 未知の設備も既存のモリ色へまとめた表示色。 */
function effectStyle(id) { return Object.hasOwn(SUPPORT_EFFECT_STYLES, id) ? SUPPORT_EFFECT_STYLES[id] : SUPPORT_EFFECT_STYLES.harpoon; }

/** @param {number} value 補間値。 @returns {number} 両端で滑らかに止まる0〜1の値。 */
function smooth(value) { const ratio = Math.max(0, Math.min(1, value)); return ratio * ratio * (3 - 2 * ratio); }

/** @param {number} angle 角度差。 @returns {number} 最短方向の角度差。 */
function shortAngle(angle) { return Math.atan2(Math.sin(angle), Math.cos(angle)); }

/** @param {number} age 発射後の表示時間。 @returns {number} 後退して元の位置へ戻る0〜1の反動量。 */
function recoilAt(age) {
  if (age < 0) return 0;
  if (age < SUPPORT_RIGGING_RULES.recoilMs) return smooth(age / SUPPORT_RIGGING_RULES.recoilMs);
  return 1 - smooth((age - SUPPORT_RIGGING_RULES.recoilMs) / SUPPORT_RIGGING_RULES.returnMs);
}

/** @param {object} mount 台または発射時に固定した枠。 @param {object} layout 盤面の縮尺。 @param {number} rackHeight 帯の高さ。 @returns {object} 兵の盤面と重ならない台と砲身の寸法。 */
function geometryFor(mount, layout, rackHeight) {
  const width = layout.cell * layout.size, slot = width / Math.max(1, mount.count);
  return { x: slot * (mount.index + 0.5), y: width + rackHeight * 0.55,
    length: Math.max(10, Math.min(slot * 0.25, rackHeight * 0.34)),
    index: mount.index, count: mount.count, slot, top: width };
}

/** @param {object} target 固定した標的中心のセル座標。 @param {object} geometry 台の寸法。 @param {number} cell セル幅。 @returns {number} 砲口から標的中心へ向く角度。 */
function targetAngle(target, geometry, cell) {
  return Math.atan2((target.y + 0.5) * cell - geometry.y, (target.x + 0.5) * cell - geometry.x);
}

/** @param {object} pose 台の姿勢。 @param {number} forward 前後方向の距離。 @param {number} side 横方向の距離。 @returns {object} 回転した砲身上の世界座標。 */
function barrelPoint(pose, forward, side) {
  return { x: pose.x + Math.cos(pose.angle) * (forward - pose.recoil) - Math.sin(pose.angle) * side,
    y: pose.y + Math.sin(pose.angle) * (forward - pose.recoil) + Math.cos(pose.angle) * side };
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {Array<object>} points 頂点座標。 @returns {void} 台の小さい部品を閉じた図形で描く。 */
function polygon(ctx, points) {
  ctx.beginPath();
  points.forEach((point, index) => { if (index) ctx.lineTo(point.x, point.y); else ctx.moveTo(point.x, point.y); });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} pose 台の姿勢。 @param {object} style 形と重さ。 @param {number} rackHeight 帯の高さ。 @returns {void} 木台・金属砲身または弩と短い設備名を描く。 */
function drawMount(ctx, pose, style, rackHeight) {
  const length = pose.length, baseWidth = length * 1.15, baseHeight = length * 0.3;
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#514439";
  ctx.strokeStyle = "#a38b69";
  ctx.lineWidth = 1;
  ctx.fillRect(pose.x - baseWidth / 2, pose.y - baseHeight * 0.15, baseWidth, baseHeight);
  ctx.beginPath();
  ctx.moveTo(pose.x - baseWidth / 2, pose.y + baseHeight);
  ctx.lineTo(pose.x + baseWidth / 2, pose.y + baseHeight);
  ctx.stroke();
  ctx.fillStyle = "#242b32";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(pose.x + side * baseWidth * 0.35, pose.y + baseHeight, Math.max(2, length * 0.12), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  const halfWidth = length * (style.kind === "cannon" ? 0.19 : 0.085);
  ctx.fillStyle = style.kind === "cannon" ? "#8c9ba4" : "#a7aeb0";
  ctx.strokeStyle = "#26343d";
  polygon(ctx, [barrelPoint(pose, -length * 0.3, -halfWidth), barrelPoint(pose, length, -halfWidth * 0.85),
    barrelPoint(pose, length, halfWidth * 0.85), barrelPoint(pose, -length * 0.3, halfWidth)]);
  if (style.kind === "bow") {
    ctx.strokeStyle = "#c8ac7a";
    ctx.lineWidth = Math.max(2, length * 0.1);
    const left = barrelPoint(pose, length * 0.35, -length * 0.65), middle = barrelPoint(pose, length * 0.65, 0);
    const right = barrelPoint(pose, length * 0.35, length * 0.65);
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(middle.x, middle.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "#e5d9bf";
    const string = barrelPoint(pose, -length * 0.1, 0);
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(string.x, string.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
  } else if (style.kind === "harpoon") {
    ctx.fillStyle = "#c9e0e6";
    polygon(ctx, [barrelPoint(pose, length, 0), barrelPoint(pose, length * 0.7, -length * 0.18),
      barrelPoint(pose, length * 0.7, length * 0.18)]);
  } else {
    const muzzle = barrelPoint(pose, length, 0);
    ctx.fillStyle = "#26343d";
    ctx.beginPath();
    ctx.ellipse(muzzle.x, muzzle.y, halfWidth * 0.85, halfWidth * 0.42,
      pose.angle + Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = `${Math.min(11, Math.max(8, pose.slot / 6))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#18212b";
  ctx.fillStyle = "#d6dfdf";
  ctx.strokeText(style.label, pose.x, pose.top + rackHeight - 4, Math.max(1, pose.slot - 4));
  ctx.fillText(style.label, pose.x, pose.top + rackHeight - 4, Math.max(1, pose.slot - 4));
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} volley 射撃記録。 @param {object} geometry 台の寸法。 @param {number} cell セル幅。 @returns {void} 発射済みの台へ固定3粒だけ薄い煙を残す。 */
function drawSmoke(ctx, volley, geometry, cell) {
  const duration = BATTLE_EFFECT_RULES.supportMs + SUPPORT_RIGGING_RULES.smokeMs;
  if (volley.age < 0 || volley.age >= duration) return;
  const progress = volley.age / duration, angle = targetAngle(volley.target, geometry, cell);
  const x = geometry.x + Math.cos(angle) * geometry.length, y = geometry.y + Math.sin(angle) * geometry.length;
  ctx.fillStyle = "#b9c5ce";
  ctx.shadowBlur = 0;
  for (let index = 0; index < 3; index++) {
    ctx.globalAlpha = (1 - progress) * 0.15;
    ctx.beginPath();
    ctx.arc(x + (index - 1) * geometry.length * (0.1 + progress * 0.24),
      y - geometry.length * progress * (0.45 + index * 0.15),
      geometry.length * (0.08 + progress * 0.2), 0, Math.PI * 2);
    ctx.fill();
  }
}
