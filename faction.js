import { state } from "./state.js";
import { settlements, nobleHome } from "./map.js";
import { clamp, relationLabel, supportLabel, warScoreLabel, displayWarLabel } from "./util.js";
import { enqueueEvent } from "./events.js";
import { pushLog } from "./dom.js";
import { FACTIONS } from "./lore.js";
import { absDay, manhattan, randInt } from "./questUtils.js";

const HONOR_COOLDOWN_DAYS = 30;
const HONOR_ROLL_RATE = 0.12; // 1日あたり12%で来訪。クールダウン付き。
export const HONOR_FAVOR_THRESHOLD = 30;
const RELATION_THRESHOLD_WAR = 100;
const RELATION_THRESHOLD_ALLY = -100;
const RELATION_MULTIPLIER = 1.2;
const BORDER_DIST = 5;

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
 * プレイヤー所属勢力と指定勢力の緊張度を加減する。
 * @param {string} otherFactionId
 * @param {number} delta 正で開戦方向、負で同盟方向
 */
export function adjustPlayerTension(otherFactionId, delta) {
  const pf = getPlayerFactionId();
  if (!otherFactionId || pf === "player" || pf === otherFactionId) return;
  adjustRelationTension(pf, otherFactionId, delta);
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
  if (!state.relationScores) state.relationScores = {};
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
 * 勢力間の関係を設定する（相互に設定）。
 * @param {string} a
 * @param {string} b
 * @param {"ally"|"neutral"|"war"} rel
 */
export function setRelation(a, b, rel) {
  if (!a || !b || a === b) return;
  ensureFactionState();
  state.factionState[a] = state.factionState[a] || { relations: {}, support: {} };
  state.factionState[b] = state.factionState[b] || { relations: {}, support: {} };
  state.factionState[a].relations[b] = rel;
  state.factionState[b].relations[a] = rel;
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
 * ??????????????????
 * @param {string} factionId
 * @param {string} settlementId
 * @returns {{entry: object, front: object}|null}
 */
export function getFrontForSettlement(factionId, settlementId) {
  if (!state?.warLedger?.entries || !factionId || !settlementId) return null;
  for (const entry of state.warLedger.entries) {
    if (!(entry.factions || []).includes(factionId)) continue;
    const front = (entry.activeFronts || []).find((f) => f && !f.resolved && f.settlementId === settlementId);
    if (front) return { entry, front };
  }
  return null;
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
  if (!state.warLedger) state.warLedger = { entries: [] };
  // 戦争状態でない場合は緊張度へ加算し、必要なら開戦/同盟判定
  const relation = getRelation(a, b);
  if (relation !== "war") {
    return adjustRelationTension(a, b, scoreDelta + supplyDelta + faithDelta);
  }
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
      elapsedDays: 0,
      activeFronts: [],
    };
    state.warLedger.entries.push(entry);
    activateWarFlag(a, b, startedAt);
  }
  const attackerIsFirst = a === entry.factions[0];
  const oriented = attackerIsFirst ? 1 : -1;
  const beforeLabel = warScoreLabel(entry.score);
  entry.score += scoreDelta * oriented;
  entry.supply += supplyDelta * oriented;
  entry.faith += faithDelta * oriented;
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

export function addFrontScore(a, b, settlementId, scoreDelta, startedAt = null, supplyDelta = 0, faithDelta = 0) {
  if (!settlementId) return addWarScore(a, b, scoreDelta, startedAt, supplyDelta, faithDelta);
  const entry = getWarEntry(a, b);
  if (!entry) return null;
  const front = (entry.activeFronts || []).find((f) => f && !f.resolved && f.settlementId === settlementId);
  if (!front) return null;
  const oriented = a === entry.factions[0] ? 1 : -1;
  front.localScore = (front.localScore || 0) + scoreDelta * oriented;
  if (supplyDelta) front.localSupply = (front.localSupply || 0) + supplyDelta * oriented;
  if (faithDelta) front.localFaith = (front.localFaith || 0) + faithDelta * oriented;
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

function warScoreFor(entry, factionId) {
  if (!entry) return 0;
  return factionId === entry.factions?.[0] ? entry.score : -entry.score;
}

function factionPairs() {
  const ids = FACTIONS.map((f) => f.id).filter((id) => id !== "pirates");
  const pairs = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      pairs.push([ids[i], ids[j]]);
    }
  }
  return pairs;
}

function minSettlementDistance(a, b) {
  const aSets = settlements.filter((s) => s.factionId === a);
  const bSets = settlements.filter((s) => s.factionId === b);
  if (!aSets.length || !bSets.length) return Infinity;
  let best = Infinity;
  aSets.forEach((as) => {
    bSets.forEach((bs) => {
      const d = manhattan(as.coords, bs.coords);
      if (d < best) best = d;
    });
  });
  return best;
}

function adjustRelationTension(a, b, delta) {
  if (!a || !b || a === b) return null;
  if (a === "pirates" || b === "pirates") return null;
  if (a === "player" || b === "player") return null;
  ensureFactionState();
  state.relationScores ||= {};
  const key = makeWarKey(a, b);
  const currentRel = getRelation(a, b);
  const applied = delta * RELATION_MULTIPLIER;
  // 同盟中で敵対方向に傾いたら即中立
  if (currentRel === "ally" && applied > 0) {
    setRelation(a, b, "neutral");
    state.relationScores[key] = 0;
    return null;
  }
  state.relationScores[key] = (state.relationScores[key] || 0) + applied;
  const tension = state.relationScores[key];
  // 同盟成立判定
  if (tension <= RELATION_THRESHOLD_ALLY) {
    setRelation(a, b, "ally");
    state.relationScores[key] = 0;
    const aName = FACTIONS.find((f) => f.id === a)?.name || a;
    const bName = FACTIONS.find((f) => f.id === b)?.name || b;
    const pf = getPlayerFactionId();
    const playerInvolved = pf === a || pf === b;
    if (playerInvolved) {
      enqueueEvent({ title: "同盟締結", body: `${aName} と ${bName} は同盟を結びました。` });
    } else {
      pushToast("同盟締結", `${aName} と ${bName} は同盟を結びました。`, "info");
    }
    pushLog("同盟締結", `${aName} と ${bName} が同盟を締結`, "-");
    return null;
  }
  // 開戦判定
  if (tension >= RELATION_THRESHOLD_WAR) {
    if (currentRel === "ally") {
      setRelation(a, b, "neutral");
      state.relationScores[key] = 0;
      const aName = FACTIONS.find((f) => f.id === a)?.name || a;
      const bName = FACTIONS.find((f) => f.id === b)?.name || b;
      const pf = getPlayerFactionId();
      const playerInvolved = pf === a || pf === b;
    if (playerInvolved) {
      enqueueEvent({ title: "同盟破棄", body: `${aName} と ${bName} は同盟を解消しました。` });
    } else {
      pushToast("同盟破棄", `${aName} と ${bName} は同盟を解消しました。`, "info");
    }
    pushLog("同盟破棄", `${aName} と ${bName} が同盟を解消`, "-");
    return null;
  }
  setRelation(a, b, "war");
    const seedScore = 0; // 開戦時の戦況はフラットからスタート
    state.relationScores[key] = 0;
    const aName = FACTIONS.find((f) => f.id === a)?.name || a;
    const bName = FACTIONS.find((f) => f.id === b)?.name || b;
    const pf = getPlayerFactionId();
    const playerInvolved = pf === a || pf === b;
    if (playerInvolved) {
      enqueueEvent({ title: "開戦", body: `${aName} と ${bName} の間で戦争が始まりました。` });
    } else {
      pushToast("開戦", `${aName} と ${bName} の間で戦争が始まりました。`, "info");
    }
    pushLog("開戦", `${aName} と ${bName} が交戦状態に入りました`, "-");
    return addWarScore(a, b, seedScore, absDay(state), 0, 0);
  }
  return null;
}

function maybeStartFront(entry, absDay, duration) {
  const factions = entry.factions || [];
  if (factions.length !== 2) return;
  const attacker = Math.random() < 0.5 ? factions[0] : factions[1];
  const defender = attacker === factions[0] ? factions[1] : factions[0];
  const orientedScore = attacker === entry.factions[0] ? entry.score : -entry.score;
  const baseScore = orientedScore;
  const defSets = settlements.filter(
    (s) => s.factionId === defender && !(entry.activeFronts || []).some((f) => f?.settlementId === s.id)
  );
  const atkSets = settlements.filter((s) => s.factionId === attacker);
  if (!defSets.length || !atkSets.length) return;
  // 防衛側の拠点から、攻撃側に最も近いものを優先
  let best = [];
  let bestDist = Infinity;
  defSets.forEach((ds) => {
    const dist = Math.min(...atkSets.map((as) => manhattan(ds.coords, as.coords)));
    if (dist < bestDist) {
      bestDist = dist;
      best = [ds];
    } else if (dist === bestDist) {
      best.push(ds);
    }
  });
  const target = best[Math.floor(Math.random() * best.length)];
  const front = {
    id: `${entry.id}-${absDay}-${Math.random().toString(36).slice(2, 6)}`,
    attacker,
    defender,
    settlementId: target.id,
    startAbs: absDay,
    endAbs: absDay + duration,
    resolved: false,
    baseScore,
    usedKinds: [],
    requestAttempted: false,
  };
  if (!entry.activeFronts) entry.activeFronts = [];
  entry.activeFronts.push(front);
  const attackerName = FACTIONS.find((f) => f.id === attacker)?.name || attacker;
  const defenderName = FACTIONS.find((f) => f.id === defender)?.name || defender;
  const setObj = settlements.find((s) => s.id === target.id);
  const setName = setObj?.name || "拠点";
  const setPos = `(${(setObj?.coords?.x ?? 0) + 1}, ${(setObj?.coords?.y ?? 0) + 1})`;
  const pf = getPlayerFactionId();
  const playerInvolved = pf === attacker || pf === defender;
  if (playerInvolved) {
    enqueueEvent({
      title: "拠点攻撃開始",
      body: `${setName} ${setPos} への攻撃が始まりました。${attackerName} vs ${defenderName}`,
    });
  } else {
    pushToast("拠点攻撃開始", `${setName} ${setPos} への攻撃が始まりました。`, "info");
  }
  pushLog("攻撃開始", `${attackerName} が ${defenderName} の ${setName} ${setPos} を攻撃開始`, "-");
}

function resolveFront(entry, front, attackerWins) {
  if (!front || front.resolved) return;
  front.resolved = true;
  const winner = attackerWins ? front.attacker : front.defender;
  const loser = attackerWins ? front.defender : front.attacker;
  const winnerName = FACTIONS.find((f) => f.id === winner)?.name || winner;
  const loserName = FACTIONS.find((f) => f.id === loser)?.name || loser;
  const set = settlements.find((s) => s.id === front.settlementId);
  if (!set) return;
  const prevNoble = set.nobleId;
  const prevFaction = set.factionId;
  if (attackerWins) {
    set.factionId = winner;
    // 勝者側の拠点保有が少ない貴族に割り当て
    const nobles = FACTIONS.find((f) => f.id === winner)?.nobles || [];
    const counts = nobles.map((n) => ({
      noble: n,
      cnt: settlements.filter((s) => s.factionId === winner && s.nobleId === n.id).length,
    }));
    counts.sort((a, b) => a.cnt - b.cnt);
    const chosen = counts.length ? counts[0].noble : nobles[0];
    if (chosen) {
      set.nobleId = chosen.id;
      set.controllerId = chosen.id;
      nobleHome.set(chosen.id, set.id);
    }
  }
  // 敗者側の貴族がいた場合の退避
  if (prevNoble && prevFaction === loser) {
    const remaining = settlements.filter((s) => s.factionId === loser && s.id !== set.id);
    if (remaining.length) {
      const dest = remaining[Math.floor(Math.random() * remaining.length)];
      nobleHome.set(prevNoble, dest.id);
    } else {
      // 同盟勢力に退避させる
      const ally = FACTIONS.find((f) => f.id !== loser && getRelation(f.id, loser) === "ally");
      const allySets = ally ? settlements.filter((s) => s.factionId === ally.id) : [];
      if (allySets.length) {
        const dest = allySets[Math.floor(Math.random() * allySets.length)];
        nobleHome.set(prevNoble, dest.id);
      } else {
        nobleHome.delete(prevNoble);
      }
    }
  }
  const setName = set?.name ?? "拠点";
  const setPos = `(${(set?.coords?.x ?? 0) + 1}, ${(set?.coords?.y ?? 0) + 1})`;
  const pf = getPlayerFactionId();
  const playerInvolved = pf === front.attacker || pf === front.defender;
  if (playerInvolved) {
    enqueueEvent({
      title: "拠点攻防の決着",
      body: `${setName} ${setPos} は ${winnerName} が占領しました`,
    });
  } else {
    pushToast("拠点攻防の決着", `${setName} ${setPos} は ${winnerName} が占領しました`, "info");
  }
  pushLog("攻防決着", `${setName} ${setPos} が ${winnerName} に占領されました`, "-");
  if (state?.quests?.active) {
    const warTypes = new Set(["war_defend_raid", "war_attack_raid", "war_skirmish", "war_supply", "war_escort", "war_blockade"]);
    state.quests.active = state.quests.active.filter(
      (q) => !(warTypes.has(q.type) && q.frontSettlementId === front.settlementId)
    );
  }
}

function endWar(entry) {
  if (!entry) return;
  const [a, b] = entry.factions || [];
  const aName = FACTIONS.find((f) => f.id === a)?.name || a;
  const bName = FACTIONS.find((f) => f.id === b)?.name || b;
  // warLedger から削除し、関係を中立へ戻す
  const warTypes = new Set(["war_defend_raid", "war_attack_raid", "war_skirmish", "war_supply", "war_escort", "war_blockade"]);
  const frontSettlementIds = (entry.activeFronts || []).map((f) => f?.settlementId).filter(Boolean);
  if (state?.quests?.active && warTypes.size) {
    state.quests.active = state.quests.active.filter((q) => {
      if (!warTypes.has(q.type)) return true;
      if (frontSettlementIds.includes(q.frontSettlementId)) return false;
      if ((entry.factions || []).includes(q.enemyFactionId)) return false;
      return true;
    });
    if (typeof document !== "undefined") {
      document.dispatchEvent(new CustomEvent("quests-updated"));
    }
  }
  state.warLedger.entries = state.warLedger.entries.filter((e) => e !== entry);
  setRelation(a, b, "neutral");
  const fa = state.factionState?.[a];
  const fb = state.factionState?.[b];
  if (fa?.warFlags) fa.warFlags = { active: false, fronts: [] };
  if (fb?.warFlags) fb.warFlags = { active: false, fronts: [] };
  enqueueEvent({
    title: "戦争終結",
    body: `${aName} と ${bName} の戦争が終結しました。`,
  });
  pushLog("戦争終結", `${aName} と ${bName} の戦争が終結しました`, "-");
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

function queueFrontActionRequest(entry, front) {
  const pf = getPlayerFactionId();
  if (!pf || pf === "player") return false;
  const role = front.defender === pf ? "defend" : front.attacker === pf ? "attack" : null;
  if (!role) return false;
  const used = new Set(front.usedKinds || []);
  const kindPool =
    role === "defend"
      ? ["defendRaid", "escort", "skirmish", "supplyFood"]
      : ["attackRaid", "blockade", "skirmish", "supplyFood"];
  const remaining = kindPool.filter((k) => !used.has(k));
  if (!remaining.length) return false;
  // 1回の街攻めにつき1度だけ試行
  if (front.requestAttempted) return false;
  front.requestAttempted = true;
  // ランダムで要請を行う（50%）
  if (Math.random() >= 0.5) return false;
  const kind = remaining[Math.floor(Math.random() * remaining.length)];
  const set = settlements.find((s) => s.id === front.settlementId);
  const setName = set?.name || "拠点";
  const kindLabel = {
    defendRaid: "補給路迎撃",
    attackRaid: "補給路襲撃",
    skirmish: "小規模戦闘",
    supplyFood: "食糧搬入",
    escort: "輸送護衛",
    blockade: "補給封鎖",
  }[kind];
  enqueueEvent({
    title: "前線要請",
    body: `${setName} で「${kindLabel}」を実施してほしいと要請が届きました。受けますか？`,
    actions: [
      {
        id: "accept-front",
        label: "受ける",
        type: "front_request_accept",
        payload: { frontId: front.id, settlementId: front.settlementId, kind },
      },
      {
        id: "ignore-front",
        label: "断る",
        type: "front_request_ignore",
        payload: { frontId: front.id, settlementId: front.settlementId, kind },
      },
    ],
  });
  return true;
}

/**
 * 戦況を日次で確認し、劣勢なら兵站要請イベントを積む。
 * 7日間は再送しないクールダウンでスパムを抑止する。
 * @param {number} absDay 現在の通算日数
 */
export function tickDailyWar(absDay) {
  if (!state.warLedger?.entries) return;
  const ATTACK_CHANCE = 0.05;
  const FRONT_DURATION = 90;
  const FRONT_THRESHOLD = 60;

  state.warLedger.entries.forEach((entry) => {
    if ((entry.factions || []).includes("pirates")) return;
    if ((entry.factions || []).includes("player")) return;
    entry.elapsedDays = (entry.elapsedDays || 0) + 1;

    // 進行中フロントの決着判定
    entry.activeFronts = (entry.activeFronts || []).filter((front) => {
      if (!front || front.resolved) return false;
      const orientedScore = front.attacker === entry.factions[0] ? entry.score : -entry.score;
      const base = front.baseScore ?? 0;
      const local = front.localScore || 0;
      const delta = orientedScore + local - base;
      const overThreshold = delta >= FRONT_THRESHOLD || delta <= -FRONT_THRESHOLD;
      const timeUp = absDay >= (front.endAbs || 0);
      if (!overThreshold && !timeUp) return true;
      const attackerWins = overThreshold ? delta > 0 : delta >= 0;
      resolveFront(entry, front, attackerWins);
      return false;
    });

    // 前線要請（1街攻め1回まで）
    (entry.activeFronts || []).forEach((front) => {
      if (!front || front.resolved) return;
      queueFrontActionRequest(entry, front);
    });

    // 劣勢時の兵站要請
    const label = warScoreLabel(entry.score);
    const disadvantage = label === "disadvantage" || label === "losing";
    const since = entry.lastRequestAbs != null ? absDay - entry.lastRequestAbs : Infinity;
    if (disadvantage && since >= 7) {
      queueLogisticsRequest(entry);
      entry.lastRequestAbs = absDay;
    }

    // 戦争終結判定（経過日 or 閾値）
    const WAR_END_THRESHOLD = 120;
    if (entry.elapsedDays >= FRONT_DURATION || Math.abs(entry.score) >= WAR_END_THRESHOLD) {
      endWar(entry);
      return;
    }

    // 新規攻撃開始（最大2拠点）
    const activeCount = (entry.activeFronts || []).length;
    if (activeCount >= 2) return;
    if (Math.random() > ATTACK_CHANCE) return;
    maybeStartFront(entry, absDay, FRONT_DURATION);
  });
}

/**
 * NPC間の緊張度を日次で揺らし、開戦/同盟を自動で発生させる。
 * @param {number} absDay
 */
export function tickRelationDrift(absDay) {
  factionPairs().forEach(([a, b]) => {
    const rel = getRelation(a, b);
    let delta = randInt(-1, 1); // 毎日小さく揺らす
    // 週次で少し大きめに揺らす
    if (absDay % 7 === 0) delta += randInt(-2, 2);
    // 国境が近いと緊張が高まりやすい
    const dist = minSettlementDistance(a, b);
    if (Number.isFinite(dist)) {
      if (dist <= BORDER_DIST && rel !== "ally") delta += 1;
      if (dist > BORDER_DIST + 3 && rel === "ally") delta -= 1;
    }
    if (delta !== 0) adjustRelationTension(a, b, delta);
  });
}
