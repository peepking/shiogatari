import { state } from "./state.js";
import { elements } from "./dom.js";
import { adjustSupport, addWarScore, addHonorFaction, getPlayerFactionId, adjustNobleFavor } from "./faction.js";
import { handleTravelEventAction } from "./actions.js";

/**
 * イベントキューにイベントを追加し、未表示なら即座に表示する。
 * @param {{title?:string,body?:string,kind?:string,actions?:Array<{id?:string,label?:string,type?:string,payload?:any}>}} evt
 */
export function enqueueEvent(evt) {
  ensureQueue();
  const id = state.eventSeq++;
  const normalized = {
    id,
    title: evt?.title || "イベント",
    body: evt?.body || "",
    kind: evt?.kind || "info",
    createdAt: Date.now(),
    actions: normalizeActions(evt?.actions, id),
  };
  state.eventQueue.push(normalized);
  showNextEvent();
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
 */
export function resolveCurrentEvent() {
  ensureQueue();
  if (state.eventQueue.length) state.eventQueue.shift();
  showNextEvent();
}

function ensureQueue() {
  if (!Array.isArray(state.eventQueue)) state.eventQueue = [];
  if (!state.eventSeq || Number.isNaN(state.eventSeq)) state.eventSeq = 1;
}

/**
 * @param {Array<{id?:string,label?:string,type?:string,payload?:any}>|undefined} actions
 * @param {number} baseId
 * @returns {Array<{id:string,label:string,type:string,payload:any}>}
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

function handleAction(action) {
  if (!action) {
    resolveCurrentEvent();
    return;
  }
  if (handleTravelEventAction(action)) {
    resolveCurrentEvent();
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

function showNextEvent() {
  const modal = elements.eventModal;
  if (!modal) return;
  ensureQueue();
  const ev = state.eventQueue[0];
  if (!ev) {
    modal.hidden = true;
    return;
  }
  if (elements.eventModalTitle) elements.eventModalTitle.textContent = ev.title || "イベント";
  if (elements.eventModalBody) elements.eventModalBody.textContent = ev.body || "";
  if (elements.eventModalActions) {
    elements.eventModalActions.innerHTML = "";
    ev.actions.forEach((act) => {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = act.label || "閉じる";
      btn.dataset.actionId = act.id;
      elements.eventModalActions.append(btn);
    });
  }
  modal.hidden = false;
}
