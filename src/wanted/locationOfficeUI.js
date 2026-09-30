import { state } from "../core/state.js";
import { canManageIdentity } from "./identityPolicy.js";
import { wantedSettlement, appendWantedActions, appendIdentityActions } from "./wantedUI.js";
import { appendTheftActions } from "./settlementCrimeUI.js";

/** 交渉・犯罪・所属を別々の入口から表示する。状態変更後は利用条件を再確認する。
 * @param {string} kind 表示種別。 @param {Function} sync 画面同期。 @returns {void}
 */
function openOffice(kind, sync) {
  const modal = document.getElementById("locationOfficeModal"), body = document.getElementById("locationOfficeBody");
  if (!modal || !body || !canManageIdentity(state) || (kind !== "identity" && !wantedSettlement())) return;
  const previous = document.activeElement;
  /** 閉じた後は元の操作へフォーカスを戻す。 @returns {void} */
  function close() { modal.hidden = true; previous?.focus(); }
  /** 処理完了後、戦闘などに移行したら窓口を閉じる。 @returns {void} */
  function refresh() {
    sync();
    if (!canManageIdentity(state) || (kind !== "identity" && !wantedSettlement())) { close(); return; }
    render();
  }
  /** 選択した窓口の内容だけを再描画する。 @returns {void} */
  function render() {
    body.replaceChildren();
    document.getElementById("locationOfficeTitle").textContent = kind === "identity" ? "所属・身分" : `${wantedSettlement().name} — ${kind === "crime" ? "裏の行動" : "窓口で交渉"}`;
    if (kind === "identity") appendIdentityActions(body, refresh);
    else if (kind === "office") appendWantedActions(body, refresh);
    else {
      appendTheftActions(body, wantedSettlement, refresh);
      if (state.honorFactions?.length) {
        const button = document.createElement("button"); button.className = "btn"; button.textContent = "所属・身分を確認";
        button.onclick = () => openOffice("identity", sync); body.append(button);
      }
    }
  }
  document.getElementById("locationOfficeClose").onclick = close;
  modal.onclick = event => { if (event.target === modal) close(); };
  modal.onkeydown = event => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
  render(); modal.hidden = false; document.getElementById("locationOfficeClose").focus();
}

/** 入口でも交渉・襲撃を残し、所属変更はフィールドにも表示する。 @param {Function} sync 画面同期。 @returns {void} */
export function renderOfficeControls(sync) {
  for (const [id, kind] of [["locationOfficeBtn", "office"], ["locationCrimeBtn", "crime"], ["identityOpenBtn", "identity"]]) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.hidden = kind !== "identity" && !wantedSettlement();
    button.disabled = !canManageIdentity(state);
    button.onclick = () => openOffice(kind, sync);
  }
}
