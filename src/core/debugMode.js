const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * ローカル起動で明示された場合だけ、管理操作を有効にする。
 * 起動時に判定し、セーブやブラウザの保存設定には持ち越さない。
 * @param {{hostname?:string, search?:string}|undefined} source 起動先。
 * @returns {boolean} デバッグ操作を使えるか。
 */
export function isDebugLocation(source) {
  if (!LOCAL_HOSTS.has(source?.hostname?.toLowerCase())) return false;
  const values = new URLSearchParams(source.search || "").getAll("debug");
  return values.length === 1 && values[0] === "1";
}

/** @type {boolean} この起動だけに適用するデバッグ状態。 */
export const DEBUG_MODE = isDebugLocation(globalThis.location);
