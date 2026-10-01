import { receiveFunds } from "../core/voyageStats.js";
import { recordCrime, WANTED_FACTIONS } from "./playerWanted.js";
import { wantedEntryReason } from "./wantedPolicy.js";
import { MODE_LABEL } from "../core/constants.js";
import { absDay, SEASONS_PER_YEAR } from "../core/calendar.js";

/** 窃盗の基準報酬。拠点規模と乱数を適用し、市場在庫・名声には依存しない。 */
export const THEFT_TYPES = Object.freeze({
  theft_market: Object.freeze({ name: "市場で盗む", funds: 500, supplies: Object.freeze({ salt: 2 }), support: -2, favor: -2 }),
  theft_granary: Object.freeze({ name: "兵糧庫で盗む", funds: 0, supplies: Object.freeze({ food: 30, wood: 5 }), support: -4, favor: -4 }),
  theft_armory: Object.freeze({ name: "武器庫で盗む", funds: 0, supplies: Object.freeze({ arms: 8, iron: 10 }), support: -8, favor: -8, battle: true }),
  settlement_raid: Object.freeze({ name: "拠点を襲撃", funds: 5000, supplies: Object.freeze({ food: 50, wood: 10 }), support: -15, favor: -15, battle: true, raid: true, banDays: 30, enemyScale: 1.5 }),
});

/** 村は報酬・関係悪化・守備隊を半分、街は1.5倍。旧データの種別欠損は従来倍率。 @param {object} settlement 拠点。 @returns {number} 規模倍率。 */
export function crimeScale(settlement) { return settlement.kind === "village" ? 0.5 : settlement.kind === "town" ? 1.5 : 1; }

/** 基本報酬の80～120%を整数で一様抽選する。成立時に一度だけ抽選し戦闘報酬は保存する。
 * @param {object} settlement 拠点。 @param {string} kind 行動。 @param {Function} random 乱数源。 @returns {object} 資金と物資。
 */
export function rollCrimeReward(settlement, kind, random = Math.random) {
  const rule = THEFT_TYPES[kind], scale = crimeScale(settlement);
  /** @param {number} base 基準量。 @returns {number} 整数報酬。 */
  const roll = base => { const low = Math.floor(base * scale * 0.8), high = Math.ceil(base * scale * 1.2); return low + Math.floor(random() * (high - low + 1)); };
  return { funds: roll(rule.funds), supplies: Object.fromEntries(Object.entries(rule.supplies).map(([id, qty]) => [id, roll(qty)])) };
}

/** 拠点全体で季節1回。名誉家臣・保留イベント・容量不足は何も消費せず拒否する。
 * @param {object} state 状態。 @param {object} settlement 拠点。 @param {string} kind 種別。 @param {number} space 空き容量。 @returns {string} 不可理由。
 */
export function theftReason(state, settlement, kind, space) {
  const rule = THEFT_TYPES[kind];
  if (!rule || !settlement?.id || !WANTED_FACTIONS.includes(settlement.factionId)) return "対象がありません。";
  if (state.honorFactions?.length) return "名誉家臣は犯罪を選べません。先に名誉家臣を辞してください。";
  const modes = rule.raid ? [MODE_LABEL.NORMAL, MODE_LABEL.IN_TOWN, MODE_LABEL.IN_VILLAGE] : [MODE_LABEL.IN_TOWN, MODE_LABEL.IN_VILLAGE];
  if (rule.raid && (settlement.pirateHaven || settlement.factionId === "pirates")) return "拠点襲撃は通常勢力の街・村が対象です。";
  if (!modes.includes(state.modeLabel) || (!rule.raid && wantedEntryReason(state, settlement, absDay(state)))) return "窃盗には街・村への入場が必要です。";
  if (state.pendingEncounter?.active || state.eventQueue?.length || state.wanted?.detention) return "進行中の出来事を先に解決してください。";
  if (rule.battle && !Object.values(state.troops || {}).some(levels => typeof levels === "number" ? levels > 0 : Object.values(levels).some(n => n > 0))) return "守備隊との戦闘には部隊員が必要です。";
  if (state.wanted?.settlementActions?.[settlement.id]?.[rule.raid ? "raidSeason" : "theftSeason"] === state.year * SEASONS_PER_YEAR + state.season) return `この拠点では今季すでに${rule.raid ? "襲撃" : "窃盗"}を行いました。`;
  if (Object.values(rule.supplies).reduce((sum, n) => sum + Math.ceil(n * crimeScale(settlement) * 1.2), 0) > space) return "報酬の最大数量を受け取る物資の空き容量が足りません。";
  return "";
}

/** 再検証後に犯罪・季節枠・固定報酬を一括反映する。関係悪化と保存は呼出元で同じ取引として扱う。
 * @param {object} state 状態。 @param {object} settlement 拠点。 @param {string} kind 種別。 @param {number} space 空き容量。 @param {object} reward 抽選済み報酬。 @returns {boolean} 成立したか。
 */
export function commitTheft(state, settlement, kind, space, reward) {
  if (theftReason(state, settlement, kind, space)) return false;
  reward ||= rollCrimeReward(settlement, kind);
  if (!recordCrime(state, kind, {}, absDay(state), settlement.factionId)) return false;
  const rule = THEFT_TYPES[kind];
  const activity = state.wanted.settlementActions[settlement.id] ||= {};
  activity[rule.raid ? "raidSeason" : "theftSeason"] = state.year * SEASONS_PER_YEAR + state.season;
  if (rule.raid) activity.bannedUntil = absDay(state) + rule.banDays;
  if (rule.battle) return true;
  receiveFunds(state, reward.funds);
  state.supplies ||= {};
  for (const [id, qty] of Object.entries(reward.supplies)) state.supplies[id] = (state.supplies[id] || 0) + qty;
  return true;
}

/** 勝利時だけ予約された武器庫報酬を一度与える。通常戦利品とは別枠で、超過物資はプレイヤーが整理する。
 * @param {object} state 状態。 @param {object} encounter 戦闘準備情報。 @param {boolean} won 勝利か。 @returns {Array} 表示用資源。
 */
export function finishTheftBattle(state, encounter, won) {
  if (!THEFT_TYPES[encounter?.theftKind]?.battle || encounter.theftResolved) return [];
  encounter.theftResolved = true;
  if (!won) return [];
  const goods = encounter.theftReward;
  if (!goods) return [];
  state.supplies ||= {};
  const resources = [];
  if (encounter.theftFunds > 0) {
    receiveFunds(state, encounter.theftFunds);
    resources.push({ id: "funds", label: "資金", value: encounter.theftFunds });
  }
  return resources.concat(Object.entries(goods).map(([id, qty]) => {
    state.supplies[id] = (state.supplies[id] || 0) + qty;
    return { id, label: { arms: "武具", iron: "鉄", food: "食料", wood: "木材" }[id] || id, value: qty };
  }));
}
