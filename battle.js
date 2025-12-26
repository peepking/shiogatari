import { elements, pushLog, pushToast } from "./dom.js";
import { TROOP_STATS } from "./troops.js";
import { clamp } from "./util.js";
import { state } from "./state.js";
import { MODE_LABEL, BATTLE_RESULT, BATTLE_RESULT_LABEL } from "./constants.js";
import { getTerrainAt } from "./map.js";

const BASE_TICK_MS = 1000;
const MAX_TICKS = 60;
const FIXED_BATTLE_SIZE = 10;
const SEARCH_RANGE = 4;
const MELEE_SEARCH_RANGE = 3;
const TARGET_SWITCH_RATIO = 1.5;
const SPEED_OPTIONS = [1, 2, 4];
const MAX_UNIT_COUNT = 10;
const MAX_SQUADS = 20;
const ATTACK_FX_TTL = 2;
const MOVE_FX_TTL = 3;
const MOVE_COLORS = {
  ally: "#4ec7f0",
  enemy: "#f26b6b",
  allyRetreat: "#f6a63c",
  enemyRetreat: "#f08232",
};
const ATTACK_COLORS = {
  ally: "#ffd447", // 黄金色で移動ラインと差別化
  enemy: "#ff4df5", // マゼンタ寄りでコントラストを確保
};
const DECK_KEY = "deck";

/**
 * バトルキャンバスを画面幅とDPRに合わせてリサイズする
 */
function resizeBattleCanvas() {
  const canvas = elements.battleCanvas;
  if (!canvas) return;
  const size = battleState.size || FIXED_BATTLE_SIZE;
  const dpr = window.devicePixelRatio || 1;
  const parentWidth =
    canvas.parentElement?.clientWidth || canvas.clientWidth || canvas.width || 640;
  // 親幅いっぱいに合わせ、ズーム/全体でサイズを変えない
  const drawSize = parentWidth;
  const cellDisplay = Math.max(24, Math.floor(drawSize / size));
  canvas.style.width = `${drawSize}px`;
  canvas.style.height = `${drawSize}px`;
  canvas.width = Math.floor(drawSize * dpr);
  canvas.height = Math.floor(drawSize * dpr);
  if (!battleState.ctx) battleState.ctx = canvas.getContext("2d");
  battleState.dpr = dpr;
  battleState.cellDisplay = cellDisplay;
  if (battleState.ctx) {
    battleState.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    battleState.ctx.clearRect(0, 0, drawSize, drawSize);
  }
}

const TERRAIN_KINDS = [
  { key: "sea", name: "海", color: "#0f4c81" },
  { key: "forest", name: "森", color: "#16603a" },
  { key: "plain", name: "平原", color: "#3a6b35" },
  { key: "mountain", name: "山岳", color: "#4b4b4b" },
  { key: "shoal", name: "浅瀬", color: "#227f91" },
  { key: DECK_KEY, name: "甲板", color: "#b58a5c" },
];

const TERRAIN_WEIGHTS_BY_BASE = {
  plain: [
    { key: "plain", weight: 60 },
    { key: "forest", weight: 15 },
    { key: "mountain", weight: 15 },
    { key: "shoal", weight: 10 },
  ],
  forest: [
    { key: "forest", weight: 60 },
    { key: "plain", weight: 15 },
    { key: "mountain", weight: 15 },
    { key: "shoal", weight: 10 },
  ],
  mountain: [
    { key: "mountain", weight: 60 },
    { key: "plain", weight: 15 },
    { key: "forest", weight: 15 },
    { key: "shoal", weight: 10 },
  ],
  shoal: [
    { key: "shoal", weight: 70 },
    { key: "sea", weight: 30 },
  ],
  sea: [
    { key: "sea", weight: 70 },
    { key: "shoal", weight: 30 },
  ],
};

const DEFAULT_ENEMY_FORMATION = [
  { type: "infantry", count: 10, level: 1 },
  { type: "infantry", count: 10, level: 1 },
  { type: "archer", count: 10, level: 1 },
  { type: "archer", count: 10, level: 1 },
  { type: "cavalry", count: 10, level: 1 },
  { type: "shield", count: 10, level: 1 },
  { type: "medic", count: 10, level: 1 },
  { type: "scout", count: 10, level: 1 },
  { type: "marine", count: 10, level: 1 },
  { type: "seaArcher", count: 10, level: 1 },
];

/** @type {Record<string, HTMLImageElement>} */
const unitImages = {};

const battleState = {
  ready: false,
  running: false,
  speed: 1,
  elapsedMs: 0,
  tick: 0,
  size: 10,
  grid: [],
  units: [],
  timer: null,
  ctx: null,
  logLines: [],
  resultCode: "",
  result: "",
  hoveredId: null,
  selectedId: null,
  allyFormation: "balance",
  customSlots: {},
  customSlotsDraft: {},
  editing: false,
  selectedUnitId: null,
  attackFx: [],
  moveFx: [],
  enemyFormation: null,
  enemyFactionId: null,
  onEnd: null,
  battleTerrain: "plain",
  enemySlotOrder: null,
};

const battleRoster = {
  standby: {},
  sortie: [],
};

const battleStrategy = {
  targetMode: "type", // "type" = 兵種準拠
  kiteMode: "kite", // "kite" | "retreat" | "none"
  retreatThreshold: 30, // percent
  chargeMode: "cavalry", // "cavalry" | "all" | "none"
  speed: 1,
};

const UNIT_TARGET_MODE = {
  infantry: "hp",
  marine: "hp",
  shield: "hp",
  cavalry: "hp",
  medic: "hp",
  scout: "hp",
  archer: "rear",
  crossbow: "rear",
  seaArcher: "rear",
};

/**
 * 部隊編成をUIドラフトから確定させる。
 */
function applyRoster() {
  if (!battleRoster.sortie.length) {
    pushToast("編成エラー", "出撃部隊がありません。1部隊以上を出撃にしてください。", "warn");
    return;
  }
  resetBattle();
}

/**
 * 戦闘マップの一辺サイズを計算する。
 * @returns {number}
 */
function calcBattleSize() {
  return FIXED_BATTLE_SIZE;
}

/**
 * 戦闘用の地形グリッドを生成する。
 * @param {number} size
 * @param {string} baseTerrain
 * @returns {string[][]}
 */
function buildBattleGrid(size, baseTerrain = "plain") {
  const weights = TERRAIN_WEIGHTS_BY_BASE[baseTerrain] || TERRAIN_WEIGHTS_BY_BASE.plain;
  const pickWeightedTerrain = () => {
    const total = weights.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    for (const item of weights) {
      roll -= item.weight;
      if (roll <= 0) return item.key;
    }
    return weights[weights.length - 1].key;
  };

  const grid = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) {
      row.push(pickWeightedTerrain());
    }
    grid.push(row);
  }

  if (baseTerrain === "shoal" || baseTerrain === "sea") {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x < 2 || x >= size - 2) {
          grid[y][x] = DECK_KEY;
        }
      }
    }
  }

  return grid;
}

/**
 * トループ状態を集計して部隊ごとのレベル別人数を得る。
 * standbyLevels: type -> [{level, count}]
 */
function aggregateTroops() {
  const standbyLevels = {};
  Object.entries(state.troops || {}).forEach(([type, levels]) => {
    if (typeof levels === "number") {
      if (!standbyLevels[type]) standbyLevels[type] = [];
      standbyLevels[type].push({ level: 1, count: levels });
      return;
    }
    Object.entries(levels || {}).forEach(([lvl, qty]) => {
      if (!standbyLevels[type]) standbyLevels[type] = [];
      standbyLevels[type].push({ level: Number(lvl), count: Number(qty || 0) });
    });
  });
  // ソート（Lv高い順）と0除去
  Object.keys(standbyLevels).forEach((type) => {
    standbyLevels[type] = standbyLevels[type]
      .filter((e) => e.count > 0)
      .sort((a, b) => b.level - a.level);
  });
  return standbyLevels;
}

/**
 * ロスターを初期化する（全員待機）。
 */
function resetRoster() {
  battleRoster.standby = aggregateTroops();
  battleRoster.sortie = [];
}

/**
 * 待機総数を取得。
 * @returns {Record<string, number>}
 */
function standbyTotals() {
  const totals = {};
  Object.entries(battleRoster.standby || {}).forEach(([type, list]) => {
    totals[type] = (list || []).reduce((sum, e) => sum + (e.count || 0), 0);
  });
  return totals;
}

/**
 * 待機中の平均レベル（人数加重）を返す。
 * @param {string} type
 * @returns {number}
 */
function standbyAverageLevel(type) {
  const list = battleRoster.standby[type] || [];
  let cnt = 0;
  let wsum = 0;
  list.forEach((e) => {
    cnt += e.count || 0;
    wsum += (e.count || 0) * (e.level || 1);
  });
  if (cnt === 0) return 1;
  return Math.round((wsum / cnt) * 10) / 10;
}

/**
 * スタンバイから人数を取り出し、平均Lvを返す。
 * @param {string} type
 * @param {number} amount
 * @returns {{count:number, level:number}}
 */
function takeFromStandby(type, amount) {
  const list = battleRoster.standby[type] || [];
  let remain = Math.max(0, amount);
  let used = 0;
  let wSum = 0;
  while (remain > 0 && list.length) {
    const bucket = list[0];
    const take = Math.min(bucket.count, remain);
    used += take;
    wSum += take * bucket.level;
    bucket.count -= take;
    if (bucket.count <= 0) list.shift();
    remain -= take;
  }
  if (!list.length) delete battleRoster.standby[type];
  if (used === 0) return { count: 0, level: 1 };
  const avg = Math.round((wSum / used) * 10) / 10;
  return { count: used, level: avg };
}

/**
 * スタンバイに人数を戻す（レベル付）。
 * @param {string} type
 * @param {number} count
 * @param {number} level
 */
function pushToStandby(type, count, level) {
  if (count <= 0) return;
  if (!battleRoster.standby[type]) battleRoster.standby[type] = [];
  battleRoster.standby[type].push({ level, count });
  battleRoster.standby[type] = battleRoster.standby[type]
    .filter((e) => e.count > 0)
    .sort((a, b) => b.level - a.level);
}

/**
 * 出撃部隊一覧を返す（最大20件）。
 * @returns {Array<{type:string,count:number}>}
 */
function getSortieEntries() {
  return battleRoster.sortie.slice(0, MAX_SQUADS);
}

/**
 * 重み（自動配備用）。
 * @param {string} type
 * @returns {number}
 */
function autoWeight(type) {
  const stat = TROOP_STATS[type];
  return stat?.basePower ?? stat?.hire ?? 0;
}

/**
 * 自動配備を行う。
 */
function autoDeployRoster() {
  resetRoster();
  const totals = standbyTotals();
  // 部隊（最大10人）チャンク単位で重み付けし、強い順に詰める
  const chunks = Object.entries(totals)
    .filter(([, cnt]) => cnt > 0)
    .flatMap(([type, cnt]) => {
      const avgLv = standbyAverageLevel(type);
      const base = autoWeight(type) * (1 + 0.1 * (avgLv - 1));
      const slotCount = Math.ceil(cnt / MAX_UNIT_COUNT);
      return Array.from({ length: slotCount }, (_, i) => {
        const remain = cnt - i * MAX_UNIT_COUNT;
        const chunk = Math.min(MAX_UNIT_COUNT, Math.max(1, remain));
        return { type, size: chunk, weight: base * chunk, avgLv };
      });
    })
    .sort((a, b) => b.weight - a.weight || b.size - a.size);

  battleRoster.sortie = [];
  // standbyは takeFromStandby が直接更新するので既存を再利用
  for (const chunk of chunks) {
    if (battleRoster.sortie.length >= MAX_SQUADS) break;
    const pulled = takeFromStandby(chunk.type, chunk.size);
    if (pulled.count <= 0) continue;
    battleRoster.sortie.push({ type: chunk.type, count: pulled.count, level: pulled.level });
  }
  // standby は takeFromStandby が既に減算済み
}

/**
 * 全員待機に戻す。
 */
function clearRoster() {
  resetRoster();
}

/**
 * ロスターUIを描画する。戦闘開始後は入力・ボタンをロックする。
 * @returns {void}
 */
function renderRosterUI() {
  const standbyEl = elements.rosterStandby;
  const sortieEl = elements.rosterSortie;
  const countEl = elements.rosterCount;
  const disableAll = battleState.running || !!battleState.result;
  const sortieCount = battleRoster.sortie.length;
  if (countEl) countEl.textContent = `${sortieCount}/${MAX_SQUADS}`;
  const sortieFull = sortieCount >= MAX_SQUADS;
  if (elements.rosterApply) elements.rosterApply.disabled = sortieCount === 0 || disableAll;

  // 合計人数を先に算出
  const totals = standbyTotals();

  if (standbyEl) {
    const rows = Object.entries(battleRoster.standby || {})
      .filter(([type]) => (totals[type] || 0) > 0)
      .map(([type]) => {
        const stat = TROOP_STATS[type];
        const name = stat?.name || type;
        const total = totals[type] || 0;
        const maxSend = Math.min(10, total);
        return `
          <div class="roster-row" data-type="${type}" data-count="${total}">
            <div class="roster-line">
              <div><b>${name}</b></div>
              <div class="tiny">待機 ${total}人</div>
            </div>
            <div class="roster-right">
              <div class="roster-controls">
                <input type="range" min="0" max="${maxSend}" value="${maxSend}" class="roster-slider" data-type="${type}" ${disableAll ? "disabled" : ""}>
                <input type="number" min="0" max="${maxSend}" value="${maxSend}" class="roster-number" data-type="${type}" ${disableAll ? "disabled" : ""}>
              </div>
              <button class="btn" data-action="to-sortie" ${sortieFull || disableAll ? "disabled" : ""}>出撃</button>
            </div>
          </div>
        `;
      })
      .join("");
    standbyEl.innerHTML = rows || `<div class="roster-empty">待機中の部隊はありません</div>`;
  }

  if (sortieEl) {
    const rows = battleRoster.sortie
      .map((s, idx) => {
        const stat = TROOP_STATS[s.type];
        const name = stat?.name || s.type;
        return `
          <div class="roster-row" data-idx="${idx}" data-type="${s.type}" data-count="${s.count}">
            <div class="roster-line">
              <div><b>${name}</b></div>
              <div class="tiny">出撃 ${s.count}人</div>
            </div>
            <button class="btn ghost" data-action="to-standby" ${disableAll ? "disabled" : ""}>待機</button>
          </div>
        `;
      })
      .join("");
    sortieEl.innerHTML = rows || `<div class="roster-empty">出撃予定の部隊はありません</div>`;
  }
  [elements.rosterAuto, elements.rosterClear].forEach((btn) => {
    if (btn) btn.disabled = disableAll;
  });
}

/**
 * 作戦UIを現在の設定で同期する。
 */
function renderStrategyUI() {
  if (elements.strategyTarget) elements.strategyTarget.value = battleStrategy.targetMode;
  if (elements.strategyKite) elements.strategyKite.value = battleStrategy.kiteMode;
  if (elements.strategyRetreat) elements.strategyRetreat.value = String(battleStrategy.retreatThreshold);
  if (elements.strategyCharge) elements.strategyCharge.value = battleStrategy.chargeMode;
  document
    .querySelectorAll("input[name='strategySpeed']")
    .forEach((r) => (r.checked = Number(r.value) === battleStrategy.speed));
}

/**
 * UI入力から作戦設定を反映する。
 */
function applyStrategyFromUI() {
  const target = elements.strategyTarget?.value || "type";
  const kite = elements.strategyKite?.value || "kite";
  const retreat = clamp(Number(elements.strategyRetreat?.value) || 30, 1, 100);
  const charge = elements.strategyCharge?.value || "cavalry";
  const speedSel = document.querySelector("input[name='strategySpeed']:checked");
  const speedVal = Number(speedSel?.value || battleStrategy.speed);
  battleStrategy.targetMode = target;
  battleStrategy.kiteMode = kite;
  battleStrategy.retreatThreshold = retreat;
  battleStrategy.chargeMode = charge;
  battleStrategy.speed = SPEED_OPTIONS.includes(speedVal) ? speedVal : 1;
  setBattleSpeed(battleStrategy.speed);
  renderStrategyUI();
  pushToast("作戦を更新", "戦闘方針を反映しました", "info", 2500);
}

/**
 * 配置可能な座標リスト（手前2列）を作成する。
 * @param {"ally"|"enemy"} side
 * @param {number} size
 * @returns {{x:number,y:number}[]}
 */
function buildDeploySlots(side, size) {
  const frontCols =
    side === "ally"
      ? [0, 1]
      : [size - 1, size - 2].filter((n) => n >= 0);
  const slots = [];
  frontCols.forEach((x) => {
    for (let y = 0; y < size; y++) slots.push({ x, y });
  });
  return slots;
}

/**
 * 兵種情報から戦闘ユニットを生成する。
 * @param {string} type
 * @param {"ally"|"enemy"} side
 * @param {number} index
 * @param {{x:number,y:number}} pos
 * @param {number} count
 * @returns {object}
 */
function createUnit(type, side, index, pos, count, level = 1) {
  const stat = TROOP_STATS[type];
  const baseAtk = stat?.atk ?? stat?.basePower ?? 10;
  const baseDef = stat?.def ?? 10;
  const baseHp = stat?.hp ?? 100;
  const unitCount = clamp(Number(count) || MAX_UNIT_COUNT, 1, MAX_UNIT_COUNT);
  const ratio = unitCount / MAX_UNIT_COUNT;
  const lvlRounded = Math.min(5, Math.round(Number(level) * 10) / 10); // 上限Lv5
  const lvlMultRaw = 1 + 0.1 * (lvlRounded - 1);
  const lvlMult = Math.round(lvlMultRaw * 100) / 100; // 小数2桁
  const hpVal = Math.max(1, Math.floor(baseHp * ratio * lvlMult));
  const atkVal = Math.max(1, Math.floor(baseAtk * ratio * lvlMult));
  const defVal = Math.max(1, Math.floor(baseDef * lvlMult));
  return {
    id: `${side}-${index + 1}`,
    side,
    type,
    name: stat?.name || type,
    count: unitCount,
    maxCount: MAX_UNIT_COUNT,
    level: lvlRounded,
    hp: hpVal,
    maxHp: hpVal,
    atk: atkVal,
    def: defVal,
    spd: stat?.spd ?? 3,
    range: stat?.range ?? 1,
    move: stat?.move ?? 1,
    terrain: stat?.terrain || {},
    x: pos.x,
    y: pos.y,
    cooldown: 0,
    switchLock: 0,
    targetId: null,
  };
}

/**
 * 側ごとのユニット配列を生成する。
 * @param {Array} entries
 * @param {"ally"|"enemy"} side
 * @param {number} size
 * @param {{x:number,y:number}[]} slots
 * @returns {object[]}
 */
function createUnits(entries, side, size, slots) {
  const positions = slots && slots.length ? slots : buildDeploySlots(side, size);
  return entries.map((entry, i) => {
    const type = typeof entry === "string" ? entry : entry?.type;
    const count = typeof entry === "string" ? MAX_UNIT_COUNT : entry?.count;
    const level = typeof entry === "string" ? 1 : entry?.level ?? 1;
    const pos = positions[i] || positions[positions.length - 1] || { x: 0, y: 0 };
    return createUnit(type, side, i, pos, count, level);
  });
}

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
  return unit.atk * terrainRate(unit);
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

/**
 * 目標優先モードを取得する。
 * @param {object} unit
 * @returns {"hp"|"rear"|"strong"}
 */
function targetMode(unit) {
  if (unit.side === "ally") {
    const mode = battleStrategy.targetMode;
    if (mode && mode !== "type") return mode;
  }
  return UNIT_TARGET_MODE[unit.type] || "strong";
}

/**
 * モードに応じたターゲットを選ぶ。
 * @param {"hp"|"rear"|"strong"} mode
 * @param {object} unit
 * @param {object[]} enemies
 * @returns {object|null}
 */
function pickTargetByMode(mode, unit, enemies) {
  if (!enemies.length) return null;
  if (mode === "rear") {
    const ranged = enemies.filter((e) => e.range > 1);
    if (ranged.length) {
      return ranged.reduce((best, cur) => (cur.hp < (best?.hp ?? Infinity) ? cur : best), null);
    }
    // 遠隔がいない場合はHP優先にフォールバック
    mode = "hp";
  }
  if (mode === "close") {
    return enemies.reduce((best, cur) => {
      if (!best) return cur;
      return manhattan(unit, cur) < manhattan(unit, best) ? cur : best;
    }, null);
  }
  if (mode === "hp") {
    return enemies.reduce((best, cur) => (cur.hp < (best?.hp ?? Infinity) ? cur : best), null);
  }
  // strong
  return enemies.reduce((best, cur) => {
    if (!best) return cur;
    return calcStrength(cur) > calcStrength(best) ? cur : best;
  }, null);
}

/**
 * スロットの並びをフォーメーション種別で並べ替える。
 * @param {"balance"|"assault"|"defense"} kind
 * @param {"ally"|"enemy"} side
 * @param {{x:number,y:number}[]} slots
 * @param {number} size
 * @returns {{x:number,y:number}[]}
 */
function sortSlotsByFormation(kind, side, slots, size) {
  const center = (size - 1) / 2;
  // 前列 = 敵に近い列 / 後列 = 敵から遠い列
  const frontCol = side === "ally" ? 1 : size - 2;
  const backCol = side === "ally" ? 0 : size - 1;
  const score = (slot) => {
    const dist = Math.abs(slot.y - center);
    const isFront = slot.x === frontCol;
    const isBack = slot.x === backCol;
    switch (kind) {
      case "assault":
        // 前の列を強く優先
        return (isFront ? 0 : 100) + dist;
      case "defense":
        // 後ろの列を強く優先
        return (isBack ? 0 : 100) + dist;
      case "balance":
      default:
        return (isFront ? 2 : 4) + dist;
    }
  };
  return [...slots].sort((a, b) => score(a) - score(b));
}

/**
 * ユニットへスロットを割り当てる。
 * @param {object[]} units
 * @param {{x:number,y:number}[]} slots
 * @param {Record<string, number>} [customMap]
 * @param {boolean} [keepExisting=false]
 */
function assignSlots(units, slots, customMap = {}, keepExisting = false) {
  const used = new Set();
  const slotIndexByKey = new Map();
  slots.forEach((s, i) => slotIndexByKey.set(`${s.x},${s.y}`, i));
  const claim = (idx) => {
    if (!Number.isFinite(idx)) return null;
    if (idx < 0 || idx >= slots.length) return null;
    if (used.has(idx)) return null;
    used.add(idx);
    return slots[idx];
  };
  const pickFallback = () => {
    for (let i = 0; i < slots.length; i++) {
      if (used.has(i)) continue;
      return claim(i);
    }
    return null;
  };
  units.forEach((u) => {
    let slot = null;
    const preferredIdx = Number(customMap[u.id]);
    slot = claim(preferredIdx);
    if (!slot && keepExisting) {
      const idx = slotIndexByKey.get(`${u.x},${u.y}`);
      slot = claim(idx);
    }
    if (!slot) slot = pickFallback();
    const picked = slot || slots[0] || { x: 0, y: 0 };
    u.x = picked.x;
    u.y = picked.y;
  });
}

/**
 * 配置を適用する（味方は指定フォーメーション、敵はランダム）。
 * @param {Record<string, number>} [customOverride]
 */
function applyFormations(customOverride) {
  const allies = battleState.units.filter((u) => u.side === "ally");
  const enemies = battleState.units.filter((u) => u.side === "enemy");
  const allySlots = buildDeploySlots("ally", battleState.size);
  const enemySlotsBase = buildDeploySlots("enemy", battleState.size);
  if (!battleState.enemySlotOrder || battleState.enemySlotOrder.length !== enemySlotsBase.length) {
    battleState.enemySlotOrder = [...enemySlotsBase];
  }
  const enemySlots = battleState.enemySlotOrder;
  const kind = battleState.allyFormation;
  const useCustom = kind === "custom";
  const slotsForAllies = useCustom
    ? allySlots
    : sortSlotsByFormation(kind, "ally", allySlots, battleState.size);
  const customMap = useCustom ? customOverride || battleState.customSlots : {};
  assignSlots(allies, slotsForAllies, customMap, useCustom);
  assignSlots(enemies, enemySlots);
}

/**
 * カスタム配置フォームを描画する。
 */
function renderCustomEditor() {
  // 旧UI削除済み。現在はキャンバス上で直接選択・配置するため処理なし。
}

/**
 * 追加で指定したカスタムスロットを適用しつつ味方の位置だけ更新する。
 * 敵の位置は維持する。
 * @param {Record<string, number>} map
 */
function applyCustomDraftToAllies(map) {
  const allies = battleState.units.filter((u) => u.side === "ally");
  const slots = buildDeploySlots("ally", battleState.size);
  assignSlots(allies, slots, map, true);
}

/**
 * フォーメーションUIの表示状態を同期する。
 */
function syncFormationUI() {
  const lock = battleState.running || !!battleState.result;
  if (elements.battleFormationSelect) {
    elements.battleFormationSelect.value = battleState.allyFormation;
    elements.battleFormationSelect.disabled = lock;
    elements.battleFormationSelect.setAttribute("aria-disabled", String(lock));
  }
  if (elements.battleFormationApply) {
    elements.battleFormationApply.disabled = lock;
    elements.battleFormationApply.setAttribute("aria-disabled", String(lock));
  }
  if (elements.battleFormationSave) {
    elements.battleFormationSave.hidden = !battleState.editing;
    elements.battleFormationSave.disabled = lock;
    elements.battleFormationSave.setAttribute("aria-disabled", String(lock));
  }
}

/**
 * ターゲットを選択する。
 * @param {object} unit
 * @param {object[]} enemies
 * @returns {object|null}
 */
function selectTarget(unit, enemies) {
  const alive = enemies.filter((e) => e.hp > 0);
  if (!alive.length) return null;
  const isMelee = (unit.range ?? 1) <= 1;
  const searchRange = isMelee ? MELEE_SEARCH_RANGE : SEARCH_RANGE;
  // 敵側は「最も近い敵」を常に狙う（弱った味方への集中攻撃を緩和）
  if (unit.side === "enemy") {
    return alive.reduce((best, cur) => {
      if (!best) return cur;
      return manhattan(unit, cur) < manhattan(unit, best) ? cur : best;
    }, null);
  }
  const current = alive.find((e) => e.id === unit.targetId);
  const candidates = alive.filter((e) => manhattan(unit, e) <= searchRange);
  const mode = targetMode(unit);
  const modePick = pickTargetByMode(mode, unit, candidates);
  const strongPick = pickTargetByMode("strong", unit, candidates);
  const bestCandidate = modePick || strongPick;
  if (current && manhattan(unit, current) <= searchRange) {
    if (!bestCandidate) return current;
    const currentStrength = calcStrength(current);
    const nextStrength = calcStrength(bestCandidate);
    // HP優先時はHPがより低いなら切替を許容
    if (mode === "hp" && bestCandidate.hp < current.hp * 0.8) return bestCandidate;
    // 後衛狙い時はrange>1の敵が優先対象なら切替
    if (mode === "rear" && bestCandidate.range > 1 && current.range <= 1) return bestCandidate;
    if (nextStrength < currentStrength * TARGET_SWITCH_RATIO) return current;
  }
  if (bestCandidate) return bestCandidate;
  if (current) return current;
  return alive.reduce((best, cur) => {
    if (!best) return cur;
    return manhattan(unit, cur) < manhattan(unit, best) ? cur : best;
  }, null);
}

/**
 * 地形名を返す。
 * @param {string} key
 * @returns {string}
 */
function getTerrainName(key) {
  return TERRAIN_KINDS.find((t) => t.key === key)?.name || key || "-";
}

/**
 * IDからユニットを取得する（存在しない/撃破済みならnull）。
 * @param {string|null} id
 * @param {boolean} allowDead
 * @returns {object|null}
 */
function getUnitById(id, allowDead = false) {
  if (!id) return null;
  const u = battleState.units.find((v) => v.id === id);
  if (!u) return null;
  if (!allowDead && u.hp <= 0) return null;
  return u;
}

/**
 * 対象へ移動する。
 * @param {object} unit
 * @param {object} target
 * @param {Set<string>} occupied
 */
function moveToward(unit, target, occupied, maxStep = unit.move) {
  let { x, y } = unit;
  const steps = Math.max(1, maxStep);
  for (let step = 0; step < steps; step++) {
    const dx = target.x - x;
    const dy = target.y - y;
    if (dx === 0 && dy === 0) break;
    const primary = Math.abs(dx) >= Math.abs(dy);
    const tries = primary
      ? [
          { x: x + Math.sign(dx), y },
          { x, y: y + Math.sign(dy) },
        ]
      : [
          { x, y: y + Math.sign(dy) },
          { x: x + Math.sign(dx), y },
        ];
    let moved = false;
    for (const next of tries) {
      if (next.x < 0 || next.y < 0 || next.x >= battleState.size || next.y >= battleState.size)
        continue;
      const key = `${next.x},${next.y}`;
      if (occupied.has(key)) continue;
      occupied.delete(`${x},${y}`);
      occupied.add(key);
      x = next.x;
      y = next.y;
      moved = true;
      break;
    }
    if (!moved) break;
  }
  unit.x = x;
  unit.y = y;
}

/**
 * 移動軌跡を記録する。
 * @param {object} unit
 * @param {number} fromX
 * @param {number} fromY
 * @param {boolean} retreatMove
 */
function recordMoveTrail(unit, fromX, fromY, retreatMove = false) {
  if (unit.x === fromX && unit.y === fromY) return;
  if (!battleState.moveFx) battleState.moveFx = [];
  battleState.moveFx.push({
    fromX,
    fromY,
    toX: unit.x,
    toY: unit.y,
    side: unit.side,
    retreat: retreatMove,
    ttl: MOVE_FX_TTL,
  });
  if (battleState.moveFx.length > 400) {
    battleState.moveFx = battleState.moveFx.slice(-400);
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
    const rate = (unit.terrain?.[battleState.grid[ny]?.[nx]] ?? 100) / 100;
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
  if ((unit.range ?? 1) <= 1) return false;
  const melee = enemies.filter((e) => e.hp > 0 && (e.range ?? 1) <= 1);
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
 * 攻撃処理を実行する。
 * @param {object} attacker
 * @param {object} target
 */
function applyAttack(attacker, target) {
  const atk = effectiveAtk(attacker);
  const def = effectiveDef(target);
  const dmg = Math.max(1, Math.round((atk * 100) / (100 + def)));
  target.hp = Math.max(0, target.hp - dmg);
  // 攻撃エフェクトのため記録
  battleState.attackFx.push({ from: attacker.id, to: target.id, ttl: ATTACK_FX_TTL });
  battleState.attackFx.push({ from: attacker.id, to: target.id, ttl: ATTACK_FX_TTL, impact: true, crit: dmg > atk * 0.8 });
  if (target.hp <= 0) {
    addBattleLog(`${target.side === "ally" ? "味方" : "敵"}の${target.name}が撃破された。`);
  }
}

/**
 * 戦闘状態を1ティック進める。
 * @returns {boolean}
 */
/**
 * 戦闘状態を1ティック進める。
 * @param {number} dtMs 進行時間(ms)
 * @returns {boolean}
 */
function advanceBattleTick(dtMs = BASE_TICK_MS) {
  battleState.elapsedMs += dtMs;
  battleState.tick += 1;
  const alive = battleState.units.filter((u) => u.hp > 0);
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

  alive.forEach((unit) => {
    if (unit.hp <= 0) return;
    const startX = unit.x;
    const startY = unit.y;
    let movedTrail = false;
    let retreatTrail = false;
    unit.switchLock = Math.max(0, (unit.switchLock || 0) - 1);
    unit.cooldown = Math.max(0, unit.cooldown - 1);
    const enemyList = unit.side === "ally" ? enemies : allies;
    if (!enemyList.length) return;
    // 目標選択（切替クールダウン考慮）
    let target = getUnitById(unit.targetId, true);
    const needsRetarget =
      !target || target.hp <= 0 || manhattan(unit, target) > (unit.range ?? 1) + 5 || unit.switchLock <= 0;
    if (needsRetarget) {
      target = selectTarget(unit, enemyList);
      if (target && target.id !== unit.targetId) {
        unit.switchLock = (unit.range ?? 1) > 1 ? 2 : 3; // 遠隔は短め、近接は長め
      }
    }
    if (!target) return;
    unit.targetId = target.id;
    let dist = manhattan(unit, target);
    const hpRatio = unit.hp / Math.max(1, unit.maxHp);
    const retreatLimit =
      unit.side === "ally"
        ? battleStrategy.kiteMode === "retreat" || battleStrategy.kiteMode === "kite"
          ? (battleStrategy.retreatThreshold || 30) / 100
          : null
        : 0.3;
    if (retreatLimit && hpRatio < retreatLimit) {
      // 有利地形へ退避を試みる
      const moved = retreatToBetterTerrain(unit, occupied);
      if (moved) {
        movedTrail = true;
        retreatTrail = true;
        recordMoveTrail(unit, startX, startY, true);
        return;
      }
    }
    let cappedMove = unit.move;
    const chargeMode = battleStrategy.chargeMode || "cavalry";
    const restrictCharge =
      unit.side === "ally" &&
      unit.move > 1 &&
      (chargeMode === "all" || (chargeMode === "cavalry" && unit.type === "cavalry"));
    if (restrictCharge) {
      const friends = (unit.side === "ally" ? allies : enemies).filter(
        (u) => u.hp > 0 && u.id !== unit.id
      );
      const friendMin = friends.length
        ? Math.min(...friends.map((f) => manhattan(f, target)))
        : Infinity;
      // 目標への距離が味方先頭より2マス以上近い場合は突っ込みを抑制
      if (Number.isFinite(friendMin) && dist <= friendMin - 2) {
        cappedMove = 1;
      }
    }
    const allowKite =
      unit.range > 1 &&
      (unit.side !== "ally" || battleStrategy.kiteMode !== "none");
    if (allowKite) {
      const kited = kiteForRanged(unit, enemyList, target, occupied);
      if (kited) {
        movedTrail = true;
        retreatTrail = true;
        // 位置が変わるので距離を更新
        const distAfter = manhattan(unit, target);
        dist = distAfter;
        if (distAfter <= unit.range) {
          if (unit.cooldown <= 0) {
            applyAttack(unit, target);
            unit.cooldown = unit.spd;
          }
          recordMoveTrail(unit, startX, startY, true);
          return;
        }
      }
    }
    dist = manhattan(unit, target);
    if (dist <= unit.range) {
      if (unit.cooldown > 0) return;
      applyAttack(unit, target);
      unit.cooldown = unit.spd;
      if (movedTrail) recordMoveTrail(unit, startX, startY, retreatTrail);
      return;
    }
    const beforeX = unit.x;
    const beforeY = unit.y;
    moveToward(unit, target, occupied, cappedMove);
    if (unit.x !== beforeX || unit.y !== beforeY) {
      movedTrail = true;
    }
    if (movedTrail) recordMoveTrail(unit, startX, startY, retreatTrail);
  });

  const nextAllies = alive.filter((u) => u.hp > 0 && u.side === "ally");
  const nextEnemies = alive.filter((u) => u.hp > 0 && u.side === "enemy");
  if (!nextAllies.length || !nextEnemies.length) {
    finishBattle();
    return true;
  }
  if (battleState.tick >= MAX_TICKS) {
    finishBattle(true);
    return true;
  }
  return false;
}

/**
 * 戦闘の終了処理を行う。
 * @param {boolean} [forceDraw=false]
 */
function finishBattle(forceDraw = false) {
  pauseBattle();
  const alive = battleState.units.filter((u) => u.hp > 0);
  const allies = alive.filter((u) => u.side === "ally");
  const enemies = alive.filter((u) => u.side === "enemy");
  let result = BATTLE_RESULT.DRAW;
  if (!forceDraw) {
    if (allies.length && !enemies.length) result = BATTLE_RESULT.WIN;
    else if (!allies.length && enemies.length) result = BATTLE_RESULT.LOSE;
  }
  if (result === BATTLE_RESULT.DRAW && (allies.length || enemies.length)) {
    const allyHp = allies.reduce((sum, u) => sum + u.hp, 0);
    const enemyHp = enemies.reduce((sum, u) => sum + u.hp, 0);
    if (allyHp > enemyHp) result = BATTLE_RESULT.WIN;
    else if (enemyHp > allyHp) result = BATTLE_RESULT.LOSE;
  }
  battleState.resultCode = result;
  const resultLabel = BATTLE_RESULT_LABEL[result] || "";
  battleState.result = resultLabel;
  addBattleLog(`戦闘終了: ${resultLabel}`);
  updateBattleStatus();
  updateBattleInfo();
  pushLog("戦闘結果", `結果: ${resultLabel} / 味方${allies.length}・敵${enemies.length}`, "-");
  updateBattleButtons();
  renderRosterUI();
  const handler = battleState.onEnd;
  if (handler) {
    battleState.onEnd = null;
    handler(result, {
      units: battleState.units,
      enemyFormation: battleState.enemyFormation,
      enemyFactionId: battleState.enemyFactionId,
      resultLabel,
    });
  }
}

/**
 * 戦闘ログを追加してUIを更新する。
 * @param {string} text
 */
function addBattleLog(text) {
  battleState.logLines.unshift(text);
  battleState.logLines = battleState.logLines.slice(0, 6);
  if (elements.battleLog) elements.battleLog.textContent = battleState.logLines.join("\n");
}

/**
 * 戦闘表示のステータスを更新する。
 * @param {string} [result]
 */
function updateBattleStatus() {
  const alive = battleState.units.filter((u) => u.hp > 0);
  const allies = alive.filter((u) => u.side === "ally");
  const enemies = alive.filter((u) => u.side === "enemy");
  if (elements.battleTime)
    elements.battleTime.textContent = `${Math.floor((battleState.elapsedMs || 0) / 1000)}s`;
  if (elements.battleCount)
    elements.battleCount.textContent = `${allies.length} vs ${enemies.length}`;
  if (elements.battleStatus) {
    const status = battleState.result
      ? `結果: ${battleState.result}`
      : battleState.running
        ? "戦闘中"
        : "待機中";
    elements.battleStatus.textContent = status;
  }
}

/**
 * 現在フォーカス（選択/ホバー）しているユニットを返す。
 * @returns {object|null}
 */
function focusedUnit() {
  // 編集中はカスタム選択中のユニットを最優先
  if (battleState.editing && battleState.selectedUnitId) {
    const draftSel = getUnitById(battleState.selectedUnitId, true);
    if (draftSel && draftSel.hp > 0) return draftSel;
  }
  const selected = getUnitById(battleState.selectedId, true);
  if (selected && selected.hp > 0) return selected;
  const hovered = getUnitById(battleState.hoveredId);
  if (hovered) return hovered;
  return null;
}

/**
 * 戦闘詳細パネルを更新する。
 */
function updateBattleInfo() {
  const infoEl = elements.battleInfo;
  if (!infoEl) return;
  const fmt = (n) => Math.round(n);
  const unit = focusedUnit();
  if (!unit) {
    infoEl.textContent = "部隊にカーソルを合わせるかクリックすると詳細を表示します。";
    return;
  }
  const terrainKey = battleState.grid[unit.y]?.[unit.x];
  const terrName = getTerrainName(terrainKey);
  const terrRate = unit.terrain?.[terrainKey] ?? 100;
  const effAtk = fmt(effectiveAtk(unit));
  const effDef = fmt(effectiveDef(unit));
  const hpText = `${fmt(unit.hp)}/${fmt(unit.maxHp)}`;
  const side = unit.side === "ally" ? "味方" : "敵";
  const status =
    unit.hp <= 0 ? "撃破" : `HP ${hpText} / ATK ${effAtk} / DEF ${effDef} / SPD ${unit.spd}`;
  const coords = `(${unit.x + 1}, ${unit.y + 1})`;
  infoEl.innerHTML = `
    <div><b>${side}</b> ${unit.name} x${unit.count ?? MAX_UNIT_COUNT} / Lv${(unit.level ?? 1).toFixed(1)}</div>
    <div>${status}</div>
    <div>射程 ${unit.range} / 移動 ${unit.move}</div>
    <div>座標 ${coords}</div>
    <div>地形 ${terrName} (補正 x${Math.round((terrRate / 100) * 100) / 100})</div>
  `;
}

/**
 * 速度表示を更新する。
 */
function updateSpeedUI() {
  if (elements.battleSpeedLabel)
    elements.battleSpeedLabel.textContent = `x${battleState.speed}`;
  document.querySelectorAll(".battle-speed").forEach((btn) => {
    const speed = Number(btn.getAttribute("data-battle-speed") || 1);
    btn.classList.toggle("active", speed === battleState.speed);
  });
}

/**
 * 戦闘ボタンの状態を更新する。
 */
function updateBattleButtons() {
  const hasSortie = battleRoster.sortie.length > 0;
  if (elements.battleStartBtn)
    elements.battleStartBtn.disabled = battleState.running || battleState.editing || !hasSortie;
  if (elements.battlePauseBtn) elements.battlePauseBtn.disabled = !battleState.running;
  if (elements.battleBackBtn)
    elements.battleBackBtn.disabled = !battleState.result;
  syncFormationUI();
}

/**
 * 戦闘UIを描画する。
 */
function renderBattle() {
  const canvas = elements.battleCanvas;
  if (!canvas) return;
  resizeBattleCanvas();
  const ctx = battleState.ctx;
  if (!ctx) return;
  const size = battleState.size;
  const dpr = battleState.dpr || 1;
  const drawSize = (canvas.width || 0) / dpr;
  const cell = drawSize / size;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, drawSize, drawSize);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const terrainKey = battleState.grid[y]?.[x];
      const terrain = TERRAIN_KINDS.find((t) => t.key === terrainKey);
      ctx.fillStyle = terrain?.color || "#0b1020";
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = Math.max(1, Math.floor(cell * 0.06));
  for (let i = 0; i <= size; i++) {
    const pos = i * cell;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, drawSize);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(drawSize, pos);
    ctx.stroke();
  }
  const alive = battleState.units.filter((u) => u.hp > 0);
  if (battleState.editing) {
    ctx.strokeStyle = "rgba(255, 122, 122, 0.9)";
    ctx.lineWidth = 2;
    // 左から2マスと3マスの間の線を赤く
    const lineX = 2 * cell;
    ctx.beginPath();
    ctx.moveTo(lineX, 0);
    ctx.lineTo(lineX, canvas.height);
    ctx.stroke();
  }
  alive.forEach((unit) => {
    const centerX = unit.x * cell + cell / 2;
    const centerY = unit.y * cell + cell / 2;
    const selected =
      (battleState.selectedId === unit.id || battleState.selectedUnitId === unit.id) && unit.hp > 0;
    ctx.fillStyle = unit.side === "ally" ? "#7aa7ff" : "#ff7a7a";
    ctx.beginPath();
    ctx.arc(centerX, centerY, cell * 0.28, 0, Math.PI * 2);
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = "#7aa7ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, cell * 0.34, 0, Math.PI * 2);
      ctx.stroke();
    }

    const img = getUnitImage(unit.type);
    if (img?.complete && img.naturalWidth > 0) {
      const maxW = cell * 0.9;
      const ratio = img.naturalHeight / img.naturalWidth || 1;
      const drawW = maxW;
      const drawH = Math.min(cell * 0.9, drawW * ratio);
      const drawY = centerY - drawH / 2;
      ctx.save();
      if (unit.side === "enemy") {
        ctx.translate(centerX, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, -drawW / 2, drawY, drawW, drawH);
      } else {
        ctx.drawImage(img, centerX - drawW / 2, drawY, drawW, drawH);
      }
      ctx.restore();
    }

    const hpRatio = unit.hp / Math.max(1, unit.maxHp);
    const barW = cell * 0.5;
    const barH = 4;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(centerX - barW / 2, centerY + cell * 0.22, barW, barH);
    ctx.fillStyle = "#7dffb2";
    ctx.fillRect(centerX - barW / 2, centerY + cell * 0.22, barW * hpRatio, barH);
  });

  // 攻撃エフェクト（ライン + スパーク）
  (battleState.attackFx || []).forEach((fx) => {
    const from = getUnitById(fx.from, true);
    const to = getUnitById(fx.to, true);
    if (!from || !to || from.hp <= 0 || to.hp <= 0) return;
    const fromX = from.x * cell + cell / 2;
    const fromY = from.y * cell + cell / 2;
    const toX = to.x * cell + cell / 2;
    const toY = to.y * cell + cell / 2;
    const ally = from.side === "ally";
    const color = ally ? ATTACK_COLORS.ally : ATTACK_COLORS.enemy;
    const alpha = Math.max(0.2, Math.min(1, (fx.ttl || 1) / ATTACK_FX_TTL));
    ctx.save();
    ctx.globalAlpha = alpha;
    // ライン（頭太尻細）
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    // スパーク
    ctx.fillStyle = color;
    const spark = fx.impact ? 5 : 3;
    for (let i = 0; i < spark; i++) {
      const angle = (Math.PI * 2 * i) / spark;
      const len = fx.crit ? cell * 0.22 : cell * 0.16;
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX + Math.cos(angle) * len, toY + Math.sin(angle) * len);
      ctx.stroke();
    }
    ctx.restore();
  });
  // 移動軌跡（細いライン表示）
  (battleState.moveFx || []).forEach((fx) => {
    const fromX = fx.fromX * cell + cell / 2;
    const fromY = fx.fromY * cell + cell / 2;
    const toX = fx.toX * cell + cell / 2;
    const toY = fx.toY * cell + cell / 2;
    const ally = fx.side === "ally";
    const color = fx.retreat
      ? ally
        ? MOVE_COLORS.allyRetreat
        : MOVE_COLORS.enemyRetreat
      : ally
        ? MOVE_COLORS.ally
        : MOVE_COLORS.enemy;
    const alpha = Math.max(0.15, Math.min(1, (fx.ttl || 1) / MOVE_FX_TTL));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.restore();
  });
}

/**
 * 指定セルのユニットを返す（生存のみ）。
 * @param {number} x
 * @param {number} y
 * @returns {object|null}
 */
function findUnitAt(x, y) {
  return (
    battleState.units.find((u) => u.hp > 0 && u.x === x && u.y === y) || null
  );
}

/**
 * 戦闘を開始する。開始時に編成UIをロックし、タイマーを起動する。
 * @returns {void}
 */
function startBattle() {
  if (battleState.running || !battleState.ready) return;
  setBattleSpeed(battleStrategy.speed || 1);
  // 撃破済み選択をクリア
  const sel = getUnitById(battleState.selectedId, true);
  if (sel && sel.hp <= 0) battleState.selectedId = null;
  battleState.result = "";
  battleState.elapsedMs = 0;
  battleState.running = true;
  updateBattleButtons();
  renderRosterUI();
  scheduleBattleTimer();
  addBattleLog("戦闘開始。");
}

/**
 * 戦闘を一時停止し、UIを更新する。
 * @returns {void}
 */
function pauseBattle() {
  battleState.running = false;
  if (battleState.timer) {
    clearInterval(battleState.timer);
    battleState.timer = null;
  }
  updateBattleButtons();
  renderRosterUI();
}

/**
 * 戦闘状態を初期化する。
 * @param {boolean} useDraft
 * @param {boolean} preserveField 既存の地形・敵配置を保持するか
 */
function resetBattle(useDraft = false, preserveField = true) {
  pauseBattle();
  battleState.tick = 0;
  battleState.elapsedMs = 0;
  battleState.resultCode = "";
  battleState.result = "";
  battleState.hoveredId = null;
  battleState.selectedId = null;
  battleState.attackFx = [];
  battleState.moveFx = [];
  battleState.moveFx = [];
  const allyEntries = getSortieEntries();
  const allies = allyEntries.length ? allyEntries : [];
  const enemiesFormation = battleState.enemyFormation && battleState.enemyFormation.length
    ? battleState.enemyFormation
    : DEFAULT_ENEMY_FORMATION;
  const maxUnits = Math.max(allies.length, enemiesFormation.length);
  battleState.size = calcBattleSize(maxUnits);
  if (!preserveField || !battleState.grid || !battleState.grid.length) {
    battleState.grid = buildBattleGrid(battleState.size, battleState.battleTerrain || "plain");
    battleState.enemySlotOrder = null;
  }
  const allySlots = buildDeploySlots("ally", battleState.size);
  const enemySlotsBase = buildDeploySlots("enemy", battleState.size);
  if (!battleState.enemySlotOrder || battleState.enemySlotOrder.length !== enemySlotsBase.length) {
    battleState.enemySlotOrder = [...enemySlotsBase].sort(() => Math.random() - 0.5);
  }
  const enemySlots = battleState.enemySlotOrder;
  battleState.units = [
    ...createUnits(allies, "ally", battleState.size, allySlots),
    ...createUnits(enemiesFormation, "enemy", battleState.size, enemySlots),
  ];
  const override =
    battleState.allyFormation === "custom" && useDraft
      ? battleState.customSlotsDraft
      : battleState.allyFormation === "custom"
        ? battleState.customSlots
        : undefined;
  applyFormations(override);
  battleState.logLines = [];
  battleState.ready = true;
  syncFormationUI();
  updateSpeedUI();
  updateBattleStatus();
  updateBattleButtons();
  addBattleLog("配置を初期化しました。");
  renderBattle();
  updateBattleInfo();
}

/**
 * 兵種画像を取得（未ロードなら読み込みを開始）する。
 * @param {string} type
 * @returns {HTMLImageElement|null}
 */
function getUnitImage(type) {
  if (!type) return null;
  if (unitImages[type]) return unitImages[type];
  const img = new Image();
  img.src = `image/troops/${type}.gif`;
  img.decoding = "async";
  img.onload = () => {
    if (battleState.ready) renderBattle();
  };
  img.onerror = () => {
    // 読み込み失敗時はデフォルト描画のままにする。
  };
  unitImages[type] = img;
  return img;
}

/**
 * 戦闘速度を変更する。
 * @param {number} speed
 */
function setBattleSpeed(speed) {
  if (!SPEED_OPTIONS.includes(speed)) return;
  battleState.speed = speed;
  battleStrategy.speed = speed;
  if (battleState.running) {
    scheduleBattleTimer();
  }
  updateSpeedUI();
}

/**
 * 戦闘タイマーを現在の速度で再設定する。
 */
function scheduleBattleTimer() {
  if (battleState.timer) {
    clearInterval(battleState.timer);
    battleState.timer = null;
  }
  if (!battleState.running) return;
  const interval = Math.max(50, Math.floor(BASE_TICK_MS / Math.max(1, battleState.speed)));
  battleState.timer = setInterval(() => {
    const scaledMs = interval * Math.max(1, battleState.speed);
    const ended = advanceBattleTick(scaledMs);
    renderBattle();
    updateBattleStatus();
    updateBattleInfo();
    if (ended) {
      pauseBattle();
      updateBattleStatus();
      updateBattleInfo();
    }
  }, interval);
}

/**
 * 戦闘画面を開き、編成・作戦UIを初期化する。
 * @returns {void}
 */
function openBattleView() {
  if (elements.mapBlock) elements.mapBlock.hidden = true;
  if (elements.battleBlock) elements.battleBlock.hidden = false;
  if (elements.battleInfoCard) elements.battleInfoCard.hidden = false;
  if (elements.rosterCard) elements.rosterCard.hidden = false;
  if (elements.strategyCard) elements.strategyCard.hidden = false;
  // 現在地の地形を基準にする（遭遇時は事前にセット済み）
  if (!battleState.battleTerrain) {
    battleState.battleTerrain = getTerrainAt(state.position.x, state.position.y) || "plain";
  }
  battleState.running = false;
  battleState.resultCode = "";
  battleState.result = "";
  battleState.editing = false;
  resetRoster();
  renderRosterUI();
  renderStrategyUI();
  resetBattle(false, false);
}

/**
 * 戦闘表示を閉じる。
 */
function closeBattleView() {
  pauseBattle();
  battleState.running = false;
  battleState.resultCode = "";
  battleState.result = "";
  if (elements.battleBlock) elements.battleBlock.hidden = true;
  if (elements.mapBlock) elements.mapBlock.hidden = false;
  if (elements.battleInfoCard) elements.battleInfoCard.hidden = true;
  if (elements.rosterCard) elements.rosterCard.hidden = true;
  if (elements.strategyCard) elements.strategyCard.hidden = true;
  battleState.editing = false;
  battleState.battleTerrain = null;
  syncFormationUI();
  state.modeLabel = MODE_LABEL.NORMAL;
}

/**
 * 戦闘UIのイベントを設定する。
 */
export function wireBattleUI() {
  if (!elements.battleCanvas) return;
  battleState.ctx = elements.battleCanvas.getContext("2d");
  resizeBattleCanvas();
  resetRoster();
  renderRosterUI();
  elements.battleBtn?.addEventListener("click", openBattleView);
  elements.battleBackBtn?.addEventListener("click", closeBattleView);
  elements.battleStartBtn?.addEventListener("click", startBattle);
  elements.battlePauseBtn?.addEventListener("click", pauseBattle);
  document.querySelectorAll(".battle-speed").forEach((btn) => {
    btn.addEventListener("click", () => {
      const speed = Number(btn.getAttribute("data-battle-speed") || 1);
      setBattleSpeed(speed);
    });
  });
  elements.rosterStandby?.addEventListener("input", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    const row = target.closest(".roster-row");
    if (!row) return;
    const max = Number(row.getAttribute("data-count") || 0);
    const type = row.getAttribute("data-type");
    if (!type) return;
    const slider = row.querySelector(".roster-slider");
    const number = row.querySelector(".roster-number");
    const clampVal = (v) => {
      let n = Math.max(0, Math.min(max, Number(v) || 0));
      if (n > 10) n = 10;
      return n;
    };
    const val = clampVal(target.value);
    if (slider) slider.value = String(val);
    if (number) number.value = String(val);
  });
  elements.rosterSortie?.addEventListener("input", () => {
    // 出撃側の数値変更UIは無し
  });
  elements.rosterStandby?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='to-sortie']");
    if (!btn) return;
    const row = btn.closest(".roster-row");
    if (!row) return;
    const type = row.getAttribute("data-type");
    const max = Number(row.getAttribute("data-count") || 0);
    if (!type || max <= 0) return;
    if (battleRoster.sortie.length >= MAX_SQUADS) return;
    const slider = row.querySelector(".roster-slider");
    const number = row.querySelector(".roster-number");
    const val = Math.max(
      0,
      Math.min(
        10,
        Number(number?.value || slider?.value || 0),
        max,
      ),
    );
    if (val <= 0) return;
    const pulled = takeFromStandby(type, val);
    if (pulled.count > 0) {
      battleRoster.sortie.push({ type, count: pulled.count, level: pulled.level });
    }
    renderRosterUI();
  });
  elements.rosterSortie?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='to-standby']");
    if (!btn) return;
    const row = btn.closest(".roster-row");
    if (!row) return;
    const idx = Number(row.getAttribute("data-idx"));
    if (!Number.isFinite(idx) || idx < 0 || idx >= battleRoster.sortie.length) return;
    const entry = battleRoster.sortie[idx];
    battleRoster.sortie.splice(idx, 1);
    pushToStandby(entry.type, entry.count, entry.level || 1);
    renderRosterUI();
  });
  elements.rosterAuto?.addEventListener("click", () => {
    autoDeployRoster();
    renderRosterUI();
  });
  elements.rosterClear?.addEventListener("click", () => {
    clearRoster();
    renderRosterUI();
  });
  elements.rosterApply?.addEventListener("click", () => {
    applyRoster();
    renderRosterUI();
  });
  elements.strategyApply?.addEventListener("click", () => {
    applyStrategyFromUI();
  });
  document.querySelectorAll("input[name='strategySpeed']").forEach((btn) => {
    btn.addEventListener("change", () => {
      const val = Number(btn.value || 1);
      battleStrategy.speed = SPEED_OPTIONS.includes(val) ? val : battleStrategy.speed;
      setBattleSpeed(battleStrategy.speed);
      renderStrategyUI();
    });
  });
  elements.battleCanvas.addEventListener("mousemove", (e) => {
    const canvas = elements.battleCanvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const gx = Math.floor(((e.clientX - rect.left) * scaleX) / (canvas.width / battleState.size));
    const gy = Math.floor(((e.clientY - rect.top) * scaleY) / (canvas.height / battleState.size));
    const unit = findUnitAt(gx, gy);
    battleState.hoveredId = unit?.id || null;
    updateBattleInfo();
    renderBattle();
  });
  elements.battleCanvas.addEventListener("mouseleave", () => {
    battleState.hoveredId = null;
    updateBattleInfo();
    renderBattle();
  });
  elements.battleCanvas.addEventListener("click", (e) => {
    if (battleState.editing) {
      const canvas = elements.battleCanvas;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const gx = Math.floor(((e.clientX - rect.left) * scaleX) / (canvas.width / battleState.size));
      const gy = Math.floor(((e.clientY - rect.top) * scaleY) / (canvas.height / battleState.size));
      const slots = buildDeploySlots("ally", battleState.size);
      const slotIdx = slots.findIndex((s) => s.x === gx && s.y === gy);
      const allies = battleState.units.filter((u) => u.side === "ally");
      const unitAt = allies.find((u) => u.x === gx && u.y === gy);
      // 選択していない状態で味方をクリックすると選択
      if (!battleState.selectedUnitId) {
        if (unitAt) {
          battleState.selectedUnitId = unitAt.id;
          renderCustomEditor();
          renderBattle();
          updateBattleInfo();
        }
        return;
      }
      // 選択中で別ユニットをクリックした場合は位置を入れ替える
      if (unitAt && unitAt.id !== battleState.selectedUnitId) {
        const slotIndexFor = (uid) => {
          if (typeof battleState.customSlotsDraft[uid] === "number") return battleState.customSlotsDraft[uid];
          const u = allies.find((x) => x.id === uid);
          if (!u) return -1;
          return slots.findIndex((s) => s.x === u.x && s.y === u.y);
        };
        const selSlot = slotIndexFor(battleState.selectedUnitId);
        const targetSlot = slotIndexFor(unitAt.id);
        if (selSlot >= 0 && targetSlot >= 0) {
          battleState.customSlotsDraft[battleState.selectedUnitId] = targetSlot;
          battleState.customSlotsDraft[unitAt.id] = selSlot;
          applyCustomDraftToAllies(battleState.customSlotsDraft);
        }
        renderCustomEditor();
        renderBattle();
        updateBattleInfo();
        return;
      }
      // 同じユニットをクリックした場合は選択解除
      if (unitAt && unitAt.id === battleState.selectedUnitId) {
        battleState.selectedUnitId = null;
        renderCustomEditor();
        renderBattle();
        updateBattleInfo();
        return;
      }
      // 配置先が有効か確認
      if (slotIdx < 0) return;
      const taken = Object.entries(battleState.customSlotsDraft).find(
        ([uid, idx]) => uid !== battleState.selectedUnitId && idx === slotIdx
      );
      if (taken) return;
      // スロット割当を更新
      battleState.customSlotsDraft[battleState.selectedUnitId] = slotIdx;
      applyCustomDraftToAllies(battleState.customSlotsDraft);
      battleState.selectedUnitId = null;
      renderCustomEditor();
      renderBattle();
      updateBattleInfo();
      return;
    }
    const canvas = elements.battleCanvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const gx = Math.floor(((e.clientX - rect.left) * scaleX) / (canvas.width / battleState.size));
    const gy = Math.floor(((e.clientY - rect.top) * scaleY) / (canvas.height / battleState.size));
    const unit = findUnitAt(gx, gy);
    const sel = getUnitById(unit?.id);
    battleState.selectedId = sel?.hp > 0 ? sel.id : null;
    updateBattleInfo();
    renderBattle();
  });
  elements.battleFormationApply?.addEventListener("click", () => {
    if (battleState.running || battleState.result) return;
    const val = elements.battleFormationSelect?.value || "balance";
    battleState.allyFormation = val;
    battleState.selectedUnitId = null;
    if (val === "custom") {
      battleState.editing = true;
      battleState.customSlotsDraft = { ...battleState.customSlots };
      resetBattle(true);
    } else {
      battleState.editing = false;
      battleState.customSlotsDraft = {};
      resetBattle();
    }
    syncFormationUI();
    renderBattle();
    updateBattleInfo();
  });
  elements.battleFormationSelect?.addEventListener("change", () => {
    if (battleState.running || battleState.result) return;
    const val = elements.battleFormationSelect?.value || "balance";
    battleState.allyFormation = val;
    battleState.editing = false;
    battleState.customSlotsDraft = {};
    battleState.selectedUnitId = null;
    syncFormationUI();
  });
  elements.battleFormationSave?.addEventListener("click", () => {
    if (battleState.running || battleState.result) return;
    // 保存ボタンは編集中のみ有効
    if (!battleState.editing || battleState.allyFormation !== "custom") return;
    battleState.customSlots = { ...battleState.customSlotsDraft };
    battleState.editing = false;
    battleState.selectedUnitId = null;
    resetBattle();
    renderCustomEditor();
  });
  updateSpeedUI();
  updateBattleButtons();
  updateBattleStatus();
  renderBattle();
  updateBattleInfo();
  syncFormationUI();
  renderCustomEditor();
  renderStrategyUI();
}

/**
 * 敵勢力IDを設定する。
 * @param {string|null} factionId
 */
export function setBattleEnemyFaction(factionId) {
  battleState.enemyFactionId = factionId || null;
}

/**
 * 敵編成をセットする。
 * @param {Array} entries 部隊スロットの配列
 */
export function setEnemyFormation(entries) {
  battleState.enemyFormation = Array.isArray(entries) ? [...entries] : null;
  battleState.enemySlotOrder = null;
}

/**
 * 戦闘終了時に呼ぶコールバックを設定する。
 * @param {Function|null} handler 終了ハンドラ
 */
export function setBattleEndHandler(handler) {
  battleState.onEnd = typeof handler === "function" ? handler : null;
}

/**
 * 戦闘画面を開く。
 */
export function openBattle() {
  openBattleView();
}

/**
 * 戦闘用の地形キーを設定する。
 * @param {string} key 地形ID（例: plain/forest など）
 */
export function setBattleTerrain(key) {
  battleState.battleTerrain = key || "plain";
}
