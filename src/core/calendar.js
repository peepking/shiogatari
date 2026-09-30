/** @type {number} 1季節の日数。 */
export const DAY_PER_SEASON = 30;
/** @type {number} 1年の季節数。 */
export const SEASONS_PER_YEAR = 4;
/** @type {number} 1年の日数。 */
export const DAY_PER_YEAR = DAY_PER_SEASON * SEASONS_PER_YEAR;
/** @param {object} date 暦。 @returns {number} 絶対日。 */
export const absDay = ({ year, season, day }) => year * DAY_PER_YEAR + season * DAY_PER_SEASON + day;
