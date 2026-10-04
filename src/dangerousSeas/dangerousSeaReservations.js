/**
 * 危険海域の探索・賞金首・両枠の限定イベントを取得し、既存の配置処理でも同じ予約を使う。
 * @param {object} game ゲーム状態。 @returns {Array<{x:number,y:number}>} 予約座標。
 */
export function dangerousSeaReservedPositions(game) {
  const data = game.dangerousSeas;
  return [...Object.values(data?.regions || {}).flatMap(r => r.sites || []), ...(data?.bounties?.active || []),
    ...Object.values(data?.events?.active || {}), ...Object.values(data?.events?.stormAftermath || {})]
    .filter(Boolean)
    .map(site => site.position).filter(Boolean);
}

/**
 * 未公開の海図や未受注依頼も含め、全ての配置で重なりを避けるための予約を作る。
 * @param {object} game ゲーム状態。 @returns {Set<string>} 使用中の座標。
 */
export function worldReservedPositions(game) {
  const positions = [...dangerousSeaReservedPositions(game), ...(game.expansion?.exploration?.sites || []).map(site => site.position),
    ...(game.bounties?.active || []).map(site => site.position), game.pirateKingStory?.active?.position];
  for (const chart of game.expansion?.charts?.active || []) positions.push(chart.destination, chart.rumor);
  const quests = [...(game.quests?.active || []), ...Object.values(game.quests?.availableBySettlement || {}).flat(), ...Object.values(game.nobleQuests?.availableByNoble || {}).flat()];
  for (const quest of quests) positions.push(quest.target, ...(quest.fights || []).map(fight => fight.target));
  return new Set(positions.filter(Boolean).map(p => `${p.x},${p.y}`));
}
