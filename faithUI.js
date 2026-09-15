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
  const targets = state.tideAlliance?.targets || [];
  const seasonalFaith = targets.reduce((sum, row) => sum + row.faith, 0) / 10;
  const until = effects.until;
  const deadline = effects.afterglow ? `神歴${Math.floor(until / 4)}年 ${['春','夏','秋','冬'][until % 4]}1日の維持費精算まで` : '';
  body.innerHTML = `<div class="faith-current"><span>現在の信仰</span><strong>${Math.max(0, Number(state.faith) || 0).toLocaleString()}</strong></div><div class="faith-benefit-list"><section class="faith-benefit-card"><h3>各地の支え</h3><p class="faith-caption">潮盟全体の今季</p><dl class="faith-metrics"><div><dt>恩恵対象</dt><dd>${targets.length}<small>拠点</small></dd></div><div><dt>信仰 / 季節</dt><dd>${seasonalFaith}</dd></div><div><dt>神託報酬</dt><dd>＋${state.tideAlliance?.bonus || 0}<small>%</small></dd></div></dl><p class="tiny">信仰の端数は繰り越されます（現在 ${(state.tideAlliance?.remainder || 0) / 10}）。</p></section>${effects.afterglow ? `<div class="faith-benefit-card"><h3>祈りの余潮</h3><p>交易・維持費の恩恵が${FAITH_CONFIG.afterglow}倍</p><p class="tiny">${deadline}</p></div>` : ''}${rows.map(([name, description]) => `<section class="faith-benefit-card"><h3>${name}</h3><p>${description}</p></section>`).join('') || '<p>現在、適用中の恩恵はありません。</p>'}</div><p class="faith-footnote tiny">恩恵は現在の信仰に応じて変わります。</p>`;
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
