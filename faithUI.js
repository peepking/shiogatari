import { state } from "./state.js";
import { faithEffects, FAITH_CONFIG } from "./faith.js";

/** 信仰の恩恵を現在値で表示する。帰り潮の内部確率は表示しない。 */
export function renderFaithDetails() {
  const body = document.getElementById('faithDetailsBody');
  if (!body) return;
  const effects = faithEffects(state);
  const percent = value => `${Number((value * 100).toFixed(2))}%`;
  const rows = [];
  if (effects.upkeep > 0) rows.push(['潮盟の取り計らい', `部隊維持費・船維持費 −${percent(effects.upkeep)}`]);
  if (effects.sale > 0) rows.push(['縁の市', `物資売却額 ＋${percent(effects.sale)}。売値は同じ拠点の買値が上限です。`]);
  if (effects.rescue > 0) rows.push(['帰り潮の加護', '勝利後の損耗を軽減します。']);
  if (effects.food > 0) rows.push(['潮待ちの恵み', `次季節の初日に食料${effects.food}個を受け取る見込みです。信仰の変化や空き容量により変わります。`]);
  if (effects.recruitChance > 0) rows.push(['潮盟の便り', `村・街の季節初回入場時、まれにLv${FAITH_CONFIG.recruitLevel}の兵員${FAITH_CONFIG.recruitCount}人が追加の雇用候補になります。雇用費は通常どおりです。`]);
  const until = effects.until;
  const deadline = effects.afterglow ? `神歴${Math.floor(until / 4)}年 ${['春','夏','秋','冬'][until % 4]}1日の維持費精算まで` : '';
  body.innerHTML = `<p>現在の信仰 <b>${Math.max(0, Number(state.faith) || 0)}</b></p>${effects.afterglow ? `<div class="sideBlock"><b>祈りの余潮</b><p>交易・維持費の恩恵が${FAITH_CONFIG.afterglow}倍（下記に反映済み）</p><p class="tiny">${deadline}</p></div>` : ''}<div class="faith-benefit-list">${rows.map(([name, description]) => `<section class="sideBlock"><h3>${name}</h3><p>${description}</p></section>`).join('') || '<p>現在、適用中の恩恵はありません。</p>'}</div><p class="tiny">潮盟は、潮語りの言葉に耳を傾ける「潮の縁者」の共同体です。恩恵は現在の信仰に応じて変わります。</p>`;
}

/** ヘッダの信仰を閲覧用詳細へ接続し、既存モーダル操作を共用する。 */
export function wireFaithDetails({ openModal, bindModal }) {
  const modal = document.getElementById('faithDetailsModal');
  const card = document.getElementById('asset-faith');
  if (!modal || !card) return;
  bindModal(modal, document.getElementById('faithDetailsClose'));
  card.setAttribute('role', 'button');
  card.setAttribute('aria-haspopup', 'dialog');
  card.tabIndex = 0;
  card.addEventListener('click', () => { renderFaithDetails(); openModal(modal); });
  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.click(); }
  });
}
