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
import { capacityOverflowText } from "../ui/capacityUI.js";
import { advanceDayWithEvents } from "../app/time.js";
import { beginDangerousSeaAction, finishDangerousSeaAction, dangerousSeaActionBlocked } from "./dangerousSeaHazards.js";
import { dangerousSeaAt } from "./dangerousSeaWorld.js";
import { getDangerousSeaEventAt, visibleDangerousSeaEvents } from "./dangerousSeaEventWorld.js";
import { DANGEROUS_SEA_EVENT_DEFS as DEFS, dangerousEventScoutRules } from "./dangerousSeaEventConfig.js";
import { closeDangerousSeaEvent, dangerousSeaEventOutcome, getDangerousSeaEventById } from "./dangerousSeaEventState.js";

/** 結果の確認後に現在地の操作を同期する。 */
let eventSync = null;
/** 選択処理中のキューは呼び出し元が解決するため、再開時の古い通知除去を行わない。 */
let handlingChoice = false;

/** @returns {object|null} 限定イベントの途中記録。 */
function pending() { return state.dangerousSeas?.events?.pending || null; }

/** @returns {object|null} 途中記録のIDと海域が一致する、通常枠または置き土産枠の地点。 */
function currentEvent() {
  const progress = pending(), event = progress && getDangerousSeaEventById(state.dangerousSeas.events, progress.eventId);
  return event && event.regionId === progress.regionId ? event : null;
}

/** @returns {boolean} 別の処理を始めずに出来事へ参加できるか。 */
function available() {
  return state.modeLabel === MODE_LABEL.NORMAL && !state.wanted?.detention && !state.pendingEncounter?.active && !state.eventQueue?.length
    && !state.expansion?.fishing?.pending && !state.expansion?.exploration?.pending && !state.expansion?.charts?.pending && !dangerousSeaActionBlocked();
}

/** 出来事の様子と、斥候が確認した灯火の正体を表示する。 @param {object} event 地点。 @returns {string} 手掛かり。 */
function hintText(event) {
  if (event.kind !== "fog_light") return { storm_aftermath: "嵐が運んだ積荷が漂着しています。", sinking_treasure: "沈みかけた船に積荷と乗員が残っています。", seabed_bell: "海底から鐘の音が聞こえます。" }[event.kind] || "";
  if (event.hintTier >= 10) return { rescue: "斥候が救難信号と乗員を確認しました。", trap: "斥候が灯火の陰に潜む海賊船を確認しました。", empty: "斥候の報告では無人船です。" }[event.variant];
  if (event.hintTier >= 5) return event.variant === "trap" ? "灯火の周囲に、不自然に揃った帆影があります。" : "待ち伏せの帆影は見当たりません。";
  return event.hintTier >= 1 ? "船の灯火を発見。救難か罠かは不明です。" : "霧の中に灯火が見えます。正体は不明です。";
}

/** 斥候の確認範囲と調査段階に合わせて、選択の先にある見込みを示す。正体が未確認の灯火は断定しない。
 * @param {object} event 地点。 @param {string} choice 選択。 @returns {string} 短い手掛かり。
 */
function choiceOutlook(event, choice) {
  if (event.kind === "fog_light") {
    if (event.hintTier >= 10) return { rescue: "近づけば遭難者を救い、船団の仲間として迎えられます。", trap: "近づけば戦闘になります。退ければ積荷を回収できます。", empty: "船に残された積荷を回収できそうです。" }[event.variant];
    return "近づけば遭難者や積荷が見つかるかもしれません。灯火が罠なら戦闘になります。";
  }
  if (event.kind === "seabed_bell") return { listen: "音の出どころを探ります。調査はこの先も続きます。", descend: "聖堂に残る手掛かりを探ります。回収には、もう一段階の調査が必要です。", answer: "鐘の主へ応えます。海底に残された品が手に入るかもしれません。" }[choice];
  return "";
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
    enqueueEvent({ kind: "dangerous_event", title: def.name, body: [`${progress.resultText}${progress.accident ? " 事故で回収資金・物資が半減しました。" : ""}`, capacityOverflowText()].filter(Boolean).join("\n"),
      resources: progress.applied ? rewardResources(progress.reward) : [], actions: [{ label: progress.complete ? "航海を再開" : "手掛かりを記録して戻る", type: "dangerous_event_choice", payload: { eventId: event.id, choice: "ack" } }] });
    return true;
  }
  const choices = event.kind === "seabed_bell" ? [["listen", "descend", "answer"][event.progress]] : Object.keys(def.choices);
  const body = event.kind === "sinking_treasure" ? "積荷か乗員、片方だけを運び出せます。\n積荷：資金3000・香辛料4・織物3\n救助：資金300・海兵4人・斥候2人"
    : event.kind === "seabed_bell" ? `海底から鐘の音が響きます。調査 ${event.progress + 1}/3（各1日）。`
      : hintText(event);
  enqueueEvent({ kind: "dangerous_event", title: def.name, body: [body, choiceOutlook(event, choices[0]), `期限まであと${Math.max(0, event.expiresAbs - absDay(state))}日 / 事故で回収資金・物資が半減する恐れあり`].filter(Boolean).join("\n"),
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
    progress.resultText = "海賊の罠から退きました。報酬は得られませんでした。";
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
    if (!saveGameToStorage()) { state.pendingEncounter = oldEncounter; state.modeLabel = oldMode; progress.stage = "action"; pushToast("保存できません", "灯火の調査を再開してください。", "warn"); return false; }
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
 * 同じ海域の通常枠と置き土産枠を両方表示し、現在地・途中記録と同じIDは重ねない。
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
  const known = new Map(visibleDangerousSeaEvents().filter(site => site.regionId === regionId).map(site => [site.id, site]));
  if (event) known.set(event.id, event);
  info.hidden = !known.size;
  info.textContent = "";
  for (const site of known.values()) {
    if (info.childNodes.length) info.append(document.createElement("br"));
    const line = document.createElement("span");
    line.textContent = `${DEFS[site.kind].name} (${site.position.x + 1}, ${site.position.y + 1}) / あと${Math.max(0, site.expiresAbs - absDay(state))}日 / ${site.kind === "fish_migration" ? "この海域で一部の巨大魚が釣れやすい" : hintText(site)}`;
    info.append(line);
  }
}
