/** 演出専用の初期調整値。戦闘の威力・間隔・判定には使用しない。 */
export const BATTLE_EFFECT_RULES = Object.freeze({
  maxClips: 160,
  maxFrameMs: 100,
  projectileMs: 300,
  attackMs: 260,
  supportMs: 420,
  impactAt: 0.62,
});

/** 艤装砲座の照準・反動・時間差射撃に使う表示専用値。 */
export const SUPPORT_RIGGING_RULES = Object.freeze({
  aimMs: 80,
  staggerMs: 70,
  recoilMs: 90,
  returnMs: 220,
  smokeMs: 180,
  minHeight: 56,
  maxHeight: 88,
  heightRatio: 0.12,
  maxMounts: 5,
  maxVolleys: 160,
});

/** 移動・足元・停止姿勢の表示専用値。長さはセル幅を基準とする。 */
export const MOVEMENT_EFFECT_RULES = Object.freeze({
  startMs: 60,
  stepMs: 180,
  settleMs: 100,
  walkBob: 0.035,
  mountedBob: 0.055,
  heavyBob: 0.018,
  walkLean: 0.09,
  mountedLean: 0.13,
  heavyLean: 0.055,
  settleScale: 0.045,
});

/** 兵種の戦術役割とは独立した、共有する攻撃の形。 */
export const ATTACK_EFFECT_CATEGORIES = Object.freeze({
  slash: "斬撃",
  thrust: "刺突・突撃",
  strike: "打撃",
  projectile: "射撃",
  blast: "砲撃・爆発",
});

/** 攻撃の構え・命中・姿勢を共有する表示専用値。長さはセル幅を基準とする。 */
export const ATTACK_EFFECT_STYLES = Object.freeze({
  slash: Object.freeze({ windup: 0.14, impactAt: 0.46, size: 0.32, width: 0.055, lunge: 0.10, tilt: 0.09, hit: 0.035 }),
  thrust: Object.freeze({ windup: 0.10, impactAt: 0.48, size: 0.20, width: 0.04, lunge: 0.16, tilt: 0.035, hit: 0.045 }),
  strike: Object.freeze({ windup: 0.18, impactAt: 0.52, size: 0.26, width: 0.075, lunge: 0.08, tilt: -0.07, hit: 0.055 }),
  projectile: Object.freeze({ windup: 0, impactAt: 0.62, size: 0.16, width: 0.035, lunge: 0.02, tilt: -0.025, hit: 0.025 }),
  blast: Object.freeze({ windup: 0, impactAt: 0.58, size: 0.32, width: 0.05, lunge: 0, tilt: 0, hit: 0.055 }),
});

/** 兵種の性能ではなく、持っている武器の形で攻撃の見た目を共有する。 */
export const TROOP_ATTACK_CATEGORIES = Object.freeze({
  infantry: "slash", marine: "slash", pirate_axe: "slash",
  halberd: "thrust", pirate_spear: "thrust", cavalry: "thrust",
  cavalier: "thrust", raider_cavalry: "thrust", pirate_assault: "thrust",
  shield: "strike", pirate_shield: "strike", medic: "strike", scout: "strike",
  archer: "projectile", crossbow: "projectile", seaArcher: "projectile", pirate_archer: "projectile",
});

/** 艤装は弾の飛び方と着弾の形を共有し、砲座と反動は専用表示へ接続する。 */
export const SUPPORT_ATTACK_CATEGORIES = Object.freeze({
  harpoon: "projectile", ballista: "projectile", grape_ballista: "projectile",
  fire_ballista: "blast", fire_grape_ballista: "blast", cannon: "blast",
});

/** 艤装ごとの既存色と強弱を維持する。 */
export const SUPPORT_EFFECT_STYLES = Object.freeze({
  harpoon: Object.freeze({ color: "#70e8ff", width: 3.5, glow: 6, rays: 5, radius: 0.18 }),
  ballista: Object.freeze({ color: "#c49aff", width: 5.5, glow: 10, rays: 7, radius: 0.25 }),
  fire_ballista: Object.freeze({ color: "#ff5d45", width: 6.5, glow: 14, rays: 9, radius: 0.29 }),
  grape_ballista: Object.freeze({ color: "#a9c5ff", width: 2, glow: 4, rays: 5, radius: 0.14 }),
  fire_grape_ballista: Object.freeze({ color: "#ff7050", width: 2.5, glow: 6, rays: 6, radius: 0.17 }),
  cannon: Object.freeze({ color: "#ff9955", width: 8, glow: 16, rays: 10, radius: 0.34 }),
});

/** 陣営の区別は既存の配色を引き継ぐ。 */
export const ATTACK_EFFECT_COLORS = Object.freeze({ ally: "#ffd447", enemy: "#ff4df5" });
