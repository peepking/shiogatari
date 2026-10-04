import { handleTravelEventAction, isBattleEventActionBlocked } from "./actions.js";
import { elements } from "../ui/dom.js";
import { addHonorFaction, addWarScore, adjustNobleFavor, adjustSupport, getPlayerFactionId } from "../factions/faction.js";
import { state } from "../core/state.js";
import { scheduleGameSave } from "../core/storage.js";
import { resourceList } from "../ui/resourceUI.js";
import { crimeRestriction } from "../wanted/wantedPolicy.js";
import { resolveRoughWave } from "../dangerousSeas/dangerousSeaState.js";
import { pushLog } from "../ui/dom.js";
import { handleDangerousRaidAction } from "../dangerousSeas/dangerousSeaHazards.js";
import { handleDangerousSeaEventAction } from "../dangerousSeas/dangerousSeaEventUI.js";

/**
 * イベントキューにイベントを追加し、未表示なら即座に表示する。
 * @param {{title?:string,body?:string,resources?:Array,kind?:string,actions?:Array<{id?:string,label?:string,type?:string,payload?:any}>}} evt
 */
export function enqueueEvent(evt) {
  ensureQueue();
  const id = state.eventSeq++;
  const normalized = {
    id,
    title: evt?.title || "イベント",
    body: evt?.body || "",
    resources: Array.isArray(evt?.resources) ? evt.resources : [],
    kind: evt?.kind || "info",
    createdAt: Date.now(),
    actions: normalizeActions(evt?.actions, id),
  };
  state.eventQueue.push(normalized);
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("auto-move-stop"));
  }
  showNextEvent();
  scheduleGameSave();
}

/**
 * イベントモーダルのUI初期化。ロード時にキューがあれば表示する。
 */
export function initEventQueueUI() {
  const modal = elements.eventModal;
  if (!modal) return;
  if (modal.dataset.bound === "true") return;
  modal.dataset.bound = "true";
  elements.eventModalClose?.addEventListener("click", () => resolveCurrentEvent());
  modal.addEventListener("click", (e) => {
    if (e.target === modal) resolveCurrentEvent();
  });
  elements.eventModalActions?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action-id]");
    if (!btn) return;
    const actionId = btn.dataset.actionId;
    const current = state.eventQueue?.[0];
    const action = current?.actions?.find((a) => a.id === actionId);
    handleAction(action);
  });
  if (state.eventQueue?.length) {
    showNextEvent();
  }
}

  /**
   * 現在のイベントを解決し、次のイベントを表示する。
   * @param {boolean} force 行動処理済みの場合だけ、未解決検問の閉じる制限を解除する。
   * @returns {void}
   */
export function resolveCurrentEvent(force = false) {
  ensureQueue();
  if (!force && state.piracy?.checkpoint && state.eventQueue[0]?.actions?.some(a => a.type?.startsWith("pirate_"))) return;
  if (!force && state.eventQueue[0]?.kind === "dangerous_wave" && state.dangerousSeas?.pendingHazard) return;
  if (!force && state.eventQueue[0]?.kind === "dangerous_raid_warning" && state.dangerousSeas?.pendingHazard) return;
  if (!force && state.eventQueue[0]?.kind === "dangerous_event" && state.dangerousSeas?.events?.pending) return;
  if (state.eventQueue.length) state.eventQueue.shift();
  showNextEvent();
  if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("quests-updated"));
  scheduleGameSave();
}

/**
 * イベントキューの初期化を保証する。
 */
function ensureQueue() {
  if (!Array.isArray(state.eventQueue)) state.eventQueue = [];
  if (!state.eventSeq || Number.isNaN(state.eventSeq)) state.eventSeq = 1;
}

/**
 * イベントのアクション配列を安全な形に正規化する。
 * @param {Array<{id?:string,label?:string,type?:string,payload?:any}>|undefined} actions 元のアクション配列
 * @param {number} baseId 連番生成のベースID
 * @returns {Array<{id:string,label:string,type:string,payload:any}>} 正規化したアクション配列
 */
function normalizeActions(actions, baseId) {
  const list = Array.isArray(actions) && actions.length ? actions : [{ label: "閉じる", type: "close" }];
  return list.map((a, idx) => ({
    id: a.id || `${baseId}-${idx}`,
    label: a.label || "閉じる",
    type: a.type || "close",
    payload: a.payload ?? null,
  }));
}

/**
 * イベントアクションを処理し、必要なら現在のイベントを解決する。
 * @param {*} action イベントアクション
 * @returns {void}
 */
function handleAction(action) {
  if (action?.type === "dangerous_event_choice") {
    if (handleDangerousSeaEventAction(action.payload)) resolveCurrentEvent(true);
    return;
  }
  if (action?.type === "dangerous_raid_continue" || action?.type === "dangerous_raid_evade") {
    if (handleDangerousRaidAction(action)) resolveCurrentEvent(true);
    return;
  }
  if (action?.type === "dangerous_wave_protect" || action?.type === "dangerous_wave_accept") {
    const result = resolveRoughWave(state, action.payload?.id, action.type === "dangerous_wave_protect");
    if (!result) return;
    pushLog("荒波の対策", result.protected ? "木材1・繊維1で魚を守りました。" : `魚${result.lost}匹を失いました。図鑑の記録は残ります。`, "-");
    resolveCurrentEvent(true);
    return;
  }
  if (isBattleEventActionBlocked(action)) {
    showNextEvent();
    return;
  }
  if (!action) {
    resolveCurrentEvent();
    return;
  }
  if (handleTravelEventAction(action)) {
    resolveCurrentEvent(true);
    return;
  }
  switch (action.type) {
    case "support": {
      const payload = action.payload || {};
      if (payload.settlementId && payload.factionId) {
        adjustSupport(payload.settlementId, payload.factionId, 3);
        addWarScore(getPlayerFactionId(), payload.factionId, 0, null, 6, 0);
      }
      break;
    }
    case "fortify": {
      const payload = action.payload || {};
      if (payload.settlementId && payload.factionId) {
        adjustSupport(payload.settlementId, payload.factionId, 2);
        addWarScore(getPlayerFactionId(), payload.factionId, 0, null, 6, 0);
      }
      break;
    }
    case "truce": {
      const payload = action.payload || {};
      if (payload.factionId) {
        addWarScore(getPlayerFactionId(), payload.factionId, 3, null, 0, 0);
      }
      break;
    }
    case "ignore": {
      const payload = action.payload || {};
      if (payload.settlementId && payload.factionId) {
        adjustSupport(payload.settlementId, payload.factionId, -2);
      }
      break;
    }
    case "honor_accept": {
      const payload = action.payload || {};
      if (payload.factionId) {
        addHonorFaction(payload.factionId);
        state.playerFactionId = payload.factionId;
      }
      break;
    }
    case "favor_up": {
      const payload = action.payload || {};
      if (payload.nobleId && payload.delta) {
        adjustNobleFavor(payload.nobleId, payload.delta);
      }
      break;
    }
    case "honor_decline": {
      // 断っても軽微なペナルティはなし。将来必要ならここで追加する。
      break;
    }
    default:
      break;
  }
  resolveCurrentEvent();
}

/**
 * 次のイベントをモーダルに表示する。
 * @returns {void}
 */
export function showNextEvent() {
  if (state.wanted?.detention) return;
  const modal = elements.eventModal;
  if (!modal) return;
  const dangerousEvent = state.dangerousSeas?.events?.pending;
  if (dangerousEvent && ["action", "battle"].includes(dangerousEvent.stage) && !dangerousEvent.pausedForHazard) { modal.hidden = true; return; }
  if (state.expansion?.exploration.pending || state.expansion?.charts.pending || state.expansion?.fishing?.pending || (state.dangerousSeas?.explorationPending && !state.dangerousSeas.explorationPending.pausedForHazard && state.dangerousSeas.explorationPending.wreck?.stage !== "choice") || (elements.fishingModal && !elements.fishingModal.hidden) || (elements.battleBlock && !elements.battleBlock.hidden) || (elements.battleResultModal && !elements.battleResultModal.hidden)) {
    modal.hidden = true;
    return;
  }
  ensureQueue();
  const ev = state.eventQueue[0];
  if (elements.eventModalClose) elements.eventModalClose.hidden = ["dangerous_wave", "dangerous_raid_warning", "dangerous_event"].includes(ev?.kind) || !!(state.piracy?.checkpoint && ev?.actions?.some(a => a.type?.startsWith("pirate_")));
  if (!ev) {
    modal.hidden = true;
    return;
  }
  if (elements.eventModalTitle) elements.eventModalTitle.textContent = ev.title || "イベント";
  if (elements.eventModalBody) {
    elements.eventModalBody.textContent = ev.body || "";
    if (Array.isArray(ev.resources) && ev.resources.length) {
      elements.eventModalBody.insertAdjacentHTML("beforeend", resourceList(ev.resources));
    }
  }
  if (elements.eventModalActions) {
    elements.eventModalActions.innerHTML = "";
    ev.actions.forEach((act) => {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = act.label || "閉じる";
      btn.dataset.actionId = act.id;
      btn.disabled = isBattleEventActionBlocked(act);
      const crimeReason = crimeRestriction(state, act);
      if (btn.disabled) btn.title = crimeReason || "部隊員がいないため選択できません。";
      elements.eventModalActions.append(btn);
      if (crimeReason) {
        const reason = document.createElement("p");
        reason.className = "tiny";
        reason.textContent = crimeReason;
        elements.eventModalActions.append(reason);
      }
    });
  }
  modal.hidden = false;
}
