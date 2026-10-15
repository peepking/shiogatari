import { TACTICAL_ORDERS, normalizeTacticalOrder, canOrderTactics, tacticalArea } from "./battleTacticalOrders.js";
import { formationOrderTargets, selectFormationOrderRecipients } from "./battleUnitFormationOrders.js";
import { isBattleActive, isBattleOnBoard } from "./battleMorale.js";
import { isHostileZone } from "./battleMovement.js";

/** @param {string} field 項目。 @param {string} selected 指示。 @returns {string} 選択肢。 */
export function tacticalOptions(field, selected = "auto") {
  return Object.entries(TACTICAL_ORDERS[field]).map(([id, name]) =>
    `<option value="${id}"${id === normalizeTacticalOrder(field, selected) ? " selected" : ""}>${name}</option>`).join("");
}

/** @param {object} state 戦場。 @param {string|null} selected 指定敵。 @returns {string} 敵一覧。 */
function tacticalEnemyOptions(state, selected = null) {
  return `<option value="">敵を選択</option>` + state.units.filter(unit => unit.side === "enemy" && isBattleActive(unit))
    .map(unit => `<option value="${unit.id}"${unit.id === selected ? " selected" : ""}>${unit.id} ${unit.name} ${unit.count}人</option>`).join("");
}

/** @param {object} entry 準備編成。 @param {object} state 戦場。 @param {boolean} disabled 無効状態。 @returns {string} 準備中の個別指示。 */
export function rosterTacticalMarkup(entry, state, disabled) {
  const labels = { actionOrder: "行動", targetOrder: "攻撃目標", targetAreaOrder: "担当区域" };
  const fields = Object.entries(labels).map(([field, label]) => `<label for="${field}-${entry.rosterUnitId}">${label}</label>
    <select id="${field}-${entry.rosterUnitId}" data-tactical-roster="${entry.rosterUnitId}" data-tactical-field="${field}" ${disabled ? "disabled" : ""}>${tacticalOptions(field, entry[field])}</select>`).join("");
  return `<details class="quest-description"><summary>戦術を指示</summary><div class="battle-unit-orders">${fields}
    <label for="focus-${entry.rosterUnitId}">指定する敵（敵を指定する場合）</label>
    <select id="focus-${entry.rosterUnitId}" data-tactical-roster="${entry.rosterUnitId}" data-tactical-field="focusEnemyId" ${disabled ? "disabled" : ""}>${tacticalEnemyOptions(state, entry.focusEnemyId)}</select>
    <p class="tiny">おまかせは戦況に応じて切り替えます。手動の進軍・待機では自動の立て直しを行いません。</p></div></details>`;
}

/** @param {object} unit 部隊。 @param {object} state 戦場。 @returns {string} 行動状態と判断理由。 */
export function tacticalInfoMarkup(unit, state) {
  const labels = { advance: "進軍", hold: "待機", withdrawing: "後退", recovering: "士気回復" };
  const current = !state.started || unit.status === "reserve" ? "参加時に判断" : labels[unit.tacticalState] || "判断待ち";
  const order = TACTICAL_ORDERS.actionOrder[unit.actionOrder] || "おまかせ";
  const target = TACTICAL_ORDERS.targetOrder[unit.targetOrder] || "おまかせ";
  const area = TACTICAL_ORDERS.targetAreaOrder[unit.targetAreaOrder] || "おまかせ";
  const fields = { actionOrder: "行動", targetOrder: "攻撃目標", targetAreaOrder: "区域" };
  const pending = Object.entries(unit.pendingTacticalOrders || {}).map(([field, value]) =>
    `${fields[field]}→${TACTICAL_ORDERS[field]?.[value.value] || "おまかせ"}${value.value === "focus" ? `（${value.focusEnemyId}）` : ""}`).join(" / ");
  return `<div>行動 ${order} / 現在 ${current}</div>`
    + `<div>攻撃目標 ${target}${unit.focusEnemyId ? `（${unit.focusEnemyId}）` : ""} / 担当区域 ${area}</div>`
    + (pending ? `<div>次のカウント：${pending}</div>` : "")
    + (state.started ? `<div>${unit.tacticalReason || ""}${unit.tacticalTargetReason ? `・${unit.tacticalTargetReason}` : ""}</div>` : "");
}

/** @param {string} prefix 要素の接頭辞。 @param {boolean} bulk 一括か。 @returns {string} 常設の指示欄。 */
function tacticalEditorMarkup(prefix, bulk) {
  return `<div class="battle-unit-orders mt-6">${bulk ? `<label for="${prefix}Recipients">指示する対象</label><select id="${prefix}Recipients"></select>` : ""}
    <label for="${prefix}Field">変更する項目</label><select id="${prefix}Field"><option value="actionOrder">行動</option><option value="targetOrder">攻撃目標</option><option value="targetAreaOrder">担当区域</option><option value="reset">戦術をすべておまかせ</option></select>
    <label for="${prefix}Order">指示</label><select id="${prefix}Order">${tacticalOptions("actionOrder")}</select>
    <label for="${prefix}Enemy" id="${prefix}EnemyLabel" hidden>指定する敵</label><select id="${prefix}Enemy" hidden></select>
    <button class="btn ghost" type="button" id="${prefix}Map" hidden>盤面で敵を選ぶ</button>
    <button class="btn primary" type="button" id="${prefix}Apply">指示する</button>
    <p class="tiny" id="${prefix}Note" role="status"></p>
    <p class="tiny">待機は追撃せず、距離維持は続けます。手動の進軍・待機では自動立て直しを行いません。立て直しでHPは回復しません。区域は標的の優先範囲です。</p></div>`;
}

/** @param {string} prefix 接頭辞。 @param {string} suffix 要素名。 @returns {HTMLElement|null} 要素。 */
function tacticalElement(prefix, suffix) { return document.getElementById(`${prefix}${suffix}`); }

/**
 * 画面要素を保持して、編集中の選択を描画ごとに戻さない。対象が失われたときだけ選択を解除する。
 * @param {object} state 戦場。 @param {object|null} unit 選択部隊。 @param {Array} roster 準備編成。
 * @param {Function} nameForType 兵種名。 @returns {void}
 */
export function syncTacticalPanels(state, unit, roster, nameForType) {
  for (const prefix of ["rosterTactical", "battleTacticalBulk", "battleTacticalUnit"]) {
    const editor = document.getElementById(`${prefix}Editor`);
    if (!editor) continue;
    const bulk = prefix !== "battleTacticalUnit";
    editor.hidden = prefix === "rosterTactical" ? state.started : bulk ? !state.started : !unit || unit.side !== "ally";
    const items = bulk ? (state.started ? state.units : roster).filter(canOrderTactics) : unit && canOrderTactics(unit) ? [unit] : [];
    if (bulk) {
      const picker = tacticalElement(prefix, "Recipients");
      const choices = formationOrderTargets(items, nameForType);
      const old = picker.value;
      const markup = `<option value="">対象を選択</option>` + choices.map(choice => `<option value="${choice.id}">${choice.name}（${choice.count}部隊）</option>`).join("");
      if (picker.innerHTML !== markup) picker.innerHTML = markup;
      picker.value = choices.some(choice => choice.id === old) ? old : "";
    }
    const enemy = tacticalElement(prefix, "Enemy");
    const oldEnemy = enemy.value;
    const enemyMarkup = tacticalEnemyOptions(state, oldEnemy);
    if (enemy.innerHTML !== enemyMarkup) { enemy.innerHTML = enemyMarkup; enemy.value = oldEnemy; }
    const field = tacticalElement(prefix, "Field"), order = tacticalElement(prefix, "Order");
    const recipients = bulk ? selectFormationOrderRecipients(items, tacticalElement(prefix, "Recipients").value) : items;
    if (!bulk && editor.dataset.unit !== unit?.id) {
      editor.dataset.unit = unit?.id || "";
      field.value = "actionOrder";
      order.innerHTML = tacticalOptions("actionOrder", unit?.pendingTacticalOrders?.actionOrder?.value ?? unit?.actionOrder);
      enemy.value = unit?.pendingTacticalOrders?.targetOrder?.focusEnemyId ?? unit?.focusEnemyId ?? "";
    }
    const focus = field.value === "targetOrder" && order.value === "focus";
    for (const suffix of ["Enemy", "EnemyLabel", "Map"]) tacticalElement(prefix, suffix).hidden = !focus;
    for (const suffix of ["Field", "Order", "Enemy", "Map", "Recipients"]) {
      const element = tacticalElement(prefix, suffix);
      if (element) element.disabled = !!state.result || !items.length || !!state.editing;
    }
    const apply = tacticalElement(prefix, "Apply");
    apply.disabled = !!state.result || !recipients.length || !!state.editing || (focus && !enemy.value);
    apply.textContent = `${recipients.length}部隊に指示`;
  }
  const cancel = document.getElementById("battleTacticalCancel");
  if (cancel) cancel.hidden = !state.focusSelection;
}

/** @param {object} callbacks 戦場・部隊・編成・操作の接続。 @returns {void} 個別と一括の指示欄を接続する。 */
export function wireTacticalPanels({ state, unit, roster, pause, sync, change, selectEnemy }) {
  for (const prefix of ["rosterTactical", "battleTacticalBulk", "battleTacticalUnit"]) {
    const editor = document.getElementById(`${prefix}Editor`);
    if (!editor) continue;
    const bulk = prefix !== "battleTacticalUnit";
    editor.insertAdjacentHTML("beforeend", tacticalEditorMarkup(prefix, bulk));
    /** @returns {Array} 操作時点の対象。 */
    const recipients = function () {
      const items = (state.started ? state.units : roster()).filter(canOrderTactics);
      return bulk ? selectFormationOrderRecipients(items, tacticalElement(prefix, "Recipients").value)
        : unit() && canOrderTactics(unit()) ? [unit()] : [];
    };
    editor.addEventListener("toggle", () => { if (editor.open && !editor.hidden) pause(); });
    editor.addEventListener("focusin", pause);
    for (const suffix of ["Field", "Order", "Enemy", "Recipients"]) tacticalElement(prefix, suffix)?.addEventListener("change", () => {
      pause();
      const field = tacticalElement(prefix, "Field");
      if (suffix === "Field") {
        const selected = !bulk ? unit()?.pendingTacticalOrders?.[field.value]?.value ?? unit()?.[field.value] : "auto";
        tacticalElement(prefix, "Order").innerHTML = field.value === "reset" ? `<option value="auto">おまかせ</option>` : tacticalOptions(field.value, selected);
      }
      tacticalElement(prefix, "Note").textContent = "";
      sync();
    });
    tacticalElement(prefix, "Apply").addEventListener("click", () => {
      const button = tacticalElement(prefix, "Apply");
      if (button.disabled) return;
      pause();
      const count = change(recipients(), tacticalElement(prefix, "Field").value, tacticalElement(prefix, "Order").value, tacticalElement(prefix, "Enemy").value || null);
      sync();
      tacticalElement(prefix, "Note").textContent = `${count}部隊へ指示しました。${state.started ? "再開すると反映します。" : ""}`;
    });
    tacticalElement(prefix, "Map").addEventListener("click", () => { pause(); selectEnemy(recipients()); });
  }
}

/** @param {CanvasRenderingContext2D} ctx 描画先。 @param {object} state 戦場。 @param {object|null} unit 選択部隊。 @param {number} cell マス幅。 @returns {void} 選択部隊だけの補助表示。 */
export function drawTacticalOverlay(ctx, state, unit, cell) {
  if (!unit || unit.status === "reserve" || !isBattleOnBoard(unit) || state.editing) return;
  ctx.save();
  const area = unit.targetAreaOrder === "auto" ? unit.tacticalTargetArea : unit.targetAreaOrder;
  ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,184,91,0.7)";
  for (let y = 0; y < state.size; y++) for (let x = 0; x < state.size; x++) {
    if (area && area !== "all" && tacticalArea(y, state.size) === area) {
      ctx.fillStyle = "rgba(112,218,255,0.09)"; ctx.fillRect(x * cell, y * cell, cell, cell);
    }
    if (isHostileZone({ x, y }, unit, state.units)) {
      ctx.beginPath(); ctx.moveTo(x * cell + 3, (y + 1) * cell - 3); ctx.lineTo((x + 1) * cell - 3, y * cell + 3); ctx.stroke();
    }
  }
  const focus = state.units.find(enemy => enemy.id === (unit.pendingTacticalOrders?.targetOrder?.focusEnemyId ?? unit.focusEnemyId) && isBattleActive(enemy));
  for (const [point, label, color] of [[focus, "標的", "#ffe18a"], [unit.regroupGoal, "後退先", "#9de8fc"]]) {
    if (!point) continue;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo((unit.x + 0.5) * cell, (unit.y + 0.5) * cell);
    ctx.lineTo((point.x + 0.5) * cell, (point.y + 0.5) * cell); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeRect(point.x * cell + 2, point.y * cell + 2, cell - 4, cell - 4);
    ctx.font = `${Math.max(10, cell * 0.18)}px sans-serif`; ctx.fillText(label, point.x * cell + 3, point.y * cell + cell * 0.7);
  }
  ctx.restore();
}
