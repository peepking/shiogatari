import { state } from "./state.js";
import { mapData } from "./map.js";
import { CHART_CONFIG as CONFIG } from "./expansionConfig.js";
import { chooseChart, canAssignChart, assignChart, claimFragment, reconcileCharts } from "./charts.js";
import { enqueueEvent } from "./events.js";
import { pushLog, pushToast } from "./dom.js";

/** @param {object} offer 海図の種類とサイズ。 @returns {string} 表示名。 */
export function chartLabel(offer) { return `${CONFIG.rewards[offer.kind]?.name || "海図"}（${offer.size}枚）`; }

/**
 * 地点の競合を防ぐため、未公開の完成地点と未受注依頼を含めて予約する。
 * @returns {Set<string>} 使用済み座標。
 */
export function reservedChartPositions() {
  const positions = (state.expansion.exploration.sites || []).map(s => s.position);
  for (const c of state.expansion.charts.active) positions.push(c.destination, c.rumor);
  const quests = [...(state.quests?.active || []), ...Object.values(state.quests?.availableBySettlement || {}).flat(), ...Object.values(state.nobleQuests?.availableByNoble || {}).flat()];
  for (const q of quests) positions.push(q.target, ...(q.fights || []).map(f => f.target));
  return new Set(positions.filter(Boolean).map(p => `${p.x},${p.y}`));
}

/**
 * 上下左右に移動可能な世界地図で最短距離の範囲内を均等抽選する。
 * 完成地点のみ距離条件を緩和し、噂地点は候補がなければ見送る。
 * @param {object} origin 基準。 @param {string} kind 地点種別。 @param {boolean} rumor 噂か。
 * @returns {object|null} 座標。
 */
function choosePosition(origin, kind, rumor = false) {
  const blocked = reservedChartPositions();
  const range = rumor ? CONFIG.rumorDistance : CONFIG.destinationDistance;
  const candidates = [];
  for (let y = 0; y < mapData.length; y++) for (let x = 0; x < mapData[y].length; x++) {
    const cell = mapData[y][x];
    if ((cell.building && cell.building !== "none") || blocked.has(`${x},${y}`)) continue;
    const sea = cell.terrain === "sea" || cell.terrain === "shoal";
    if (!rumor && sea !== (kind === "inlet")) continue;
    const distance = Math.abs(x - origin.x) + Math.abs(y - origin.y);
    if (!distance) continue;
    candidates.push({ x, y, distance });
  }
  let pool = candidates.filter(p => p.distance >= range[0] && p.distance <= range[1]);
  if (!pool.length && !rumor) pool = candidates.filter(p => p.distance <= range[1]);
  if (!pool.length && !rumor) pool = candidates;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return chosen ? { x: chosen.x, y: chosen.y } : null;
}

/** @returns {void} 消滅した依頼の予約を解放する。 */
export function syncChartReservations() {
  reconcileCharts(state.expansion.charts, state.quests?.active || []);
}

/** @param {object} offer 予告。 @returns {object|null} 完成地点を内部固定した割当先。 */
function allocate(offer) {
  const data = state.expansion.charts;
  if (!canAssignChart(data, offer)) return null;
  const current = data.active.find(c => c.size === offer.size);
  return assignChart(data, offer, current?.destination || choosePosition(state.position, offer.kind));
}

/**
 * 候補生成時だけ資金から断片への置換を抽選する。候補段階では海図枠を予約しない。
 * @param {object} quest 依頼。 @returns {void}
 */
export function offerQuestFragment(quest) {
  if (!quest || !(quest.reward > 0) || quest.rewardFragment || Math.random() >= CONFIG.questFragmentChance) return;
  const offer = chooseChart(state.expansion.charts);
  if (!offer) return;
  quest.rewardFragment = offer;
  quest.originalFunds = quest.reward;
  quest.reward = 0;
}

/**
 * 物資付与・候補削除より前に予告と空きを再検証し、依頼IDへ予約を結ぶ。
 * @param {object} quest 依頼。 @returns {boolean} 受注できるか。
 */
export function reserveQuestFragment(quest) {
  if (!quest.rewardFragment) return true;
  syncChartReservations();
  const chart = allocate(quest.rewardFragment);
  if (!chart) {
    pushToast("受注できません", "予告された海図の断片枠が埋まっているか、その海図は終了しています。", "warn");
    return false;
  }
  chart.questIds.push(quest.id);
  quest.rewardFragment.chartId = chart.id;
  quest.reward = 0;
  return true;
}

/**
 * 断片の取得元と進捗を通知する。1枚目は海図の内容、完成時は固定地点を公開する。
 * @param {object} chart 海図。 @param {string} source 入手元。 @returns {void}
 */
export function announceFragment(chart, source) {
  const completed = chart.fragments === chart.size;
  const message = `${source}で${chartLabel(chart)}の断片を入手しました。取得 ${chart.fragments}/${chart.size}枚。`;
  const first = chart.fragments === 1 ? ` この海図には「${CONFIG.rewards[chart.kind].name}」への道が記されています。依頼欄の海図から期待報酬を確認できます。` : "";
  const destination = completed ? ` 海図が完成しました。発見地点は (${chart.destination.x + 1}, ${chart.destination.y + 1}) です。` : "";
  enqueueEvent({ title: completed ? "海図完成" : "海図の断片を入手", body: message + first + destination });
  pushLog(completed ? "海図完成" : "海図の断片", message + destination, "-");
}

/**
 * 依頼の資金報酬だけを置き換える。断片予約は一度だけ消費し、その他の報酬は呼び出し元が付与する。
 * @param {object} quest 依頼。 @param {number} [funds] 通常の資金報酬。 @returns {number} 実際の資金報酬。
 */
export function payQuestFunds(quest, funds = quest.reward || 0) {
  if (!quest.rewardFragment) { state.funds += funds; return funds; }
  const chart = state.expansion.charts.active.find(c => c.id === quest.rewardFragment.chartId);
  if (claimFragment(chart, "quest", quest.id)) announceFragment(chart, "依頼報酬");
  quest.reward = 0;
  return 0;
}

/**
 * 断片を予告した依頼の全関連戦闘を除外し、勝利時に未予約枠を低確率で埋める。
 * @param {*} questId 関連依頼。 @returns {object|null} 取得した海図。
 */
export function awardBattleFragment(questId) {
  if (state.quests?.active?.some(q => q.id === questId && q.rewardFragment)) return null;
  if (Math.random() >= CONFIG.battleFragmentChance) return null;
  syncChartReservations();
  const offer = chooseChart(state.expansion.charts);
  const chart = offer && allocate(offer);
  if (!chart || !claimFragment(chart, "battle")) return null;
  announceFragment(chart, "戦闘報酬");
  return chart;
}

/**
 * 拠点ごとの季節初回入場を不発も含めて記録する。同じ海図の噂は最大1枚。
 * 進行中海図を優先し、候補地がなければ予約せず見送る。
 * @param {object|null} settlement 拠点。 @returns {void}
 */
export function rollChartRumor(settlement) {
  if (!settlement) return;
  const data = state.expansion.charts;
  const season = state.year * 4 + state.season;
  if (data.rumorSeasons[settlement.id] === season) return;
  data.rumorSeasons[settlement.id] = season;
  if (Math.random() >= CONFIG.rumorChance) return;
  syncChartReservations();
  const offer = chooseChart(data, true);
  if (!offer) return;
  const chart = allocate(offer);
  if (!chart) return;
  const position = choosePosition(settlement.coords, offer.kind, true);
  if (!position) { syncChartReservations(); return; }
  chart.rumor = position;
  enqueueEvent({ title: "海図の断片の噂", body: `${chartLabel(chart)}の断片が (${position.x + 1}, ${position.y + 1}) にあると聞きました。現地で1日使って回収できます。探索自体の戦闘はなく、期限もありません。依頼欄の「噂の手掛かり」から場所を確認できます。` });
  pushLog("海図の噂", `${chartLabel(chart)} / (${position.x + 1}, ${position.y + 1})`, "-");
}
