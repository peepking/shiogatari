import { elements, setOutput, pushLog } from "./dom.js";
import { state } from "./state.js";
import { MODE_LABEL } from "./constants.js";
import { getCurrentSettlement } from "./actions.js";
import { TROOP_STATS } from "./troops.js";

/**
 * モーダル内のエラーメッセージ表示を更新する。
 * @param {HTMLElement|null} el
 * @param {string} msg
 */
function setInlineMessage(el, msg) {
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.textContent = msg;
  el.hidden = false;
}

/**
 * 雇用モーダルのエラー表示を更新する。
 * @param {string} msg
 */
function setHireError(msg) {
  setInlineMessage(elements.hireError, msg);
}

/**
 * 雇用による資金変動を再計算する。
 */
function updateHireDelta() {
  const deltaEl = elements.hireDelta;
  const fundsEl = elements.hireFunds;
  if (fundsEl) fundsEl.textContent = String(state.funds);
  if (!deltaEl) return;
  deltaEl.hidden = false;
  const inputs = elements.hireModal?.querySelectorAll(".hire-count") || [];
  const totalCost = Array.from(inputs).reduce((sum, inp) => {
    const type = inp.getAttribute("data-type");
    const qty = Math.max(0, Number(inp.value) || 0);
    return sum + (TROOP_STATS[type]?.hire ?? 0) * qty;
  }, 0);
  if (totalCost === 0) {
    deltaEl.textContent = "資金変動: 0";
    deltaEl.className = "pill delta-zero";
    return;
  }
  deltaEl.textContent = `資金変動: -${totalCost}`;
  deltaEl.className = "pill delta-neg";
}

/**
 * 雇用モーダルを描画する。
 * @param {object|null} settlement
 */
export function renderHireModal(settlement) {
  const body = elements.hireTableBody;
  if (!body) return;
  if (!settlement) {
    body.innerHTML = `<tr><td colspan="5" class="ta-center pad-10">街・村の中でのみ雇用できます。</td></tr>`;
    setHireError("");
    if (elements.hireDelta) elements.hireDelta.hidden = true;
    if (elements.hireFunds) elements.hireFunds.textContent = String(state.funds);
    return;
  }
  const slots = settlement.recruitSlots || [];
  if (!slots.length) {
    body.innerHTML = `<tr><td colspan="5" class="ta-center pad-10">雇用枠がありません。</td></tr>`;
    setHireError("");
    if (elements.hireDelta) elements.hireDelta.hidden = true;
    if (elements.hireFunds) elements.hireFunds.textContent = String(state.funds);
    return;
  }
  const rows = slots
    .map((slot) => {
      const stat = TROOP_STATS[slot.type];
      const name = stat?.name || slot.type;
      const hire = stat?.hire ?? 0;
      const remaining = Math.max(0, Number(slot.remaining) || 0);
      const disabled = remaining <= 0 ? "disabled" : "";
      const imgSrc = `image/troops/${slot.type}.gif`;
      return `
        <tr>
          <td class="ta-center"><img src="${imgSrc}" alt="${name}" class="hire-icon"></td>
          <td>${name}</td>
          <td class="ta-center">${hire}</td>
          <td class="ta-center">${remaining}</td>
          <td class="ta-center">
            <input type="number" min="0" max="${remaining}" value="0" data-type="${slot.type}" class="hire-count input-70" ${disabled}>
          </td>
        </tr>
      `;
    })
    .join("");
  body.innerHTML = rows;
  setHireError("");
  updateHireDelta();
}

/**
 * 雇用モーダルのイベントを設定する。
 * @param {{openModal:Function,bindModal:Function,syncUI:Function}} param0
 */
export function wireHireModal({ openModal, bindModal, syncUI }) {
  bindModal?.(elements.hireModal, elements.hireModalClose);
  elements.hireModal?.addEventListener("input", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("hire-count")) return;
    // 雇用数は残り枠を超えないように強制する。
    const max = Math.max(0, Number(target.getAttribute("max")) || 0);
    let v = Math.max(0, Number(target.value) || 0);
    if (v > max) v = max;
    target.value = String(v);
    updateHireDelta();
  });
  elements.hireConfirm?.addEventListener("click", () => {
    const settlement = getCurrentSettlement();
    if (!settlement) {
      setHireError("街・村の中でのみ雇用できます。");
      return;
    }
    const inputs = elements.hireModal?.querySelectorAll(".hire-count") || [];
    const selections = [];
    inputs.forEach((inp) => {
      const type = inp.getAttribute("data-type");
      const qty = Math.max(0, Number(inp.value) || 0);
      if (!type || qty <= 0) return;
      selections.push({ type, qty });
    });
    if (!selections.length) {
      setHireError("雇用する人数を入力してください。");
      return;
    }
    const totalCost = selections.reduce(
      (sum, s) => sum + (TROOP_STATS[s.type]?.hire ?? 0) * s.qty,
      0
    );
    if (state.funds < totalCost) {
      setHireError("資金が不足しています。");
      return;
    }
    setHireError("");
    selections.forEach((s) => {
      const slot = settlement.recruitSlots?.find((r) => r.type === s.type);
      if (!slot) return;
      const hireQty = Math.min(slot.remaining || 0, s.qty);
      slot.remaining = Math.max(0, (slot.remaining || 0) - hireQty);
      state.troops[s.type] = state.troops[s.type] || {};
      state.troops[s.type][1] = (state.troops[s.type][1] || 0) + hireQty;
    });
    const summary = selections
      .map((s) => `${TROOP_STATS[s.type]?.name || s.type} x${s.qty}`)
      .join(" / ");
    state.funds = Math.max(0, state.funds - totalCost);
    pushLog("雇用", `雇用: ${summary} / 資金-${totalCost}`, "-");
    renderHireModal(settlement);
    syncUI?.();
  });
  const openHireModal = () => {
    const settlement = getCurrentSettlement();
    if (!settlement || (state.modeLabel !== MODE_LABEL.IN_VILLAGE && state.modeLabel !== MODE_LABEL.IN_TOWN)) {
      setOutput("雇用不可", "街・村の中でのみ雇用できます。", [
        { text: "雇用", kind: "warn" },
        { text: "入場時に利用可", kind: "warn" },
      ]);
      return;
    }
    renderHireModal(settlement);
    openModal?.(elements.hireModal);
  };
  elements.hireBtn?.addEventListener("click", openHireModal);
}
