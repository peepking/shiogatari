import { CHART_CONFIG } from "../core/expansionConfig.js";
import { state } from "../core/state.js";
import { MODE_LABEL } from "../core/constants.js";
import { saveGameToStorage } from "../core/storage.js";
import { settlements } from "../world/map.js";
import { offerQuestFragment, chartLabel } from "../exploration/chartWorld.js";
import { pushToast } from "../ui/dom.js";

/**
 * 通常拠点で季節ごとに20%で最大1件追加し、調達と通常海賊討伐を等確率で選ぶ。
 * 資金だけを断片1枚へ置換し、海図を予告できない場合は依頼自体を見送る。
 * @param {object} settlement 発注拠点。
 * @param {{supply:Function,hunt:Function}} generators 既存形式の生成処理。
 * @returns {object|null} 追加依頼。
 */
export function makeChartQuestOpportunity(settlement, generators) {
  if (!settlement || settlement.pirateHaven || Math.random() >= CHART_CONFIG.opportunities.dedicatedQuestChance) return null;
  const hunt = Math.random() >= 0.5;
  const quest = (hunt ? generators.hunt : generators.supply)(settlement);
  if (!quest || (hunt && quest.target?.x === settlement.coords.x && quest.target?.y === settlement.coords.y)) return null;
  offerQuestFragment(quest, true);
  if (!quest.rewardFragment) return null;
  quest.chartOpportunity = true;
  quest.title = hunt ? "海図収集家の海賊討伐" : "海図収集家の調達依頼";
  quest.desc += ` 海図を集める収集家からの依頼。資金の代わりに${chartLabel(quest.rewardFragment)}の断片1枚を受け取る。`;
  return quest;
}

/**
 * 移動イベントの難民護送だけ、受注時に10%の追加謝礼の当落を保存する。
 * 既存依頼は補完せず、目的地への引き渡し時だけ未予約枠へ断片を付与する。
 * @param {object} quest 新たに受注する護送依頼。
 * @returns {void}
 */
export function fixRefugeeFragmentReward(quest) {
  if (typeof quest.refugeeFragmentReward === "boolean") return;
  quest.refugeeFragmentReward = Math.random() < CHART_CONFIG.opportunities.refugeeFragmentChance;
}

/**
 * 報酬・予約・依頼削除と、世界側に保持した支持度をまとめて退避する。
 * @returns {{game:object,supports:Array}} 変更前の状態。
 */
export function snapshotChartQuestChange() {
  return { game: structuredClone(state), supports: settlements.map(settlement => ({ settlement, support: structuredClone(settlement.support) })) };
}

/**
 * 非戦闘の海図入手経路を一括保存し、失敗時は通常謝礼・消費物資・依頼も変更前へ戻す。
 * 戦闘中は後続の戦果も含む既存の戦後保存へ委ね、途中状態を保存しない。
 * @param {{game:object,supports:Array}} previous 変更前の状態。
 * @returns {boolean} 保存できたか。
 */
export function commitChartQuestChange(previous) {
  if (state.modeLabel === MODE_LABEL.BATTLE || saveGameToStorage()) return true;
  for (const key of Object.keys(state)) if (!Object.hasOwn(previous.game, key)) delete state[key];
  Object.assign(state, previous.game);
  for (const { settlement, support } of previous.supports) {
    if (support === undefined) delete settlement.support;
    else settlement.support = support;
  }
  pushToast("保存できません", "依頼と海図の更新を取り消しました。もう一度お試しください。", "warn");
  return false;
}
