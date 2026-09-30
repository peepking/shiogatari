/** 用途ごとの基本桁数。戦闘編成の既存48px欄とデバッグ欄は対象外にする。 */
const NUMBER_FIELDS = [
  { selector: '.hire-count, .troop-dismiss, [data-tide-type]', digits: 2 },
  { selector: '.trade-quantity, .event-trade-buy, .supply-discard', digits: 4 },
  { selector: '#bribeInput, #nationalPowerAmount, #tideFunds', digits: 6 },
  { selector: '#shipQuantity', digits: 2 },
];

/** 基本幅に符号1文字を確保し、現在値・上下限の桁数が多い場合は拡張する。 */
function fitNumberInput(input) {
  const field = NUMBER_FIELDS.find(row => input.matches(row.selector));
  if (!field) return;
  const digits = [input.value, input.min, input.max].reduce((largest, value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(largest, String(Math.trunc(Math.abs(number))).length) : largest;
  }, field.digits);
  input.classList.add('number-compact');
  input.dataset.numberWidth = String(Math.min(18, digits + 1));
}

/** 後から生成される入力欄も含め、追加された要素だけを調べて幅を設定する。 */
function fitNumberTree(root) {
  if (!(root instanceof Element)) return;
  if (root.matches('input[type="number"]')) fitNumberInput(root);
  root.querySelectorAll('input[type="number"]').forEach(fitNumberInput);
}

/** 数量欄の再生成・上限変更・手入力に追従する。表示用属性は監視せず再帰更新を防ぐ。 */
export function initNumberInputs() {
  fitNumberTree(document.body);
  document.addEventListener('input', event => {
    if (event.target.matches('input[type="number"]')) fitNumberInput(event.target);
  });
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') fitNumberTree(record.target);
      else record.addedNodes.forEach(fitNumberTree);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['min', 'max', 'value'] });
}
