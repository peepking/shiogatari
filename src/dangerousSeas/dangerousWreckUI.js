import { state } from "../core/state.js";
import { MODE_LABEL } from "../core/constants.js";
import { saveGameToStorage } from "../core/storage.js";
import { snapshotWorld, restoreWorld } from "../world/map.js";
import { advanceDayWithEvents } from "../app/time.js";
import { elements, pushToast } from "../ui/dom.js";
import { enqueueEvent } from "../app/events.js";
import { beginDangerousSeaAction, finishDangerousSeaAction } from "./dangerousSeaHazards.js";
import { dangerousWreckPending, chooseDangerousWreckStage, closeDangerousWreck, dangerousWreckHints } from "./dangerousWreck.js";

/** @returns {void} 固定した探索を保存できない時の再試行を案内する。 */
function saveFailure() { pushToast("保存できません", "保存容量を確認して探索を再開してください。", "warn"); }

/** @returns {boolean} 戦闘・結果画面を閉じる前の追加探索を止めるか。 */
function wreckScreenBlocked() {
  return !!((elements.battleBlock && !elements.battleBlock.hidden) || (elements.battleResultModal && !elements.battleResultModal.hidden) || state.wanted?.detention);
}

/** @param {object} pending 途中探索。 @param {boolean} [save=true] 呼出側の精算保存より前に保存するか。 @returns {boolean} 日次危険を先に解決するため段階探索を保留したか。 */
export function pauseDangerousWreckForHazard(pending, save = true) {
  if (!state.dangerousSeas.pendingHazard || state.dangerousSeas.pendingHazard.stage === "watch") return false;
  if (state.dangerousSeas.action?.kind === "exploration") finishDangerousSeaAction("exploration");
  pending.pausedForHazard = true;
  if (save && state.modeLabel !== MODE_LABEL.BATTLE && !state.pendingEncounter?.active && !saveGameToStorage()) saveFailure();
  return true;
}

/**
 * 保存済みの段階を一日ずつ再開する。甲板と追加枝の間にある危険は先に解決し、固定敵との戦闘を重ねない。
 * @param {Function} sync 表示同期。 @param {Function} finish 現在枝の精算。 @returns {boolean} 段階を再開したか。
 */
export function resumeDangerousWreck(sync, finish) {
  let pending = dangerousWreckPending(state.dangerousSeas);
  if (!pending || state.pendingEncounter?.active || state.modeLabel === MODE_LABEL.BATTLE || wreckScreenBlocked()) return false;
  if (pending.pausedForHazard) {
    if (state.dangerousSeas.pendingHazard && state.dangerousSeas.pendingHazard.stage !== "watch") { sync?.(); return false; }
    pending.pausedForHazard = false;
    if (!saveGameToStorage()) { pending.pausedForHazard = true; saveFailure(); sync?.(); return false; }
  }
  if (pending.wreck.stage === "choice") {
    pauseDangerousWreckForHazard(pending); sync?.(); return true;
  }
  if (!pending.dayApplied) {
    if (pauseDangerousWreckForHazard(pending)) { sync?.(); return false; }
    const before = structuredClone(state), world = structuredClone(snapshotWorld());
    if (!state.dangerousSeas.action && !beginDangerousSeaAction("exploration")) return false;
    if (!saveGameToStorage()) { Object.assign(state, before); saveFailure(); sync?.(); return false; }
    state.modeLabel = MODE_LABEL.NORMAL;
    const advanced = advanceDayWithEvents(1, { activity: "exploration", suppressDangerRaid: !!pending.encounter });
    if (advanced !== 1) { finishDangerousSeaAction("exploration"); sync?.(); return false; }
    pending = dangerousWreckPending(state.dangerousSeas);
    pending.dayApplied = true; pending.wreck.branches[pending.wreck.stage].appliedDays = 1;
    if (!saveGameToStorage()) {
      Object.assign(state, before); restoreWorld(world); saveFailure(); sync?.(); return false;
    }
  }
  pending = dangerousWreckPending(state.dangerousSeas);
  if (pending.wreck.stage !== "deck" && pauseDangerousWreckForHazard(pending)) { sync?.(); return false; }
  if (pending.encounter) {
    const previous = state.pendingEncounter, mode = state.modeLabel;
    state.pendingEncounter = structuredClone(pending.encounter); state.modeLabel = MODE_LABEL.PREP;
    if (!saveGameToStorage()) { state.pendingEncounter = previous; state.modeLabel = mode; saveFailure(); sync?.(); return false; }
    pushToast("難破船の待ち伏せ", "敵が潜んでいました。戦うか、逃走するかを選んでください。", "warn");
  } else {
    const before = structuredClone(state);
    state.modeLabel = MODE_LABEL.NORMAL;
    const resources = finish(true);
    if (!saveGameToStorage()) { Object.assign(state, before); saveFailure(); sync?.(); return false; }
    enqueueEvent({ title: pending.wreck.stage === "choice" ? "甲板の探索完了" : "船倉の探索完了",
      body: dangerousWreckPending(state.dangerousSeas) ? "甲板の積荷を回収。引き上げるか、追加1日で積荷または生存者を探せます。" : "探索を終えました。積載上限を超えた積荷・兵員は整理してください。", resources });
  }
  sync?.(); return true;
}

/** 選択と報酬の受取印を保存し、選び直しや二重回収を防ぐ。
 * @param {string} choice 引き上げ・積荷・救助。 @param {Function} sync 表示同期。 @param {Function} finish 現在枝の精算。
 * @returns {boolean} 選択を確定したか。
 */
export function chooseDangerousWreckBranch(choice, sync, finish) {
  const pending = dangerousWreckPending(state.dangerousSeas);
  if (!pending || pending.wreck.stage !== "choice" || state.modeLabel !== MODE_LABEL.NORMAL || state.pendingEncounter?.active || wreckScreenBlocked()
    || (state.dangerousSeas.pendingHazard && state.dangerousSeas.pendingHazard.stage !== "watch") || state.eventQueue?.length || !["leave", "cargo", "rescue"].includes(choice)) return false;
  const before = structuredClone(state);
  if (choice === "leave") {
    closeDangerousWreck(state.dangerousSeas); finishDangerousSeaAction("exploration");
    if (!saveGameToStorage()) { Object.assign(state, before); saveFailure(); sync?.(); return false; }
    enqueueEvent({ title: "難破船から引き上げ", body: "甲板で回収した積荷を持ち帰りました。" }); sync?.(); return true;
  }
  if (!chooseDangerousWreckStage(pending, choice) || !beginDangerousSeaAction("exploration")) { Object.assign(state, before); return false; }
  if (!saveGameToStorage()) { Object.assign(state, before); saveFailure(); sync?.(); return false; }
  document.dispatchEvent(new CustomEvent("auto-move-stop")); resumeDangerousWreck(sync, finish); return true;
}

/** @param {HTMLElement} button 既存探索ボタン。 @param {Function} sync 表示同期。 @param {Function} finish 現在枝の精算。 @returns {void} 段階選択を表示する。 */
export function renderDangerousWreckChoice(button, sync, finish) {
  const pending = dangerousWreckPending(state.dangerousSeas);
  let choices = document.getElementById("dangerousWreckChoices");
  if (!pending && !choices) return;
  if (!choices) { choices = document.createElement("div"); choices.id = "dangerousWreckChoices"; choices.className = "row"; button.after(choices); }
  choices.hidden = !!(!pending || pending.wreck.stage !== "choice" || pending.pausedForHazard || (state.dangerousSeas.pendingHazard && state.dangerousSeas.pendingHazard.stage !== "watch")
    || state.pendingEncounter?.active || state.modeLabel !== MODE_LABEL.NORMAL || state.eventQueue?.length || wreckScreenBlocked());
  if (choices.hidden) return;
  choices.innerHTML = "";
  for (const [id, text] of [["leave", "甲板の積荷を持って引き上げ"], ["cargo", "船倉の積荷を回収（追加1日）"], ["rescue", "生存者を救助（追加1日）"]]) {
    const option = document.createElement("button"); option.className = "btn"; option.textContent = text;
    option.onclick = () => chooseDangerousWreckBranch(id, sync, finish); choices.append(option);
  }
  const hints = document.createElement("p"); hints.className = "tiny"; hints.textContent = `積荷か救助、どちらか一方を選べます。\n${dangerousWreckHints(pending)}`; choices.append(hints);
}
