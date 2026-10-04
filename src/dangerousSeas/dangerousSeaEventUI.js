import { state } from "../core/state.js";
import { MODE_LABEL } from "../core/constants.js";
import { absDay } from "../core/calendar.js";
import { receiveFunds, recordVoyage } from "../core/voyageStats.js";
import { saveGameToStorage } from "../core/storage.js";
import { snapshotWorld, restoreWorld } from "../world/map.js";
import { snapshotOutfitting } from "../fleet/outfitting.js";
import { addTroops, TROOP_STATS } from "../resources/troops.js";
import { SUPPLY_ITEMS } from "../resources/supplies.js";
import { elements, pushToast, pushLog } from "../ui/dom.js";
import { enqueueEvent } from "../app/events.js";
import { advanceDayWithEvents } from "../app/time.js";
import { beginDangerousSeaAction, finishDangerousSeaAction, dangerousSeaActionBlocked } from "./dangerousSeaHazards.js";
import { dangerousSeaAt } from "./dangerousSeaWorld.js";
import { getDangerousSeaEventAt, visibleDangerousSeaEvents } from "./dangerousSeaEventWorld.js";
import { DANGEROUS_SEA_EVENT_DEFS as DEFS, dangerousEventScoutRules } from "./dangerousSeaEventConfig.js";
import { closeDangerousSeaEvent, dangerousSeaEventOutcome } from "./dangerousSeaEventState.js";

/** 結果の確認後に現在地の操作を同期する。 */
let eventSync = null;
/** 選択処理中のキューは呼び出し元が解決するため、再開時の古い通知除去を行わない。 */
let handlingChoice = false;

/** @returns {object|null} 限定イベントの途中記録。 */
function pending() { return state.dangerousSeas?.events?.pending || null; }

/** @returns {object|null} 途中記録が参照する一枠の地点。 */
function currentEvent() {
  const progress = pending(), event = progress && state.dangerousSeas.events.active[progress.regionId];
  return event?.id === progress?.eventId ? event : null;
}

/** @returns {boolean} 別の処理を始めずに出来事へ参加できるか。 */
function available() {
  return state.modeLabel === MODE_LABEL.NORMAL && !state.wanted?.detention && !state.pendingEncounter?.active && !state.eventQueue?.length
    && !state.expansion?.fishing?.pending && !state.expansion?.exploration?.pending && !state.expansion?.charts?.pending && !dangerousSeaActionBlocked();
}

/** 正体と事故率の手掛かりを段階的に表示する。 @param {object} event 地点。 @returns {string} 手掛かり。 */
function hintText(event) {
  if (event.kind !== "fog_light") return event.hintTier >= 5 ? "斥候が安全な接近経路を調べました。事故の危険が下がります。" : "現地の調査には1日かかります。斥候がいると事故の危険が下がります。";
  if (event.hintTier >= 10) return { rescue: "斥候は救難信号と乗員の姿を確認しました。", trap: "斥候は灯火の陰に潜む海賊船を確認しました。", empty: "斥候は船に乗員がいないことを確認しました。" }[event.variant];
  if (event.hintTier >= 5) return event.variant === "trap" ? "灯火の周囲に、不自然に揃った帆影があります。" : "灯火の周囲に、待ち伏せの帆影は見当たりません。";
  return event.hintTier >= 1 ? "霧の中に船の灯火が見えます。救難か罠かはまだ分かりません。" : "霧の中から灯火が揺れています。正体は近づくまで分かりません。";
}

/** 固定報酬を既存イベントの資源表示へ変換する。 @param {object|null} reward 報酬。 @returns {object[]} 表示資源。 */
function rewardResources(reward) {
  if (!reward) return [];
  const resources = reward.funds ? [{ id: "funds", label: "回収資金", value: `+${reward.funds}` }] : [];
  for (const [id, qty] of Object.entries(reward.supplies)) if (qty) resources.push({ id, label: SUPPLY_ITEMS.find(item => item.id === id)?.name || id, value: `+${qty}` });
  for (const [id, qty] of Object.entries(reward.troops)) if (qty) resources.push({ id, label: `救助: ${TROOP_STATS[id]?.name || id} Lv1`, value: `+${qty}人` });
  return resources;
}

/**
 * 保存済み進行と合わない古い選択通知を除く。選択後の保存と通知消去の間で再読込されても同じ選択を繰り返さない。
 * @returns {void}
 */
function discardOldEventNotifications() {
  if (handlingChoice || !Array.isArray(state.eventQueue)) return;
  const progress = pending();
  state.eventQueue = state.eventQueue.filter(event => event.kind !== "dangerous_event" || (progress && event.actions?.some(action =>
    action.payload?.eventId === progress.eventId && (progress.stage === "choice" ? action.payload.choice !== "ack" : progress.stage === "result" && action.payload.choice === "ack"))));
}

/**
 * 現地で選択を開始する。正体と報酬は生成済み地点を使い、選択の開始自体では日数を使わない。
 * @param {Function} syncUI 表示同期。 @returns {void}
 */
function beginEvent(syncUI) {
  eventSync = syncUI || eventSync;
  if (pending()) { resumeDangerousSeaEvent(eventSync); return; }
  const event = getDangerousSeaEventAt(state.position);
  if (!event || event.kind === "fish_migration" || !available() || absDay(state) >= event.expiresAbs) return;
  const before = structuredClone(state);
  event.discovered = true;
  event.hintTier = Math.max(event.hintTier, dangerousEventScoutRules(snapshotOutfitting(state).scouts).min);
  state.dangerousSeas.events.pending = { eventId: event.id, regionId: event.regionId, stage: "choice", choice: null, dayApplied: false,
    scoutTier: 0, pausedForHazard: false, reward: null, encounter: null, applied: false, complete: false, accident: false, resultText: "" };
  if (!saveGameToStorage()) { Object.assign(state, before); pushToast("保存できません", "出来事は開始していません。", "warn"); return; }
  document.dispatchEvent(new CustomEvent("auto-move-stop"));
  processDangerousSeaEvent();
}

/**
 * 保存済み選択を表示する。鐘の段階と沈没船の救助／積荷は排他的で、未解決の選択画面を閉じて回避できない。
 * @returns {boolean} 選択・報告を表示したか。
 */
export function processDangerousSeaEvent() {
  discardOldEventNotifications();
  const progress = pending(), event = currentEvent();
  if (!event || handlingChoice || progress.pausedForHazard || !["choice", "result"].includes(progress.stage)
    || state.pendingEncounter?.active || state.wanted?.detention || state.modeLabel === MODE_LABEL.BATTLE || state.eventQueue?.length
    || (elements.battleResultModal && !elements.battleResultModal.hidden) || (elements.battleBlock && !elements.battleBlock.hidden)) return false;
  const def = DEFS[event.kind];
  if (progress.stage === "result") {
    enqueueEvent({ kind: "dangerous_event", title: def.name, body: `${progress.resultText}${progress.accident ? " 接近中の事故で資金と物資の回収量が半分になりました。" : ""}\n上限を超えた物資・兵員は航海を再開する前に整理してください。`,
      resources: progress.applied ? rewardResources(progress.reward) : [], actions: [{ label: progress.complete ? "成果を確認して航海を再開" : "手掛かりを記録して航海へ戻る", type: "dangerous_event_choice", payload: { eventId: event.id, choice: "ack" } }] });
    return true;
  }
  const choices = event.kind === "seabed_bell" ? [["listen", "descend", "answer"][event.progress]] : Object.keys(def.choices);
  const body = event.kind === "sinking_treasure" ? "宝船が沈みかけています。積荷か乗員、片方しか運び出せません。\n積荷: 資金3000・香辛料4・織物3 / 救助: 資金300・海兵4人・斥候2人。"
    : event.kind === "seabed_bell" ? `海底から鐘の音が響きます。調査 ${event.progress + 1}/3。各段階で1日を使います。`
      : hintText(event);
  enqueueEvent({ kind: "dangerous_event", title: def.name, body: `${body}\n期限まであと${Math.max(0, event.expiresAbs - absDay(state))}日。選んだ活動は1日かかります。事故では回収資金・物資が半減します。`,
    actions: [...choices.map(choice => ({ label: `${def.choices[choice]}（1日）`, type: "dangerous_event_choice", payload: { eventId: event.id, choice } })),
      { label: "参加を見送る", type: "dangerous_event_choice", payload: { eventId: event.id, choice: "leave" } }] });
  return true;
}

/**
 * 固定報酬と段階を一度適用し、結果確認まで一枠を占有する。保存失敗では報酬・救助・統計・進行を全て戻す。
 * @param {boolean} success 成功。 @param {boolean} [save=true] 戦後の一括保存を呼び出し元へ任せる場合はfalse。
 * @returns {boolean} 精算できたか。
 */
function settleEvent(success, save = true) {
  const progress = pending(), event = currentEvent();
  if (!event || progress.applied) return false;
  const before = structuredClone(state);
  if (success) {
    receiveFunds(state, progress.reward.funds);
    for (const [id, qty] of Object.entries(progress.reward.supplies)) state.supplies[id] = (state.supplies[id] || 0) + qty;
    for (const [id, qty] of Object.entries(progress.reward.troops)) { addTroops(id, 1, qty); recordVoyage(state, "refugeesRescued", qty); }
    event.progress++;
  } else {
    progress.reward = { funds: 0, supplies: {}, troops: {} }; progress.complete = true; progress.accident = false;
    progress.resultText = "海賊の罠から退きました。この出来事の積荷・救助報酬は得られませんでした。";
  }
  event.completed = progress.complete;
  event.choices.push({ choice: progress.choice, day: absDay(state), success, accident: progress.accident, reward: structuredClone(progress.reward) });
  progress.applied = true; progress.stage = "result"; progress.encounter = null;
  if (save && !saveGameToStorage()) { Object.assign(state, before); pushToast("保存できません", "報酬を確定できませんでした。同じ出来事を再開してください。", "warn"); return false; }
  pushLog(DEFS[event.kind].name, progress.resultText, "-");
  return true;
}

/**
 * 日数未適用の活動だけ一日進める。未解決危険は固定敵を除き先に解決し、保存再開でも報酬・日数を繰り返さない。
 * @param {Function} [syncUI] 表示同期。 @returns {boolean} 再開できたか。
 */
export function resumeDangerousSeaEvent(syncUI) {
  eventSync = syncUI || eventSync;
  discardOldEventNotifications();
  let progress = pending();
  if (!currentEvent() || state.wanted?.detention || state.modeLabel === MODE_LABEL.BATTLE) return false;
  if (["choice", "result"].includes(progress.stage)) { processDangerousSeaEvent(); return true; }
  if (progress.stage === "battle") {
    if (!state.pendingEncounter?.active && progress.encounter) {
      state.pendingEncounter = structuredClone(progress.encounter); state.modeLabel = MODE_LABEL.PREP;
      saveGameToStorage();
    }
    return true;
  }
  const hazard = state.dangerousSeas.pendingHazard;
  if (progress.pausedForHazard && hazard && hazard.stage !== "watch") return false;
  const before = structuredClone(state), world = structuredClone(snapshotWorld());
  if (!state.dangerousSeas.action && !beginDangerousSeaAction("event")) return false;
  progress.pausedForHazard = false;
  if (!progress.dayApplied) {
    const day = absDay(state);
    advanceDayWithEvents(1, { activity: "event", suppressDangerRaid: !!progress.encounter });
    if (absDay(state) === day) { Object.assign(state, before); restoreWorld(world); return false; }
    progress = pending(); progress.dayApplied = true;
  }
  const actualHazard = state.dangerousSeas.pendingHazard;
  if (actualHazard && actualHazard.stage !== "watch" && !progress.encounter) {
    progress.pausedForHazard = true; finishDangerousSeaAction("event");
    if (!saveGameToStorage()) { Object.assign(state, before); restoreWorld(world); pushToast("保存できません", "活動を中断しました。同じ出来事を再開してください。", "warn"); return false; }
    eventSync?.(); return true;
  }
  if (!saveGameToStorage()) { Object.assign(state, before); restoreWorld(world); pushToast("保存できません", "活動を中断しました。同じ出来事を再開してください。", "warn"); return false; }
  if (progress.encounter) {
    const oldEncounter = state.pendingEncounter, oldMode = state.modeLabel;
    state.pendingEncounter = structuredClone(progress.encounter); state.modeLabel = MODE_LABEL.PREP; progress.stage = "battle";
    if (!saveGameToStorage()) { state.pendingEncounter = oldEncounter; state.modeLabel = oldMode; progress.stage = "action"; pushToast("保存できません", "固定された海賊の罠を再開してください。", "warn"); return false; }
    pushToast("霧中の海賊の罠", "灯火の陰から海賊船が現れました。戦闘・逃走・降伏を選んでください。", "warn");
  } else if (!settleEvent(true)) return false;
  processDangerousSeaEvent(); eventSync?.();
  return true;
}

/**
 * 限定イベントの選択を保存してから活動を開始する。二重クリック・期限後の新規選択・結果の再支給を認めない。
 * @param {{eventId:number,choice:string}} payload 専用イベントの選択。 @returns {boolean} 現在の通知を解決してよいか。
 */
export function handleDangerousSeaEventAction(payload) {
  const progress = pending(), event = currentEvent();
  if (!event || event.id !== payload?.eventId || state.wanted?.detention || state.pendingEncounter?.active || state.modeLabel === MODE_LABEL.BATTLE) return false;
  const before = structuredClone(state);
  if (progress.stage === "result" && payload.choice === "ack") {
    if (progress.complete) closeDangerousSeaEvent(state.dangerousSeas.events, event.id, absDay(state));
    state.dangerousSeas.events.pending = null; finishDangerousSeaAction("event");
    if (!saveGameToStorage()) { Object.assign(state, before); return false; }
    return true;
  }
  if (progress.stage !== "choice") return false;
  if (payload.choice === "leave" || absDay(state) >= event.expiresAbs) {
    closeDangerousSeaEvent(state.dangerousSeas.events, event.id, absDay(state), payload.choice === "leave" ? "declined" : "expired");
    state.dangerousSeas.events.pending = null;
    if (!saveGameToStorage()) { Object.assign(state, before); return false; }
    return true;
  }
  const scouts = dangerousEventScoutRules(snapshotOutfitting(state).scouts).min;
  const outcome = dangerousSeaEventOutcome(event, payload.choice, scouts);
  if (!outcome || !beginDangerousSeaAction("event")) return false;
  Object.assign(progress, outcome, { choice: payload.choice, scoutTier: scouts, stage: "action", dayApplied: false });
  if (!saveGameToStorage()) { Object.assign(state, before); pushToast("保存できません", "選択は確定していません。", "warn"); return false; }
  handlingChoice = true;
  try { resumeDangerousSeaEvent(eventSync); } finally { handlingChoice = false; }
  return true;
}

/**
 * 灯火の固定戦闘を一度精算する。戦後保存は既存の一括処理へ任せ、報酬確認後に元行動の危険を解決する。
 * @param {object} encounter 専用参照付き遭遇。 @param {boolean} [won=true] 勝利したか。
 * @returns {Array} 既存戦果表示へ追加する資源。
 */
export function finishDangerousSeaEventEncounter(encounter, won = true) {
  const progress = pending();
  if (progress?.stage !== "battle" || progress.eventId !== encounter?.dangerousEventId || progress.regionId !== encounter?.dangerousRegionId) return [];
  if (!settleEvent(won, false)) return [];
  return rewardResources(pending().reward).map(resource => ({ text: `${resource.label} ${resource.value}`, icon: resource.id }));
}

/**
 * 既存の探索ボタン付近へ出来事の入口と発見済み情報を追加する。回遊は海域全体で期限まで有効で、調査による消費をしない。
 * @param {Function} syncUI 表示同期。 @returns {void}
 */
export function renderDangerousSeaEventControl(syncUI) {
  eventSync = syncUI || eventSync;
  const anchor = document.getElementById("exploreBtn");
  if (!anchor) return;
  let button = document.getElementById("dangerousSeaEventBtn"), info = document.getElementById("dangerousSeaEventInfo");
  if (!button) {
    button = document.createElement("button"); button.id = "dangerousSeaEventBtn"; button.className = "btn"; anchor.insertAdjacentElement("afterend", button);
    info = document.createElement("p"); info.id = "dangerousSeaEventInfo"; info.className = "tiny"; button.insertAdjacentElement("afterend", info);
  }
  const progress = pending(), event = currentEvent() || getDangerousSeaEventAt(state.position);
  const canResume = progress && !state.pendingEncounter?.active && !state.wanted?.detention && state.modeLabel !== MODE_LABEL.BATTLE
    && (!progress.pausedForHazard || !state.dangerousSeas.pendingHazard || state.dangerousSeas.pendingHazard.stage === "watch");
  button.hidden = !(canResume || (event && event.kind !== "fish_migration" && available()));
  button.textContent = progress ? "海域の出来事を再開" : `${DEFS[event?.kind]?.name || "出来事"}を調べる`;
  button.onclick = () => beginEvent(eventSync);
  const regionId = dangerousSeaAt(state.position)?.regionId;
  const known = event || visibleDangerousSeaEvents().find(site => site.regionId === regionId);
  info.hidden = !known;
  info.textContent = known ? `${DEFS[known.kind].name} (${known.position.x + 1}, ${known.position.y + 1}) / 期限まであと${Math.max(0, known.expiresAbs - absDay(state))}日 / ${known.kind === "fish_migration" ? "この海域の一部の巨大魚が釣れやすい期間です。希少・未登録枠と餌の相性は維持されます。" : hintText(known)}` : "";
}
