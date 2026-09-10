import { SEASONS, formatGameTime } from "./util.js";

const SEASON_ICONS = ["✿", "☀", "❧", "❄"];

/**
 * 年を補助情報、季節と日を主情報としてヘッダに表示する。
 * 季節は数値IDで色とアイコンを切り替え、読み上げには日付全体を渡す。
 * @param {HTMLElement} element
 * @param {{year:number,season:number,day:number}} date
 * @returns {void}
 */
export function renderGameTime(element, date) {
  if (!element) return;
  if (!element.querySelector(".game-date-year")) {
    element.innerHTML = '<span class="game-date-icon" aria-hidden="true"></span><span class="game-date-content" aria-hidden="true"><span class="game-date-year"></span><span class="game-date-main"><span class="game-date-season"></span><span class="game-date-divider"></span><span><b class="game-date-day"></b><span class="game-date-unit">日</span></span></span></span>';
    element.setAttribute("role", "img");
  }
  const season = Number.isInteger(date.season) && SEASONS[date.season] ? date.season : 0;
  element.dataset.season = String(season);
  element.setAttribute("aria-label", formatGameTime(date));
  element.querySelector(".game-date-icon").textContent = SEASON_ICONS[season];
  element.querySelector(".game-date-year").textContent = `神歴 ${date.year}年`;
  element.querySelector(".game-date-season").textContent = SEASONS[season];
  element.querySelector(".game-date-day").textContent = String(date.day);
}
