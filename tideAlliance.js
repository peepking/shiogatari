/** 潮盟拠点の発展条件。費用・人員は累計、信仰は十分の一単位。 */
export const TIDE_STAGES = Object.freeze([
  { name: 'まだ名のない集い', funds: 0, people: 0, faith: 0, bonus: 0 },
  { name: '小さな祠', funds: 20000, people: 5, faith: 2, bonus: 2 },
  { name: '祭壇', funds: 60000, people: 15, faith: 4, bonus: 4 },
  { name: '寺院', funds: 120000, people: 30, faith: 7, bonus: 7 },
  { name: '神殿', funds: 200000, people: 50, faith: 10, bonus: 10 },
].map(Object.freeze));
/** 恩恵対象数と発展間近の進捗閾値。 */
export const TIDE_CONFIG = Object.freeze({ limit: 5, busyProgress: 0.8 });

/** 年を含む季節番号。 */
export function tideSeason(state) { return state.year * 4 + state.season; }

/** 旧セーブの潮盟領域を補完し、過去の支給は生成しない。 */
export function normalizeTide(data) {
  return { sites: data?.sites || {}, nextOrder: data?.nextOrder || 1, season: data?.season ?? null,
    targets: data?.targets || [], remainder: data?.remainder || 0, bonus: data?.bonus || 0 };
}

/** 拠点の累計から両条件を満たす最高段階を返す。 */
export function tideStage(site) {
  let stage = 0;
  TIDE_STAGES.forEach((value, index) => { if ((site?.funds || 0) >= value.funds && (site?.people || 0) >= value.people) stage = index; });
  return stage;
}

/** 次段階までの資金・人員の低い側の進捗を返す。神殿後は順位に加算しない。 */
export function tideProgress(site) {
  const stage = tideStage(site), current = TIDE_STAGES[stage], next = TIDE_STAGES[stage + 1];
  if (!next) return 1;
  return Math.max(0, Math.min(1, ((site?.funds || 0) - current.funds) / (next.funds - current.funds), ((site?.people || 0) - current.people) / (next.people - current.people)));
}

/** 段階・低い側の進捗・祠完成順・内部IDの順に上位を選ぶ。 */
export function tideRanking(data) {
  return Object.entries(data?.sites || {}).filter(([,site]) => tideStage(site) > 0)
    .sort(([aid,a],[bid,b]) => tideStage(b)-tideStage(a) || tideProgress(b)-tideProgress(a) || a.order-b.order || (aid < bid ? -1 : aid > bid ? 1 : 0))
    .slice(0,TIDE_CONFIG.limit).map(([id,site]) => ({ id, stage:tideStage(site), faith:TIDE_STAGES[tideStage(site)].faith, bonus:TIDE_STAGES[tideStage(site)].bonus }));
}

/** 季節初日の対象と寄与を固定し、端数を繰り越して信仰を一度だけ支給する。 */
export function settleTideSeason(state) {
  const data = state.tideAlliance = normalizeTide(state.tideAlliance);
  const season = tideSeason(state);
  if (data.season === season) return null;
  data.season = season;
  data.targets = tideRanking(data);
  data.bonus = data.targets.reduce((sum,row) => sum+row.bonus,0);
  const tenths = data.remainder + data.targets.reduce((sum,row) => sum+row.faith,0);
  const gain = Math.floor(tenths/10);
  data.remainder = tenths%10;
  state.faith = (state.faith || 0)+gain;
  return { gain, bonus:data.bonus, count:data.targets.length };
}

/** 神託だけに報告時点の今季補正を適用し、最後に切り捨てる。 */
export function tideOracleReward(state, quest) {
  const base = quest.rewardFaith || 0;
  const bonus = quest.type?.startsWith('oracle_') && state.tideAlliance?.season === tideSeason(state) ? state.tideAlliance.bonus : 0;
  return Math.floor(base*(100+(bonus || 0))/100);
}

/** 訪問ごとの描写キーを記録する。同じ滞在の再描画では更新しない。 */
export function visitTideSite(state, id) {
  if (!id) return;
  const data = state.tideAlliance = normalizeTide(state.tideAlliance);
  const site = data.sites[id] ||= { funds:0, people:0, order:0, visits:0, reaction:'first' };
  site.visits++;
  site.reaction = site.visits === 1 ? 'first' : 'return';
}

/** 支援を独立した状態へ反映する。人数は兵種・レベル別に再検証し、全条件成立時だけ変更を返す。 */
export function proposeTideSupport(state, id, funds, troops = []) {
  if (!Number.isSafeInteger(funds) || funds < 0 || funds > state.funds) return null;
  const requested = new Map();
  for (const row of troops) {
    if (!Number.isSafeInteger(row.count) || row.count < 0) return null;
    const key = `${row.type}|${row.level}`;
    requested.set(key,(requested.get(key)||0)+row.count);
  }
  const nextTroops = structuredClone(state.troops || {});
  let people=0;
  for (const [key,count] of requested) {
    const [type,level]=key.split('|');
    if (typeof nextTroops[type] === 'number') nextTroops[type]={1:nextTroops[type]};
    if ((nextTroops[type]?.[level] || 0) < count) return null;
    if (count) {
      nextTroops[type][level]-=count;
      if (!nextTroops[type][level]) delete nextTroops[type][level];
      if (!Object.keys(nextTroops[type]).length) delete nextTroops[type];
    }
    people+=count;
  }
  if (!funds && !people) return null;
  const data=structuredClone(normalizeTide(state.tideAlliance));
  const site=data.sites[id] ||= {funds:0,people:0,order:0,visits:0,reaction:'first'};
  const before=tideStage(site);
  site.funds+=funds;site.people+=people;
  const stage=tideStage(site);
  if (stage && !site.order) site.order=data.nextOrder++;
  site.reaction=stage>before?'growth':'support';
  return { funds:state.funds-funds, troops:nextTroops, tideAlliance:data, people, stage, before };
}
