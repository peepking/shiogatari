import { state } from "./state.js";
import { settlements } from "./map.js";
import { clamp, relationLabel, supportLabel, warScoreLabel, displayWarLabel } from "./util.js";
import { enqueueEvent } from "./events.js";
import { FACTIONS } from "./lore.js";
import { absDay } from "./questUtils.js";

const HONOR_COOLDOWN_DAYS = 30;
const HONOR_ROLL_RATE = 0.12; // 1日あたり12%で来訪。クールダウン付き。
export const HONOR_FAVOR_THRESHOLD = 30;

/**
 * 名誉家臣として仕えている勢力IDリストを返す。
 * @returns {string[]}
 */
export function honorFactions() {
  if (!Array.isArray(state.honorFactions)) state.honorFactions = [];
  return state.honorFactions;
}

/**
 * 名誉家臣フラグを付与する。
 * @param {string} factionId
 */
export function addHonorFaction(factionId) {
  if (!factionId) return;
  state.honorFactions = [factionId];
}

/**
 * 名誉家臣かどうかを判定する。
 * @param {string} factionId
 * @returns {boolean}
 */
export function isHonorFaction(factionId) {
  return honorFactions().includes(factionId);
}

/**
 * 名誉家臣フラグを解除する。
 * @param {string} factionId
 */
export function removeHonorFaction(factionId) {
  if (!factionId) return;
  state.honorFactions = honorFactions().filter((id) => id !== factionId);
  if (state.playerFactionId === factionId) state.playerFactionId = null;
}

/**
 * 現在所属している勢力IDを返す（未所属なら"player"）。
 * @returns {string}
 */
export function getPlayerFactionId() {
  return state.playerFactionId || "player";
}

/**
 * 貴族の好感度を取得する（なければ0）。
 * @param {string} nobleId
 * @returns {number}
 */
export function getNobleFavor(nobleId) {
  if (!nobleId) return 0;
  if (!state.nobleFavor) state.nobleFavor = {};
  return Number(state.nobleFavor[nobleId] || 0);
}

/**
 * 貴族の好感度を加算する。
 * @param {string} nobleId
 * @param {number} delta
 * @returns {number} 更新後の値
 */
export function adjustNobleFavor(nobleId, delta) {
  if (!nobleId || !delta) return getNobleFavor(nobleId);
  if (!state.nobleFavor) state.nobleFavor = {};
  const next = clamp(getNobleFavor(nobleId) + delta, -100, 100);
  state.nobleFavor[nobleId] = next;
  return next;
}

/**
 * 名誉家臣勧誘イベントを日次で判定・投入する。
 * 条件: 名声100以上かつ勢力内で最も好感度が高い貴族の好感度が閾値以上。
 * @param {number} absDay
 */
export function maybeQueueHonorInvite(absDay) {
  if (!state.honorInviteLog) state.honorInviteLog = {};
  if (honorFactions().length > 0) return;
  (FACTIONS || [])
    .filter((f) => f.id !== "pirates")
    .forEach((f) => {
      if (isHonorFaction(f.id)) return;
      if ((state.fame || 0) < 100) return;
      const nobles = f.nobles || [];
      if (!nobles.length) return;
      const best = nobles
        .map((n) => ({ n, favor: getNobleFavor(n.id) }))
        .sort((a, b) => b.favor - a.favor)[0];
      if (!best || best.favor < HONOR_FAVOR_THRESHOLD) return;
      const last = state.honorInviteLog[f.id];
      if (last != null && absDay - last < HONOR_COOLDOWN_DAYS) return;
      if (Math.random() > HONOR_ROLL_RATE) return;
      state.honorInviteLog[f.id] = absDay;
      enqueueEvent({
        title: "名誉家臣の要請",
        body: `${f.name} の ${best.n.name} から名誉家臣の打診が届きました。受け入れますか？`,
        actions: [
          { label: "受け入れる", type: "honor_accept", payload: { factionId: f.id, nobleId: best.n.id } },
          { label: "断る", type: "honor_decline", payload: { factionId: f.id, nobleId: best.n.id } },
        ],
      });
    });
}

/**
 * 勢力状態を初期化/補完する。
 * @returns {object}
 */
export function ensureFactionState() {
  if (!state.factionState) state.factionState = {};
  // 既存のfactionStateが空ならresetState側で初期化済みの値を保持
  return state.factionState;
}

/**
 * 初期の同盟/戦争関係を設定し、戦況エントリを作成する。
 */
export function seedWarDefaults() {
  ensureFactionState();
  if (state.warLedger?.entries?.length) return;
  state.warLedger ||= { entries: [] };
  const setRel = (a, b, rel) => {
    if (state.factionState?.[a]?.relations) state.factionState[a].relations[b] = rel;
    if (state.factionState?.[b]?.relations) state.factionState[b].relations[a] = rel;
  };
  setRel("north", "archipelago", "ally");
  setRel("north", "citadel", "war");
  setRel("archipelago", "citadel", "war");
  const wars = [
    ["north", "citadel"],
    ["archipelago", "citadel"],
  ];
  wars.forEach(([a, b]) => {
    addWarScore(a, b, 0, absDay(state), 0, 0);
  });
}

/**
 * 勢力の状態を取得する。
 * @param {string} factionId
 * @returns {object|null}
 */
export function getFactionState(factionId) {
  ensureFactionState();
  return state.factionState?.[factionId] || null;
}

/**
 * 勢力間の関係を取得する（デフォルト中立）。
 * @param {string} a
 * @param {string} b
 * @returns {"ally"|"neutral"|"war"}
 */
export function getRelation(a, b) {
  if (!a || !b || a === b) return "ally";
  const fa = getFactionState(a);
  return fa?.relations?.[b] || "neutral";
}

/**
 * 関係値を段階ラベルに変換する。
 * @param {number} value
 * @returns {"cold"|"wary"|"soft"|"warm"|"ally"}
 */
export function getRelationLabel(value) {
  return relationLabel(value);
}

/**
 * 拠点の支持度ラベルを返す。
 * @param {string} settlementId
 * @param {string} factionId
 * @returns {"low"|"mid"|"high"}
 */
export function getSupportLabel(settlementId, factionId) {
  const set = settlements.find((s) => s.id === settlementId);
  if (!set) return "mid";
  const val = set.support?.[factionId] ?? 0;
  return supportLabel(val);
}

/**
 * 支持度を戦況に応じて週次で微調整する。
 * 優勢: +1、劣勢: -1、それ以外は変化なし。
 */
export function applySupportDrift() {
  settlements.forEach((s) => {
    if (!s?.factionId) return;
    const entry = getWarEntry(getPlayerFactionId(), s.factionId);
    const label = warScoreLabel(entry?.score || 0);
    let delta = 0;
    if (label === "winning" || label === "advantage") delta = 1;
    else if (label === "losing" || label === "disadvantage") delta = -1;
    if (delta !== 0) adjustSupport(s.id, s.factionId, delta);
  });
}

/**
 * 拠点の支持度を加算する（内部数値のみ）。
 * @param {string} settlementId
 * @param {string} factionId
 * @param {number} delta
 */
export function adjustSupport(settlementId, factionId, delta) {
  const set = settlements.find((s) => s.id === settlementId);
  if (!set || !factionId) return;
  if (!set.support) set.support = {};
  const next = clamp((set.support[factionId] ?? 0) + delta, -100, 100);
  set.support[factionId] = next;
}

/**
 * 戦況スコアのラベルを返す。
 * @param {number} score
 * @returns {"winning"|"advantage"|"even"|"disadvantage"|"losing"}
 */
export function getWarScoreLabel(score) {
  return warScoreLabel(score);
}

/**
 * 勢力間の戦況エントリを取得する（存在しなければnull）。
 * @param {string} a
 * @param {string} b
 * @returns {{id:string,factions:[string,string],score:number,supply:number,faith:number,startedAt:number|null}|null}
 */
export function getWarEntry(a, b) {
  if (!a || !b || a === b) return null;
  if (a === "pirates" || b === "pirates") return null;
  if (a === "player" || b === "player") return null;
  if (getRelation(a, b) !== "war") return null;
  if (!state.warLedger) state.warLedger = { entries: [] };
  const key = makeWarKey(a, b);
  return state.warLedger.entries.find((e) => e.id === key) || null;
}

/**
 * 戦況スコア・兵站・信仰値を更新する（存在しなければ作成する）。
 * @param {string} a 勢力ID
 * @param {string} b 勢力ID
 * @param {number} scoreDelta 戦況スコア加算
 * @param {number|null} startedAt 開始時刻(absDay)
 * @param {number} supplyDelta 兵站加算
 * @param {number} faithDelta 信仰加算
 * @returns {object|null} 更新後のエントリ
 */
export function addWarScore(a, b, scoreDelta, startedAt = null, supplyDelta = 0, faithDelta = 0) {
  if (!a || !b || a === b) return null;
  if (a === "pirates" || b === "pirates") return null;
  if (a === "player" || b === "player") return null;
  if (getRelation(a, b) !== "war") return null;
  if (!state.warLedger) state.warLedger = { entries: [] };
  const key = makeWarKey(a, b);
  let entry = state.warLedger.entries.find((e) => e.id === key);
  if (!entry) {
    entry = {
      id: key,
      factions: sortPair(a, b),
      score: 0,
      supply: 0,
      faith: 0,
      startedAt: startedAt ?? null,
      lastAlert: null,
      lastRequestAbs: null,
    };
    state.warLedger.entries.push(entry);
    activateWarFlag(a, b, startedAt);
  }
  const beforeLabel = warScoreLabel(entry.score);
  entry.score += scoreDelta;
  entry.supply += supplyDelta;
  entry.faith += faithDelta;
  const afterLabel = warScoreLabel(entry.score);
  if (
    beforeLabel !== afterLabel &&
    (afterLabel === "advantage" || afterLabel === "disadvantage" || afterLabel === "winning" || afterLabel === "losing") &&
    entry.lastAlert !== afterLabel
  ) {
    enqueueEvent({
      title: "戦況変化",
      body: `戦況が「${displayWarLabel(afterLabel)}」に変化しました。`,
    });
    entry.lastAlert = afterLabel;
    if (afterLabel === "disadvantage" || afterLabel === "losing") {
      queueLogisticsRequest(entry);
    }
  }
  return entry;
}

function activateWarFlag(a, b, startedAt) {
  const fa = state.factionState?.[a];
  const fb = state.factionState?.[b];
  if (fa) fa.warFlags = { active: true, startedAt: startedAt ?? fa?.warFlags?.startedAt ?? null, fronts: fa?.warFlags?.fronts || [] };
  if (fb) fb.warFlags = { active: true, startedAt: startedAt ?? fb?.warFlags?.startedAt ?? null, fronts: fb?.warFlags?.fronts || [] };
}

function sortPair(a, b) {
  return [a, b].sort((x, y) => (x > y ? 1 : x < y ? -1 : 0));
}

function makeWarKey(a, b) {
  const [x, y] = sortPair(a, b);
  return `${x}__${y}`;
}

/**
 * 兵站支援要請イベントを生成する（劣勢時のサンプル）。
 * @param {object} entry
 */
function queueLogisticsRequest(entry) {
  const factions = entry?.factions || [];
  const pf = getPlayerFactionId();
  const targetFaction = factions.find((f) => f !== pf) || factions[0];
  if (!targetFaction) return;
  const owned = settlements.filter((s) => s.factionId === targetFaction);
  const set = owned[0];
  const place = set ? set.name : "前線";
  const support = set ? getSupportLabel(set.id, targetFaction) : "mid";
  const rate = support === "low" ? 1 : support === "high" ? 0.6 : 0.85;
  if (Math.random() > rate) return;
  const patterns = ["support", "fortify", "truce"];
  const pick = patterns[Math.floor(Math.random() * patterns.length)];
  const body =
    pick === "fortify"
      ? `${place} から籠城準備の支援要請が届いています。物資を送りますか？`
      : pick === "truce"
        ? `${place} から停戦交渉の打診が届いています。動きを後押ししますか？`
        : `${place} から兵站支援要請が届いています。支援しますか？`;
  enqueueEvent({
    title: pick === "truce" ? "停戦の打診" : "兵站要請",
    body,
    actions: [
      {
        id: pick,
        label: pick === "fortify" ? "物資を送る" : pick === "truce" ? "後押しする" : "支援する",
        type: pick,
        payload: { settlementId: set?.id, factionId: targetFaction },
      },
      { id: "ignore", label: "無視する", type: "ignore", payload: { settlementId: set?.id, factionId: targetFaction } },
    ],
  });
}

/**
 * 戦況を日次で確認し、劣勢なら兵站要請イベントを積む。
 * 7日間は再送しないクールダウンでスパムを抑止する。
 * @param {number} absDay 現在の通算日数
 */
export function tickDailyWar(absDay) {
  if (!state.warLedger?.entries) return;
state.warLedger.entries.forEach((entry) => {
    if ((entry.factions || []).includes("pirates")) return;
    if ((entry.factions || []).includes("player")) return;
    const label = warScoreLabel(entry.score);
    const disadvantage = label === "disadvantage" || label === "losing";
    const since = entry.lastRequestAbs != null ? absDay - entry.lastRequestAbs : Infinity;
    if (disadvantage && since >= 7) {
      queueLogisticsRequest(entry);
      entry.lastRequestAbs = absDay;
    }
  });
}
