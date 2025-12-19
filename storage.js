import { state, resetState } from "./state.js";
import { snapshotWorld, restoreWorld } from "./map.js";

const SAVE_KEY = "shiogatari-save";

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
 * @returns {boolean}
 */
export function saveGameToStorage() {
  try {
    const data = {
      state,
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
    return true;
  } catch (e) {
    console.error("loadGameFromStorage failed", e);
    return false;
  }
}
