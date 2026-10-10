/**
 * 帆装・櫂・船楼を描き分けた船種のピクセル絵を返す。
 * @param {string} id 船種。
 * @returns {string} 装飾用SVG。
 */
export function shipIcon(id) {
  const ships = ["caravel", "knarr", "longship", "cog", "galley", "carrack", "galleass", "galleon", "fluyt", "fishing_boat", "viking_ship"];
  const art = ships.includes(id) ? id : "caravel";
  return `<svg class="ship-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><image href="./image/ui/ship-${art}.png?v=20261010-maritime-ui" width="64" height="64" preserveAspectRatio="xMidYMid meet"/></svg>`;
}
