import { PIRATE_CONFIG } from "./pirateConfig.js";
import { havenDistance, havenPlacementCandidates, selectHavenCoordinate } from "./pirateHavenLayout.js";

/** 無法港の生成順に使う名称。移設では既存の名称を変更しない。 */
const HAVEN_NAMES = ["黒帆の隠れ港","流れ者の泊地","霧裂き港","沈鐘の入り江","牙岩の泊地",
  "赤帆の入江","夜潮の港","骸礁の泊地","荒波の港","無灯の入り江",
  "鴉羽の港","欠月の泊地","朽ち錨の入り江","青焔の港","忘れ潮の泊地"];

/**
 * 最大の連続した海域へ無法港を最大15港配置する。四隅付近から始め、他港を海域全体へ分散する。
 * 新規世界生成だけで呼び、既設の無法港がある場合は何も変更しない。
 * @param {Array} grid 地図。 @param {Array} settlements 拠点。 @param {Map} homes 人物本拠地。
 * @param {Function} initialize 雇用・物資の初期化。 @returns {void}
 */
export function buildPirateHavens(grid, settlements, homes, initialize) {
  if (settlements.some(settlement => settlement.pirateHaven)) return;
  migratePirateHavens(grid, settlements, homes, initialize);
}

/**
 * 新しい無法港を作る。既存IDとの衝突を避け、初期化は新港だけに適用する。
 * @param {Array} settlements 拠点。 @param {object} coords 座標。
 * @param {number} index 港の生成順。 @param {Function} initialize 雇用・物資の初期化。
 * @returns {object} 新港。
 */
function createPirateHaven(settlements, coords, index, initialize) {
  const ids = new Set();
  for (const settlement of settlements) ids.add(settlement.id);
  let number = 1;
  while (ids.has(`haven-${number}`)) number++;
  const port = {id:`haven-${number}`,name:HAVEN_NAMES[index] || `沖の泊地${number}`,kind:"town",pirateHaven:true,factionId:"pirates",
    nobleId:PIRATE_CONFIG.nobleId,controllerId:PIRATE_CONFIG.nobleId,coords,goods:[],specialty:null,
    support:{pirates:0},warState:{contested:false,frontline:false}};
  initialize(port);
  settlements.push(port);
  return port;
}

/**
 * 旧世界の港を安全な内側座標へ移し、空きがあれば15港まで追加する。一度限りの保存移行から呼ぶ。
 * 未移設の港を間隔判定に含めることで、候補不足で元位置に残す港も保護する。
 * 既存港はID・名称・在庫など全状態を維持し、座標だけ更新する。本拠地IDも保持する。
 * @param {Array} grid 地図。 @param {Array} settlements 拠点。 @param {Map} homes 人物本拠地。
 * @param {Function} initialize 新港の雇用・物資初期化。 @param {Array} avoid 予約座標。
 * @returns {Array} 移設した港のIDと旧・新座標。
 */
export function migratePirateHavens(grid, settlements, homes, initialize, avoid = []) {
  const ports = [];
  for (const settlement of settlements) if (settlement.pirateHaven) ports.push(settlement);
  const candidates = havenPlacementCandidates(grid, settlements, avoid), moves = [];
  for (let index = 0; index < ports.length; index++) {
    const port = ports[index], occupied = [];
    for (const other of ports) if (other !== port) occupied.push(other.coords);
    const coords = selectHavenCoordinate(grid, candidates, occupied, index);
    if (!coords || havenDistance(coords, port.coords) === 0) continue;
    const from = { ...port.coords }, previous = grid[from.y]?.[from.x];
    if (previous?.settlement?.id === port.id) {
      Object.assign(previous, { building: "none", settlement: null, factionId: null });
    }
    port.coords = coords;
    Object.assign(grid[coords.y][coords.x], { building: "town", settlement: port, factionId: port.factionId });
    moves.push({ id: port.id, from, to: { ...coords } });
  }
  while (ports.length < PIRATE_CONFIG.ports) {
    const occupied = [];
    for (const port of ports) occupied.push(port.coords);
    const coords = selectHavenCoordinate(grid, candidates, occupied, ports.length);
    if (!coords) break;
    const port = createPirateHaven(settlements, coords, ports.length, initialize);
    ports.push(port);
    Object.assign(grid[coords.y][coords.x], { building: "town", settlement: port, factionId: port.factionId });
  }
  if (ports.length && !homes.has(PIRATE_CONFIG.nobleId)) homes.set(PIRATE_CONFIG.nobleId, ports[0].id);
  return moves;
}
