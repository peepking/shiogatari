import { MODE_LABEL, PLACE } from "./constants.js";
import { pushLog, pushToast, setOutput } from "./dom.js";
import { enqueueEvent } from "./events.js";
import {
  addWarScore,
  adjustNobleFavor,
  adjustSupport,
  getFrontById,
  getPlayerFactionId,
  getRelation,
  getWarEntry,
  isSettlementUnderSiege,
} from "./faction.js";
import { FACTIONS } from "./lore.js";
import { getLocationStatus, getSettlementAtPosition, getSettlementById, getTerrainAt, settlements } from "./map.js";
import {
  addRefugeeEscortQuest,
  addWarFrontQuest,
  completeNobleRefugeeAt,
  completeRefugeeEscortAt,
  completeWarEscortAt,
  markNobleRefugeePickup,
  markWarEscortPickup,
} from "./quests.js";
import { absDay, manhattan, NORMAL_ANCHORS, pickAnchorRange, randInt, STRONG_ANCHORS } from "./questUtils.js";
import { state } from "./state.js";
import { calcSupplyCap, createSettlementDemand, SUPPLY_ITEMS, totalSupplies } from "./supplies.js";
import { advanceDayWithEvents } from "./time.js";
import { calcTroopCap, totalTroops, TROOP_STATS } from "./troops.js";
import { clamp, warScoreLabel } from "./util.js";

/**
 * エンカウント歩数
 */
const ENCOUNTER_MIN = 10;
const ENCOUNTER_MAX = 15;
/**
 * 強プール確率
 */
const STRONG_POOL_CHANCE = 0.25;
const FRONT_ENCOUNTER_RADIUS = 2;
const TRAVEL_EVENT_RADIUS = 5;
const TRAVEL_EVENT_COOLDOWN_DAYS = 7;
const MERCHANT_EVENT_RATE = 0.02;
const RESCUE_EVENT_RATE = 0.02;
const SMUGGLE_EVENT_RATE = 0.03;
const REFUGEE_EVENT_RATE = 0.02;
const CHECKPOINT_EVENT_RATE = 0.01;
const OMEN_EVENT_RATE = 0.01;
const WRECK_EVENT_RATE = 0.03;
const TRAITOR_EVENT_RATE = 0.02;

let travelSync = null;
const travelEventTags = new Set(["merchant_attack", "merchant_rescue_help", "merchant_rescue_raid", "smuggle_raid", "refugee_raid", "checkpoint_force", "omen_attack", "wreck_attack"]);

/**
 * 前線拠点からの距離を見て、交戦中フロントの情報を返す。
 * @param {{x:number,y:number}} pos 現在位置
 * @returns {{enemyFactionId:string,frontId:string,d:number}|null}
 */
function pickFrontEncounter(pos) {
  const pf = getPlayerFactionId();
  if (!pf || pf === "player" || !state.warLedger?.entries) return null;
  let best = null;
  state.warLedger.entries.forEach((entry) => {
    if (!(entry.factions || []).includes(pf)) return;
    (entry.activeFronts || []).forEach((front) => {
      if (!front || front.resolved) return;
      const set = settlements.find((s) => s.id === front.settlementId);
      if (!set?.coords) return;
      const d = manhattan(set.coords, pos);
      if (d <= FRONT_ENCOUNTER_RADIUS && (!best || d < best.d)) {
        const enemy = front.attacker === pf ? front.defender : front.attacker;
        best = { enemyFactionId: enemy, frontId: front.id, d };
      }
    });
  });
  return best;
}

/** エンカウント進捗と閾値をリセットする。 */
export function resetEncounterMeter() {
  state.encounterProgress = 0;
  state.encounterThreshold = randInt(ENCOUNTER_MIN, ENCOUNTER_MAX);
}

/**
 * 移動系ランダムイベントのUI同期関数を登録する。
 * @param {Function|null} syncUI
 */
export function setTravelEventSync(syncUI) {
  travelSync = typeof syncUI === "function" ? syncUI : null;
}

/**
 * 自動移動を停止させるためのイベントを通知する。
 */
function notifyAutoMoveStop() {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent("auto-move-stop"));
}

/**
 * 名声と強敵フラグから敵編成を生成する。
 * @param {"normal"|"elite"|null} forceStrength 強敵プール強制指定
 * @param {string|null} enemyFactionId 敵勢力ID（正規軍プール判定用）
 * @returns {{formation:Array, total:number, strength:string, terrain?:string}} 生成結果
 */
export function buildEnemyFormation(forceStrength, enemyFactionId = null) {
  const fame = Math.max(0, state.fame || 0);
  const useRegular = enemyFactionId && enemyFactionId !== "pirates";
  const useStrong =
    forceStrength === "elite"
      ? true
      : forceStrength === "normal"
        ? false
        : fame >= 100 && Math.random() < STRONG_POOL_CHANCE;
  const useStrongScale = useStrong || useRegular;
  const range = useStrongScale ? pickAnchorRange(fame, STRONG_ANCHORS) : pickAnchorRange(fame, NORMAL_ANCHORS);
  const total = randInt(range.min, range.max);
  const basePool = useRegular
    ? Object.keys(TROOP_STATS).filter((k) => k !== "scout" && k !== "medic")
    : useStrong
      ? Object.keys(TROOP_STATS)
      : ["infantry", "archer", "scout", "marine"];
  const pool = basePool.slice().sort(() => Math.random() - 0.5).slice(0, Math.min(6, basePool.length));
  if (!pool.length) pool.push("infantry");
  const formation = [];
  let remain = total;
  while (remain > 0) {
    const type = pool[randInt(0, pool.length - 1)];
    const level = useStrongScale ? randInt(1, 3) : 1;
    const chunk = Math.min(remain, Math.max(1, randInt(5, 10)));
    formation.push({ type, count: chunk, level });
    remain -= chunk;
  }
  return { formation, total, strength: useStrongScale ? "elite" : "normal" };
}

/**
 * エンカウント時に出現する勢力IDを選ぶ。前線近傍なら交戦勢力のみ、それ以外は海賊固定。
 * @param {{x:number,y:number}} pos 現在位置
 * @param {string} terrain 地形ID
 * @returns {string} 勢力ID
 */
function pickEncounterFaction(pos, terrain) {
  const regionWeight = new Map();
  settlements.forEach((s) => {
    if (!s?.factionId) return;
    const dist = manhattan(s.coords, pos);
    if (dist > FRONT_ENCOUNTER_RADIUS) return;
    const w = FRONT_ENCOUNTER_RADIUS - dist + 1;
    regionWeight.set(s.factionId, (regionWeight.get(s.factionId) || 0) + w);
  });
  const pf = getPlayerFactionId();
  const warNearby = FACTIONS.filter(
    (f) => f.id !== "pirates" && f.id !== pf && getRelation(pf, f.id) === "war" && regionWeight.has(f.id)
  );
  const warFactor = (fid) => {
    const entry = getWarEntry(getPlayerFactionId(), fid);
    const label = warScoreLabel(entry?.score || 0);
    if (label === "losing") return 1.5;
    if (label === "disadvantage") return 1.2;
    if (label === "advantage") return 0.8;
    if (label === "winning") return 0.7;
    return 1;
  };
  const entries = [];
  const pirateBase = terrain === "sea" || terrain === "shoal" ? 1.0 : 0.3;
  const pushFaction = (fid, base) => {
    let w = base;
    const rw = regionWeight.get(fid) || 0;
    if (rw > 0) w *= 1 + rw / 10;
    w *= warFactor(fid);
    entries.push({ fid, w });
  };
  pushFaction("pirates", pirateBase);
  warNearby.forEach((f) => {
    const base = 1.0; // 近傍の交戦勢力のみ
    pushFaction(f.id, base);
  });
  const total = entries.reduce((s, e) => s + e.w, 0);
  if (total <= 0) return "pirates";
  let roll = Math.random() * total;
  for (const e of entries) {
    roll -= e.w;
    if (roll <= 0) return e.fid;
  }
  return entries[entries.length - 1].fid || "pirates";
}

/**
 * エンカウントを生成し、戦闘準備用のメタデータを返す（UIは呼び出し側で処理）。
 * @returns {{title:string,message:string,log:string,detail:object}} UI表示用の情報
 */
function triggerEncounter() {
  const terrain = getTerrainAt(state.position.x, state.position.y) || "plain";
  const frontHint = pickFrontEncounter(state.position);
  const enemyFactionId = frontHint?.enemyFactionId || pickEncounterFaction(state.position, terrain);
  const { formation, total, strength } = buildEnemyFormation(null, enemyFactionId);
  state.pendingEncounter = {
    active: true,
    enemyFormation: formation,
    enemyTotal: total,
    strength,
    terrain,
    enemyFactionId,
    frontId: frontHint?.frontId || null,
  };
  state.modeLabel = MODE_LABEL.PREP;
  resetEncounterMeter();
  const enemyName = FACTIONS.find((f) => f.id === enemyFactionId)?.name || "敵勢力";
  const strengthLabel =
    strength === "elite"
      ? enemyFactionId !== "pirates"
        ? "正規軍"
        : "強編成"
      : "通常編成";
  return {
    title: "敵襲",
    message: `${enemyName} と遭遇しました（推定${total}人 / ${strengthLabel}）。行動を選んでください。`,
    log: `${enemyName} と遭遇（推定${total}人 / ${strengthLabel}）。`,
    detail: { enemyName, total, strengthLabel, enemyFactionId, frontId: frontHint?.frontId || null },
  };
}

/**
 * 移動進捗に応じてエンカウントをチェックする。
 * @returns {{ok:boolean, info?:object}} 発生した場合はinfoを含む
 */
function maybeTriggerEncounter() {
  if (state.pendingEncounter?.active) return { ok: false };
  const loc = getLocationStatus();
  // 村/街タイル上ではエンカウントしないが、リセットもしない（入場時のみリセット）
  if (loc?.place === PLACE.VILLAGE || loc?.place === PLACE.TOWN) return { ok: false };
  const threshold = clamp(state.encounterThreshold || ENCOUNTER_MIN, ENCOUNTER_MIN, ENCOUNTER_MAX);
  const terrain = getTerrainAt(state.position.x, state.position.y) || "plain";
  const frontHint = pickFrontEncounter(state.position);
  const enemyFactionId = frontHint?.enemyFactionId || pickEncounterFaction(state.position, terrain);
  const playerFid = getPlayerFactionId();
  const nearbyEnemyBoost = enemyFactionId !== "pirates" && enemyFactionId !== playerFid ? 1.3 : 1;
  const escortBoost = state.refugeeEscort?.active ? 3 : 1;
  state.encounterProgress = (state.encounterProgress || 0) + nearbyEnemyBoost * escortBoost;
  if (state.encounterProgress >= threshold) {
    const info = triggerEncounter();
    return { ok: true, info: { ...info, enemyFactionId } };
  }
  return { ok: false };
}

/**
 * マップ境界内への移動か判定する。
 * @param {{x:number,y:number}} from 現在位置
 * @param {{x:number,y:number}} to 目標位置
 * @returns {boolean}
 */
export function isValidMove(from, to) {
  if (!to) return false;
  const dx = Math.abs((to.x ?? 0) - (from.x ?? 0));
  const dy = Math.abs((to.y ?? 0) - (from.y ?? 0));
  // 上下左右方向で最大1マスまで移動可
  if (dx === 0 && dy === 1) return true;
  if (dy === 0 && dx === 1) return true;
  return false;
}

/**
 * 選択したマスへ移動し、エンカウントやUI更新を行う。
 * @param {Function} showActionMessage アクションメッセージ表示
 * @param {Function} syncUI UI同期関数
 * @returns {boolean} 移動成功か
 */
export function moveToSelected(syncUI) {
  // 謁見モードのまま移動した場合は通常モードに戻す
  if (state.modeLabel === MODE_LABEL.AUDIENCE) {
    state.modeLabel = MODE_LABEL.NORMAL;
  }
  if (state.pendingEncounter?.active) {
    return { ok: false, code: "prep-active" };
  }
  if (state.modeLabel === MODE_LABEL.BATTLE) {
    return { ok: false, code: "in-battle" };
  }
  const supplyTotal = totalSupplies();
  const supplyCap = calcSupplyCap(state.ships);
  if (supplyTotal > supplyCap) {
    return { ok: false, code: "over-supply", detail: { supplyTotal, supplyCap } };
  }
  const troopTotal = totalTroops();
  const troopCap = calcTroopCap(state.ships);
  if (troopTotal > troopCap) {
    return { ok: false, code: "over-troop", detail: { troopTotal, troopCap } };
  }
  const dest = state.selectedPosition;
  if (!dest) {
    return { ok: false, code: "no-destination" };
  }
  if (!isValidMove(state.position, dest)) {
    return { ok: false, code: "invalid-move" };
  }
  if (state.modeLabel === MODE_LABEL.IN_VILLAGE || state.modeLabel === MODE_LABEL.IN_TOWN) {
    state.modeLabel = MODE_LABEL.NORMAL;
  }
  state.position = { ...dest };
  markNobleRefugeePickup(state.position);
  markWarEscortPickup(state.position);
  const arrivedSet = getSettlementAtPosition(state.position.x, state.position.y);
  if (arrivedSet) {
    completeWarEscortAt(arrivedSet);
  }
  advanceDayWithEvents(1);
  setTravelEventSync(syncUI);
  const travelEventHit = rollTravelEvents();
  if (travelEventHit) {
    notifyAutoMoveStop();
    return { ok: false, code: "travel-event" };
  }
  const enc = maybeTriggerEncounter();
  if (enc?.ok) {
    notifyAutoMoveStop();
    return { ok: true, code: "encounter", detail: enc.info };
  }
  checkRefugeeEscortArrival();
  completeNobleRefugeeAt(getSettlementAtPosition(state.position.x, state.position.y));
  syncUI?.();
  return { ok: true, code: "moved", detail: { pos: { ...state.position } } };
}

/**
 * 村/街への入場を試みる。
 * @param {"village"|"town"} target 入場先種別
 * @param {Function} clearActionMessage 表示中のメッセージを消す
 * @param {Function} syncUI UI同期関数
 * @returns {boolean} 入場できたか
 */
export function attemptEnter(target, clearActionMessage, syncUI) {
  if (state.pendingEncounter?.active) {
    setOutput("入場できません", "戦闘準備中は拠点に入れません。先に戦闘を処理してください。", [
      { text: "戦闘準備", kind: "warn" },
      { text: "入場不可", kind: "warn" },
    ]);
    return false;
  }
  const loc = getLocationStatus();
  const targetPlace = target === "village" ? PLACE.VILLAGE : PLACE.TOWN;
  const insideLabel = target === "village" ? MODE_LABEL.IN_VILLAGE : MODE_LABEL.IN_TOWN;
  if (loc?.place !== targetPlace) {
    setOutput("入場できません", `${targetPlace}にいません。`, [
      { text: targetPlace, kind: "warn" },
      { text: "移動が必要", kind: "warn" },
    ]);
    return false;
  }
  const hereSettlement = getSettlementAtPosition(state.position.x, state.position.y);
  if (hereSettlement && isSettlementUnderSiege(hereSettlement.id)) {
    setOutput("入場できません", "防衛中の拠点には入れません。戦闘の行方を見守りましょう。", [
      { text: "防衛中", kind: "warn" },
      { text: "入場不可", kind: "warn" },
    ]);
    return false;
  }
  state.modeLabel = insideLabel;
  resetEncounterMeter();
  setOutput("入場", `${targetPlace}に入りました。`, [
    { text: targetPlace, kind: "" },
    { text: "滞在", kind: "" },
  ]);
  pushLog("入場", `${targetPlace}に入りました`, state.lastRoll ?? "-");
  clearActionMessage?.();
  syncUI?.();
  return true;
}

/**
 * 村/街から出る処理を行い通常モードへ戻す。
 * @param {"village"|"town"} target 退出対象
 * @param {object} elements DOM要素群
 * @param {Function} clearActionMessage メッセージ消去
 * @param {Function} setTradeError 取引エラー設定
 * @param {Function} syncUI UI同期
 * @returns {boolean} 退出できたか
 */
export function attemptExit(target, elements, clearActionMessage, setTradeError, syncUI) {
  const label = target === "village" ? MODE_LABEL.IN_VILLAGE : MODE_LABEL.IN_TOWN;
  const place = target === "village" ? PLACE.VILLAGE : PLACE.TOWN;
  if (state.modeLabel !== label) {
    setOutput("出られません", `${label}ではありません。`, [
      { text: "場所", kind: "warn" },
      { text: "移動が必要", kind: "warn" },
    ]);
    return false;
  }
  state.modeLabel = MODE_LABEL.NORMAL;
  resetEncounterMeter();
  setOutput("出発", `${place}を出ました。`, [
    { text: "移動", kind: "" },
    { text: "通常", kind: "" },
  ]);
  pushLog("出発", `${place}を出ました`, state.lastRoll ?? "-");
  if (elements?.ctxEl) elements.ctxEl.value = "move";
  clearActionMessage?.();
  setTradeError?.("");
  syncUI?.();
  return true;
}

/**
 * 1日経過処理を行いUIを更新する。
 * @param {object} elements DOM要素群
 * @param {Function} clearActionMessage メッセージ消去
 * @param {Function} syncUI UI同期
 * @returns {void}
 */
export function waitOneDay(elements, clearActionMessage, syncUI) {
  if (state.pendingEncounter?.active) {
    setOutput("待機できません", "戦闘準備中は待機できません。行動を選んでください。", [
      { text: "戦闘準備", kind: "warn" },
      { text: "待機不可", kind: "warn" },
    ]);
    return false;
  }
  if (state.modeLabel === MODE_LABEL.BATTLE) {
    setOutput("待機できません", "戦闘中は待機できません。地図に戻ってください。", [
      { text: "戦闘中", kind: "warn" },
      { text: "待機不可", kind: "warn" },
    ]);
    return false;
  }
  advanceDayWithEvents(1);
  setOutput("待機", "1日待機しました。", [
    { text: "待機", kind: "" },
    { text: "日数+1", kind: "" },
  ]);
  pushLog("待機", "1日待機", state.lastRoll ?? "-");
  clearActionMessage?.();
  if (elements?.ctxEl) elements.ctxEl.value = "move";
  setTravelEventSync(syncUI);
  syncUI?.();
  return true;
}

/**
 * 現在位置の拠点情報を返す。
 * @returns {object|null} 拠点情報
 */
export function getCurrentSettlement() {
  return getSettlementAtPosition(state.position.x, state.position.y);
}

/**
 * 移動時のランダムイベントを判定し、発火する。
 * @returns {boolean} イベントが発生したか
 */
export function rollTravelEvents() {
  if (state.pendingEncounter?.active) return false;
  if (state.modeLabel === MODE_LABEL.BATTLE || state.modeLabel === MODE_LABEL.PREP) return false;
  if ((state.travelEventCooldown || 0) > 0) {
    state.travelEventCooldown = Math.max(0, (state.travelEventCooldown || 0) - 1);
    return false;
  }
  const loc = getLocationStatus();
  if (loc?.place === PLACE.VILLAGE || loc?.place === PLACE.TOWN) return false;
  const terrain = getTerrainAt(state.position.x, state.position.y) || "plain";
  // 行商人救助は先に判定
  if (Math.random() < RESCUE_EVENT_RATE) {
    const queued = enqueueMerchantRescueEvent(terrain);
    if (queued) {
      state.travelEventCooldown = TRAVEL_EVENT_COOLDOWN_DAYS;
      return true;
    }
  }
  if (Math.random() < MERCHANT_EVENT_RATE) {
    const queued = enqueueMerchantEvent(terrain);
    if (queued) {
      state.travelEventCooldown = TRAVEL_EVENT_COOLDOWN_DAYS;
      return true;
    }
  }
  if (Math.random() < SMUGGLE_EVENT_RATE && (terrain === "sea" || terrain === "shoal")) {
    const queued = enqueueSmuggleEvent(terrain);
    if (queued) {
      state.travelEventCooldown = TRAVEL_EVENT_COOLDOWN_DAYS;
      return true;
    }
  }
  if (!state.refugeeEscort?.active && Math.random() < REFUGEE_EVENT_RATE) {
    const queued = enqueueRefugeeEvent(terrain);
    if (queued) {
      state.travelEventCooldown = TRAVEL_EVENT_COOLDOWN_DAYS;
      return true;
    }
  }
  if (terrain === "sea" || terrain === "shoal") {
    if (Math.random() < WRECK_EVENT_RATE) {
      const queued = enqueueWreckEvent(terrain);
      if (queued) {
        state.travelEventCooldown = TRAVEL_EVENT_COOLDOWN_DAYS;
        return true;
      }
    }
  }
  if (Math.random() < OMEN_EVENT_RATE) {
    const queued = enqueueOmenEvent();
    if (queued) {
      state.travelEventCooldown = TRAVEL_EVENT_COOLDOWN_DAYS;
      return true;
    }
  }
  if (Math.random() < TRAITOR_EVENT_RATE) {
    const queued = enqueueTraitorEvent();
    if (queued) {
      state.travelEventCooldown = TRAVEL_EVENT_COOLDOWN_DAYS;
      return true;
    }
  }
  if (Math.random() < CHECKPOINT_EVENT_RATE) {
    const queued = enqueueCheckpointEvent();
    if (queued) {
      state.travelEventCooldown = TRAVEL_EVENT_COOLDOWN_DAYS;
      return true;
    }
  }
  return false;
}

/**
 * 拠点での戦時アクションを即時で処理し、戦況スコアを加算する。
 * @param {"defendRaid"|"attackRaid"|"skirmish"|"supplyFood"|"escort"|"blockade"} kind
 * @returns {boolean}
 */
export function triggerWarAction(kind) {
  const here = getSettlementAtPosition(state.position.x, state.position.y);
  const pf = getPlayerFactionId();
  if (!here || !here.factionId || !pf || pf === "player") {
    pushToast("行動不可", "拠点上でのみ実行できます。", "warn");
    return false;
  }
  const fronts =
    here && Array.isArray(state.warLedger?.entries)
      ? state.warLedger.entries
          .flatMap((e) => (e.activeFronts || []).map((f) => ({ entry: e, front: f })))
          .filter((f) => f.front?.settlementId === here.id && (f.entry.factions || []).includes(pf))
      : [];
  const frontInfo = fronts[0] || null;
  if (!frontInfo?.front) {
    pushToast("行動不可", "この拠点は前線ではありません。", "warn");
    return false;
  }
  const role = frontInfo.front.defender === pf ? "defend" : "attack";
  const q = addWarFrontQuest(here, frontInfo.front, role, kind);
  if (!q) {
    pushToast("依頼重複", "同じ前線で進行中の行動があります。", "info");
    return false;
  }
  pushLog("前線行動", `${q.title} を受注しました`, "-");
  pushToast("前線行動", `${q.title} を受注しました。`, "info");
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("quests-updated"));
    document.dispatchEvent(new CustomEvent("map-changed"));
  }
  return true;
}

/**
 * 行商人関連の移動イベントを処理する。
 * @param {object} action
 * @returns {boolean}
 */
function handleMerchantAction(action) {
  switch (action.type) {
    case "merchant_trade": {
      const deals = action.payload?.deals || [];
      if (!deals.length) return true;
      state.eventTrade = {
        source: "merchant",
        title: "行商人との取引",
        note: "相場より高めの価格です。",
        deals: deals.map((d) => ({
          id: d.id,
          name: SUPPLY_ITEMS.find((i) => i.id === d.id)?.name || d.id,
          price: Math.max(1, Math.round((d.cost || 0) / Math.max(1, d.qty || 1))),
          stock: d.qty || 0,
        })),
      };
      if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("event-trade-open"));
      travelSync?.();
      return true;
    }
    case "merchant_attack": {
      const ctx = action.payload || {};
      applyAggressivePenalties(ctx);
      startTravelEncounter({
        forceStrength: "normal",
        enemyFactionId: ctx.enemyFactionId || "pirates",
        title: "行商人を襲撃",
        flavor: "行商人を襲撃します。戦闘準備へ移行します。",
        eventTag: "merchant_attack",
        eventContext: ctx,
      });
      return true;
    }
    case "merchant_rescue_help": {
      const ctx = action.payload || {};
      startTravelEncounter({
        forceStrength: "elite",
        enemyFactionId: ctx.enemyFactionId || "pirates",
        title: "行商人救助",
        flavor: "襲撃者を撃退します。戦闘準備へ移行します。",
        eventTag: "merchant_rescue_help",
        eventContext: ctx,
      });
      return true;
    }
    case "merchant_rescue_attack": {
      const ctx = action.payload || {};
      applyAggressivePenalties(ctx);
      startTravelEncounter({
        forceStrength: "normal",
        enemyFactionId: ctx.enemyFactionId || "pirates",
        title: "行商人を襲撃",
        flavor: "弱った行商人を襲撃します。戦闘準備へ移行します。",
        eventTag: "merchant_rescue_raid",
        eventContext: ctx,
      });
      return true;
    }
    case "merchant_rescue_leave":
    case "merchant_leave":
      return true;
    default:
      return false;
  }
}

/**
 * 前線依頼や停戦依頼のイベントを処理する。
 * @param {object} action
 * @returns {boolean}
 */
function handleFrontAction(action) {
  switch (action.type) {
    case "front_request_accept": {
      const frontId = action.payload?.frontId;
      const settlementId = action.payload?.settlementId;
      const kind = action.payload?.kind;
      if (!frontId || !settlementId || !kind) return true;
      const pf = getPlayerFactionId();
      const entryFront =
        state.warLedger?.entries
          ?.flatMap((e) => (e.activeFronts || []).map((f) => ({ entry: e, front: f })))
          .find((p) => p.front?.id === frontId) || null;
      if (!entryFront) return true;
      const front = entryFront.front;
      const set = getSettlementById(settlementId);
      if (!set) return true;
      const role = front.defender === pf ? "defend" : front.attacker === pf ? "attack" : null;
      if (!role) return true;
      const q = addWarFrontQuest(set, front, role, kind, action.payload || {});
      if (q) {
        pushLog("前線要請", `${q.title} を受注しました`, "-");
        pushToast("前線要請", `${q.title} を受注しました。`, "info");
        if (typeof document !== "undefined") {
          document.dispatchEvent(new CustomEvent("quests-updated"));
          document.dispatchEvent(new CustomEvent("map-changed"));
        }
      }
      return true;
    }
    case "front_request_ignore": {
      pushLog("前線要請", "要請を断りました", "-");
      pushToast("前線要請", "要請を断りました。", "info");
      return true;
    }
    case "truce_request_accept": {
      const frontId = action.payload?.frontId;
      const settlementId = action.payload?.settlementId;
      if (!frontId || !settlementId) return true;
      const pf = getPlayerFactionId();
      const front = getFrontById(frontId);
      if (!front || front.defender !== pf) return true;
      const set = getSettlementById(settlementId);
      if (!set) return true;
      const q = addWarFrontQuest(set, front, "defend", "truce", action.payload || {});
      if (q) {
        pushLog("停戦工作", `${q.title} を受注しました`, "-");
        pushToast("停戦工作", `${q.title} を受注しました。`, "info");
        if (typeof document !== "undefined") {
          document.dispatchEvent(new CustomEvent("quests-updated"));
          document.dispatchEvent(new CustomEvent("map-changed"));
        }
      }
      return true;
    }
    case "truce_request_ignore": {
      pushLog("停戦工作", "要請を断りました", "-");
      pushToast("停戦工作", "要請を断りました。", "info");
      return true;
    }
    default:
      return false;
  }
}

/**
 * 密輸関連の移動イベントを処理する。
 * @param {object} action
 * @returns {boolean}
 */
function handleSmuggleAction(action) {
  switch (action.type) {
    case "smuggle_trade": {
      const ctx = action.payload || {};
      const deals = ctx.deals || [];
      state.eventTrade = {
        source: "smuggle",
        title: "密輸船との取引",
        note: "相場より高めの価格です。",
        deals: deals.map((d) => ({
          id: d.id,
          name: SUPPLY_ITEMS.find((i) => i.id === d.id)?.name || d.id,
          price: Math.max(1, Math.round((d.cost || 0) / Math.max(1, d.qty || 1))),
          stock: d.qty || 0,
        })),
        settlementId: ctx.settlementId || null,
        factionId: ctx.factionId || null,
      };
      if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("event-trade-open"));
      travelSync?.();
      return true;
    }
    case "smuggle_bust": {
      const ctx = action.payload || {};
      const ok = intimidateCheck();
      if (ok) {
        if (ctx.nobleId) adjustNobleFavor(ctx.nobleId, 4);
        if (ctx.settlementId && ctx.factionId) adjustSupport(ctx.settlementId, ctx.factionId, 2);
        addWarScore(getPlayerFactionId(), ctx.factionId || "pirates", 3, absDay(state), 0, 0);
        const gain = randInt(20, 50);
        state.funds = Math.max(0, (state.funds || 0) + gain);
        pushToast("摘発成功", `摘発に成功しました。資金+${gain}`, "good");
        pushLog("密輸摘発", `摘発成功。支援と好感を得たようだ。資金+${gain}`, "-");
        travelSync?.();
      } else {
        enqueueEvent({
          title: "摘発失敗",
          body: "摘発に失敗しました。どうしますか？",
          actions: [
            { id: "smug-raid", label: "襲撃する", type: "smuggle_attack", payload: ctx },
            { id: "smug-leave", label: "立ち去る", type: "merchant_leave" },
          ],
        });
      }
      return true;
    }
    case "smuggle_attack": {
      const ctx = action.payload || {};
      applyAggressivePenalties(ctx);
      startTravelEncounter({
        forceStrength: "normal",
        enemyFactionId: ctx.enemyFactionId || ctx.factionId || "pirates",
        title: "密輸船襲撃",
        flavor: "密輸船を襲撃します。",
        eventTag: "smuggle_raid",
        eventContext: ctx,
      });
      pushLog("密輸船襲撃", "密輸船を襲撃することにしました。", "-");
      return true;
    }
    default:
      return false;
  }
}

/**
 * 難民イベントを処理する。
 * @param {object} action
 * @returns {boolean}
 */
function handleRefugeeAction(action) {
  switch (action.type) {
    case "refugee_feed": {
      const need = Math.max(5, Math.floor(totalSupplies(state.supplies) * 0.05));
      const pay = Math.min(state.supplies?.food || 0, need);
      state.supplies.food = Math.max(0, (state.supplies.food || 0) - pay);
      const info = nearestSettlementInfo();
      state.fame += 3;
      if (info?.settlementId && info?.factionId) adjustSupport(info.settlementId, info.factionId, 2);
      pushLog("難民支援", `食料-${pay} / 名声+3`, "-");
      pushToast("支援", `食料-${pay} / 名声+3`, "info");
      travelSync?.();
      return true;
    }
    case "refugee_escort": {
      const info = nearestSettlementInfo();
      if (info?.settlementId) {
        state.refugeeEscort = { active: true, targetId: info.settlementId, factionId: info.factionId || null, nobleId: info.nobleId || null };
        const set = getSettlementById(info.settlementId);
        const q = addRefugeeEscortQuest(set);
        pushLog("難民護送依頼を受注", `目的地: ${set?.name || info.settlementId}`, "-");
        pushToast("護送開始", "目的地まで護送します。エンカウント率が上がります。", "warn");
        if (typeof document !== "undefined") {
          document.dispatchEvent(new CustomEvent("quests-updated", { detail: { questId: q?.id } }));
        }
        travelSync?.();
      }
      return true;
    }
    case "refugee_attack": {
      const info = nearestSettlementInfo();
      if (info?.settlementId && info?.factionId) adjustSupport(info.settlementId, info.factionId, -3);
      if (info?.nobleId) adjustNobleFavor(info.nobleId, -4);
      startTravelEncounter({
        forceStrength: "normal",
        enemyFactionId: info?.factionId || "pirates",
        title: "難民船団襲撃",
        flavor: "難民船団を襲撃します。",
        eventTag: "refugee_raid",
        eventContext: info || {},
      });
      pushLog("難民襲撃", "難民旅団を襲撃することにしました。", "-");
      return true;
    }
    default:
      return false;
  }
}

/**
 * 検問イベントを処理する。
 * @param {object} action
 * @returns {boolean}
 */
function handleCheckpointAction(action) {
  switch (action.type) {
    case "checkpoint_ok": {
      const info = nearestSettlementInfo();
      if (info?.settlementId && info?.factionId) adjustSupport(info.settlementId, info.factionId, 2);
      const spend = Math.min(2, state.supplies?.raw || 0);
      if (spend > 0) state.supplies.raw = Math.max(0, state.supplies.raw - spend);
      pushLog("検問通過", spend > 0 ? `原料-${spend}` : "消費なし", "-");
      pushToast("検問通過", spend > 0 ? `物資-${spend}` : "物資消費なし", "info");
      return true;
    }
    case "checkpoint_bribe": {
      const info = nearestSettlementInfo();
      const cost = 50;
      if ((state.funds || 0) < cost) {
        pushToast("資金不足", "賄賂の資金が足りません。", "warn");
        return true;
      }
      state.funds = Math.max(0, (state.funds || 0) - cost);
      if (info?.nobleId) adjustNobleFavor(info.nobleId, 3);
      pushLog("検問賄賂", `資金-${cost}`, "-");
      pushToast("賄賂成功", `資金-${cost}`, "info");
      return true;
    }
    case "checkpoint_force": {
      const info = nearestSettlementInfo();
      if (info?.settlementId && info?.factionId) adjustSupport(info.settlementId, info.factionId, -2);
      startTravelEncounter({
        forceStrength: "normal",
        enemyFactionId: info?.factionId || "pirates",
        title: "検問突破",
        flavor: "強行突破を試みます。",
        eventTag: "checkpoint_force",
        eventContext: info || {},
      });
      pushLog("検問突破", "検問を強行突破しようとしています。", "-");
      return true;
    }
    default:
      return false;
  }
}

/**
 * 兆しイベントを処理する。
 * @param {object} action
 * @returns {boolean}
 */
function handleOmenAction(action) {
  switch (action.type) {
    case "omen_pray": {
      if ((state.faith || 0) < 10) {
        // 信仰不足なら無視と同じ扱い（災いのスケジュール）
        scheduleOmenCalamity(absDay(state) + 30);
        pushLog("兆しを無視", "信仰が足りず祈れませんでした。30日後に災いが訪れるかもしれません。", "-");
        pushToast("信仰不足", "祈れませんでした。30日後に災いが訪れるかもしれません。", "warn");
        return true;
      }
      const cost = Math.max(10, Math.floor(state.faith * 0.1));
      state.faith = Math.max(0, (state.faith || 0) - cost);
      const roll = Math.random();
      if (roll < 0.2) {
        state.ships = Math.max(0, (state.ships || 0) + 1);
        pushLog("祈りの兆し", "無人船を得ました。", "-");
        pushToast("祈りの加護", "無人船を得ました。", "good");
      } else if (roll < 0.6) {
        const foodGain = randInt(5, 15);
        state.supplies.food = (state.supplies.food || 0) + foodGain;
        pushLog("祈りの兆し", `食料+${foodGain}`, "-");
        pushToast("祈りの加護", `食料+${foodGain}`, "good");
      } else {
        pushLog("祈りの兆し", "何も起きませんでした。", "-");
        pushToast("祈り", "何も起きませんでした。", "info");
      }
      travelSync?.();
      return true;
    }
    case "omen_ignore": {
      scheduleOmenCalamity(absDay(state) + 30);
      pushLog("兆しを無視", "30日後に災いが訪れるかもしれません。", "-");
      pushToast("兆しを無視", "30日後に何かが起こるかもしれません。", "warn");
      return true;
    }
    default:
      return false;
  }
}

/**
 * 廃船イベントを処理する。
 * @param {object} action
 * @returns {boolean}
 */
function handleWreckAction(action) {
  if (action.type !== "wreck_probe") return false;
  const roll = Math.random();
  if (roll < 0.1) {
    startTravelEncounter({
      forceStrength: "elite",
      enemyFactionId: "pirates",
      title: "廃船の罠",
      flavor: "廃船を装った待ち伏せです。",
      eventTag: "wreck_attack",
      eventContext: {},
    });
  } else {
    const loot = Math.random();
    if (loot < 0.3) {
      state.ships = Math.max(0, (state.ships || 0) + 1);
      pushLog("廃船調査", "船を回収しました。", "-");
      pushToast("廃船調査", "船を回収しました。", "good");
    } else {
      const id = SUPPLY_ITEMS[randInt(0, SUPPLY_ITEMS.length - 1)].id;
      const qty = randInt(2, 6);
      state.supplies[id] = (state.supplies[id] || 0) + qty;
      const name = supplyName(id);
      pushLog("廃船調査", `${name} +${qty}`, "-");
      pushToast("廃船調査", `${name} +${qty}`, "info");
    }
    travelSync?.();
  }
  return true;
}

/**
 * 内通者イベントを処理する。
 * @param {object} action
 * @returns {boolean}
 */
function handleTraitorAction(action) {
  switch (action.type) {
    case "traitor_buy": {
      const info = nearestSettlementInfo();
      const cost = 80;
      if ((state.funds || 0) < cost) {
        pushToast("資金不足", "資金が足りません。", "warn");
        return true;
      }
      state.funds = Math.max(0, (state.funds || 0) - cost);
      const fid = info?.factionId || "pirates";
      addWarScore(getPlayerFactionId(), fid, 4, absDay(state), 0, 0);
      pushLog("内通者との取引", `資金-${cost}で情報を買った。敵勢力の動きをつかんだ。`, "-");
      pushToast("内通者との取引", `資金-${cost}で情報を買った。しばらくは優位に動けそうだ。`, "good");
      travelSync?.();
      return true;
    }
    case "traitor_capture": {
      const info = nearestSettlementInfo();
      if (info?.nobleId) adjustNobleFavor(info.nobleId, 3);
      const fid = info?.factionId || "pirates";
      addWarScore(getPlayerFactionId(), fid, -3, absDay(state), 0, 0);
      pushLog("内通者捕縛", "使者を捕縛し、情報を勢力に渡した。", "-");
      pushToast("内通者捕縛", "捕縛に成功。味方の信頼がわずかに高まった。", "info");
      travelSync?.();
      return true;
    }
    case "traitor_ignore":
      return true;
    default:
      return false;
  }
}

/**
 * イベントモーダルのアクションを処理する。
 * @param {object} action
 * @returns {boolean} 処理した場合true
 */
export function handleTravelEventAction(action) {
  if (!action?.type) return false;
  const handlers = [
    handleMerchantAction,
    handleFrontAction,
    handleSmuggleAction,
    handleRefugeeAction,
    handleCheckpointAction,
    handleOmenAction,
    handleWreckAction,
    handleTraitorAction,
  ];
  for (const h of handlers) {
    if (h(action)) return true;
  }
  return false;
}

/**
 * 最寄り拠点情報を取得する（同距離は乱択）。
 * @returns {{settlementId:string|null,nobleId:string|null,factionId:string|null}|null}
 */
function nearestSettlementInfo() {
  const entries = settlements
    .map((s) => ({ s, d: manhattan(s.coords, state.position) }))
    .filter((o) => o.d != null && o.d <= TRAVEL_EVENT_RADIUS)
    .sort((a, b) => a.d - b.d);
  if (!entries.length) return null;
  const topDist = entries[0].d;
  const tied = entries.filter((o) => o.d === topDist).map((o) => o.s);
  const pick = tied[Math.floor(Math.random() * tied.length)];
  return { settlementId: pick?.id || null, nobleId: pick?.nobleId || null, factionId: pick?.factionId || null };
}

/**
 * 行商人イベントをキューに積む。
 * @param {string} terrain
 * @returns {boolean}
 */
/**
 * 行商人イベントをキューに積む。
 * @param {string} terrain
 * @returns {boolean}
 */
function enqueueMerchantEvent(terrain) {
  // 海/浅瀬でなくても発生するようにし、地形は参考文言のみ
  const info = nearestSettlementInfo();
  const deals = pickDeals();
  enqueueEvent({
    title: "行商人との遭遇",
    body: `行商人と遭遇しました（地形: ${terrain}）。\nどうしますか？`,
    actions: [
      { id: "trade", label: "取引する", type: "merchant_trade", payload: { deals } },
      { id: "leave", label: "立ち去る", type: "merchant_leave" },
      {
        id: "raid",
        label: "襲撃する",
        type: "merchant_attack",
        payload: { enemyFactionId: info?.factionId, nobleId: info?.nobleId, settlementId: info?.settlementId },
      },
    ],
  });
  return true;
}

/**
 * 行商人救助イベントをキューに積む。
 * @param {string} terrain
 * @returns {boolean}
 */
/**
 * 行商人救助イベントをキューに積む。
 * @param {string} terrain
 * @returns {boolean}
 */
function enqueueMerchantRescueEvent(terrain) {
  const info = nearestSettlementInfo();
  enqueueEvent({
    title: "行商人救助",
    body: `襲撃を受けた行商人を発見しました（地形: ${terrain}）。どうしますか？`,
    actions: [
      {
        id: "help",
        label: "救助する",
        type: "merchant_rescue_help",
        payload: { enemyFactionId: info?.factionId || "pirates", nobleId: info?.nobleId, settlementId: info?.settlementId },
      },
      { id: "ignore", label: "立ち去る", type: "merchant_rescue_leave" },
      {
        id: "raid",
        label: "襲撃する",
        type: "merchant_rescue_attack",
        payload: { enemyFactionId: info?.factionId || "pirates", nobleId: info?.nobleId, settlementId: info?.settlementId },
      },
    ],
  });
  return true;
}

/**
 * 行商人イベント用の取引品を作る。
 * @returns {Array<{id:string,qty:number,cost:number}>}
 */
function pickDeals() {
  const demand = createSettlementDemand("village");
  const candidates = SUPPLY_ITEMS.slice();
  const deals = [];
  while (candidates.length && deals.length < 7) {
    const totalW = candidates.reduce((s, i) => s + (demand[i.id] || 1), 0);
    let roll = Math.random() * totalW;
    let pickIdx = 0;
    for (let i = 0; i < candidates.length; i++) {
      roll -= demand[candidates[i].id] || 1;
      if (roll <= 0) {
        pickIdx = i;
        break;
      }
    }
    const item = candidates.splice(pickIdx, 1)[0];
    const qty = randInt(1, 3);
    const cost = Math.floor(item.basePrice * qty * 1.6);
    deals.push({ id: item.id, qty, cost });
  }
  return deals;
}

/**
 * 物資IDから日本語名を取得する。
 * @param {string} id
 * @returns {string}
 */
function supplyName(id) {
  return SUPPLY_ITEMS.find((i) => i.id === id)?.name || id;
}

/**
 * 襲撃選択時の支持度/好感度ペナルティを適用する。
 * @param {object} ctx
 */
function applyAggressivePenalties(ctx) {
  if (ctx?.settlementId && ctx?.factionId) {
    adjustSupport(ctx.settlementId, ctx.factionId, -3);
  }
  if (ctx?.nobleId) {
    adjustNobleFavor(ctx.nobleId, -6);
  }
}

/**
 * トラベルイベント由来の戦闘を準備状態に設定する。
 * @param {object} param0
 */
/**
 * トラベルイベント由来の戦闘を準備状態に設定する。
 * @param {object} param0
 */
export function startTravelEncounter({ forceStrength, enemyFactionId, title, flavor, eventTag, eventContext }) {
  const { formation, total, strength } = buildEnemyFormation(forceStrength, enemyFactionId || "pirates");
  const terrain = getTerrainAt(state.position.x, state.position.y) || "plain";
  state.pendingEncounter = {
    active: true,
    enemyFormation: formation,
    enemyTotal: total,
    strength,
    terrain,
    enemyFactionId: enemyFactionId || "pirates",
    eventTag: travelEventTags.has(eventTag) ? eventTag : null,
    eventContext: eventContext || null,
  };
  state.modeLabel = MODE_LABEL.PREP;
  resetEncounterMeter();
  setOutput(title || "遭遇", `${flavor || "敵に遭遇しました。"}（推定${total}人 / ${strength === "elite" ? "強編成" : "通常編成"}）`, [
    { text: "戦闘準備", kind: "warn" },
  ]);
  pushLog(title || "遭遇", `敵推定${total}人（${strength === "elite" ? "強編成" : "通常編成"}）`, "-");
  pushToast(title || "遭遇", "戦闘準備に入ります。", "warn");
  travelSync?.();
}

/**
 * 近隣拠点勢力と紐づく確率イベント: 密輸船
 * @param {string} terrain
 * @returns {boolean}
 */
function enqueueSmuggleEvent(terrain) {
  const info = nearestSettlementInfo();
  const deals = pickDeals();
  enqueueEvent({
    title: "密輸船を発見",
    body: `正規ルートを避ける船団を発見しました（地形: ${terrain}）。\nどうしますか？`,
    actions: [
      { id: "smug-trade", label: "取引する", type: "smuggle_trade", payload: { deals, ...info } },
      { id: "smug-bust", label: "摘発する", type: "smuggle_bust", payload: info || {} },
      { id: "smug-raid", label: "襲撃する", type: "smuggle_attack", payload: info || {} },
      { id: "smug-leave", label: "立ち去る", type: "merchant_leave" },
    ],
  });
  return true;
}

/**
 * 難民船団イベントを積む。
 * @param {string} terrain
 * @returns {boolean}
 */
function enqueueRefugeeEvent(terrain) {
  if (state.refugeeEscort?.active) return false;
  const info = nearestSettlementInfo();
  const foodNeed = Math.max(5, Math.floor(totalSupplies(state.supplies) * 0.05));
  enqueueEvent({
    title: "難民旅団",
    body: `物資不足で漂流する難民旅団に遭遇しました（地形: ${terrain}）。どうしますか？\n食糧支援目安: 食料${foodNeed}消費（所持量に応じて減免）`,
    actions: [
      { id: "refugee-leave", label: "立ち去る", type: "merchant_leave" },
      { id: "refugee-feed", label: "食糧を分け与える", type: "refugee_feed" },
      { id: "refugee-escort", label: "護送依頼受注", type: "refugee_escort", payload: info || {} },
      { id: "refugee-raid", label: "襲撃する", type: "refugee_attack" },
    ],
  });
  return true;
}

/**
 * 検問強化イベントを積む（拠点近傍のみ）。
 * @returns {boolean}
 */
function enqueueCheckpointEvent() {
  const info = nearestSettlementInfo();
  if (!info?.settlementId) return false;
  const bribeCost = 50;
  enqueueEvent({
    title: "検問強化",
    body: `臨時検問に遭遇しました。どうしますか？\n賄賂コスト: 資金${bribeCost}`,
    actions: [
      { id: "cp-ok", label: "正規に応じる", type: "checkpoint_ok" },
      { id: "cp-bribe", label: "賄賂を渡す", type: "checkpoint_bribe" },
      { id: "cp-force", label: "強行突破", type: "checkpoint_force" },
    ],
  });
  return true;
}

/**
 * 災いの兆しイベントを積む。
 * @returns {boolean}
 */
function enqueueOmenEvent() {
  const costHint = Math.max(10, Math.floor((state.faith || 0) * 0.1));
  enqueueEvent({
    title: "災いの兆し",
    body: `不穏な兆しを感じます。今、祈りますか？\n祈りの消費目安: 信仰${costHint}`,
    actions: [
      { id: "omen-pray", label: "海に祈る", type: "omen_pray" },
      { id: "omen-ignore", label: "無視する", type: "omen_ignore" },
    ],
  });
  return true;
}

/**
 * 廃船・漂流物イベント。
 * @param {string} terrain
 * @returns {boolean}
 */
function enqueueWreckEvent(terrain) {
  enqueueEvent({
    title: "廃船・漂流物",
    body: `廃船や漂流物を発見しました（地形: ${terrain}）。どうしますか？`,
    actions: [
      { id: "wreck-probe", label: "調査する", type: "wreck_probe" },
      { id: "wreck-leave", label: "立ち去る", type: "merchant_leave" },
    ],
  });
  return true;
}

/**
 * 内通者接触イベント。
 * @returns {boolean}
 */
function enqueueTraitorEvent() {
  const info = nearestSettlementInfo();
  if (!info?.settlementId) return false;
  const intelCost = 80;
  enqueueEvent({
    title: "内通者の接触",
    body: `匿名の使者が情報を売りたいと言っています。\n情報購入コスト: 資金${intelCost}\nどうしますか？`,
    actions: [
      { id: "traitor-buy", label: "情報を買う", type: "traitor_buy" },
      { id: "traitor-ignore", label: "拒否する", type: "traitor_ignore" },
      { id: "traitor-cap", label: "捕縛する", type: "traitor_capture" },
    ],
  });
  return true;
}

/**
 * 威圧判定: 名声と部隊規模の合算で成功を判定する。
 * @returns {boolean}
 */
function intimidateCheck() {
  const fame = Math.max(0, state.fame || 0);
  const troops = totalTroops();
  const score = fame * 0.4 + troops * 2;
  const dc = 60 + Math.random() * 40;
  return score >= dc;
}

/**
 * 災いの予告をスケジュールする。
 * @param {number} triggerDay
 */
function scheduleOmenCalamity(triggerDay) {
  if (!state.pendingOmens) state.pendingOmens = [];
  state.pendingOmens.push({ day: triggerDay, handled: false });
}

/**
 * 護送フラグをクリアする。
 */
function clearEscort() {
  state.refugeeEscort = { active: false, targetId: null, factionId: null, nobleId: null };
}

/**
 * 護送目的地に到達したかを確認し、達成処理を行う。
 */
function checkRefugeeEscortArrival() {
  if (!state.refugeeEscort?.active || !state.refugeeEscort.targetId) return;
  const here = getCurrentSettlement();
  if (here?.id !== state.refugeeEscort.targetId) return;
  completeRefugeeEscortAt(here);
  clearEscort();
}
