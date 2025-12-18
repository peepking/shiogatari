import { nowStr, escapeHtml, formatGameTime } from "./util.js";
import { state } from "./state.js";

/**
 * 指定IDの要素を取得する。
 * @param {string} id
 * @returns {HTMLElement|null}
 */
export const $ = (id) => document.getElementById(id);

/**
 * 画面要素の参照一覧。
 * @type {object}
 */
export const elements = {
  shipsEl: $("ships"),
  troopsEl: $("troops"),
  faithEl: $("faith"),
  suppliesEl: $("supplies"),
  fundsEl: $("funds"),
  fameEl: $("fame"),
  modeLabelEl: $("modeLabel"),
  locationLabelEl: $("locationLabel"),
  gameTimeEl: $("gameTime"),
  ctxEl: $("context"),
  shipsIn: $("shipsIn"),
  troopsIn: $("troopsIn"),
  faithIn: $("faithIn"),
  suppliesIn: $("suppliesIn"),
  fundsIn: $("fundsIn"),
  fameIn: $("fameIn"),
  silenceIn: $("silenceIn"),
  outTitle: $("opTitle"),
  outText: $("opText"),
  tag1: $("tag1"),
  tag2: $("tag2"),
  logEl: $("log"),
  assetImgs: {
    ships: $("assetShipsImg"),
    troops: $("assetTroopsImg"),
    faith: $("assetFaithImg"),
    supplies: $("assetSuppliesImg"),
    funds: $("assetFundsImg"),
    fame: $("assetFameImg"),
  },
  factionListEl: $("factionList"),
  noblePanel: $("noblePanel"),
  nobleFactionName: $("nobleFactionName"),
  nobleListEl: $("nobleList"),
  nobleDetail: $("nobleDetail"),
  closeNoblesBtn: $("closeNobles"),
  mapCanvas: $("mapCanvas"),
  mapToggle: $("mapToggle"),
  mapInfo: $("mapInfo"),
  mapPosLabel: $("mapPosLabel"),
  tradeBtn: $("tradeBtn"),
  shipTradeBtn: $("shipTradeBtn"),
  questOpenBtn: $("questOpenBtn"),
  hireBtn: $("hireBtn"),
  oracleBtn: $("oracleBtn"),
  modeWaitBtn: $("modeWaitBtn"),
  modePrayBtn: $("modePrayBtn"),
  tradeModal: $("tradeModal"),
  tradeModalClose: $("tradeModalClose"),
  tradeTableBody: $("tradeTableBody"),
  tradeConfirm: $("tradeConfirm"),
  tradeDelta: $("tradeDelta"),
  tradeFunds: $("tradeFunds"),
  tradeError: $("tradeError"),
  shipTradeModal: $("shipTradeModal"),
  shipTradeModalClose: $("shipTradeModalClose"),
  shipTradeTableBody: $("shipTradeTableBody"),
  shipTradeConfirm: $("shipTradeConfirm"),
  shipTradeDelta: $("shipTradeDelta"),
  shipTradeFunds: $("shipTradeFunds"),
  shipTradeError: $("shipTradeError"),
  enterVillageBtn: $("enterVillageBtn"),
  enterTownBtn: $("enterTownBtn"),
  exitVillageBtn: $("exitVillageBtn"),
  exitTownBtn: $("exitTownBtn"),
  toastContainer: $("toastContainer"),
  confirmModal: $("confirmModal"),
  confirmTitle: $("confirmTitle"),
  confirmBody: $("confirmBody"),
  confirmOk: $("confirmOk"),
  confirmCancel: $("confirmCancel"),
  confirmClose: $("confirmClose"),
  questBody: $("questBody"),
  questList: $("questList"),
  questModal: $("questModal"),
  questModalClose: $("questModalClose"),
  questModalBody: $("questModalBody"),
  hireModal: $("hireModal"),
  hireModalClose: $("hireModalClose"),
  hireTableBody: $("hireTableBody"),
  hireConfirm: $("hireConfirm"),
  hireError: $("hireError"),
  hireFunds: $("hireFunds"),
  hireDelta: $("hireDelta"),
  memoBox: $("memoBox"),
  memo: $("memo"),
  manualModal: $("manualModal"),
  manualModalClose: $("manualModalClose"),
  manualModalBtn: $("manualModalBtn"),
  helpModal: $("helpModal"),
  helpModalClose: $("helpModalClose"),
  loreModal: $("loreModal"),
  loreModalClose: $("loreModalClose"),
  endingsModal: $("endingsModal"),
  endingsModalClose: $("endingsModalClose"),
  troopsModal: $("troopsModal"),
  troopsModalClose: $("troopsModalClose"),
  troopsDetail: $("troopsDetail"),
  suppliesModal: $("suppliesModal"),
  suppliesModalClose: $("suppliesModalClose"),
  suppliesDetail: $("suppliesDetail"),
};

/**
 * 出力欄のタグ表示を更新する。
 * @param {{text:string,kind?:string}|undefined} tag1Data
 * @param {{text:string,kind?:string}|undefined} tag2Data
 */
export function setTags(tag1Data, tag2Data) {
  const apply = (el, obj) => {
    if (!el) return;
    el.className = "tag" + (obj?.kind ? " " + obj.kind : "");
    el.querySelector("span").textContent = obj?.text ?? "-";
  };
  apply(elements.tag1, tag1Data);
  apply(elements.tag2, tag2Data);
}

/**
 * 出力欄のタイトル/本文/タグを更新する。
 * @param {string} title
 * @param {string} text
 * @param {Array} tags
 */
export function setOutput(title, text, tags) {
  if (elements.outTitle) elements.outTitle.textContent = title;
  if (elements.outText) elements.outText.textContent = text;
  setTags(tags?.[0], tags?.[1]);
}

/**
 * ログに新しい項目を追加する。
 * @param {string} title
 * @param {string} body
 * @param {string} lastRollDisplay
 */
export function pushLog(title, body, lastRollDisplay = "-") {
  if (!elements.logEl) return;
  const gameTime = formatGameTime(state);
  const realTime = nowStr();
  const item = document.createElement("div");
  item.className = "logitem";
  item.innerHTML = `
      <div class="top">
        <div>
          <div class="what">${escapeHtml(title)}</div>
          <div class="when">${escapeHtml(gameTime)}</div>
        </div>
      </div>
      <div class="txt">${escapeHtml(body)}</div>
      <div class="when mt-6">${escapeHtml(realTime)}</div>
    `;
  elements.logEl.prepend(item);
}

/**
 * トースト通知を表示する。
 * @param {string} title
 * @param {string} body
 * @param {string} kind
 * @param {number} duration
 */
export function pushToast(title, body, kind = "info", duration = 4000) {
  const box = elements.toastContainer;
  if (!box) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `
    <div class="toast-title">${escapeHtml(title)}</div>
    <div class="toast-body">${escapeHtml(body)}</div>
  `;
  box.appendChild(el);
  requestAnimationFrame(() => {
    el.classList.remove("hide");
  });
  const remove = () => {
    el.classList.add("hide");
    setTimeout(() => el.remove(), 250);
  };
  const timeout = setTimeout(remove, duration);
  el.addEventListener("mouseenter", () => clearTimeout(timeout));
  el.addEventListener("mouseleave", () => {
    setTimeout(remove, 800);
  });
}

let confirmReady = false;
let confirmHandler = null;

/**
 * 確認モーダル（またはフォールバックのダイアログ）を表示する。
 * @param {{title:string,body:string,confirmText?:string,cancelText?:string,onConfirm?:Function}} params
 */
export function confirmAction({ title, body, confirmText = "実行", cancelText = "キャンセル", onConfirm }) {
  const modal = elements.confirmModal;
  // 確認モーダルが無い場合は標準ダイアログにフォールバックする。
  if (!modal) {
    if (window.confirm(`${title}\n${body}`)) onConfirm?.();
    return;
  }
  if (!confirmReady) {
    confirmReady = true;
    const close = () => {
      modal.hidden = true;
      confirmHandler = null;
    };
    elements.confirmCancel?.addEventListener("click", close);
    elements.confirmClose?.addEventListener("click", close);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });
    elements.confirmOk?.addEventListener("click", () => {
      const cb = confirmHandler;
      close();
      cb?.();
    });
  }
  if (elements.confirmTitle) elements.confirmTitle.textContent = title || "確認";
  if (elements.confirmBody) elements.confirmBody.textContent = body || "";
  if (elements.confirmOk) elements.confirmOk.textContent = confirmText;
  if (elements.confirmCancel) elements.confirmCancel.textContent = cancelText;
  confirmHandler = onConfirm;
  modal.hidden = false;
}
