import { state } from "./state.js";
import { setOutput, pushLog } from "./dom.js";
import { getSettlementAtPosition, getLocationStatus } from "./map.js";
import { calcSupplyCap, totalSupplies } from "./supplies.js";
import { calcTroopCap, totalTroops } from "./troops.js";
import { advanceDayWithEvents } from "./time.js";

/**
 * 移動が可能か（上下左右1マス）を判定する。
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @returns {boolean}
 */
export function isValidMove(from, to) {
  if (!to) return false;
  const dx = Math.abs((to.x ?? 0) - (from.x ?? 0));
  const dy = Math.abs((to.y ?? 0) - (from.y ?? 0));
  // 上下左右方向で最大1マスまで移動可
  if (dx === 0 && dy === 1) return true;
  if (dy === 0 && dx === 1) return true;
  return false;
}

/**
 * 選択マスへ移動し、可能なら1日進める。
 * @param {Function} showActionMessage
 * @param {Function} syncUI
 * @returns {boolean}
 */
export function moveToSelected(showActionMessage, syncUI) {
  if (state.modeLabel === "村の中" || state.modeLabel === "街の中") {
    showActionMessage?.("今は移動できません。村/街を出てから移動してください。", "error");
    return false;
  }
  // 物資/部隊が上限を超えている場合は移動を封じ、破棄/解雇を促す。
  const supplyTotal = totalSupplies();
  const supplyCap = calcSupplyCap(state.ships);
  if (supplyTotal > supplyCap) {
    setOutput("移動不可", `物資が上限を超えています（${supplyTotal}/${supplyCap}）。`, [
      { text: "物資超過", kind: "warn" },
      { text: "破棄が必要", kind: "warn" },
    ]);
    showActionMessage?.("物資が上限を超えています。破棄してください。", "error");
    return false;
  }
  const troopTotal = totalTroops();
  const troopCap = calcTroopCap(state.ships);
  if (troopTotal > troopCap) {
    setOutput("移動不可", `部隊が上限を超えています（${troopTotal}/${troopCap}）。`, [
      { text: "部隊超過", kind: "warn" },
      { text: "解雇が必要", kind: "warn" },
    ]);
    showActionMessage?.("部隊が上限を超えています。解雇してください。", "error");
    return false;
  }
  const dest = state.selectedPosition;
  if (!dest) {
    setOutput("移動不可", "移動先が選択されていません。", [
      { text: "移動", kind: "warn" },
      { text: "選択必須", kind: "warn" },
    ]);
    showActionMessage?.("移動先を選択してください。", "error");
    return false;
  }
  if (!isValidMove(state.position, dest)) {
    setOutput("移動不可", "現在地の上下左右1マスのみ移動できます。", [
      { text: "範囲外", kind: "warn" },
      { text: "移動", kind: "" },
    ]);
    showActionMessage?.("移動できるのは上下左右1マス以内です。", "error");
    return false;
  }
  state.position = { ...dest };
  advanceDayWithEvents(1);
  setOutput("移動", `(${dest.x + 1}, ${dest.y + 1}) へ移動しました。`, [
    { text: "移動", kind: "" },
    { text: "日数+1", kind: "" },
  ]);
  pushLog("移動", `選択マスへ移動 (${dest.x + 1}, ${dest.y + 1})`, state.lastRoll ?? "-");
  showActionMessage?.("", "info");
  syncUI?.();
  return true;
}

/**
 * 村/街に入る処理を行い、モードを更新する。
 * @param {"village"|"town"} target
 * @param {Function} clearActionMessage
 * @param {Function} syncUI
 * @returns {boolean}
 */
export function attemptEnter(target, clearActionMessage, syncUI) {
  const loc = getLocationStatus();
  const targetPlace = target === "village" ? "村" : "街";
  const insideLabel = target === "village" ? "村の中" : "街の中";
  if (loc?.place !== targetPlace) {
    setOutput("入場できません", `${targetPlace}にいません。`, [
      { text: targetPlace, kind: "warn" },
      { text: "移動が必要", kind: "warn" },
    ]);
    return false;
  }
  state.modeLabel = insideLabel;
  setOutput("入場", `${targetPlace}に入りました。`, [
    { text: targetPlace, kind: "" },
    { text: "滞在", kind: "" },
  ]);
  pushLog("入場", `${targetPlace}に入りました`, state.lastRoll ?? "-");
  clearActionMessage?.();
  syncUI?.();
  return true;
}

/**
 * 村/街から出る処理を行い、通常モードへ戻す。
 * @param {"village"|"town"} target
 * @param {object} elements
 * @param {Function} clearActionMessage
 * @param {Function} setTradeError
 * @param {Function} syncUI
 * @returns {boolean}
 */
export function attemptExit(target, elements, clearActionMessage, setTradeError, syncUI) {
  const label = target === "village" ? "村の中" : "街の中";
  const place = target === "village" ? "村" : "街";
  if (state.modeLabel !== label) {
    setOutput("出られません", `${label}ではありません。`, [
      { text: "場所", kind: "warn" },
      { text: "移動が必要", kind: "warn" },
    ]);
    return false;
  }
  state.modeLabel = "通常";
  setOutput("出発", `${place}を出ました。`, [
    { text: "移動", kind: "" },
    { text: "通常", kind: "" },
  ]);
  pushLog("出発", `${place}を出ました`, state.lastRoll ?? "-");
  if (elements?.ctxEl) elements.ctxEl.value = "move";
  clearActionMessage?.();
  setTradeError?.("");
  syncUI?.();
  return true;
}

/**
 * 移動せずに1日進める。
 * @param {object} elements
 * @param {Function} clearActionMessage
 * @param {Function} syncUI
 */
export function waitOneDay(elements, clearActionMessage, syncUI) {
  advanceDayWithEvents(1);
  setOutput("待機", "1日待機しました。", [
    { text: "待機", kind: "" },
    { text: "日数+1", kind: "" },
  ]);
  pushLog("待機", "1日待機", state.lastRoll ?? "-");
  clearActionMessage?.();
  if (elements?.ctxEl) elements.ctxEl.value = "move";
  syncUI?.();
}

/**
 * 現在地にある拠点を返す。
 * @returns {object|null}
 */
export function getCurrentSettlement() {
  return getSettlementAtPosition(state.position.x, state.position.y);
}
