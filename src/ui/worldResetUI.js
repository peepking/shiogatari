/**
 * シード入力・ランダム生成・確定操作をリセット用モーダルへ接続する。
 * @param {{defaultSeed:number,onReset:Function,openModal:Function,closeModal:Function}} options 初期値とリセット処理。
 * @returns {void}
 */
export function wireWorldResetUI({ defaultSeed, onReset, openModal, closeModal }) {
  const trigger = document.getElementById("resetBtn");
  const modal = document.getElementById("resetModal");
  const form = document.getElementById("resetForm");
  const input = document.getElementById("resetSeedInput");
  const randomButton = document.getElementById("resetSeedRandom");
  const error = document.getElementById("resetSeedError");
  const closeButton = document.getElementById("resetModalClose");
  const cancelButton = document.getElementById("resetCancel");
  const confirmButton = document.getElementById("resetConfirm");
  if (!trigger || !modal || !form || !input || !randomButton || !error || !closeButton || !cancelButton || !confirmButton) return;
  if (modal.dataset.bound === "true") return;
  modal.dataset.bound = "true";

  /** 入力エラーを消去する。 @returns {void} */
  function clearError() {
    error.textContent = "";
    input.removeAttribute("aria-invalid");
  }

  let onCancel = null;
  let returnFocus = trigger;
  /** 既定のシードで入力を開始し、ゲーム状態は確定まで維持する。 @param {Event} event 開く操作。 @returns {void} */
  function open(event) {
    onCancel = event?.detail?.onCancel || null;
    returnFocus = event?.detail?.returnFocus || trigger;
    input.value = String(defaultSeed);
    clearError();
    openModal(modal);
    input.focus();
    input.select();
  }

  /** モーダルを閉じて元のボタンへフォーカスを戻す。 @returns {void} */
  function close() {
    closeModal(modal);
    returnFocus.focus();
    const callback = onCancel;
    onCancel = null;
    callback?.();
  }

  /** 0〜4294967295の整数を等確率で抽選し、入力欄だけを更新する。 @returns {void} */
  function generateSeed() {
    input.value = String(Math.floor(Math.random() * 0x100000000));
    clearError();
    input.focus();
    input.select();
  }

  /** 入力を検証し、確定時だけリセットする。 @param {SubmitEvent} event 送信イベント。 @returns {void} */
  function submit(event) {
    event.preventDefault();
    if (modal.hidden) return;
    const value = input.value.trim();
    const seed = value === "" ? defaultSeed : Number(value);
    if ((value !== "" && !/^\d+$/.test(value)) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      error.textContent = "シード値は0〜4294967295の整数で入力してください。";
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    onCancel = null;
    close();
    onReset(seed);
  }

  /** 背景を押すと入力を取り消す。 @param {MouseEvent} event クリック。 @returns {void} */
  function backdropClick(event) {
    if (event.target === modal) close();
  }

  /** Escapeで取り消し、Tabの移動先をモーダル内に保つ。 @param {KeyboardEvent} event キー操作。 @returns {void} */
  function keydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      const first = closeButton;
      const last = confirmButton;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  trigger.addEventListener("click", open);
  randomButton.addEventListener("click", generateSeed);
  input.addEventListener("input", clearError);
  form.addEventListener("submit", submit);
  closeButton.addEventListener("click", close);
  cancelButton.addEventListener("click", close);
  modal.addEventListener("click", backdropClick);
  modal.addEventListener("keydown", keydown);
  modal.addEventListener("world-reset-open", open);
}

/** 最終航海から共通のシード入力を開く。 @param {object} options 取消時の戻り先とフォーカス。 */
export function openWorldResetDialog(options = {}) {
  document.getElementById("resetModal")?.dispatchEvent(new CustomEvent("world-reset-open", { detail: options }));
}
