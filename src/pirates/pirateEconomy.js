import { pirateRelation, PIRATE_RELATION_LABELS } from "./pirateConfig.js";

/** 海賊依頼の資金報酬倍率。関係段階ごとの初期調整値。 */
export const PIRATE_REWARD_RATES = { hostile: 0.8, wary: 0.9, neutral: 1, welcomed: 1.2 };

/**
 * 生成時の関係と資金報酬を固定する。端数は切り捨て、再適用と断片報酬への加算はしない。
 * @param {object} quest 生成した海賊依頼。 @param {number} favor 黒ひげの好感度。 @returns {void}
 */
export function bindPirateReward(quest, favor) {
  if (!quest.pirateKind || quest.rewardFragment || quest.pirateRewardMultiplier != null) return;
  const relation = pirateRelation(favor);
  quest.pirateRewardBase = Math.max(0, Number(quest.reward) || 0);
  quest.pirateRewardRelation = relation;
  quest.pirateRewardMultiplier = PIRATE_REWARD_RATES[relation];
  quest.reward = Math.floor(quest.pirateRewardBase * quest.pirateRewardMultiplier);
}

/** @param {object} quest 依頼。 @returns {string} 保存済みの報酬補正の説明。 */
export function pirateRewardLabel(quest) {
  if (!quest.pirateKind || quest.rewardFragment || !Number.isFinite(quest.pirateRewardMultiplier)) return "";
  const relation = PIRATE_RELATION_LABELS[quest.pirateRewardRelation];
  if (!relation) return "";
  return `黒ひげとの関係：${relation}・資金報酬${Math.round(quest.pirateRewardMultiplier * 100)}%（生成時に確定・反映済み）`;
}
