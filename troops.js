import { state } from "./state.js";
import { pushLog, pushToast, confirmAction } from "./dom.js";

/** @type {number} 基本の部隊上限 */
export const BASE_TROOP_CAP = 30;
/** @type {number} 船1隻あたりの部隊上限増分 */
export const CAP_PER_SHIP = 20;

/** @type {object} 兵種の定義 */
export const TROOP_STATS = {
  infantry: {
    name: "歩兵",
    hire: 100,
    upkeep: 2,
    basePower: 100,
    terrain: { plain: 100, forest: 120, mountain: 120, shoal: 100, sea: 100 },
    level: 1,
  },
  medic: {
    name: "衛生兵",
    hire: 200,
    upkeep: 4,
    basePower: 50,
    terrain: { plain: 100, forest: 100, mountain: 100, shoal: 100, sea: 100 },
    level: 1,
  },
  marine: {
    name: "海兵",
    hire: 150,
    upkeep: 3,
    basePower: 150,
    terrain: { plain: 100, forest: 100, mountain: 100, shoal: 120, sea: 130 },
    level: 1,
  },
  archer: {
    name: "弓兵",
    hire: 150,
    upkeep: 3,
    basePower: 150,
    terrain: { plain: 100, forest: 120, mountain: 130, shoal: 100, sea: 100 },
    level: 1,
  },
  scout: {
    name: "斥候",
    hire: 100,
    upkeep: 2,
    basePower: 50,
    terrain: { plain: 100, forest: 100, mountain: 100, shoal: 100, sea: 100 },
    level: 1,
  },
  cavalry: {
    name: "騎兵",
    hire: 200,
    upkeep: 4,
    basePower: 200,
    terrain: { plain: 150, forest: 100, mountain: 100, shoal: 50, sea: 50 },
    level: 1,
  },
};

// 雇用枠は村2・街4、各枠3人まで。
const RECRUIT_PER_SLOT = 3;
const RECRUIT_SLOTS = {
  village: 2,
  town: 4,
};

/**
 * 兵種IDの一覧を返す。
 * @returns {string[]}
 */
const troopTypeKeys = () => Object.keys(TROOP_STATS);

/**
 * 拠点の雇用枠を生成する（拠点生成時に固定）。
 * @param {object} settlement
 */
export function initSettlementRecruitment(settlement) {
  if (!settlement) return;
  const slotCount = RECRUIT_SLOTS[settlement.kind] || 0;
  if (!slotCount) return;
  const pool = troopTypeKeys();
  const picks = [];
  while (picks.length < slotCount && pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
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
 * @param {number} ships
 * @returns {number}
 */
export function calcTroopCap(ships) {
  return BASE_TROOP_CAP + ships * CAP_PER_SHIP;
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
 * 部隊表示用の合計/上限を作成する。
 * @returns {{total:number,cap:number,html:string}}
 */
export function formatTroopDisplay() {
  const total = totalTroops();
  const cap = calcTroopCap(state.ships);
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
 * 部隊詳細モーダルを描画する。
 * @param {HTMLElement|null} detailEl
 */
export function renderTroopModal(detailEl) {
  if (!detailEl) return;
  const { total, cap } = formatTroopDisplay();
  const rows = Object.entries(state.troops || {})
    .flatMap(([type, levels]) => {
      const stat = TROOP_STATS[type];
      const name = stat?.name || type;
      return Object.entries(levels || {})
        .filter(([, qty]) => qty > 0)
        .map(([lvlStr, qty]) => {
          const lvl = Number(lvlStr);
          const upkeep = stat?.upkeep ?? 0;
          return `
            <tr>
              <td>${name}</td>
              <td class="ta-center">Lv${lvl}</td>
              <td class="ta-center">${upkeep}</td>
              <td class="ta-center">${qty}</td>
              <td class="ta-center">
                <input type="number" min="0" max="${qty}" value="0" data-type="${type}" data-level="${lvl}" class="troop-dismiss input-70">
              </td>
            </tr>
          `;
        });
    })
    .join("");

  detailEl.innerHTML = `
    <div class="tiny mb-6">部隊数: ${total} / 上限 ${cap}</div>
    <table class="trade-table">
      <thead>
        <tr>
          <th class="ta-left">兵種</th>
          <th class="ta-center">Lv</th>
          <th class="ta-center">維持費</th>
          <th class="ta-center">人数</th>
          <th class="ta-center">解雇</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="5" class="ta-center">部隊がいません</td></tr>`}
      </tbody>
    </table>
    <div class="row mt-10 justify-end">
      <button class="btn bad" id="troopDismissBtn">部隊員を解雇</button>
    </div>
  `;
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
