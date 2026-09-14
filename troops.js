import { confirmAction, pushLog, pushToast } from "./dom.js";
import { state } from "./state.js";
import { renderUpkeepForecast } from "./upkeep.js";
import { getOutfittingEffects, applyCapacityBonus } from "./outfitting.js";
import { fleetEffects } from "./fleet.js";

/** @type {number} 基本の部隊上限 */
export const BASE_TROOP_CAP = 30;

/** @type {object} 兵種の定義 */
export const TROOP_STATS = {
  infantry: {
    name: "歩兵",
    hire: 100,
    upkeep: 2,
    basePower: 100,
    hp: 110,
    atk: 26,
    def: 18,
    spd: 2,
    range: 1,
    move: 1,
    terrain: { plain: 110, forest: 120, mountain: 120, shoal: 100, sea: 100 },
    level: 1,
  },
  halberd: {
    name: "鉾槍兵",
    hire: 170,
    upkeep: 3,
    basePower: 130,
    hp: 110,
    atk: 36,
    def: 18,
    spd: 3,
    range: 2,
    move: 1,
    terrain: { plain: 110, forest: 120, mountain: 120, shoal: 100, sea: 100 },
    level: 1,
  },
  medic: {
    name: "衛生兵",
    hire: 200,
    upkeep: 4,
    basePower: 50,
    hp: 90,
    atk: 14,
    def: 10,
    spd: 3,
    range: 1,
    move: 1,
    terrain: { plain: 100, forest: 100, mountain: 100, shoal: 100, sea: 100 },
    level: 1,
  },
  marine: {
    name: "海兵",
    hire: 150,
    upkeep: 3,
    basePower: 120,
    hp: 120,
    atk: 30,
    def: 18,
    spd: 2,
    range: 1,
    move: 1,
    terrain: { plain: 120, forest: 100, mountain: 100, shoal: 120, sea: 130 },
    level: 1,
  },
  archer: {
    name: "弓兵",
    hire: 150,
    upkeep: 3,
    basePower: 120,
    hp: 80,
    atk: 30,
    def: 8,
    spd: 3,
    range: 4,
    move: 1,
    terrain: { plain: 100, forest: 120, mountain: 130, shoal: 100, sea: 100 },
    level: 1,
  },
  scout: {
    name: "斥候",
    hire: 100,
    upkeep: 2,
    basePower: 50,
    hp: 70,
    atk: 18,
    def: 6,
    spd: 2,
    range: 2,
    move: 2,
    terrain: { plain: 100, forest: 100, mountain: 100, shoal: 100, sea: 100 },
    level: 1,
  },
  cavalry: {
    name: "騎兵",
    hire: 200,
    upkeep: 4,
    basePower: 150,
    hp: 130,
    atk: 32,
    def: 20,
    spd: 2,
    range: 1,
    move: 2,
    terrain: { plain: 150, forest: 100, mountain: 120, shoal: 80, sea: 80 },
    level: 1,
  },
  cavalier: {
    name: "重騎兵",
    hire: 250,
    upkeep: 5,
    basePower: 180,
    hp: 170,
    atk: 32,
    def: 35,
    spd: 4,
    range: 1,
    move: 2,
    terrain: { plain: 150, forest: 100, mountain: 120, shoal: 80, sea: 80 },
    level: 1,
  },
  crossbow: {
    name: "弩兵",
    hire: 180,
    upkeep: 3,
    basePower: 130,
    hp: 85,
    atk: 40,
    def: 8,
    spd: 4,
    range: 5,
    move: 1,
    terrain: { plain: 110, forest: 120, mountain: 120, shoal: 100, sea: 100 },
    level: 1,
  },
  shield: {
    name: "盾兵",
    hire: 150,
    upkeep: 3,
    basePower: 120,
    hp: 150,
    atk: 26,
    def: 30,
    spd: 3,
    range: 1,
    move: 1,
    terrain: { plain: 110, forest: 130, mountain: 130, shoal: 90, sea: 90 },
    level: 1,
  },
  seaArcher: {
    name: "海弓兵",
    hire: 170,
    upkeep: 3,
    basePower: 130,
    hp: 90,
    atk: 30,
    def: 10,
    spd: 3,
    range: 4,
    move: 1,
    terrain: { plain: 120, forest: 100, mountain: 100, shoal: 120, sea: 130 },
    level: 1,
  },
};

/** 雇用枠は村3・街5、各枠3人まで。 */
const RECRUIT_PER_SLOT = 3;
const RECRUIT_SLOTS = {
  village: 3,
  town: 5,
};
const RECRUIT_DEFAULT_WEIGHT = 5;
const RECRUIT_BASE_WEIGHTS = {
  infantry: 20,
  archer: 15,
  scout: 12,
  medic: 10,
  marine: 10,
  cavalry: 8,
  crossbow: 8,
  shield: 12,
  seaArcher: 5,
  halberd: 8,
  cavalier: 5,
};
const RECRUIT_KIND_BONUS = {
  village: { infantry: 5, scout: 5 },
  town: { cavalry: 5, crossbow: 5, medic: 5, halberd: 5, cavalier: 5 },
};
const RECRUIT_RARE_WEIGHTS = {
  cavalry: 25,
  crossbow: 25,
  shield: 20,
  seaArcher: 20,
  marine: 10,
  halberd: 20,
  cavalier: 20,
};
const RECRUIT_RARE_CHANCE = {
  village: 0.2,
  town: 0,
};

/**
 * 兵種IDの一覧を返す。
 * @returns {string[]}
 */
const troopTypeKeys = () => Object.keys(TROOP_STATS);

/**
 * 正規軍は補助兵を除く全兵種、強編成は全兵種、通常編成は基本4兵種を候補にする。
 * @param {boolean} regular 正規軍か。 @param {boolean} strong 強編成か。 @returns {string[]} 抽選前の候補。
 */
export function enemyTroopPool(regular, strong) {
  if (regular) return troopTypeKeys().filter(type => !["scout", "medic"].includes(type));
  return strong ? troopTypeKeys() : ["infantry", "archer", "scout", "marine"];
}

/**
 * 拠点種別に応じた雇用抽選用の重みを作成する。
 * @param {string} kind
 * @returns {Record<string, number>}
 */
function buildRecruitWeights(kind) {
  const bonus = RECRUIT_KIND_BONUS[kind] || {};
  const weights = {};
  troopTypeKeys().forEach((type) => {
    const base = RECRUIT_BASE_WEIGHTS[type] ?? RECRUIT_DEFAULT_WEIGHT;
    weights[type] = Math.max(0, base + (bonus[type] ?? 0));
  });
  return weights;
}

/**
 * 重み付きで兵種を選ぶ。
 * @param {string[]} types
 * @param {Record<string, number>} weights
 * @param {Record<string, number>} [fallback]
 * @returns {string|null}
 */
function pickWeightedType(types, weights, fallback) {
  if (!types.length) return null;
  const pickWith = (pool) => {
    let total = 0;
    const entries = types.map((type) => {
      const w = Math.max(0, Number(pool?.[type]) || 0);
      total += w;
      return [type, w];
    });
    if (total <= 0) return null;
    let roll = Math.random() * total;
    for (const [type, w] of entries) {
      roll -= w;
      if (roll <= 0) return type;
    }
    return entries[entries.length - 1][0];
  };
  return pickWith(weights) || pickWith(fallback) || types[Math.floor(Math.random() * types.length)];
}

/**
 * 拠点の雇用枠を生成する（拠点生成時に固定）。
 * @param {object} settlement
 */
export function initSettlementRecruitment(settlement) {
  if (!settlement) return;
  const slotCount = RECRUIT_SLOTS[settlement.kind] || 0;
  if (!slotCount) return;
  const pool = troopTypeKeys();
  const weights = buildRecruitWeights(settlement.kind);
  const rareChance = RECRUIT_RARE_CHANCE[settlement.kind] ?? 0;
  const picks = [];
  /**
   * 街はレア枠を必ず1つ確保してから残りを抽選する。
   */
  if (settlement.kind === "town" && pool.length) {
    const pick = pickWeightedType(pool, RECRUIT_RARE_WEIGHTS, weights);
    const idx = pick ? pool.indexOf(pick) : -1;
    if (idx >= 0) picks.push(pool.splice(idx, 1)[0]);
  }
  while (picks.length < slotCount && pool.length) {
    const useRare = Math.random() < rareChance;
    const pick = pickWeightedType(pool, useRare ? RECRUIT_RARE_WEIGHTS : weights, weights);
    const idx = pick ? pool.indexOf(pick) : -1;
    if (idx >= 0) picks.push(pool.splice(idx, 1)[0]);
    else picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  settlement.recruitSlots = picks.map((type) => ({
    type,
    remaining: RECRUIT_PER_SLOT,
  }));
}

/**
 * 雇用枠の人数だけを季節更新で補充する。
 * @param {object} settlement
 */
export function refreshSettlementRecruitment(settlement) {
  if (!settlement) return;
  if (!settlement.recruitSlots || !settlement.recruitSlots.length) {
    initSettlementRecruitment(settlement);
    return;
  }
  settlement.recruitSlots = settlement.recruitSlots.map((slot) => ({
    ...slot,
    remaining: RECRUIT_PER_SLOT,
  }));
}


/**
 * 部隊の所持上限を計算する。
 * @param {object} [fleet] 船種別の船団。
 * @param {object} [outfitting] 比較時に指定する艤装。
 * @returns {number}
 */
export function calcTroopCap(fleet = state.fleet, outfitting = state.expansion?.outfitting) {
  return applyCapacityBonus(BASE_TROOP_CAP + fleetEffects(fleet).troops, getOutfittingEffects(outfitting, fleet).troopCap);
}

/**
 * 部隊の合計人数を返す。
 * @param {object} troops
 * @returns {number}
 */
export function totalTroops(troops = state.troops) {
  if (!troops) return 0;
  return Object.values(troops).reduce((acc, levels) => {
    if (typeof levels === "number") return acc + levels;
    return acc + Object.values(levels || {}).reduce((a, b) => a + Number(b || 0), 0);
  }, 0);
}

/**
 * 損耗を兵種ごとに適用する
 * @param {Record<string, number>} losses
 */
export function applyTroopLosses(losses) {
  if (!losses) return;
  Object.entries(losses).forEach(([type, loss]) => {
    let remain = Math.max(0, Number(loss) || 0);
    if (remain <= 0) return;
    const bucket = state.troops[type];
    if (typeof bucket === "number") {
      state.troops[type] = Math.max(0, bucket - remain);
      return;
    }
    const levels = bucket || {};
    // ランダムにレベルを選んで減算する（加重ランダム）
    const pickLevel = () => {
      const entries = Object.entries(levels).map(([lvl, qty]) => [Number(lvl), Number(qty || 0)]);
      const total = entries.reduce((s, [, q]) => s + q, 0);
      if (total <= 0) return null;
      let roll = Math.random() * total;
      for (const [lvl, qty] of entries) {
        roll -= qty;
        if (roll <= 0) return lvl;
      }
      return entries[entries.length - 1][0];
    };
    while (remain > 0 && Object.keys(levels).length) {
      const lvl = pickLevel();
      if (lvl === null) break;
      const qty = levels[lvl] || 0;
      levels[lvl] = qty - 1;
      remain -= 1;
      if (levels[lvl] <= 0) delete levels[lvl];
    }
    // 安全策: 残数があってもレベル情報が尽きたら種別を削除する
    if (!Object.keys(levels).length) delete state.troops[type];
  });
}

/**
 * 兵力を追加する。
 * @param {string} type
 * @param {number} level
 * @param {number} qty
 */
export function addTroops(type, level, qty) {
  if (!type || qty <= 0) return;
  const lvl = Math.min(5, Math.max(1, Math.round(level || 1)));
  if (!state.troops[type]) state.troops[type] = {};
  if (typeof state.troops[type] === "number") {
    state.troops[type] = { [lvl]: (state.troops[type] || 0) + qty };
    return;
  }
  const bucket = state.troops[type];
  bucket[lvl] = (bucket[lvl] || 0) + qty;
}

/**
 * Lv5未満の兵を人数比で毎回抽選してLvを+1する。同じ兵が再選出される場合もある。
 * @param {number} upCount 上げる人数
 * @param {Array} [promotions] 兵種・昇級前後のレベルごとの結果を追記する配列。
 * @returns {number} 実際に上がった人数
 */
export function levelUpTroopsRandom(upCount, promotions = []) {
  let remaining = Math.max(0, Math.floor(upCount));
  const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pool = () => {
    const entries = [];
    Object.entries(state.troops || {}).forEach(([type, levels]) => {
      if (typeof levels === "number") {
        if (levels > 0) entries.push({ type, lvl: 1, count: levels });
        return;
      }
      Object.entries(levels || {}).forEach(([lvl, cnt]) => {
        const c = Number(cnt || 0);
        const levelNum = Number(lvl);
        if (c > 0 && levelNum < 5) entries.push({ type, lvl: levelNum, count: c });
      });
    });
    return entries;
  };
  let leveled = 0;
  while (remaining > 0) {
    const entries = pool();
    const total = entries.reduce((s, e) => s + e.count, 0);
    if (total <= 0) break;
    const pick = randInt(0, total - 1);
    let acc = 0;
    let target = null;
    for (const e of entries) {
      acc += e.count;
      if (pick < acc) {
        target = e;
        break;
      }
    }
    if (!target) break;
    // 1人分をレベルアップ移動
    const bucket = state.troops[target.type];
    if (typeof bucket === "number") {
      const nextLvl = Math.min(5, target.lvl + 1);
      state.troops[target.type] = { 1: bucket - 1, [nextLvl]: 1 + ((state.troops[target.type] || {})[nextLvl] || 0) };
    } else if (bucket) {
      bucket[target.lvl] = Math.max(0, (bucket[target.lvl] || 0) - 1);
      if (bucket[target.lvl] <= 0) delete bucket[target.lvl];
      const nextLvl = Math.min(5, target.lvl + 1);
      bucket[nextLvl] = (bucket[nextLvl] || 0) + 1;
      if (!Object.keys(bucket).length) delete state.troops[target.type];
    }
    const existing = promotions.find(row => row.type === target.type && row.from === target.lvl);
    if (existing) existing.count += 1;
    else promotions.push({ type: target.type, from: target.lvl, to: target.lvl + 1, count: 1 });
    remaining -= 1;
    leveled += 1;
  }
  return leveled;
}

/**
 * 部隊表示用の合計/上限を作成する。
 * @returns {{total:number,cap:number,html:string}}
 */
export function formatTroopDisplay() {
  const total = totalTroops();
  const cap = calcTroopCap(state.fleet);
  return {
    total,
    cap,
    html: `${total}<span class="denom">/${cap}</span>`,
  };
}

/**
 * 部隊人数を手動で上書きする（検証用）。
 * @param {number} total
 */
export function setTroopsManual(total) {
  state.troops = { marine: { 1: Math.max(0, total) } };
}

/**
 * 兵種別の合計人数と、人数のあるレベルを昇順で部隊詳細に描画する。
 * 内訳は初期状態で開き、再描画時は兵種ごとの折りたたみ状態を保持する。
 * @param {HTMLElement|null} detailEl
 */
export function renderTroopModal(detailEl) {
  if (!detailEl) return;
  const { total, cap } = formatTroopDisplay();
  const closed = new Set([...detailEl.querySelectorAll(".troop-group:not([open])")].map(el => el.dataset.type));
  const cards = Object.entries(state.troops || {}).map(([type, levels]) => {
    const stat = TROOP_STATS[type];
    if (!stat) return "";
    const entries = Object.entries(levels || {}).filter(([, qty]) => qty > 0)
      .sort((a, b) => Number(a[0]) - Number(b[0]));
    const count = entries.reduce((sum, [, qty]) => sum + Number(qty), 0);
    if (!count) return "";
    return `<details class="troop-group" data-type="${type}" ${closed.has(type) ? "" : "open"}>
      <summary class="troop-group-heading"><img src="image/troops/${type}.gif" alt="" class="troop-icon"><b>${stat.name}</b><span class="troop-group-total">${count.toLocaleString()}<small>人</small></span></summary>
      <div class="troop-group-body"><p class="tiny">レベル別人数（出撃・控えの合計）</p>
      <div class="troop-level-list">${entries.map(([level, qty]) => `<div class="troop-level-item"><div><b>Lv${Number(level)}</b><strong>${Number(qty).toLocaleString()}人</strong></div><label>解雇する人数<input type="number" min="0" max="${Number(qty)}" step="1" value="0" data-type="${type}" data-level="${Number(level)}" aria-label="${stat.name} Lv${Number(level)}の解雇人数" class="troop-dismiss"></label></div>`).join("")}</div>
      <p class="troop-base-stats tiny">基礎能力（レベル・地形・船団補正前）<br>HP ${stat.hp ?? 0} / ATK ${stat.atk ?? stat.basePower ?? 0} / DEF ${stat.def ?? 0} / SPD ${stat.spd ?? 0} / RNG ${stat.range ?? 1} / MOV ${stat.move ?? 1}<br>維持費 ${stat.upkeep ?? 0}資金／人・季節（軽減前）</p></div>
    </details>`;
  }).join("");
  detailEl.innerHTML = `${renderUpkeepForecast(state, TROOP_STATS)}
    <div class="tiny mb-6">保有兵員: ${total}人 / 上限 ${cap}人（出撃・控えを含む）</div>
    <div class="troop-group-list">${cards || '<p>部隊がいません</p>'}</div>
    <div class="sticky-footer justify-end"><button class="btn bad" id="troopDismissBtn">入力した部隊員を解雇</button></div>`;
}

/**
 * 部隊解雇モーダルのイベントを設定する。
 * @param {HTMLElement|null} detailEl
 * @param {Function} onChange
 */
export function wireTroopDismiss(detailEl, onChange) {
  if (!detailEl || detailEl.dataset.troopDismissWired) return;
  detailEl.dataset.troopDismissWired = "1";
  detailEl.addEventListener("input", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("troop-dismiss")) return;
    const max = Math.max(0, Number(target.getAttribute("max")) || 0);
    let v = Math.max(0, Number(target.value) || 0);
    if (v > max) v = max;
    target.value = String(v);
  });
  detailEl.addEventListener("click", (e) => {
    const btn = e.target.closest("#troopDismissBtn");
    if (!btn) return;
    const inputs = detailEl.querySelectorAll(".troop-dismiss");
    const selections = [];
    inputs.forEach((inp) => {
      const type = inp.getAttribute("data-type");
      const level = Number(inp.getAttribute("data-level"));
      const qty = Math.max(0, Number(inp.value) || 0);
      if (!type || qty <= 0) return;
      selections.push({ type, level, qty });
    });
    if (!selections.length) {
      pushToast("解雇できません", "解雇する人数を入力してください。", "warn");
      return;
    }
    const summary = selections
      .map((s) => `${TROOP_STATS[s.type]?.name || s.type} Lv${s.level} x${s.qty}`)
      .join(" / ");
    confirmAction({
      title: "解雇の確認",
      body: `以下を解雇します。\n${summary}`,
      confirmText: "解雇する",
      onConfirm: () => {
        selections.forEach((s) => {
          const levels = state.troops?.[s.type];
          if (!levels) return;
          const current = Number(levels[s.level] || 0);
          const next = Math.max(0, current - s.qty);
          if (next === 0) delete levels[s.level];
          else levels[s.level] = next;
          if (Object.keys(levels).length === 0) delete state.troops[s.type];
        });
        pushLog("部隊を解雇しました", summary, "-");
        renderTroopModal(detailEl);
        onChange?.();
      },
    });
  });
}
