/** 数量入力をタップ用ボタンで囲む。 */
export function quantityControl(input, reset = false, singleStep = false) {
  if (singleStep) return `<div class="quantity-control quantity-single"><button class="btn" type="button" data-step="-1" aria-label="人数を1減らす">−</button>${input}<button class="btn" type="button" data-step="1" aria-label="人数を1増やす">＋</button></div>`;
  return `<div class="quantity-control"><button class="btn" type="button" data-step="-5" aria-label="数量を5減らす">−5</button><button class="btn" type="button" data-step="-1" aria-label="数量を1減らす">−</button>${input}<button class="btn" type="button" data-step="1" aria-label="数量を1増やす">＋</button><button class="btn" type="button" data-step="5" aria-label="数量を5増やす">＋5</button>${reset ? '<button type="button" data-reset class="btn quantity-reset">リセット</button><output class="quantity-description">取引なし</output>' : ''}</div>`;
}

/** 数量ボタンの端制限と操作結果を更新する。 */
export function refreshQuantity(input) {
  const control = input.closest('.quantity-control');
  if (!control) return;
  const value = Number(input.value) || 0;
  control.querySelectorAll('[data-step]').forEach(button => {
    button.disabled = input.disabled || (Number(button.dataset.step) < 0 ? value <= Number(input.min) : value >= Number(input.max));
  });
  const output = control.querySelector('output');
  if (output) output.textContent = value > 0 ? `購入${value}個` : value < 0 ? `売却${-value}個` : '取引なし';
}

/** 既存の入力イベントを利用して数量ボタンを配線する。 */
export function wireQuantityControls(root) {
  if (!root || root.dataset.quantityWired) return;
  root.dataset.quantityWired = '1';
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-step], [data-reset]');
    if (!button) return;
    const input = button.closest('.quantity-control').querySelector('input');
    if (input.disabled) return;
    const next = button.hasAttribute('data-reset') ? 0 : (Number(input.value) || 0) + Number(button.dataset.step);
    input.value = String(Math.max(Number(input.min), Math.min(Number(input.max), Math.trunc(next))));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    refreshQuantity(input);
  });
  root.addEventListener('change', event => {
    const input = event.target;
    if (!input.matches('.quantity-control input')) return;
    if (!input.value && !input.validity.badInput) input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
