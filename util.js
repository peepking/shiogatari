/**
 * 現実時間の文字列を返す。
 * @returns {string}
 */
export const nowStr = () => new Date().toLocaleString();
/**
 * 数値を指定範囲に丸める。
 * @param {number} n
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
/**
 * 1D6の出目を返す。
 * @returns {number}
 */
export const rollD6 = () => 1 + Math.floor(Math.random() * 6);
/**
 * 季節ラベル。
 * @type {string[]}
 */
export const SEASONS = ["春", "夏", "秋", "冬"];

/**
 * HTMLエスケープを行う。
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * ゲーム内時間の表示文字列を返す。
 * @param {{year:number,season:number,day:number}} param0
 * @returns {string}
 */
export function formatGameTime({ year, season, day }) {
  const s = SEASONS[season] ?? SEASONS[0];
  return `神歴${year}年 / ${s} / ${day}日`;
}

/**
 * オブジェクトの数値合計を返す。
 * @param {object} obj
 * @returns {number}
 */
export function sumValues(obj) {
  return Object.values(obj || {}).reduce((a, b) => a + Number(b || 0), 0);
}
