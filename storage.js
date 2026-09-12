import { MODE_LABEL } from "./constants.js";
import { restoreWorld, snapshotWorld } from "./map.js";
import { reconcileWarFronts } from "./warFronts.js";
import { resetState, state } from "./state.js";
import { normalizeLogs } from "./logStore.js";
import { normalizeExpansionState } from "./expansionState.js";

const SAVE_KEY = "shiogatari-save";
let saveScheduled = false;

/**
 * 同期処理内の更新をまとめ、イベント解決などの処理完了後に保存する。
 * @returns {void}
 */
export function scheduleGameSave() {
  if (saveScheduled) return;
  saveScheduled = true;
  queueMicrotask(flushGameSave);
}

/**
 * 予約済みの保存を実行する。
 * @returns {void}
 */
function flushGameSave() {
  saveScheduled = false;
  saveGameToStorage();
}

/**
 * シンプルなハッシュ（32bit）を計算する。
 * @param {string} str
 * @returns {string}
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

/**
 * ゲーム状態をローカルストレージへ保存する。
 * 戦闘準備・戦闘中は保存しない。戦後処理完了時だけ通常画面として保存する。
 * @param {{battleComplete?:boolean}} [options] 戦後処理完了の指定
 * @returns {boolean}
 */
export function saveGameToStorage({ battleComplete = false } = {}) {
  const unsafe = state.modeLabel === MODE_LABEL.BATTLE || state.pendingEncounter?.active;
  if (!battleComplete && unsafe) return false;
  try {
    const data = {
      state: {
        ...state,
        logs: normalizeLogs(state.logs),
        ...(battleComplete ? {
          modeLabel: MODE_LABEL.NORMAL,
          pendingEncounter: { ...state.pendingEncounter, active: false },
        } : {}),
      },
      world: snapshotWorld(),
    };
    const payload = JSON.stringify(data);
    const hash = simpleHash(payload);
    const blob = JSON.stringify({ hash, payload, savedAt: Date.now() });
    localStorage.setItem(SAVE_KEY, blob);
    return true;
  } catch (e) {
    console.error("saveGameToStorage failed", e);
    return false;
  }
}

/**
 * ローカルストレージからゲーム状態を復元する。
 * @returns {boolean} 復元に成功したら true
 */
export function loadGameFromStorage() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const payload = parsed?.payload;
    const hash = parsed?.hash;
    if (!payload || !hash) return false;
    const actualHash = simpleHash(payload);
    if (actualHash !== hash) {
      console.warn("save data hash mismatch, skip loading");
      return false;
    }
    const snapshot = JSON.parse(payload);
    if (!snapshot?.state) return false;
    resetState();
    if (snapshot.world) {
      restoreWorld(snapshot.world);
    }
    Object.assign(state, snapshot.state);
    state.logs = normalizeLogs(state.logs);
    state.expansion = normalizeExpansionState(state.expansion);
    reconcileCharts(state.expansion.charts, state.quests?.active || []);
    reconcileWarFronts(state, snapshotWorld().settlements || []);
    return true;
  } catch (e) {
    console.error("loadGameFromStorage failed", e);
    return false;
  }
}
import { reconcileCharts } from "./charts.js";
