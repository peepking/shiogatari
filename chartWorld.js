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

/** @returns {object|null} 探索時に当選済みの断片を未予約枠へ付与する。 */
export function awardExplorationFragment() {
  syncChartReservations();
  const offer = chooseChart(state.expansion.charts);
  const chart = offer && allocate(offer);
  if (!chart || !claimFragment(chart, "exploration")) return null;
  announceFragment(chart, "探索報酬");
  return chart;
}

/**
 * 各購入元で未取得の海図を優先する。当落と対象はイベント生成時に固定し、再表示では抽選しない。
 * 予約済み断片を侵食せず、候補がない場合は販売イベントを出さない。
 * @param {string} source 購入元。 @returns {boolean} イベントを生成したか。
 */
export function enqueueChartMerchant(source) {
  const settings = CONFIG.merchants[source];
  if (!settings) return false;
  syncChartReservations();
  const offer = chooseChart(state.expansion.charts, false, Math.random, source);
  if (!offer) return false;
  const title = source === "sailor" ? "海図売り" : "古文書商";
  const body = source === "sailor" ? "怪しい船乗りが古びた海図の切れ端を持っている" : "行商人が古びた海図の切れ端を持っている";
  enqueueEvent({ title, body: `${body}。${settings.price}資金で購入しますか？\n本物の確率は${settings.success * 100}%。偽物でも代金は戻りません。`,
    actions: [{ label: `${settings.price}資金で購入`, type: "chart_purchase", payload: { source, offer, genuine: Math.random() < settings.success } }, { label: "見送る", type: "close" }] });
  return true;
}

/**
 * 支払い直前に空き・取得上限・資金を再確認する。偽物では取得上限を消費しない。
 * @param {object} action 保存された選択肢。 @returns {boolean} 対応するイベントか。
 */
export function handleChartPurchase(action) {
  if (action?.type !== "chart_purchase") return false;
  const payload = action.payload || {};
  const settings = CONFIG.merchants[payload.source];
  if (!settings || payload.used || typeof payload.genuine !== "boolean") return true;
  payload.used = true;
  syncChartReservations();
  const current = state.expansion.charts.active.find(c => c.size === payload.offer?.size);
  if (!canAssignChart(state.expansion.charts, payload.offer) || current?.merchantClaims?.includes(payload.source)) {
    enqueueEvent({ title: "購入できません", body: "対象の海図が変わったか、断片枠が埋まっています。資金は消費していません。" }); return true;
  }
  if (state.funds < settings.price) { enqueueEvent({ title: "資金不足", body: "購入資金が足りません。資金は消費していません。" }); return true; }
  if (payload.genuine) {
    const chart = allocate(payload.offer);
    if (!chart || !claimFragment(chart, payload.source)) return true;
    state.funds -= settings.price;
    announceFragment(chart, payload.source === "sailor" ? "海図売りからの購入" : "古文書商からの購入");
  } else {
    state.funds -= settings.price;
    enqueueEvent({ title: "偽物の海図", body: "切れ端を詳しく調べると、もっともらしく描かれた偽物でした。海図の断片は手に入りませんでした。", resources: [{ id: "funds", label: "購入代金", value: `−${settings.price}` }] });
    pushLog("偽物の海図", `${settings.price}資金を支払いましたが、切れ端は偽物でした。`, "-");
  }
  return true;
}

/**
 * 街ごとの季節初回入場だけ独立して10%で抽選し、出入りの繰り返しを防ぐ。
 * @param {object|null} settlement 拠点。 @returns {void}
 */
export function rollChartMerchant(settlement) {
  if (settlement?.kind !== "town") return;
  const data = state.expansion.charts;
  const season = state.year * 4 + state.season;
  data.merchantSeasons ||= {};
  if (data.merchantSeasons[settlement.id] === season) return;
  data.merchantSeasons[settlement.id] = season;
  if (Math.random() < CONFIG.merchants.archivist.chance) enqueueChartMerchant("archivist");
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
