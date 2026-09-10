/** 受注時に期限を設定する依頼の日数。内部の依頼種別IDをキーにする。 */
export const QUEST_DEADLINE_DAYS = Object.freeze({
  supply: 30,
  delivery: 60,
  refugee_escort: 30,
  pirate_hunt: 45,
  bounty_hunt: 45,
  noble_supply: 30,
  noble_scout: 30,
  noble_security: 60,
  noble_refugee: 60,
  noble_logistics: 60,
  noble_hunt: 60,
});

/**
 * 受注時の期限日数を返す。期限を個別管理する種別は対象外とする。
 * @param {string} type 依頼種別ID。
 * @returns {number|null} 受注からの日数。
 */
export function getQuestDeadlineDays(type) {
  return QUEST_DEADLINE_DAYS[type] ?? null;
}

/**
 * 確定済みの期限を優先し、未受注の場合は共通設定から期限を案内する。
 * @param {object} q 依頼。
 * @param {number} nowAbs 現在の絶対日。
 * @returns {string} 期限の表示文。
 */
export function modalDeadlineText(q, nowAbs) {
  if (q.deadlineAbs != null) {
    const remaining = q.deadlineAbs - nowAbs;
    if (remaining < 0) return "期限切れ";
    if (remaining === 0) return "本日が期限";
    return `残り${remaining}日`;
  }
  const days = getQuestDeadlineDays(q.type);
  return days == null ? "期限なし" : `受注から${days}日`;
}
