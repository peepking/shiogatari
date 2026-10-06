/**
 * ルール要約と質問集の開閉・項目への案内をまとめる。
 * 読む操作だけを扱い、旅の状態や日付は変更しない。
 * @returns {void}
 */
export function wireGuideHelp() {
  const dialogs = [document.getElementById("helpModal"), document.getElementById("troubleModal")];
  let active = null;
  let opener = null;

  /** 説明を閉じ、最初に開いた操作へフォーカスを戻す。 @returns {void} */
  function closeGuide() {
    if (!active || active.hidden) return;
    active.hidden = true;
    active = null;
    opener?.focus();
  }

  /**
   * 説明を切り替え、指定された質問を展開して読み始める位置へ移す。
   * @param {HTMLElement} dialog 表示する説明。
   * @param {string} [topic] 展開する質問の識別子。
   * @returns {void}
   */
  function openGuide(dialog, topic) {
    if (!dialog) return;
    if (!active || active.hidden) opener = document.activeElement;
    dialogs.forEach(item => { if (item) item.hidden = item !== dialog; });
    active = dialog;
    dialog.querySelector(".modal-bd").scrollTop = 0;
    const question = topic && dialog.querySelector(`#${topic}`);
    if (question) {
      dialog.querySelectorAll(".guide-question").forEach(item => { item.open = item === question; });
      question.querySelector("summary").focus();
      question.scrollIntoView({ block: "nearest" });
    } else {
      dialog.querySelector(".modal-close").focus();
    }
  }

  document.getElementById("helpBtn")?.addEventListener("click", () => openGuide(dialogs[0]));
  document.getElementById("troubleBtn")?.addEventListener("click", () => openGuide(dialogs[1]));
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-guide-dialog]");
    if (!button) return;
    event.preventDefault();
    openGuide(dialogs.find(dialog => dialog?.id === button.dataset.guideDialog), button.dataset.guideTopic);
  });
  dialogs.forEach(dialog => {
    if (!dialog) return;
    dialog.querySelector(".modal-close").addEventListener("click", closeGuide);
    dialog.addEventListener("click", event => { if (event.target === dialog) closeGuide(); });
    dialog.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeGuide();
      } else if (event.key === "Tab") {
        const focusable = [...dialog.querySelectorAll("button, summary")].filter(item => item.getClientRects().length);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
  });
}
