/** 地図の表示順と範囲。周辺と拡大は詳細描画、全体だけ簡略描画にする。 */
export const MAP_VIEWS = Object.freeze({
  full: { label: "全体", cells: 50, detailed: false },
  nearby: { label: "周辺", cells: 19, detailed: true },
  zoom: { label: "拡大", cells: 9, detailed: true },
});

/** @param {string} mode 現在の表示。 @returns {string} 全体・周辺・拡大の循環順で次の表示。 */
export function nextMapMode(mode) {
  const modes = Object.keys(MAP_VIEWS);
  return modes[(modes.indexOf(mode) + 1) % modes.length];
}

/**
 * 描画・ホバー・クリックで同じ表示範囲を使う。現在地を中央に置き、地図端では範囲を内側に寄せる。
 * @param {string} mode 表示種別。 @param {{x:number,y:number}} position 現在地。
 * @returns {object} 固定描画幅700に対するマス寸法と表示原点。
 */
export function mapViewport(mode, position) {
  const view = MAP_VIEWS[mode] || MAP_VIEWS.full;
  const cells = view.cells;
  const startX = Math.max(0, Math.min(50 - cells, position.x - Math.floor(cells / 2)));
  const startY = Math.max(0, Math.min(50 - cells, position.y - Math.floor(cells / 2)));
  return { ...view, startX, startY, cellSize: 700 / cells };
}
