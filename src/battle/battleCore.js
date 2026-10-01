import { findTacticalPath, findRoutPath, resolveBattleMovement, movementPriority } from "./battleMovement.js";
import { MORALE_RULES, isBattleActive, isBattleOnBoard, updateBattleMorale, localPressure } from "./battleMorale.js";
import { selectBattleTarget } from "./battleTarget.js";
import { chooseUnitFormation, formationDamage, initializeUnitFormation, resolveUnitFormation, unitFormation, UNIT_FORMATION_RULES } from "./battleUnitFormation.js";
import { REINFORCEMENT_RULES, deployReinforcements, canSideContinue } from "./battleReinforcements.js";

/** 現行ルールの時間・表示寿命。描画と計算で共有する。 */
export const BATTLE_RULES = Object.freeze({ tickMs: 1000, maxTicks: 60, attackFxTtl: 2, moveFxTtl: 3 });

/** 通常攻撃だけに適用する兵種補正。支援射撃には適用しない。 */
export const COMBAT_TRAIT_RULES = Object.freeze({ antiCavalry: 1.2, rangedEngaged: 0.7 });

/** 動揺と敵近接隣接による攻撃力補正を乗算する。増援直後・敗走中の敵は拘束しない。
 * @param {object} unit 部隊。 @param {Array} units 全部隊。 @returns {number} 攻撃倍率。
 */
export function battleAttackRate(unit, units) {
  const engaged = unit.role === "ranged" && units.some(enemy =>
    enemy.side !== unit.side && isBattleActive(enemy) && !enemy.arriving && enemy.role === "melee"
    && Math.abs(unit.x - enemy.x) + Math.abs(unit.y - enemy.y) === 1);
  return (unit.shaken ? MORALE_RULES.attackRate : 1) * (engaged ? COMBAT_TRAIT_RULES.rangedEngaged : 1);
}

/**
 * DOM・保存・全体stateに触れず、渡された戦闘状態だけを1tick進める。
 * 同じ盤面から移動意図を作り、移動後の通常攻撃を予約して同時反映する。
 * @param {object} battleState 戦闘状態。
 * @param {object} battleStrategy 作戦。
 * @param {object} dependencies ダメージ計算・射撃・設備名・乱数源。
 * @param {number} dtMs 進行時間。
 * @returns {{ended:boolean,forceDraw:boolean,logs:string[],observation:object}} 画面側へ渡す通知。
 */
export function stepBattle(battleState, battleStrategy, { defendedDamage, fireOutfitting, equipmentNames = {}, random = Math.random }, dtMs = 1000) {
  const logs = [];
  const before = battleState.units.map(u => ({ id: u.id, hp: u.hp, x: u.x, y: u.y }));
  let blockedSteps = 0;
  let zocStops = 0;
  let forceDraw = false;
  /** @param {string} text ログ本文。 */
  function addBattleLog(text) { logs.push(text); }
  /** @param {boolean} draw 時間切れか。 */
  function finishBattle(draw = false) { forceDraw = draw; }
  const BASE_TICK_MS = BATTLE_RULES.tickMs;
  const MAX_TICKS = battleState.battleKind === "grand" ? REINFORCEMENT_RULES.maxTicks : BATTLE_RULES.maxTicks;
  const ATTACK_FX_TTL = BATTLE_RULES.attackFxTtl;
  const MOVE_FX_TTL = BATTLE_RULES.moveFxTtl;
  const DECK_KEY = "deck";
  /**
   * マンハッタン距離を返す。
   * @param {object} a
   * @param {object} b
   * @returns {number}
   */
  function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  /**
   * ユニットがいるマスを占有表にまとめる。
   * @param {object[]} units
   * @returns {Set<string>}
   */
  function buildOccupied(units) {
    const occupied = new Set();
    units.forEach((u) => {
      if (u.hp <= 0) return;
      occupied.add(`${u.x},${u.y}`);
    });
    return occupied;
  }

  /**
   * 地形補正倍率を返す。
   * @param {object} unit
   * @returns {number}
   */
  function terrainRate(unit) {
    const terrain = battleState.grid[unit.y]?.[unit.x];
    const normalized = terrain === DECK_KEY ? "plain" : terrain;
    const rate = unit.terrain?.[terrain] ?? unit.terrain?.[normalized] ?? 100;
    return Math.max(0, Number(rate) || 100) / 100;
  }

  /**
   * 有効攻撃力を算出する。
   * @param {object} unit
   * @returns {number}
   */
  function effectiveAtk(unit) {
    return unit.atk * terrainRate(unit) * battleAttackRate(unit, battleState.units);
  }

  /**
   * 有効防御力を算出する。
   * @param {object} unit
   * @returns {number}
   */
  function effectiveDef(unit) {
    return unit.def * terrainRate(unit);
  }

  /**
   * 強さ判定値を算出する。
   * @param {object} unit
   * @returns {number}
   */
  function calcStrength(unit) {
    const atk = effectiveAtk(unit);
    const def = effectiveDef(unit);
    const dps = atk / Math.max(1, unit.spd);
    const ehp = unit.hp * (1 + def / 100);
    return dps * ehp;
  }

  /** @param {object} unit 部隊。 @param {Array} enemies 候補。 @returns {object|null} 標的。 */
  function selectTarget(unit, enemies) {
    return selectBattleTarget(unit, enemies, { strategy: battleStrategy, seed: battleState.randomSeed || 0,
      tick: battleState.tick, strength: calcStrength });
  }

  /** 開始時の共通盤面から脅威・圧力・攻撃可能性を評価する。
   * @param {object} unit 部隊。 @returns {object} 自動陣形と理由。
   */
  function decideFormation(unit) {
    const enemies = battleState.units.filter(enemy => enemy.side !== unit.side);
    const target = selectTarget(unit, enemies.filter(enemy => manhattan(unit, enemy) <= unit.range));
    return chooseUnitFormation(unit, {
      pressure: localPressure(unit, battleState.units),
      shock: (battleState.moraleShocks || []).some(event => event.side === unit.side
        && event.count > 0 && manhattan(unit, event) <= UNIT_FORMATION_RULES.shockRange),
      adjacentMelee: enemies.some(enemy => isBattleActive(enemy) && !enemy.arriving
        && enemy.role === "melee" && manhattan(unit, enemy) === 1),
      rangedThreat: enemies.some(enemy => isBattleActive(enemy) && !enemy.arriving
        && enemy.role === "ranged" && manhattan(unit, enemy) <= enemy.range),
      target, canAttack: !unit.arriving && isBattleActive(unit) && Math.max(0, (unit.cooldown || 0) - 1) === 0 && !!target,
    });
  }

  /** 共通盤面の判断を一括確定し、実際の切り替えだけを記録する。
   * @param {Array} units 対象部隊。 @returns {void}
   */
  function resolveFormations(units) {
    const decisions = new Map(units.filter(unit => isBattleActive(unit)).map(unit => [unit.id, decideFormation(unit)]));
    for (const unit of units) {
      if (resolveUnitFormation(unit, battleState.tick, () => decisions.get(unit.id)))
        addBattleLog(`${unit.side === "ally" ? "味方" : "敵"}の${unit.name}が${unitFormation(unit).name}に変更した。`);
    }
  }







  /**
   * 有利地形へ1歩退避する（現在地より補正が高い隣接マスがあれば移動）。
   * @param {object} unit
   * @param {Set<string>} occupied
   * @returns {boolean} moved
   */
  function retreatToBetterTerrain(unit, occupied) {
    const curRate = terrainRate(unit);
    let best = null;
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    dirs.forEach((d) => {
      const nx = unit.x + d.x;
      const ny = unit.y + d.y;
      if (nx < 0 || ny < 0 || nx >= battleState.size || ny >= battleState.size) return;
      const key = `${nx},${ny}`;
      if (occupied.has(key)) return;
      const rate = terrainRate({ ...unit, x: nx, y: ny });
      if (rate > curRate && (!best || rate > best.rate)) {
        best = { x: nx, y: ny, rate };
      }
    });
    if (!best) return false;
    occupied.delete(`${unit.x},${unit.y}`);
    occupied.add(`${best.x},${best.y}`);
    unit.x = best.x;
    unit.y = best.y;
    return true;
  }

  /**
   * 近接に張り付かれた遠隔ユニットが1歩下がる（射程を維持できる場合のみ）。
   * @param {object} unit
   * @param {object[]} enemies
   * @param {object|null} target
   * @param {Set<string>} occupied
   * @returns {boolean} moved
   */
  function kiteForRanged(unit, enemies, target, occupied) {
    if (unit.role !== "ranged") return false;
    const melee = enemies.filter((e) => isBattleActive(e) && e.role === "melee");
    if (!melee.length) return false;
    const adjMelee = melee.filter((m) => manhattan(unit, m) === 1);
    if (!adjMelee.length) return false;
    const currentMin = Math.min(...adjMelee.map((m) => manhattan(unit, m)));
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    let best = null;
    dirs.forEach((d) => {
      const nx = unit.x + d.x;
      const ny = unit.y + d.y;
      if (nx < 0 || ny < 0 || nx >= battleState.size || ny >= battleState.size) return;
      const key = `${nx},${ny}`;
      if (occupied.has(key)) return;
      const minMelee = Math.min(...melee.map((m) => Math.abs(nx - m.x) + Math.abs(ny - m.y)));
      if (minMelee <= currentMin) return;
      const distToTarget = target ? Math.abs(nx - target.x) + Math.abs(ny - target.y) : 0;
      if (distToTarget > unit.range) return; // 射程を外すなら下がらない
      if (!best || minMelee > best.min || distToTarget < best.dist) {
        best = { x: nx, y: ny, min: minMelee, dist: distToTarget };
      }
    });
    if (!best) return false;
    occupied.delete(`${unit.x},${unit.y}`);
    occupied.add(`${best.x},${best.y}`);
    unit.x = best.x;
    unit.y = best.y;
    return true;
  }



  /**
   * 通常行動、枠順の支援射撃、勝敗、制限時間の順に1ティックを処理する。
   * @param {number} dtMs 進行時間(ms)
   * @returns {boolean}
   */
  function advanceBattleTick(dtMs = BASE_TICK_MS) {
    battleState.elapsedMs += dtMs;
    battleState.tick += 1;
    for (const unit of battleState.units) if (unit.arriving) unit.arriving = false;
    resolveFormations(battleState.units.filter(unit => unit.status !== "reserve"));
    const arrivals = deployReinforcements(battleState);
    for (const unit of arrivals) {
      initializeUnitFormation(unit, unit.formationOrder, battleState.tick + 1);
      addBattleLog(`${unit.side === "ally" ? "味方" : "敵"}の増援: ${unit.name} ${unit.count}人が到着した。`);
      if (unit.formationOrder === "auto") unit.formationChangeAt = battleState.tick;
    }
    resolveFormations(arrivals);
    const alive = battleState.units.filter(isBattleOnBoard);
    const allies = alive.filter((u) => u.side === "ally");
    const enemies = alive.filter((u) => u.side === "enemy");
    const occupied = buildOccupied(alive);
    // 攻撃エフェクトの寿命を減衰
    battleState.attackFx = (battleState.attackFx || [])
      .map((fx) => ({ ...fx, ttl: (fx.ttl || 0) - 1 }))
      .filter((fx) => fx.ttl > 0);
    // 移動軌跡の寿命を減衰
    battleState.moveFx = (battleState.moveFx || [])
      .map((fx) => ({ ...fx, ttl: (fx.ttl || 0) - 1 }))
      .filter((fx) => fx.ttl > 0);

    const plans = alive.map(unit => {
      if (unit.arriving) return { unit, path: [], kind: "hold", wantsMove: false, attackBlocked: true };
      if (unit.status === "routing") return { unit, path: findRoutPath(unit, battleState.size, alive,
        movementPriority(unit.id, battleState.randomSeed || 0, battleState.tick)).slice(0, unit.move), kind: "rout", wantsMove: true };
      unit.switchLock = Math.max(0, (unit.switchLock || 0) - 1);
      unit.cooldown = Math.max(0, unit.cooldown - 1);
      const enemyList = unit.side === "ally" ? enemies : allies;
      let target = enemyList.find(e => e.id === unit.targetId);
      if (target && !isBattleActive(target) && enemyList.some(isBattleActive)) target = null;
      if (!target || manhattan(unit, target) > unit.range + 5 || unit.switchLock <= 0) {
        const next = selectTarget(unit, enemyList);
        if (next && next.id !== unit.targetId) unit.switchLock = unit.role === "ranged" ? 2 : 3;
        target = next;
      }
      const plan = { unit, path: [], kind: "hold", wantsMove: false };
      if (!target) return plan;
      unit.targetId = target.id;
      const strategy = unit.side === "ally" ? battleStrategy : { kiteMode: "kite", retreatThreshold: 30, chargeMode: "cavalry" };
      const shadow = { ...unit };
      const retreatLimit = strategy.kiteMode !== "none" ? (strategy.retreatThreshold ?? 30) / 100 : 0;
      if (unit.hp / Math.max(1, unit.maxHp) < retreatLimit && retreatToBetterTerrain(shadow, new Set(occupied))) {
        return { unit, path: [{ x: shadow.x, y: shadow.y }], kind: "retreat", wantsMove: true };
      }
      if (strategy.kiteMode !== "none" && kiteForRanged(shadow, enemyList, target, new Set(occupied))) {
        return { unit, path: [{ x: shadow.x, y: shadow.y }], kind: "kite", wantsMove: true };
      }
      const priority = movementPriority(unit.id, battleState.randomSeed || 0, battleState.tick);
      if (unit.role === "support") {
        const path = findTacticalPath(unit, target, battleState.size, occupied, priority, alive).slice(0, unit.move);
        return { unit, path, kind: "support", wantsMove: path.length > 0 };
      }
      if (manhattan(unit, target) <= unit.range) return plan;
      let steps = unit.move;
      const restrictCharge = steps > 1 && (strategy.chargeMode === "all"
        || (strategy.chargeMode === "cavalry" && unit.traits?.includes("mounted")));
      if (restrictCharge) {
        const friends = alive.filter(friend => friend.side === unit.side && friend.id !== unit.id);
        const friendMin = Math.min(...friends.map(friend => manhattan(friend, target)));
        if (manhattan(unit, target) <= friendMin - 2) steps = 1;
      }
      const path = findTacticalPath(unit, target, battleState.size, occupied, priority, alive).slice(0, steps);
      return { unit, path, kind: "approach", wantsMove: true };
    });
    const movement = resolveBattleMovement(plans, alive, battleState.size, battleState.randomSeed || 0, battleState.tick);
    blockedSteps = movement.blocked;
    zocStops = movement.zocStops;
    battleState.moveFx.push(...movement.moves.map(move => ({ ...move, ttl: MOVE_FX_TTL })));
    battleState.moveFx = battleState.moveFx.slice(-400);

    // 移動後の盤面で全攻撃を予約する。相打ちを許し、倒された側の予約攻撃も成立する。
    const attacks = [];
    for (const plan of plans) {
      const { unit } = plan;
      if (!isBattleActive(unit) || unit.cooldown > 0 || plan.attackBlocked || (plan.moved && plan.kind !== "kite")) continue;
      const targets = alive.filter(enemy => enemy.side !== unit.side && manhattan(unit, enemy) <= unit.range);
      const target = selectTarget(unit, targets);
      if (!target) continue;
      unit.targetId = target.id;
      const atk = effectiveAtk(unit);
      const antiCavalry = unit.traits?.includes("antiCavalry") && target.traits?.includes("mounted");
      const damage = formationDamage(Math.floor(defendedDamage(atk, effectiveDef(target))
        * (antiCavalry ? COMBAT_TRAIT_RULES.antiCavalry : 1)), unit, target);
      attacks.push({ unit, target, damage, atk });
      unit.cooldown = unit.spd;
    }
    for (const { unit, target, damage, atk } of attacks) {
      target.hp = Math.max(0, target.hp - damage);
      battleState.attackFx.push({ from: unit.id, to: target.id, ttl: ATTACK_FX_TTL });
      battleState.attackFx.push({ from: unit.id, to: target.id, ttl: ATTACK_FX_TTL, impact: true, crit: damage > atk * 0.8 });
    }
    for (const target of alive.filter(unit => unit.hp <= 0))
      addBattleLog(`${target.side === "ally" ? "味方" : "敵"}の${target.name}が撃破された。`);

    for (const shot of fireOutfitting(battleState.tick, alive.filter(isBattleActive), battleState.outfitting.effects.attacks,
      effectiveDef, random, (damage, target) => formationDamage(damage, null, target, "ranged"))) {
      battleState.attackFx.push({ support: true, equipmentId: shot.id, to: shot.target.id, ttl: ATTACK_FX_TTL, impact: true });
      addBattleLog(`${equipmentNames[shot.id] || shot.id}: 敵の${shot.target.name}に${shot.damage}ダメージ${shot.target.hp <= 0 ? "・撃破" : ""}。`);
    }
    for (const unit of updateBattleMorale(battleState, before))
      addBattleLog(`${unit.side === "ally" ? "味方" : "敵"}の${unit.name}が士気を失い敗走した。`);
    for (const unit of alive) {
      if (unit.hp <= 0) unit.status = "destroyed";
      else if (unit.status === "routing" && unit.x === (unit.side === "ally" ? 0 : battleState.size - 1)) unit.status = "escaped";
    }
    const allyContinues = canSideContinue(battleState, "ally");
    const enemyContinues = canSideContinue(battleState, "enemy");
    if (!allyContinues || !enemyContinues) {
      const sealed = ["ally", "enemy"].some(side => !canSideContinue(battleState, side)
        && (battleState.entryBlockedTicks?.[side] || 0) >= REINFORCEMENT_RULES.blockedTicks);
      battleState.resultReason = sealed ? "blockade" : battleState.units.some(unit => (unit.side === "ally" ? !allyContinues : !enemyContinues)
        && (unit.status === "routing" || unit.status === "escaped")) ? "rout" : "elimination";
      finishBattle();
      return true;
    }
    if (battleState.tick >= MAX_TICKS) {
      battleState.resultReason = "timeout";
      finishBattle(true);
      return true;
    }
    return false;
  }
  const ended = advanceBattleTick(dtMs);
  for (const unit of battleState.units) {
    if (unit.status === "active" && unit.hp <= 0) unit.status = "destroyed";
  }
  const observation = { tick: battleState.tick, blockedSteps, zocStops, movedUnits: 0, damage: 0 };
  for (const previous of before) {
    const unit = battleState.units.find(u => u.id === previous.id);
    if (!unit) continue;
    if (unit.x !== previous.x || unit.y !== previous.y) observation.movedUnits++;
    observation.damage += Math.max(0, previous.hp - unit.hp);
  }
  return { ended, forceDraw, logs, observation };
}

/**
 * 継戦可能な部隊を比較する。時間切れと両軍継戦不能は引き分けとする。
 * @param {object[]} units 部隊。
 * @param {boolean} forceDraw 時間切れか。
 * @param {object} context 増援と入口封鎖の戦闘状態。省略時は通常戦。
 * @returns {string} win／lose／draw。
 */
export function battleResult(units, forceDraw = false, context = {}) {
  const state = { ...context, units };
  const allies = canSideContinue(state, "ally");
  const enemies = canSideContinue(state, "enemy");
  if (!forceDraw) {
    if (allies && !enemies) return "win";
    if (!allies && enemies) return "lose";
  }
  return "draw";
}

/**
 * 32bitシードから再現可能な乱数列を返す。描画や再生速度から独立させる。
 * @param {number} seed シード。
 * @returns {Function} 0以上1未満の乱数源。
 */
export function createBattleRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let n = Math.imul(value ^ (value >>> 15), 1 | value);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
