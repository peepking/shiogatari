import { UNIT_FORMATIONS, normalizeFormationOrder, unitFormation, unitFormationDescription } from "./battleUnitFormation.js";
import { formationOrderRecipients, formationOrderTargets, selectFormationOrderRecipients } from "./battleUnitFormationOrders.js";

/** @param {string} order 指示。 @returns {string} 表示名。 */
export function formationOrderName(order) {
  return order === "auto" ? "おまかせ" : UNIT_FORMATIONS[normalizeFormationOrder(order)].name;
}

/** @param {string} order 選択中の指示。 @returns {string} 指示の選択肢。 */
export function formationOptions(order) {
  return [...Object.entries(UNIT_FORMATIONS).map(([id, def]) => [id, def.name]), ["auto", "おまかせ"]]
    .map(([id, name]) => `<option value="${id}"${id === normalizeFormationOrder(order) ? " selected" : ""}>${name}</option>`).join("");
}

/** @param {object} unit 部隊。 @param {object} state 戦闘状態。 @returns {string} 指示と補正の説明。 */
export function formationInfoMarkup(unit, state) {
  const waiting = unit.status === "reserve";
  const auto = unit.formationOrder === "auto";
  const current = (waiting || !state.started) && auto ? (waiting ? "登場時に判断" : "戦闘開始時に判断") : unitFormation(unit).name;
  const pending = unit.pendingFormationOrder != null
    ? `${formationOrderName(unit.pendingFormationOrder)}を予約：tick ${Math.max(state.tick + 1, unit.formationChangeAt || 1)}から`
    : waiting ? "登場時に適用" : state.started && state.tick + 1 < unit.formationChangeAt
      ? `切り替え可能：tick ${unit.formationChangeAt}から` : "切り替え待ちなし";
  return `<div>指示 ${formationOrderName(unit.formationOrder)} / 現在の陣形 ${current}</div>`
    + `<div>${(waiting || !state.started) && auto ? "攻防補正は陣形の判断時に確定します" : unitFormationDescription(unit)}</div><div>${pending}</div>`
    + (auto && unit.formationReason ? `<div>判断理由：${unit.formationReason}</div>` : "");
}

/**
 * 部隊一覧と指示欄を同期する。詳細を見るだけでは停止せず、指示欄のDOMを保持して複数部隊を操作できる。
 * @param {object} state 戦闘状態。 @param {object|null} unit 詳細表示中の部隊。 @returns {void}
 */
export function syncUnitFormationPanel(state, unit) {
  const picker = document.getElementById("battleUnitSelect");
  const editor = document.getElementById("battleUnitFormationEditor");
  const order = document.getElementById("battleUnitFormationOrder");
  if (!picker || !editor || !order) return;
  const options = state.units.filter(item => item.side === "ally").map((item, index) =>
    `<option value="${item.id}">${index + 1}. ${item.status === "reserve" ? "予備 " : ""}${item.name} ${item.count}人${item.status === "routing" ? "・敗走" : item.hp <= 0 ? "・撃破" : item.status === "escaped" ? "・退出" : ""}</option>`).join("");
  const markup = `<option value="">部隊を選択</option>${options}`;
  if (picker.innerHTML !== markup) picker.innerHTML = markup;
  picker.value = unit?.side === "ally" ? unit.id : "";
  editor.hidden = !unit || unit.side !== "ally";
  const disabled = !!state.result || !unit || unit.hp <= 0 || ["routing", "escaped", "destroyed"].includes(unit.status);
  order.disabled = disabled;
  if (!order.options.length) order.innerHTML = formationOptions("line");
  order.value = normalizeFormationOrder(unit?.pendingFormationOrder ?? unit?.formationOrder);
  const note = document.getElementById("battleUnitFormationNote");
  if (note) note.textContent = disabled ? "この部隊への指示は終了しています。"
    : state.started ? "指示は次の切り替え可能な時点で適用します。複数部隊へ指示した後、再開してください。"
      : "部隊ごとに設定できます。おまかせは戦闘開始時に判断します。";
}

/** @param {object} callbacks 停止・部隊選択・指示変更の接続。 @returns {void} */
export function wireUnitFormationPanel({ pause, select, change }) {
  const picker = document.getElementById("battleUnitSelect");
  const editor = document.getElementById("battleUnitFormationEditor");
  const order = document.getElementById("battleUnitFormationOrder");
  picker?.addEventListener("change", () => select(picker.value));
  editor?.addEventListener("toggle", () => { if (editor.open && !editor.hidden) pause(); });
  order?.addEventListener("focus", pause);
  order?.addEventListener("change", () => { pause(); change(order.value); });
}

/**
 * 一括指示の選択肢と対象数を同期する。対象消滅時は未選択へ戻し、意図せず全体へ広げない。
 * @param {string} prefix 準備または戦闘の要素ID接頭辞。 @param {Array} items 編成または部隊。
 * @param {object} context 開始状態・無効状態・兵種名取得。 @returns {void}
 */
export function syncBulkFormationPanel(prefix, items, { started, disabled, nameForType, reserveItems = [] }) {
  const target = document.getElementById(`${prefix}Target`);
  const order = document.getElementById(`${prefix}Order`);
  const button = document.getElementById(`${prefix}Apply`);
  const note = document.getElementById(`${prefix}Note`);
  const feedback = document.getElementById(`${prefix}Feedback`);
  if (!target || !order || !button || !note) return;
  const recipients = formationOrderRecipients(items, started);
  const choices = formationOrderTargets(recipients, nameForType);
  const previous = target.value;
  const options = choices.map(choice => `<option value="${choice.id}">${choice.name}（${choice.count}部隊）</option>`);
  const boundary = choices.findIndex(choice => choice.individual);
  const groups = options.slice(0, boundary < 0 ? options.length : boundary).join("");
  const types = boundary < 0 ? "" : `<optgroup label="兵種別">${options.slice(boundary).join("")}</optgroup>`;
  const markup = `<option value="">対象を選択</option><optgroup label="まとめて選択">${groups}</optgroup>${types}`;
  if (target.innerHTML !== markup) target.innerHTML = markup;
  target.value = choices.some(choice => choice.id === previous) ? previous : "";
  if (!order.options.length) {
    order.innerHTML = `<option value="">陣形を選択</option>${formationOptions("line")}`;
    order.value = "";
  }
  const selected = selectFormationOrderRecipients(recipients, target.value);
  const reserve = selected.filter(item => item.status === "reserve" || reserveItems.includes(item)).length;
  target.disabled = !!disabled || !recipients.length;
  order.disabled = !!disabled || !recipients.length;
  button.disabled = !!disabled || !selected.length || !order.value;
  button.textContent = `${selected.length}部隊に指示`;
  if (disabled && feedback) feedback.textContent = "";
  note.textContent = disabled ? "この画面からの指示は終了しています。"
    : `${selected.length}部隊（前衛${selected.length - reserve}・予備隊${reserve}）が対象です。`
      + (started ? "盤上の部隊は各自の切り替え可能な時点で適用します。指示後に再開してください。"
        : "前衛と予備隊の両方が対象です。対象と陣形を選んで指示してください。");
}

/** @param {string} prefix 要素ID接頭辞。 @param {object} callbacks 停止・同期・一括指示。 @returns {void} */
export function wireBulkFormationPanel(prefix, { pause, sync, change }) {
  const editor = document.getElementById(`${prefix}Editor`);
  const target = document.getElementById(`${prefix}Target`);
  const order = document.getElementById(`${prefix}Order`);
  const button = document.getElementById(`${prefix}Apply`);
  const feedback = document.getElementById(`${prefix}Feedback`);
  editor?.addEventListener("toggle", () => { if (editor.open && !editor.hidden) pause(); });
  target?.addEventListener("focus", pause);
  order?.addEventListener("focus", pause);
  for (const select of [target, order]) select?.addEventListener("change", () => {
    if (feedback) feedback.textContent = "";
    sync();
  });
  button?.addEventListener("click", () => {
    if (button.disabled) return;
    pause();
    const count = change(target.value, order.value);
    sync();
    if (feedback && count) feedback.textContent = `${count}部隊に${formationOrderName(order.value)}を指示しました。`;
  });
}
