import { REINFORCEMENT_RULES } from "./battleReinforcements.js";
import { restoreGrandRoster } from "./grandBattle.js";
import { selectBattleSize, deploymentDepth, battleCellAt, BATTLE_SIZE_RULES } from "./battleGeometry.js";
import { takeBattlePersonnel, returnBattlePersonnel } from "./battlePersonnel.js";
import { stepBattle, battleResult, createBattleRandom, BATTLE_RULES, battleAttackRate, COMBAT_TRAIT_RULES } from "./battleCore.js";
import { isBattleActive, isBattleOnBoard, MORALE_RULES } from "./battleMorale.js";
import { troopImage } from "./pirateConfig.js";
import { faithEffects } from "./faith.js";
import { BATTLE_RESULT_LABEL, MODE_LABEL } from "./constants.js";
import { elements, pushLog, pushToast } from "./dom.js";
import { getTerrainAt } from "./map.js";
import { state } from "./state.js";
import { updateBattleLayout } from "./layout.js";
import { drawMapTile } from "./mapArt.js";
import { rosterOptions, canAutoDeploy, splitRosterCounts } from "./rosterOptions.js";
import { saveGameToStorage } from "./storage.js";
import { TROOP_STATS } from "./troops.js";
import { clamp } from "./util.js";
import { snapshotOutfitting, outfittedStat, fireOutfitting, defendedDamage } from "./outfitting.js";
import { OUTFITTING_ITEMS } from "./expansionConfig.js";
import { planBattleFormation } from "./battleFormation.js";
import { orderRosterCandidates } from "./rosterPriority.js";

const BASE_TICK_MS = BATTLE_RULES.tickMs;
const MOVE_FX_TTL = BATTLE_RULES.moveFxTtl;
const DEFAULT_BATTLE_SIZE = 10;
const SPEED_OPTIONS = [1, 2, 4];
const MAX_UNIT_COUNT = 10;
const MAX_SQUADS = 20;
const BATTLE_HP_MULTIPLIER = 3;
let appliedRosterSignature = "";
const ATTACK_FX_TTL = BATTLE_RULES.attackFxTtl;
const SUPPORT_FX = {
  harpoon: { color: "#70e8ff", width: 3.5, glow: 6, rays: 5, radius: 0.18 },
  ballista: { color: "#c49aff", width: 5.5, glow: 10, rays: 7, radius: 0.25 },
  fire_ballista: { color: "#ff5d45", width: 6.5, glow: 14, rays: 9, radius: 0.29 },
  grape_ballista: { color: "#a9c5ff", width: 2, glow: 4, rays: 5, radius: 0.14 },
  fire_grape_ballista: { color: "#ff7050", width: 2.5, glow: 6, rays: 6, radius: 0.17 },
  cannon: { color: "#ff9955", width: 8, glow: 16, rays: 10, radius: 0.34 },
};
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
 * CSSで決めた表示幅に描画解像度を合わせ、縦横比を維持する。
 * @returns {void}
 */
function resizeBattleCanvas() {
  const canvas = elements.battleCanvas;
  if (!canvas) return;
  const size = battleState.size || DEFAULT_BATTLE_SIZE;
  const dpr = window.devicePixelRatio || 1;
  const drawSize = canvas.clientWidth || 640;
  const cellDisplay = drawSize / size;
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
  reserve: [],
};

/** @returns {Array} 現在編集する編成。 */
function selectedRoster() {
  return battleState.battleKind === "grand" && document.getElementById("rosterGroup")?.value === "reserve" ? battleRoster.reserve : battleRoster.sortie;
}

/** @returns {number} 現在編集する編成の上限。 */
function selectedRosterLimit() { return selectedRoster() === battleRoster.reserve ? REINFORCEMENT_RULES.reserveLimit : MAX_SQUADS; }

/** 大会戦の反映済み編成と盤面だけを保存する。戦闘途中の保存はしない。 */
function saveGrandPreparation() {
  if (battleState.battleKind !== "grand" || battleState.started || !state.pendingEncounter?.active) return;
  if (appliedRosterSignature !== JSON.stringify([battleRoster.sortie, battleRoster.reserve])) return;
  state.pendingEncounter.preparation = JSON.parse(JSON.stringify({
    version: 2, size: battleState.size, seed: battleState.randomSeed, grid: battleState.grid,
    roster: { sortie: battleRoster.sortie, reserve: battleRoster.reserve },
    formation: battleState.allyFormation, strategy: battleStrategy,
    customCoordinates: Object.fromEntries(Object.entries(battleState.customSlots).map(([id, index]) => [id, buildDeploySlots("ally", battleState.size)[index]])),
  }));
  saveGameToStorage({ battlePreparation: true });
}

const battleStrategy = {
  targetMode: "type", // "type" = 兵種準拠
  kiteMode: "kite", // "kite" | "retreat" | "none"
  retreatThreshold: 30, // 退却判定に使う残HP割合
  chargeMode: "cavalry", // "cavalry" | "all" | "none"
  speed: 1,
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
 * @param {number} squads 同時展開予定の多い側の部隊数。
 * @returns {number}
 */
function calcBattleSize(squads) {
  return selectBattleSize(squads);
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
    let roll = battleState.fieldRandom() * total;
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
        if (x < deploymentDepth(size) || x >= size - deploymentDepth(size)) {
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
  battleRoster.reserve = [];
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
  return takeBattlePersonnel(battleRoster.standby, type, amount);
}

/**
 * スタンバイに人数を戻す（レベル付）。
 * @param {string} type
 * @param {object} sources 出撃元のレベル別人数。
 */
function pushToStandby(type, sources) {
  returnBattlePersonnel(battleRoster.standby, type, sources);
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
 * 保存された条件で自動配備を行う。兵種ごとに人数を分配してから、
 * 人数・兵種性能・平均Lvによる重みが大きい順に最大20部隊を選ぶ。
 * 同じ重みは指定の兵種順で交互に選び、同兵種内では高Lvの兵から取り出す。
 * 対象外の兵種・端数・上限超過の兵は待機に残す。
 */
function autoDeployRoster() {
  resetRoster();
  const totals = standbyTotals();
  const chunks = Object.entries(totals)
    .filter(([type, cnt]) => cnt > 0 && canAutoDeploy(type, rosterOptions))
    .flatMap(([type, cnt]) => {
      const avgLv = standbyAverageLevel(type);
      const base = autoWeight(type) * (1 + 0.1 * (avgLv - 1));
      return splitRosterCounts(cnt, rosterOptions.sizeMode).map((chunk) => {
        return { type, size: chunk, weight: base * chunk, avgLv };
      });
    });

  battleRoster.sortie = [];
  battleRoster.reserve = [];
  for (const chunk of orderRosterCandidates(chunks)) {
    if (battleRoster.sortie.length + battleRoster.reserve.length >= MAX_SQUADS + (battleState.battleKind === "grand" ? REINFORCEMENT_RULES.reserveLimit : 0)) break;
    const pulled = takeFromStandby(chunk.type, chunk.size);
    if (pulled.count <= 0) continue;
    (battleRoster.sortie.length < MAX_SQUADS ? battleRoster.sortie : battleRoster.reserve).push({ type: chunk.type, count: pulled.count, level: pulled.level, sources: pulled.sources });
  }
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
  const disableAll = battleState.started || !!battleState.result;
  document.getElementById("rosterOptions").disabled = disableAll;
  const group = document.getElementById("rosterGroup");
  if (group) { group.hidden = battleState.battleKind !== "grand"; group.disabled = disableAll; }
  const list = selectedRoster();
  const limit = selectedRosterLimit();
  const sortieCount = list.length;
  if (countEl) countEl.textContent = `${sortieCount}/${limit}`;
  const sortieFull = sortieCount >= limit;
  if (elements.rosterApply) elements.rosterApply.disabled = battleRoster.sortie.length === 0 || disableAll;

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
    const rows = list
      .map((s, idx) => {
        const stat = TROOP_STATS[s.type];
        const name = stat?.name || s.type;
        return `
          <div class="roster-row" data-idx="${idx}" data-type="${s.type}" data-count="${s.count}">
            <div class="roster-line">
              <div><b>${name}</b></div>
              <div class="tiny">${list === battleRoster.reserve ? `予備 ${idx + 1}番` : "前衛"} ${s.count}人</div>
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
  updateBattleButtons();
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
  saveGrandPreparation();
}

/**
 * 20部隊を収容できる自軍側2〜3列の配置可能座標を作成する。
 * @param {"ally"|"enemy"} side
 * @param {number} size
 * @returns {{x:number,y:number}[]}
 */
function buildDeploySlots(side, size) {
  const frontCols = Array.from({ length: deploymentDepth(size) }, (_, index) => side === "ally" ? index : size - 1 - index);
  const slots = [];
  frontCols.forEach((x) => {
    for (let y = 0; y < size; y++) slots.push({ x, y });
  });
  return slots;
}

/**
 * 兵種情報から戦闘ユニットを生成する。味方は人数・レベル補正後に艤装倍率を一度だけ適用する。
 * @param {string} type
 * @param {"ally"|"enemy"} side
 * @param {number} index
 * @param {{x:number,y:number}} pos
 * @param {number} count
 * @param {number} [level] レベル。
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
  const hpVal = Math.max(1, Math.floor(baseHp * ratio * lvlMult)) * BATTLE_HP_MULTIPLIER;
  const atkVal = Math.max(1, Math.floor(baseAtk * ratio * lvlMult));
  const defVal = Math.max(1, Math.floor(baseDef * lvlMult));
  return {
    id: `${side}-${index + 1}`,
    side,
    type,
    role: stat?.role || "melee",
    traits: [...(stat?.traits || [])],
    name: stat?.name || type,
    count: unitCount,
    maxCount: MAX_UNIT_COUNT,
    level: lvlRounded,
    morale: MORALE_RULES.initial,
    hp: hpVal,
    maxHp: hpVal,
    atk: side === "ally" ? outfittedStat(atkVal, stat?.role || "melee", "atk", battleState.outfitting.effects) : atkVal,
    def: side === "ally" ? outfittedStat(defVal, stat?.role || "melee", "def", battleState.outfitting.effects) : defVal,
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
 * 側ごとのユニット配列を最大20部隊・配置枠数まで生成する。
 * 敵候補が上限を超える場合、全配置マスで平均した既存の戦力判定値
 * （地形補正後の攻撃力÷攻撃間隔×HP×防御補正）が高い順に選抜する。
 * 人数・レベルも生成時の能力値に反映する。同点は元の順を優先し、選抜後も元の配置順を保つ。
 * @param {Array} entries
 * @param {"ally"|"enemy"} side
 * @param {number} size
 * @param {{x:number,y:number}[]} slots
 * @returns {object[]}
 */
function createUnits(entries, side, size, slots) {
  const positions = slots && slots.length ? slots : buildDeploySlots(side, size);
  const limit = Math.min(MAX_SQUADS, positions.length);
  let selected = entries;
  if (side === "enemy" && entries.length > limit) {
    const ranked = entries.map((entry, index) => {
      const type = typeof entry === "string" ? entry : entry?.type;
      const count = typeof entry === "string" ? MAX_UNIT_COUNT : entry?.count;
      const level = typeof entry === "string" ? 1 : entry?.level ?? 1;
      const strength = positions.reduce((total, pos) =>
        total + calcStrength(createUnit(type, side, index, pos, count, level)), 0) / positions.length;
      return { entry, index, strength };
    });
    selected = ranked.sort((a, b) => b.strength - a.strength || a.index - b.index)
      .slice(0, limit).sort((a, b) => a.index - b.index).map(candidate => candidate.entry);
  }
  return selected.slice(0, limit).map((entry, i) => {
    const type = typeof entry === "string" ? entry : entry?.type;
    const count = typeof entry === "string" ? MAX_UNIT_COUNT : entry?.count;
    const level = typeof entry === "string" ? 1 : entry?.level ?? 1;
    const pos = positions[i];
    const unit = createUnit(type, side, i, pos, count, level);
    unit.sources = side === "ally" ? { ...entry.sources } : { [Math.round(unit.level)]: unit.count };
    unit.status = "active";
    unit.deployedAt = 0;
    return unit;
  });
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
 * 配置を適用する（味方は指定フォーメーション、敵はバランスの左右反転）。
 * @param {Record<string, number>} [customOverride]
 */
function applyFormations(customOverride) {
  const allies = battleState.units.filter((u) => u.side === "ally" && u.status !== "reserve");
  const enemies = battleState.units.filter((u) => u.side === "enemy" && u.status !== "reserve");
  const allySlots = buildDeploySlots("ally", battleState.size);
  const enemySlotsBase = buildDeploySlots("enemy", battleState.size);
  if (!battleState.enemySlotOrder || battleState.enemySlotOrder.length !== enemySlotsBase.length) {
    battleState.enemySlotOrder = [...enemySlotsBase];
  }
  const kind = battleState.allyFormation;
  const useCustom = kind === "custom";
  if (useCustom) {
    assignSlots(allies, allySlots, customOverride || battleState.customSlots, true);
  } else {
    planBattleFormation(allies, kind, battleState.size).forEach(({ unit, x, y }) => {
      unit.x = x;
      unit.y = y;
    });
  }
  planBattleFormation(enemies, "balance", battleState.size).forEach(({ unit, x, y }) => {
    unit.x = battleState.size - 1 - x;
    unit.y = y;
  });
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
  const allies = battleState.units.filter((u) => u.side === "ally" && u.status !== "reserve");
  const slots = buildDeploySlots("ally", battleState.size);
  assignSlots(allies, slots, map, true);
}

/**
 * フォーメーションUIの表示状態を同期する。
 */
function syncFormationUI() {
  const lock = battleState.started || !!battleState.result;
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
  if (!allowDead && !isBattleOnBoard(u)) return null;
  return u;
}

/**
 * 戦闘計算の通知を画面と戦後処理へ接続する。
 * @param {number} dtMs 進行時間。
 * @returns {boolean} 決着したか。
 */
function advanceBattleTick(dtMs = BASE_TICK_MS) {
  const result = stepBattle(battleState, battleStrategy, {
    defendedDamage, fireOutfitting,
    equipmentNames: Object.fromEntries(Object.entries(OUTFITTING_ITEMS).map(([id, item]) => [id, item.name])),
    random: battleState.random || Math.random,
  }, dtMs);
  (battleState.observations ||= []).push(result.observation);
  result.logs.forEach(addBattleLog);
  if (result.ended) finishBattle(result.forceDraw);
  return result.ended;
}

/**
 * 戦闘の終了処理を行う。
 * @param {boolean} [forceDraw=false]
 */
function finishBattle(forceDraw = false) {
  pauseBattle();
  const alive = battleState.units.filter(isBattleOnBoard);
  const allies = alive.filter((u) => isBattleActive(u) && u.side === "ally");
  const enemies = alive.filter((u) => isBattleActive(u) && u.side === "enemy");
  const result = battleResult(battleState.units, forceDraw, battleState);
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
      resultReason: battleState.resultReason,
      supportMedics: battleState.outfitting.medics,
      faithRescue: battleState.faithRescue || 0,
    });
  }
  saveGameToStorage({ battleComplete: true });
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
 * 準備中から速度欄の経過時間と残存兵数・部隊数を更新する。
 * 兵数は撃破されていない部隊の編成人数の合計とし、HP割合から人数を推定しない。
 * 準備中は盤面に反映済みの編成を表示する。
 * @returns {void}
 */
function updateBattleStatus() {
  const alive = battleState.units.filter(isBattleOnBoard);
  const allies = alive.filter((u) => isBattleActive(u) && u.side === "ally");
  const enemies = alive.filter((u) => isBattleActive(u) && u.side === "enemy");
  if (elements.battleTime)
    elements.battleTime.textContent = `${Math.floor((battleState.elapsedMs || 0) / 1000)}s`;
  if (elements.battleCount) {
    const allyCount = allies.reduce((sum, unit) => sum + unit.count, 0);
    const enemyCount = enemies.reduce((sum, unit) => sum + unit.count, 0);
    const routing = side => alive.filter(unit => unit.side === side && unit.status === "routing").length;
    elements.battleCount.textContent = `味方 ${allyCount}人（${allies.length}部隊・敗走${routing("ally")}） / 敵 ${enemyCount}人（${enemies.length}部隊・敗走${routing("enemy")}）`;
    if (battleState.battleKind === "grand") {
      const reserveText = side => {
        const units = battleState.units.filter(unit => unit.side === side && unit.status === "reserve");
        return `${units.reduce((sum, unit) => sum + unit.count, 0)}人・${units.length}部隊`;
      };
      elements.battleCount.textContent += ` / 予備: 味方${reserveText("ally")}・敵${reserveText("enemy")}`;
    }
  }
  if (elements.battleStatus) {
    const status = battleState.result
      ? `結果: ${battleState.result}`
      : battleState.running
        ? "戦闘中"
        : battleState.started ? "一時停止中" : "準備中";
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
 * 戦闘詳細パネルを更新する。地形倍率は攻撃・防御計算と共通の処理で取得する。
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
  const terrRate = terrainRate(unit);
  const effAtk = fmt(effectiveAtk(unit) * battleAttackRate(unit, battleState.units));
  const traits = [];
  if (unit.traits?.includes("steadfast")) traits.push(`堅固（士気低下−${Math.round((1 - MORALE_RULES.steadfast) * 100)}%）`);
  if (unit.traits?.includes("antiCavalry")) traits.push(`対騎兵（騎乗への通常ダメージ＋${Math.round((COMBAT_TRAIT_RULES.antiCavalry - 1) * 100)}%）`);
  if (unit.traits?.includes("mounted")) traits.push("騎乗");
  if (unit.role === "ranged") traits.push(`敵近接隣接時ATK−${Math.round((1 - COMBAT_TRAIT_RULES.rangedEngaged) * 100)}%`);
  const effDef = fmt(effectiveDef(unit));
  const hpText = `${fmt(unit.hp)}/${fmt(unit.maxHp)}`;
  const side = unit.side === "ally" ? "味方" : "敵";
  const status =
    unit.hp <= 0 ? "撃破" : `HP ${hpText} / ATK ${effAtk} / DEF ${effDef} / SPD ${unit.spd}`;
  const coords = `(${unit.x + 1}, ${unit.y + 1})`;
  infoEl.innerHTML = `
    <div><b>${side}</b> ${unit.name} x${unit.count ?? MAX_UNIT_COUNT} / Lv${(unit.level ?? 1).toFixed(1)}</div>
    <div>${status}</div>
    <div>士気 ${Math.round(unit.morale ?? 100)} / ${unit.status === "routing" ? "敗走中" : unit.status === "escaped" ? "退出済み" : unit.shaken ? "動揺" : "平静"}・圧力 ${(unit.pressure || 0).toFixed(1)}</div>
    <div>射程 ${unit.range} / 移動 ${unit.move}</div>
    ${traits.length ? `<div>特性 ${traits.join("・")}</div>` : ""}
    <div>座標 ${coords}</div>
    <div>地形 ${terrName} (補正 x${Math.round(terrRate * 100) / 100})</div>
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
    btn.setAttribute("aria-pressed", String(speed === battleState.speed));
  });
}

/**
 * 戦闘ボタンの状態を更新する。
 */
function updateBattleButtons() {
  const hasSortie = battleRoster.sortie.length > 0;
  const applied = appliedRosterSignature === JSON.stringify([battleRoster.sortie, battleRoster.reserve]);
  if (elements.battleStartBtn)
    elements.battleStartBtn.disabled = battleState.running || !!battleState.result || battleState.editing || !hasSortie || !applied;
  if (elements.battlePauseBtn) elements.battlePauseBtn.disabled = !battleState.running;
  if (elements.battleBackBtn)
    elements.battleBackBtn.disabled = !battleState.result;
  updateBattleLayout({
    active: !elements.battleBlock?.hidden,
    count: battleRoster.sortie.length,
    applied,
    editing: battleState.editing,
    running: battleState.running,
    started: battleState.started,
    result: battleState.result,
  });
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
      drawMapTile(ctx, { terrain: terrainKey, building: "none" }, x * cell, y * cell, cell, true, null, (x + y) % 2);
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
  const alive = battleState.units.filter(isBattleOnBoard);
  if (battleState.editing) {
    ctx.strokeStyle = "rgba(255, 122, 122, 0.9)";
    ctx.lineWidth = 2;
    // 初期配置領域の境界を赤く示す。
    const lineX = deploymentDepth(battleState.size) * cell;
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
    if (unit.status === "routing" || unit.shaken) {
      ctx.fillStyle = unit.status === "routing" ? "#ffb47a" : "#ffe08a";
      ctx.font = `bold ${Math.max(10, Math.round(cell * 0.24))}px sans-serif`;
      ctx.fillText(unit.status === "routing" ? "逃" : "!", centerX + cell * 0.2, centerY - cell * 0.2);
    }
  });

  // 攻撃エフェクト（ライン + スパーク）
  (battleState.attackFx || []).forEach((fx) => {
    const from = fx.support ? { x: -0.4, y: battleState.size - 1, side: "ally", hp: 1 } : getUnitById(fx.from, true);
    const to = getUnitById(fx.to, true);
    if (!from || !to || from.hp <= 0 || (!fx.support && to.hp <= 0)) return;
    const fromX = from.x * cell + cell / 2;
    const fromY = from.y * cell + cell / 2;
    const toX = to.x * cell + cell / 2;
    const toY = to.y * cell + cell / 2;
    const ally = from.side === "ally";
    const supportFx = fx.support ? SUPPORT_FX[fx.equipmentId] || SUPPORT_FX.harpoon : null;
    const color = supportFx ? supportFx.color : ally ? ATTACK_COLORS.ally : ATTACK_COLORS.enemy;
    const alpha = Math.max(0.2, Math.min(1, (fx.ttl || 1) / ATTACK_FX_TTL));
    ctx.save();
    ctx.globalAlpha = alpha;
    // ライン（頭太尻細）
    ctx.strokeStyle = color;
    ctx.lineWidth = supportFx?.width || 2.4;
    if (supportFx) { ctx.shadowColor = color; ctx.shadowBlur = supportFx.glow; }
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    // スパーク
    ctx.fillStyle = color;
    const spark = supportFx?.rays || (fx.impact ? 5 : 3);
    for (let i = 0; i < spark; i++) {
      const angle = (Math.PI * 2 * i) / spark;
      const len = supportFx ? cell * supportFx.radius : fx.crit ? cell * 0.22 : cell * 0.16;
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
    battleState.units.find((u) => isBattleOnBoard(u) && u.x === x && u.y === y) || null
  );
}

/**
 * 戦闘を開始する。開始時に編成UIをロックし、タイマーを起動する。
 * @returns {void}
 */
function startBattle() {
  if (battleState.running || !battleState.ready || elements.battleStartBtn?.disabled) return;
  if (!battleState.started) {
    battleState.outfitting = snapshotOutfitting(state);
    battleState.faithRescue = faithEffects(state).rescue;
  }
  setBattleSpeed(battleStrategy.speed || 1);
  // 撃破済み選択をクリア
  const sel = getUnitById(battleState.selectedId, true);
  if (sel && sel.hp <= 0) battleState.selectedId = null;
  battleState.result = "";
  if (!battleState.started) battleState.elapsedMs = 0;
  battleState.started = true;
  battleState.running = true;
  updateBattleButtons();
  updateBattleStatus();
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
  updateBattleStatus();
  renderRosterUI();
}

/**
 * 戦闘状態を初期化する。
 * @param {boolean} useDraft
 * @param {boolean} preserveField 既存の地形・敵配置を保持するか
 */
function resetBattle(useDraft = false, preserveField = true) {
  pauseBattle();
  if (!preserveField || battleState.randomSeed == null) {
    battleState.randomSeed = Math.floor(Math.random() * 4294967296);
  }
  battleState.random = createBattleRandom(battleState.randomSeed);
  battleState.fieldRandom = createBattleRandom(battleState.randomSeed ^ 0x9e3779b9);
  battleState.outfitting = snapshotOutfitting(state);
  const equipmentLabel = document.getElementById("battleOutfitting");
  if (equipmentLabel) equipmentLabel.textContent = `艤装: ${battleState.outfitting.equipped.map(id => OUTFITTING_ITEMS[id].name).join(" / ") || "なし"}`;
  battleState.observations = [];
  battleState.tick = 0;
  battleState.moraleShocks = [];
  battleState.entryBlockedTicks = { ally: 0, enemy: 0 };
  battleState.resultReason = null;
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
  if (!preserveField || !battleState.grid?.length) battleState.size = calcBattleSize(maxUnits);
  if (!preserveField || !battleState.grid || !battleState.grid.length) {
    battleState.grid = buildBattleGrid(battleState.size, battleState.battleTerrain || "plain");
    battleState.enemySlotOrder = null;
  }
  const allySlots = buildDeploySlots("ally", battleState.size);
  const enemySlotsBase = buildDeploySlots("enemy", battleState.size);
  if (!battleState.enemySlotOrder || battleState.enemySlotOrder.length !== enemySlotsBase.length) {
    battleState.enemySlotOrder = [...enemySlotsBase].sort(() => battleState.fieldRandom() - 0.5);
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
  if (battleState.battleKind === "grand") {
    for (const [side, entries] of [["ally", battleRoster.reserve], ["enemy", state.pendingEncounter?.enemyReserve || []]]) {
      entries.slice(0, REINFORCEMENT_RULES.reserveLimit).forEach((entry, index) => {
        const unit = createUnit(entry.type, side, index, { x: -1, y: -1 }, entry.count, entry.level);
        unit.id = `${side}-reserve-${index}`; unit.status = "reserve"; unit.deployedAt = null;
        unit.sources = side === "ally" ? { ...entry.sources } : { [Math.round(unit.level)]: unit.count };
        battleState.units.push(unit);
      });
    }
  }
  battleState.logLines = [];
  battleState.ready = true;
  appliedRosterSignature = JSON.stringify([battleRoster.sortie, battleRoster.reserve]);
  syncFormationUI();
  updateSpeedUI();
  updateBattleStatus();
  updateBattleButtons();
  addBattleLog("配置を初期化しました。");
  renderBattle();
  updateBattleInfo();
  saveGrandPreparation();
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
  img.src = troopImage(type);
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
  battleState.started = false;
  battleState.battleKind = state.pendingEncounter?.battleKind === "grand" ? "grand" : "normal";
  const saved = battleState.battleKind === "grand" ? state.pendingEncounter?.preparation : null;
  if (saved?.strategy) Object.assign(battleStrategy, saved.strategy);
  const group = document.getElementById("rosterGroup");
  if (group) group.value = "sortie";
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
  const restored = saved ? restoreGrandRoster(battleRoster.standby, saved.roster) : null;
  if (restored) Object.assign(battleRoster, restored);
  else autoDeployRoster();
  const validField = saved && Number.isInteger(saved.seed) && Array.isArray(saved.grid)
    && BATTLE_SIZE_RULES.some(rule => rule.size === saved.grid.length)
    && saved.grid.every(row => Array.isArray(row) && row.length === saved.grid.length);
  if (validField) {
    battleState.size = saved.grid.length;
    battleState.randomSeed = saved.seed; battleState.grid = saved.grid;
    battleState.allyFormation = saved.formation || "balance";
    const slots = buildDeploySlots("ally", battleState.size);
    battleState.customSlots = saved.customCoordinates
      ? Object.fromEntries(Object.entries(saved.customCoordinates).map(([id, point]) => [id, slots.findIndex(slot => slot.x === point?.x && slot.y === point?.y)]).filter(([, index]) => index >= 0))
      : saved.customSlots || {};
  }
  renderRosterUI();
  renderStrategyUI();
  if (!validField) { battleState.customSlots = {}; battleState.customSlotsDraft = {}; }
  resetBattle(false, Boolean(validField && restored));
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
  updateBattleButtons();
  saveGameToStorage();
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
  document.getElementById("rosterGroup")?.addEventListener("change", renderRosterUI);
  document.getElementById("battleZoomBtn")?.addEventListener("click", () => {
    const viewport = document.getElementById("battleViewport");
    const zoomed = viewport.classList.toggle("is-zoomed");
    const button = document.getElementById("battleZoomBtn");
    button.textContent = zoomed ? "全体表示" : "拡大表示";
    button.setAttribute("aria-pressed", String(zoomed));
    renderBattle();
  });
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
    if (selectedRoster().length >= selectedRosterLimit()) return;
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
      selectedRoster().push({ type, count: pulled.count, level: pulled.level, sources: pulled.sources });
    }
    renderRosterUI();
  });
  elements.rosterSortie?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='to-standby']");
    if (!btn) return;
    const row = btn.closest(".roster-row");
    if (!row) return;
    const idx = Number(row.getAttribute("data-idx"));
    if (!Number.isFinite(idx) || idx < 0 || idx >= selectedRoster().length) return;
    const entry = selectedRoster()[idx];
    selectedRoster().splice(idx, 1);
    pushToStandby(entry.type, entry.sources);
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
    const { x: gx, y: gy } = battleCellAt(e.clientX, e.clientY, rect, battleState.size);
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
      const { x: gx, y: gy } = battleCellAt(e.clientX, e.clientY, rect, battleState.size);
      const slots = buildDeploySlots("ally", battleState.size);
      const slotIdx = slots.findIndex((s) => s.x === gx && s.y === gy);
      const allies = battleState.units.filter((u) => u.side === "ally" && u.status !== "reserve");
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
    const { x: gx, y: gy } = battleCellAt(e.clientX, e.clientY, rect, battleState.size);
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
    elements.battleFormationApply?.click();
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
