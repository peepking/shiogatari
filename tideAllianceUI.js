import { state } from './state.js';
import { MODE_LABEL } from './constants.js';
import { settlements } from './map.js';
import { getCurrentSettlement } from './actions.js';
import { TROOP_STATS } from './troops.js';
import { TIDE_STAGES, tideStage, tideRanking, proposeTideSupport } from './tideAlliance.js';
import { tideStageIcon, tideSceneText } from './tideScene.js';
import { setOutfittingOpen } from './outfittingUI.js';
import { quantityControl, wireQuantityControls, refreshQuantity } from './quantityUI.js';
import { confirmAction, pushLog, pushToast } from './dom.js';
import { saveGameToStorage } from './storage.js';
import { escapeHtml } from './util.js';

let open = false, selected = null, wired = false, support = null;
/** 街・村の内部に滞在している場合だけ潮盟拠点を訪問できる。 */
function canVisit() {
  if (getCurrentSettlement()?.pirateHaven) return false;
  const kind = getCurrentSettlement()?.kind;
  return (state.modeLabel === MODE_LABEL.IN_TOWN && kind === 'town') ||
    (state.modeLabel === MODE_LABEL.IN_VILLAGE && kind === 'village');
}
/** 選択先に滞在し、戦闘・探索の処理中でない場合だけ支援を許可する。 */
function canSupport() {
  return canVisit() &&
    getCurrentSettlement()?.id === selected && !state.pendingEncounter?.active &&
    !state.expansion?.exploration?.pending && !state.expansion?.charts?.pending;
}
/** 地図へ戻す。別の専用画面を開く際には地図の表示を変更しない。 */
function closeTide(restore = true) {
  open = false;
  document.getElementById('tidePanel').hidden = true;
  if (restore) document.getElementById('mapBlock').hidden = !document.getElementById('battleBlock').hidden;
}
/** 累計と次段階の両条件を、支援確認にも共通の文章で示す。 */
function progressText(site) {
  const next = TIDE_STAGES[tideStage(site) + 1];
  return next ? `次は${next.name}。資金 ${site?.funds || 0} / ${next.funds}、担い手 ${site?.people || 0} / ${next.people}人` : '神殿に到達しています。追加の支援は記録されますが、順位・恩恵は増えません。';
}
/** 拠点の固定寄与を読みやすい文にする。 */
function contribution(row) {
  return row ? `信仰 ${row.faith / 10} / 季節・神託 ＋${row.bonus}%` : '対象外（寄与なし）';
}
/** 支援内容と前後の見込みを確認し、保存できた場合だけ資産・累計を確定する。 */
function confirmSupport(panel, syncUI) {
  const funds = Number(panel.querySelector('#tideFunds')?.value || 0);
  const troops = [...panel.querySelectorAll('[data-tide-type]')].map(input => ({ type:input.dataset.tideType, level:input.dataset.level, count:Number(input.value) }));
  const proposal = canSupport() && proposeTideSupport(state, selected, funds, troops);
  if (!proposal) { pushToast('支援できません', '金額・人数と滞在先を確認してください。'); return; }
  const id = selected, fingerprint = JSON.stringify([state.funds, state.troops, state.tideAlliance]);
  const beforeRows = tideRanking(state.tideAlliance), afterRows = tideRanking(proposal.tideAlliance);
  const before = beforeRows.find(row => row.id === id), after = afterRows.find(row => row.id === id);
  const totals = [beforeRows, afterRows].map(rows => ({faith:rows.reduce((sum,row) => sum+row.faith,0),bonus:rows.reduce((sum,row) => sum+row.bonus,0)}));
  const unchanged = totals[0].faith === totals[1].faith && totals[0].bonus === totals[1].bonus;
  const names = troops.filter(row => row.count).map(row => `${TROOP_STATS[row.type]?.name || row.type} Lv${row.level}：${row.count}人`).join('\n');
  confirmAction({ title:'潮盟への支援', confirmText:'支援を確定する',
    body:`資金 ${funds.toLocaleString()}（残り ${proposal.funds.toLocaleString()}）\n${names ? `${names}\n担い手は恒久的に部隊を離れ、呼び戻せません。\n` : ''}\n支援後：${TIDE_STAGES[proposal.stage].name}\n${progressText(proposal.tideAlliance.sites[id])}\n\n次季節の見込み：${contribution(before)} → ${contribution(after)}\n潮盟全体：${contribution(totals[0])} → ${contribution(totals[1])}${unchanged ? '\n今回の支援では、潮盟全体の数値上の恩恵は増えません。' : ''}\n今季の恩恵は変わりません。次季節の対象は他拠点の発展で変わる場合があります。`,
    onConfirm: () => {
      if (selected !== id || !canSupport() || fingerprint !== JSON.stringify([state.funds, state.troops, state.tideAlliance])) {
        pushToast('状況が変わりました', '現在の資金・人員で支援をやり直してください。'); return;
      }
      const previous = { funds:state.funds, troops:state.troops, tideAlliance:state.tideAlliance };
      Object.assign(state, { funds:proposal.funds, troops:proposal.troops, tideAlliance:proposal.tideAlliance });
      if (!saveGameToStorage()) { Object.assign(state, previous); pushToast('支援を取り消しました', '保存できなかったため、資金・人員は変更していません。'); return; }
      support = null;
      pushLog('潮盟への支援', `${settlements.find(row => row.id === id)?.name}へ資金${funds}、担い手${proposal.people}人。${TIDE_STAGES[proposal.stage].name}。`);
      syncUI();
    }
  });
}
/** 支援入力を必要時だけ表示する。人数は兵種・レベルごとに指定する。 */
function supportHTML() {
  if (!support) return '';
  const rows = Object.entries(state.troops || {}).flatMap(([type, levels]) => Object.entries(typeof levels === 'number' ? {1:levels} : levels).filter(([,count]) => count > 0).map(([level,count]) =>
    `<label class="tide-troop-row"><span>${escapeHtml(TROOP_STATS[type]?.name || type)} Lv${escapeHtml(level)}<small>保有 ${count}人</small></span>${quantityControl(`<input type="number" min="0" max="${count}" value="0" data-tide-type="${escapeHtml(type)}" data-level="${escapeHtml(level)}" aria-label="${escapeHtml(TROOP_STATS[type]?.name || type)} Lv${escapeHtml(level)}の送り出す人数">`,false,true)}</label>`)).join('');
  return `<section class="tide-support"><h3>${support === 'funds' ? '資金を寄付する' : '潮盟の担い手として送り出す'}</h3>${support === 'funds' ? `<label>寄付額（所持 ${state.funds.toLocaleString()}）<input id="tideFunds" type="number" min="0" max="${state.funds}" step="1" value="0" inputmode="numeric"></label>` : `<p>誰でも1人として支えになります。送り出すと部隊から恒久的に離脱します。</p>${rows || '<p>送り出せる部隊員がいません。</p>'}`}<div class="tide-actions"><button class="btn good" id="tideCommit">内容を確認する</button><button class="btn ghost" id="tideCancel">取り消す</button></div></section>`;
}
/** 地図領域で情景を表示し、数値は折りたたみの詳細へまとめる。 */
export function renderTideControl(syncUI) {
  const panel = document.getElementById('tidePanel'), button = document.getElementById('tideOpen');
  if (!panel || !button) return;
  const blocked = !document.getElementById('battleBlock').hidden || state.pendingEncounter?.active;
  button.hidden = !!blocked || !canVisit();
  if (!wired) {
    wired = true;
    document.addEventListener('tide-close', () => closeTide(false));
    button.addEventListener('click', () => {
      if (!canVisit() || !document.getElementById('battleBlock').hidden || state.pendingEncounter?.active) return;
      setOutfittingOpen(false);
      selected = getCurrentSettlement().id;
      support = null; open = true; renderTideControl(syncUI);
      document.getElementById('tideTitle')?.focus();
    });
    wireQuantityControls(panel);
    panel.addEventListener('input', event => {
      if (event.target.matches('.quantity-control input')) refreshQuantity(event.target);
    });
  }
  if (blocked && open) closeTide(false);
  if (open && (!canVisit() || getCurrentSettlement()?.id !== selected)) closeTide();
  if (!open) return;
  const place = settlements.find(row => row.id === selected);
  if (!place) { closeTide(); return; }
  panel.hidden = false; document.getElementById('mapBlock').hidden = true;
  if (!canSupport()) support = null;
  const site = state.tideAlliance?.sites[selected], stage = tideStage(site), scene = tideSceneText(site);
  const current = state.tideAlliance?.targets || [], target = current.find(row => row.id === selected);
  const next = tideRanking(state.tideAlliance).find(row => row.id === selected);
  const nextStage = TIDE_STAGES[stage + 1];
  panel.innerHTML = `<div class="tide-heading"><div><span class="tiny">潮盟の拠点</span><h2 id="tideTitle" tabindex="-1">${escapeHtml(place.name)}</h2></div><button class="btn ghost" id="tideClose">地図に戻る</button></div>
    <div class="tide-intro"><div class="tide-icon-wrap">${tideStageIcon(site)}</div><h3>${TIDE_STAGES[stage].name}</h3><div class="tide-description"><p>${scene.description}</p>${scene.busy ? `<p class="tide-reaction">${scene.busy}</p>` : ''}</div></div>
    <blockquote class="tide-conversation">${scene.conversation.map(line => `<p>${line}</p>`).join('')}<p class="tide-reaction">${scene.reaction}</p></blockquote>
    <div class="tide-overview"><section class="tide-progress"><h4>${nextStage ? `${nextStage.name}への支え` : 'この地に根づいた支え'}</h4>${nextStage ? `<label>資金 <b>${(site?.funds || 0).toLocaleString()} / ${nextStage.funds.toLocaleString()}</b><progress max="${nextStage.funds}" value="${Math.min(site?.funds || 0, nextStage.funds)}"></progress></label><label>担い手 <b>${site?.people || 0} / ${nextStage.people}人</b><progress max="${nextStage.people}" value="${Math.min(site?.people || 0, nextStage.people)}"></progress></label><p class="tiny">資金と担い手の両方が必要です。</p>` : `<p>神殿に到達しました。</p><p class="tiny">累計資金 ${(site?.funds || 0).toLocaleString()}・担い手 ${site?.people || 0}人</p><p class="tiny">これからの支援も記録に残りますが、恩恵は増えません。</p>`}</section><section class="tide-season ${target ? 'is-active' : ''}"><h4>今季の状態</h4><p>${target ? 'この地の支えが、旅へ届いている' : 'この地の営みが続いている'}</p><p class="tiny">${contribution(target)}</p><div class="tide-next-season"><h4>次季節の見込み</h4><p>${contribution(next)}</p></div></section></div>
    <div class="tide-actions"><button class="btn good" id="tideDonate" ${canSupport() ? '' : 'disabled'}>資金を寄付する</button><button class="btn" id="tidePeople" ${canSupport() ? '' : 'disabled'}>潮盟の担い手として送り出す</button></div>
    ${!canSupport() ? '<p class="tiny">支援するには、この街・村に入ってください。</p>' : ''}${supportHTML()}
`;
  panel.querySelector('#tideClose').onclick = () => closeTide();
  panel.querySelector('#tideDonate').onclick = () => { support = 'funds'; renderTideControl(syncUI); panel.querySelector('#tideFunds')?.focus(); };
  panel.querySelector('#tidePeople').onclick = () => { support = 'people'; renderTideControl(syncUI); panel.querySelector('.tide-support')?.scrollIntoView({block:'nearest'}); };
  if (support) {
    panel.querySelector('#tideCancel').onclick = () => { support = null; renderTideControl(syncUI); };
    panel.querySelector('#tideCommit').onclick = () => confirmSupport(panel, syncUI);
    panel.querySelectorAll('.quantity-control input').forEach(refreshQuantity);
  }
}
