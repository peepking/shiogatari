import { state } from "./state.js";
import { faithEffects, FAITH_CONFIG } from "./faith.js";
import { settlements, focusMapPosition } from "./map.js";
import { setOutfittingOpen } from "./outfittingUI.js";
import { escapeHtml } from "./util.js";
import { TIDE_STAGES, tideStage } from "./tideAlliance.js";

/** 資金または担い手を支援した拠点だけを、既存の拠点順で返す。未建設の拠点も含む。 */
function supportedSites() {
  return settlements.filter(place => {
    const site = state.tideAlliance?.sites[place.id];
    return (site?.funds || 0) > 0 || (site?.people || 0) > 0;
  });
}

/** 支援済み拠点の名前・座標・現在の発展段階を表示し、再描画前の選択を保持する。 */
function siteLocator(selected) {
  const sites = supportedSites();
  const battleVisible = !document.getElementById('battleBlock')?.hidden;
  return `<div class="faith-site-locator"><label for="faithSiteSelect">支援した拠点</label><div class="faith-site-controls"><select id="faithSiteSelect" ${sites.length ? '' : 'disabled'}>${sites.length ? sites.map(place => `<option value="${escapeHtml(place.id)}" ${place.id === selected ? 'selected' : ''}>${escapeHtml(place.name)} (${place.coords.x + 1}, ${place.coords.y + 1}) / ${escapeHtml(TIDE_STAGES[tideStage(state.tideAlliance?.sites[place.id])].name)}</option>`).join('') : '<option>支援した拠点はありません</option>'}</select><button class="btn" id="faithSiteMap" ${!sites.length || battleVisible ? 'disabled' : ''}>地図で確認</button></div></div>`;
}

/** 戦闘画面を維持しつつ、通常時は専用画面を閉じて支援先のマスを選択する。 */
function showSupportedSite() {
  if (!document.getElementById('battleBlock')?.hidden) return;
  const selected = document.getElementById('faithSiteSelect')?.value;
  const place = supportedSites().find(site => site.id === selected);
  if (!place) return;
  document.getElementById('faithDetailsModal').hidden = true;
  document.dispatchEvent(new CustomEvent('tide-close'));
  setOutfittingOpen(false);
  focusMapPosition(place.coords);
}

/** 信仰の恩恵を現在値で表示する。帰り潮の内部確率は表示しない。 */
export function renderFaithDetails() {
  const body = document.getElementById('faithDetailsBody');
  if (!body) return;
  const selectedSite = body.querySelector('#faithSiteSelect')?.value;
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
  body.innerHTML = `<div class="faith-current"><span>現在の信仰</span><strong>${Math.max(0, Number(state.faith) || 0).toLocaleString()}</strong></div><div class="faith-benefit-list"><section class="faith-benefit-card"><h3>各地の支え</h3><p class="faith-caption">潮盟全体の今季</p><dl class="faith-metrics"><div><dt>恩恵対象</dt><dd>${targets.length}<small>拠点</small></dd></div><div><dt>信仰 / 季節</dt><dd>${seasonalFaith}</dd></div><div><dt>神託報酬</dt><dd>＋${state.tideAlliance?.bonus || 0}<small>%</small></dd></div></dl><p class="tiny">信仰の端数は繰り越されます（現在 ${(state.tideAlliance?.remainder || 0) / 10}）。</p>${siteLocator(selectedSite)}</section>${effects.afterglow ? `<div class="faith-benefit-card"><h3>祈りの余潮</h3><p>交易・維持費の恩恵が${FAITH_CONFIG.afterglow}倍</p><p class="tiny">${deadline}</p></div>` : ''}${rows.map(([name, description]) => `<section class="faith-benefit-card"><h3>${name}</h3><p>${description}</p></section>`).join('') || '<p>現在、適用中の恩恵はありません。</p>'}</div><p class="faith-footnote tiny">恩恵は現在の信仰に応じて変わります。</p>`;
  body.querySelector('#faithSiteMap').onclick = showSupportedSite;
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
