import { migratePirateHavens } from "./pirateWorld.js";
import { dangerousSeaReservedPositions } from "../dangerousSeas/dangerousSeaReservations.js";

/** 無法港の配置更新を保存済みの世界へ一度だけ適用するための版番号。 */
export const PIRATE_HAVEN_LAYOUT_VERSION = 2;

/**
 * 探索・海図・賞金首・物語・依頼の座標を予約し、港との重複を避ける。
 * 未受注の海賊依頼は配置更新後に作り直すため、予約対象から除く。
 * @param {object} game 復元済みの状態。
 * @param {Array} ports 既存の無法港。
 * @returns {Array<{x:number,y:number}>} 港を配置しない座標。
 */
function reservedPositions(game, ports) {
  const portIds = new Set();
  for (const port of ports) portIds.add(port.id);
  const quests = [...(game.quests?.active || []), ...Object.values(game.nobleQuests?.availableByNoble || {}).flat()];
  for (const [id, list] of Object.entries(game.quests?.availableBySettlement || {})) {
    if (!portIds.has(id)) quests.push(...list);
  }
  const positions = [game.pirateKingStory?.active?.position];
  positions.push(...dangerousSeaReservedPositions(game));
  for (const site of game.expansion?.exploration.sites || []) positions.push(site.position);
  for (const chart of game.expansion?.charts.active || []) positions.push(chart.destination, chart.rumor);
  for (const site of game.bounties?.active || []) positions.push(site.position);
  for (const quest of quests) {
    positions.push(quest.target);
    for (const fight of quest.fights || []) positions.push(fight.target);
  }
  const valid = [];
  for (const position of positions) {
    if (Number.isInteger(position?.x) && Number.isInteger(position?.y)) valid.push(position);
  }
  return valid;
}

/**
 * 港のIDと資産を引き継いで移設・追加し、その港にいるプレイヤーと選択位置を追随させる。
 * 受注済み依頼は維持し、未受注の海賊依頼だけ次の閲覧で新しい位置から生成し直す。
 * @param {Array} grid 地図。
 * @param {Array} settlements 拠点。
 * @param {Map} homes 人物の本拠地。
 * @param {Function} initialize 新港の雇用・物資初期化。
 * @param {object} game 復元済みの状態。
 * @returns {void}
 */
export function migratePirateHavenWorld(grid, settlements, homes, initialize, game) {
  const ports = [];
  for (const settlement of settlements) if (settlement.pirateHaven) ports.push(settlement);
  const moves = migratePirateHavens(grid, settlements, homes, initialize, reservedPositions(game, ports));
  for (const key of ["position", "selectedPosition"]) {
    const position = game[key];
    for (const move of moves) {
      if (position?.x === move.from.x && position?.y === move.from.y) {
        game[key] = { ...move.to };
        break;
      }
    }
  }
  for (const port of ports) {
    if (game.quests?.availableBySettlement) delete game.quests.availableBySettlement[port.id];
    if (game.quests?.lastSeasonBySettlement) delete game.quests.lastSeasonBySettlement[port.id];
  }
}
