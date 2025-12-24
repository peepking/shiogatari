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
 * 内部数値を段階ラベルに変換する（関係用）。
 * @param {number} value
 * @returns {"cold"|"wary"|"soft"|"warm"|"ally"}
 */
export function relationLabel(value = 0) {
  if (value >= 40) return "ally";
  if (value >= 20) return "warm";
  if (value >= 5) return "soft";
  if (value <= -20) return "cold";
  return "wary";
}

/**
 * 支持度や士気などの段階ラベル。
 * @param {number} value
 * @returns {"low"|"mid"|"high"}
 */
export function supportLabel(value = 0) {
  if (value >= 20) return "high";
  if (value <= -10) return "low";
  return "mid";
}

/**
 * 支持度ラベルを日本語表示用に変換する。
 * @param {"low"|"mid"|"high"} code
 * @returns {string}
 */
export function displaySupportLabel(code) {
  if (code === "high") return "高";
  if (code === "low") return "低";
  return "並";
}

/**
 * 戦況スコアを段階ラベルに変換する。
 * @param {number} score
 * @returns {"winning"|"advantage"|"even"|"disadvantage"|"losing"}
 */
export function warScoreLabel(score = 0) {
  if (score >= 30) return "winning";
  if (score >= 10) return "advantage";
  if (score <= -30) return "losing";
  if (score <= -10) return "disadvantage";
  return "even";
}

/**
 * 関係ラベルを日本語表示用に変換する。
 * @param {"cold"|"wary"|"soft"|"warm"|"ally"} code
 * @returns {string}
 */
export function displayRelationLabel(code) {
  switch (code) {
    case "ally":
      return "同盟";
    case "warm":
      return "友好";
    case "soft":
      return "軟化";
    case "cold":
      return "敵対";
    case "wary":
    default:
      return "警戒";
  }
}

/**
 * 戦況ラベルを日本語表示用に変換する。
 * @param {"winning"|"advantage"|"even"|"disadvantage"|"losing"} code
 * @returns {string}
 */
export function displayWarLabel(code) {
  switch (code) {
    case "winning":
      return "優勢";
    case "advantage":
      return "やや優勢";
    case "disadvantage":
      return "やや劣勢";
    case "losing":
      return "劣勢";
    case "even":
    default:
      return "拮抗";
  }
}

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
