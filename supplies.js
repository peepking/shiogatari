import { faithEffects } from "./faith.js";
import { quantityControl, wireQuantityControls, refreshQuantity } from "./quantityUI.js";
import { confirmAction, pushLog, pushToast } from "./dom.js";
import { getPlayerFactionId, getSupportLabel, getWarEntry, getWarScoreLabel } from "./faction.js";
import { state } from "./state.js";
import { sumValues } from "./util.js";
import { resourceIcon } from "./resourceUI.js";
import { renderUpkeepForecast } from "./upkeep.js";
import { getOutfittingEffects, applyCapacityBonus } from "./outfitting.js";
import { TROOP_STATS } from "./troops.js";
import { fleetEffects } from "./fleet.js";

/** @type {number} 基本の物資上限 */
export const BASE_SUPPLY_CAP = 60;

/** @enum {string} 物資タイプ */
export const SUPPLY_TYPES = {
  food: "food",
  raw: "raw",
  processed: "processed",
};

/** @type {Array} 物資定義 */
export const SUPPLY_ITEMS = [
  { id: "food", name: "食料", type: SUPPLY_TYPES.food, basePrice: 5 },
  { id: "wood", name: "木材", type: SUPPLY_TYPES.raw, basePrice: 10 },
  { id: "stone", name: "石材", type: SUPPLY_TYPES.raw, basePrice: 10 },
  { id: "iron", name: "鉄", type: SUPPLY_TYPES.raw, basePrice: 20 },
  { id: "fiber", name: "繊維", type: SUPPLY_TYPES.raw, basePrice: 20 },
  { id: "salt", name: "塩", type: SUPPLY_TYPES.raw, basePrice: 30 },
  { id: "spice", name: "香辛料", type: SUPPLY_TYPES.processed, basePrice: 100 },
  { id: "arms", name: "武具", type: SUPPLY_TYPES.processed, basePrice: 100 },
  { id: "textile", name: "織物", type: SUPPLY_TYPES.processed, basePrice: 50 },
  { id: "brew", name: "酒", type: SUPPLY_TYPES.processed, basePrice: 50 },
  { id: "leather", name: "なめし革", type: SUPPLY_TYPES.processed, basePrice: 50 },
];

const SUPPLY_INDEX = Object.fromEntries(SUPPLY_ITEMS.map((i) => [i.id, i]));
/**
 * 数値を指定範囲に丸める。
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
/**
 * 指定範囲の整数乱数を返す。
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
/**
 * XdY形式の乱数合計を返す。
 * @param {number} times
 * @param {number} faces
 * @returns {number}
 */
const rollDice = (times, faces) => {
  let total = 0;
  for (let i = 0; i < times; i++) total += randInt(1, faces);
  return total;
};

/**
 * 戦況ラベルに応じた価格倍率を返す。
 * @param {string|null} factionId
 * @returns {number}
 */
function priceWarMultiplier(factionId) {
  if (!factionId) return 1;
  const entry = getWarEntry(getPlayerFactionId(), factionId);
  const label = getWarScoreLabel(entry?.score || 0);
  switch (label) {
    case "winning":
      return 0.8;
    case "advantage":
      return 0.9;
    case "disadvantage":
      return 1.15;
    case "losing":
      return 1.2;
    default:
      return 1;
  }
}

/**
 * 支持度ラベルに応じた価格倍率を返す。
 * @param {string|null} factionId
 * @param {string|null} settlementId
 * @returns {number}
 */
function priceSupportMultiplier(factionId, settlementId) {
  if (!factionId || !settlementId) return 1;
  const label = getSupportLabel(settlementId, factionId);
  if (label === "high") return 0.95;
  if (label === "low") return 1.05;
  return 1;
}

/**
 * 物資の所持上限を計算する。
 * @param {object} [fleet] 船種別の船団。
 * @param {object} [outfitting] 比較時に指定する艤装。
 * @returns {number}
 */
export function calcSupplyCap(fleet = state.fleet, outfitting = state.expansion?.outfitting) {
  return applyCapacityBonus(BASE_SUPPLY_CAP + fleetEffects(fleet).supplies, getOutfittingEffects(outfitting, fleet).supplyCap);
}

/**
 * 物資の総数を返す。
 * @param {object} sup
 * @returns {number}
 */
export function totalSupplies(sup = state.supplies) {
  return sumValues(sup);
}

/**
 * 物資表示用の合計/上限を作成する。
 * @returns {{total:number,cap:number,html:string}}
 */
export function formatSupplyDisplay() {
  const total = totalSupplies();
  const cap = calcSupplyCap(state.fleet);
  return {
    total,
    cap,
    html: `${total}<span class="denom">/${cap}</span>`,
  };
}

/**
 * 物資総数を手動で上書きする（検証用）。
 * @param {number} total
 */
export function setSuppliesManual(total) {
  state.supplies = { food: Math.max(0, total) };
}

/**
 * 物資詳細モーダルを描画する。
 * @param {HTMLElement|null} detailEl
 */
export function renderSupplyModal(detailEl) {
  if (!detailEl) return;
  const { total, cap } = formatSupplyDisplay();
  const rows = SUPPLY_ITEMS.map((item) => {
    const qty = state.supplies?.[item.id] ?? 0;
    if (qty <= 0) return "";
    return `
      <tr>
        <td class="ta-center">${resourceIcon(item.id)}</td>
        <td>${item.name}</td>
        <td class="ta-center">${qty}</td>
        <td class="ta-center">
          ${quantityControl(`<input type="number" min="0" max="${qty}" step="1" value="0" aria-label="${item.name}の破棄数量" data-id="${item.id}" class="supply-discard">`)}
        </td>
      </tr>`;
  })
    .filter(Boolean)
    .join("");

  detailEl.innerHTML = `
    ${renderUpkeepForecast(state, TROOP_STATS)}
    <div class="tiny mb-6">総数: ${total} / ${cap}</div>
    <table class="trade-table">
      <thead>
        <tr>
          <th class="ta-center"> </th>
          <th class="ta-left">品目</th>
          <th class="ta-center">所持数</th>
          <th class="ta-center">破棄</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="4" class="ta-center">在庫なし</td></tr>`}
      </tbody>
    </table>
    <div class="sticky-footer justify-end">
      <button class="btn bad" id="supplyDiscardBtn">選択分を破棄</button>
    </div>
  `;
  detailEl.querySelectorAll('.quantity-control input').forEach(refreshQuantity);
}

/**
 * 物資破棄モーダルのイベントを設定する。
 * @param {HTMLElement|null} detailEl
 * @param {Function} onChange
 */
export function wireSupplyDiscard(detailEl, onChange) {
  if (!detailEl || detailEl.dataset.supplyDiscardWired) return;
  detailEl.dataset.supplyDiscardWired = "1";
  wireQuantityControls(detailEl);
  detailEl.addEventListener("input", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("supply-discard")) return;
    refreshQuantity(target);
    const invalid = [...detailEl.querySelectorAll('.supply-discard')].some(input => !input.value || !input.checkValidity() || !Number.isSafeInteger(Number(input.value)));
    const button = detailEl.querySelector('#supplyDiscardBtn');
    if (button) button.disabled = invalid;
  });
  detailEl.addEventListener("click", (e) => {
    const btn = e.target.closest("#supplyDiscardBtn");
    if (!btn) return;
    const inputs = detailEl.querySelectorAll(".supply-discard");
    if ([...inputs].some(input => !input.value || !input.checkValidity() || !Number.isSafeInteger(Number(input.value)))) return;
    const selections = [];
    inputs.forEach((inp) => {
      const id = inp.getAttribute("data-id");
      const qty = Math.max(0, Number(inp.value) || 0);
      if (!id || qty <= 0) return;
      selections.push({ id, qty });
    });
    if (!selections.length) {
      pushToast("破棄できません", "破棄する数を入力してください。", "warn");
      return;
    }
    const summary = selections
      .map((s) => `${SUPPLY_INDEX[s.id]?.name || s.id} x${s.qty}`)
      .join(" / ");
    confirmAction({
      title: "破棄の確認",
      body: `以下を破棄します。\n${summary}`,
      confirmText: "破棄する",
      onConfirm: () => {
        selections.forEach((s) => {
          const current = state.supplies?.[s.id] ?? 0;
          const next = Math.max(0, current - s.qty);
          state.supplies[s.id] = next;
          if (next === 0) delete state.supplies[s.id];
        });
        pushLog("物資を破棄しました", summary, "-");
        renderSupplyModal(detailEl);
        onChange?.();
      },
    });
  });
}


/**
 * 物資UI表示を更新する。
 * @param {object} elements
 * @returns {{total:number,cap:number,html:string}}
 */
export function syncSuppliesUI(elements) {
  const display = formatSupplyDisplay();
  if (elements?.suppliesEl) elements.suppliesEl.innerHTML = display.html;
  if (elements?.suppliesIn) elements.suppliesIn.value = String(display.total);
  renderSupplyModal(elements?.suppliesDetail);
  return display;
}

/**
 * 物資詳細モーダルのイベントを設定する。
 * @param {object} elements
 * @param {Function} openModal
 * @param {Function} closeModal
 */
export function wireSupplyModal(elements, openModal, closeModal) {
  if (!elements) return;
  const open = () => {
    renderSupplyModal(elements.suppliesDetail);
    openModal?.(elements.suppliesModal);
  };
  document.getElementById("asset-supplies")?.addEventListener("click", open);
  elements.suppliesModalClose?.addEventListener("click", () =>
    closeModal?.(elements.suppliesModal)
  );
  elements.suppliesModal?.addEventListener("click", (e) => {
    if (e.target === elements.suppliesModal) closeModal?.(elements.suppliesModal);
  });
}

/** 相場範囲と売却手数料を管理する。 */
export const SUPPLY_MARKET = Object.freeze({ demandMin: 1, demandMax: 10, minMultiplier: 1, maxMultiplier: 4, sellRate: 0.9 });

/**
 * 需要と売買区分から補正後の整数単価を求める。referenceは支持度・手数料を含まない。
 * @param {string} supplyId
 * @param {number} demand
 * @param {{factionId?:string|null,settlementId?:string|null,mode?:"buy"|"sell"|"reference"}} [opts]
 * @returns {number|null}
 */
export function calcSupplyPrice(supplyId, demand, opts = {}) {
  const item = SUPPLY_INDEX[supplyId];
  if (!item) return null;
  const d = clamp(Number(demand) || 0, SUPPLY_MARKET.demandMin, SUPPLY_MARKET.demandMax);
  const warMul = priceWarMultiplier(opts.factionId, opts.settlementId);
  const mode = opts.mode || "buy";
  const supportMul = mode === "buy" ? priceSupportMultiplier(opts.factionId, opts.settlementId) : 1;
  const market = SUPPLY_MARKET.minMultiplier + (d - SUPPLY_MARKET.demandMin) / (SUPPLY_MARKET.demandMax - SUPPLY_MARKET.demandMin) * (SUPPLY_MARKET.maxMultiplier - SUPPLY_MARKET.minMultiplier);
  const price = Math.floor(item.basePrice * market * warMul * supportMul * (mode === "sell" ? SUPPLY_MARKET.sellRate * (1 + faithEffects(state).sale) : 1));
  return mode === "sell" ? Math.min(price, calcSupplyPrice(supplyId, demand, { ...opts, mode: "buy" })) : price;
}

/**
 * 拠点種別/物資タイプに応じた需要度を乱数で生成する。
 * @param {string} settlementKind
 * @param {string} type
 * @returns {number}
 */
function randomDemand(settlementKind, type) {
  const base = 1 + Math.floor(Math.random() * 10);
  let bias = 0;
  if (settlementKind === "village") {
    // 村は食料/原料の需要が高め、加工品は低め。
    if (type === SUPPLY_TYPES.food || type === SUPPLY_TYPES.raw) bias = 2;
    if (type === SUPPLY_TYPES.processed) bias = -2;
  } else if (settlementKind === "town") {
    // 街は食料/原料の需要が低め、加工品が高め。
    if (type === SUPPLY_TYPES.food || type === SUPPLY_TYPES.raw) bias = -1;
    if (type === SUPPLY_TYPES.processed) bias = 2;
  }
  return clamp(base + bias, 1, 10);
}

/**
 * 物資タイプからランダムに1つ選ぶ。
 * @param {string} type
 * @returns {string|null}
 */
export function randomSupplyIdByType(type) {
  const list = SUPPLY_ITEMS.filter((i) => i.type === type);
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)].id;
}

/**
 * 拠点の需要度テーブルを生成する。
 * @param {string} [settlementKind="town"]
 * @param {string|null} specialtyId
 * @returns {object}
 */
export function createSettlementDemand(settlementKind = "town", specialtyId = null) {
  const demand = {};
  SUPPLY_ITEMS.forEach((item) => {
    demand[item.id] = randomDemand(settlementKind, item.type);
  });
  if (specialtyId && SUPPLY_INDEX[specialtyId]) {
    // 特産品の需要は1〜3で固定する。
    demand[specialtyId] = randInt(1, 3);
  }
  return demand;
}

/**
 * 拠点の需要度を再生成する。
 * @param {object} settlement
 */
export function refreshSettlementDemand(settlement) {
  settlement.demand = createSettlementDemand(settlement.kind, settlement.specialty);
}

/**
 * 需要度の低い順に上位を抽出する。
 * @param {object} settlement
 * @param {string} type
 * @param {number} limit
 * @param {boolean} [excludeSpecialty=true]
 * @returns {string[]}
 */
function pickTopByDemand(settlement, type, limit, excludeSpecialty = true) {
  const demand = settlement.demand || {};
  const list = SUPPLY_ITEMS.filter(
    (i) => i.type === type && (!excludeSpecialty || i.id !== settlement.specialty)
  )
    .map((i) => ({
      id: i.id,
      d: demand[i.id] ?? 10,
    }))
    .sort((a, b) => {
      if (a.d !== b.d) return a.d - b.d;
      return a.id.localeCompare(b.id);
    });
  return list.slice(0, limit).map((x) => x.id);
}

/**
 * 拠点の在庫を季節更新で入れ替える。
 * @param {object} settlement
 */
export function refreshSettlementStock(settlement) {
  if (!settlement) return;
  if (!settlement.demand) refreshSettlementDemand(settlement);
  const add = (id, n) => {
    if (!id || n <= 0) return;
    settlement.stock[id] = (settlement.stock[id] || 0) + n;
  };
  settlement.stock = {};

  if (settlement.kind === "village") {
    // 村の在庫: 食料5D10、特産品6D6、原料上位2=5D5、加工品上位2=3D3。
    add("food", rollDice(5, 10));
    if (settlement.specialty) add(settlement.specialty, rollDice(6, 6));
    pickTopByDemand(settlement, SUPPLY_TYPES.raw, 2).forEach((id) =>
      add(id, rollDice(5, 5))
    );
    pickTopByDemand(settlement, SUPPLY_TYPES.processed, 2).forEach((id) =>
      add(id, rollDice(3, 3))
    );
  } else if (settlement.kind === "town") {
    // 街の在庫: 食料10D10、特産品4D4、原料上位3=5D5、加工品上位3=3D3。
    add("food", rollDice(10, 10));
    if (settlement.specialty) add(settlement.specialty, rollDice(4, 4));
    pickTopByDemand(settlement, SUPPLY_TYPES.raw, 3).forEach((id) =>
      add(id, rollDice(5, 5))
    );
    pickTopByDemand(settlement, SUPPLY_TYPES.processed, 3).forEach((id) =>
      add(id, rollDice(3, 3))
    );
  }
}
