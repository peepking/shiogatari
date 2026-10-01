import { spendFunds } from "../core/voyageStats.js";
import { WANTED_FACTIONS } from "./playerWanted.js";
import { BOUNTY_CONFIG } from "../bounty/bountyConfig.js";

/** 手配対応の調整値。 */
export const WANTED_POLICY = Object.freeze({ compensationRate: 1.5, suspension: 1000, facilityRestriction: 1000, tradeRestriction: 3000, entryRestriction: 6000, emergencyFoodLimit: 30, emergencyFoodRate: 1.5 });

/** 港外の報告・清算窓口は維持し、現支配勢力の期限内賞金だけで入場を拒否する。
 * @param {object} state 状態。 @param {object} settlement 拠点。 @param {number} now 絶対日。 @returns {string} 入場拒否理由。
 */
export function wantedEntryReason(state, settlement, now) {
  const bannedUntil = state.wanted?.settlementActions?.[settlement?.id]?.bannedUntil || 0;
  if (now < bannedUntil) return `襲撃によりこの拠点はあと${bannedUntil - now}日間利用禁止です。報告は依頼カード、補給・清算は賞金首・港外窓口から行えます。`;
  const record = state.wanted?.byFaction?.[settlement?.factionId];
  return record?.amount >= WANTED_POLICY.entryRestriction && Number.isSafeInteger(record.lastCrimeAbs) && now - record.lastCrimeAbs < BOUNTY_CONFIG.lifetime
    ? "この勢力の賞金が6,000以上のため入場を拒否されています。賞金首・港外窓口から補給・賠償・投降・辞任ができます。受注済み依頼は依頼カードから報告できます。" : "";
}

/** 現在の支配勢力だけを参照する。報告・清算は対象外で、無法港の犯罪依頼も残す。
 * @param {object} state 状態。 @param {object} settlement 拠点。 @param {string} service 施設用途。 @param {number} now 絶対日。 @returns {string} 制限理由。
 */
export function wantedFacilityReason(state, settlement, service, now) {
  if (!["hire", "audience", "quest", "nobleQuest", "trade", "shipBuy"].includes(service)) return "";
  if (service === "quest" && settlement?.pirateHaven) return "";
  const record = state.wanted?.byFaction?.[settlement?.factionId];
  const trade = ["trade", "shipBuy"].includes(service);
  if (!record || record.amount < (trade ? WANTED_POLICY.tradeRestriction : WANTED_POLICY.facilityRestriction) || !Number.isSafeInteger(record.lastCrimeAbs) || now - record.lastCrimeAbs >= BOUNTY_CONFIG.lifetime) return "";
  if (trade) return "この勢力から重罪人として手配されているため、通常取引・船の購入は利用できません。最低限の食料は窓口で交渉から購入できます。";
  return "この勢力から指名手配されているため、雇用・貴族面会・新規の通常依頼は利用できません。受注済み依頼は依頼カードから報告できます。";
}

/** 所属は保持したまま、期限内の自勢力手配による資格停止を判定する。
 * @param {object} state 状態。 @param {string} factionId 勢力。 @param {number} now 絶対日。 @returns {string} 停止理由。
 */
export function honorSuspensionReason(state, factionId, now) {
  const record = state.wanted?.byFaction?.[factionId];
  return state.honorFactions?.includes(factionId) && record?.amount >= WANTED_POLICY.suspension && Number.isSafeInteger(record.lastCrimeAbs) && now - record.lastCrimeAbs < BOUNTY_CONFIG.lifetime
    ? "自勢力の賞金が1,000以上のため家臣機能は停止中です。手配額を下げると再開します。受注済み依頼の報告・辞任・賠償は可能です。" : "";
}

/** 明示的な犯罪選択だけを禁止し、救助や通常戦闘・既存依頼報告は含めない。 */
export const CRIMINAL_ACTIONS = Object.freeze(["merchant_attack", "merchant_rescue_attack", "refugee_attack", "checkpoint_force", "pirate_force"]);

/** @param {object} state 状態。 @param {object} action 行動。 @returns {string} 実行不可の理由。 */
export function crimeRestriction(state, action) {
  return state.honorFactions?.length && CRIMINAL_ACTIONS.includes(action?.type)
    ? "名誉家臣は犯罪行動を選べません。拠点の賞金首一覧から、明示的に名誉家臣を辞してください。" : "";
}

/** 対象勢力だけを清算する見積もり。履歴・好感度を変更せず、端数は切り上げる。
 * @param {object} state 状態。 @param {string} factionId 対象勢力。 @param {number} now 絶対日。 @returns {object} 費用または拒否理由。
 */
export function quoteWantedCompensation(state, factionId, now) {
  const record = state.wanted?.byFaction?.[factionId];
  if (!WANTED_FACTIONS.includes(factionId) || !record?.amount || now - record.lastCrimeAbs >= BOUNTY_CONFIG.lifetime) return { error: "この勢力からの手配はありません。" };
  const cost = Math.ceil(record.amount * WANTED_POLICY.compensationRate);
  if (!Number.isSafeInteger(cost)) return { error: "清算額が大きすぎます。" };
  return { cost, amount: record.amount, affordable: state.funds >= cost };
}

/** 確認後にも金額と所持資金を再検証し、指定勢力の手配だけを解除する。履歴は残す。
 * @param {object} state 状態。 @param {string} factionId 勢力。 @param {number} now 日付。 @param {number} amount 確認済み賞金額。 @returns {boolean} 清算できたか。
 */
export function compensateWanted(state, factionId, now, amount) {
  const quote = quoteWantedCompensation(state, factionId, now);
  if (quote.error || !quote.affordable || quote.amount !== amount) return false;
  spendFunds(state, quote.cost);
  state.wanted.byFaction[factionId] = { amount: 0, lastCrimeAbs: null };
  return true;
}
