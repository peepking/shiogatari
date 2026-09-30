export const MAX_LOG_ENTRIES = 200;
export const MAX_LOG_BODY_LENGTH = 4000;

/**
 * 新しい順のログを検証し、直近200件・本文4000文字以内に制限する。
 * 件数超過時は古い記録から除き、旧セーブの未定義ログは空として扱う。
 * @param {unknown} logs
 * @returns {Array<object>}
 */
export function normalizeLogs(logs) {
  if (!Array.isArray(logs)) return [];
  return logs.filter(isLogEntry).slice(0, MAX_LOG_ENTRIES).map(normalizeLogEntry);
}

/**
 * 復元可能なログの形式か判定する。
 * @param {unknown} entry
 * @returns {boolean}
 */
function isLogEntry(entry) {
  return !!entry && typeof entry.title === "string" && typeof entry.body === "string";
}

/**
 * ログの文字列だけを取り出し、各項目の長さを制限する。
 * @param {object} entry
 * @returns {object}
 */
function normalizeLogEntry(entry) {
  return {
    title: entry.title.slice(0, 200),
    body: entry.body.slice(0, MAX_LOG_BODY_LENGTH),
    gameTime: String(entry.gameTime || "").slice(0, 100),
    realTime: String(entry.realTime || "").slice(0, 100),
  };
}
