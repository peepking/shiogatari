import { state } from "../core/state.js";
import { MODE_LABEL } from "../core/constants.js";
import { absDay } from "../core/calendar.js";
import { saveGameToStorage } from "../core/storage.js";
import { elements, pushLog, pushToast, setOutput } from "../ui/dom.js";
import { enqueueEvent } from "../app/events.js";
import { buildDangerousEnemyFormation } from "../app/actions.js";
import { dangerousSeaAt } from "./dangerousSeaWorld.js";
import { createDangerousSeaState, tickDangerousSeaDay, rollRoughWaveLosses } from "./dangerousSeaState.js";
import { dangerousSeaName } from "./dangerousSeaConfig.js";
import { snapshotOutfitting } from "../fleet/outfitting.js";
import { updateDangerousWeather } from "./dangerousSeaWeather.js";
import { advanceDayWithEvents } from "../app/time.js";
import { restoreWorld, snapshotWorld } from "../world/map.js";

/** 同じ確定危険の保存失敗通知を、画面同期のたびに重ねない。 */
let failedHazardId = null;

/** @param {number} id 確定危険ID。 @returns {void} 保存失敗時の再試行方法を一度だけ通知する。 */
function notifyHazardSaveFailure(id) {
  if (failedHazardId === id) return;
  failedHazardId = id;
  pushToast("保存できません", "危険の結果は確定済みです。保存容量を確認し、現在地の「危険判定の表示を再試行」を押してください。", "warn");
}

/** @returns {object} 新規・旧保存の両方に独立状態を保証する。 */
function data() { return state.dangerousSeas ||= createDangerousSeaState(); }

/** @returns {boolean} 解決前の危険や継続行動が新しい行動を止めるか。予報だけでは止めない。 */
export function dangerousSeaActionBlocked() { return !!((state.dangerousSeas?.pendingHazard && state.dangerousSeas.pendingHazard.stage !== "watch") || state.dangerousSeas?.action || state.dangerousSeas?.explorationPending || state.dangerousSeas?.events?.pending); }

/**
 * 行動の開始点を保存対象にする。釣りの残り投数・探索戦闘は同じ行動として終わるまで継続する。
 * @param {string} kind 行動の種類。 @returns {number|false} 行動ID、別行動または危険の解決待ちならfalse。
 */
export function beginDangerousSeaAction(kind) {
  const current = data();
  if ((current.pendingHazard && current.pendingHazard.stage !== "watch") || current.action || (current.explorationPending && kind !== "exploration") || (current.events?.pending && kind !== "event")) return false;
  current.action = { id: current.nextActionId++, kind, startedAbs: absDay(state) };
  return current.action.id;
}

/**
 * 行動終了後の魚在庫で損失を確定し、危険を安全な画面境界で表示できる状態へ渡す。
 * @param {string} [kind] 別の継続行動を誤って終えないための種類指定。 @returns {void}
 */
export function finishDangerousSeaAction(kind) {
  const current = state.dangerousSeas;
  if (!current || (kind && current.action?.kind !== kind)) return;
  const hazard = current.pendingHazard;
  if (hazard?.stage === "action_running") {
    if (hazard.kind === "wave" && !hazard.losses) hazard.losses = rollRoughWaveLosses(state.expansion?.fishing?.counts);
    hazard.stage = "ready";
  }
  current.action = null;
}

/**
 * 日次判定は結果を保留するだけとし、敵編成を固定してから保存する。既定の探索戦闘や追跡を重ねない。
 * @param {object} [options] 日次活動と優先遭遇。 @returns {object|null} 今回の確定結果。
 */
export function updateDangerousSeaDay(options = {}) {
  const sea = dangerousSeaAt(state.position);
  const before = Object.fromEntries(Object.entries(data().regions).map(([id, region]) => [id, region.forecast && { ...region.forecast }]));
  const result = tickDangerousSeaDay(data(), sea, absDay(state), { ...options,
    detained: !!state.wanted?.detention, scouts: snapshotOutfitting(state).scouts,
    suppressRaid: options.suppressRaid || !!state.pendingEncounter?.active || !!state.piracy?.checkpoint,
    createRaid: () => buildDangerousEnemyFormation(state.position) });
  if (result?.kind === "wave_avoided") {
    pushToast("荒波を回避", "斥候が見つけた安全な潮筋を進み、荒波の被害を防ぎました。", "good");
    pushLog("荒波を回避", dangerousSeaName(result.regionId), "-");
  }
  notifyNewDangerousForecasts(before);
  return result;
}

/**
 * 初めて認識した予報と安全航路だけを通知する。海域外でも港で出発準備に使える。
 * @param {object} before 更新前の予報。 @returns {void}
 */
function notifyNewDangerousForecasts(before) {
  for (const [regionId, region] of Object.entries(data().regions)) {
    const forecast = region.forecast;
    if (!forecast || (before[regionId]?.day === forecast.day && (before[regionId]?.avoided || !forecast.avoided))) continue;
    const text = `${dangerousSeaName(regionId)} / 荒波まであと${Math.max(0, forecast.day - absDay(state))}日。${forecast.avoided ? "安全な潮筋を発見しました。この荒波は被害を回避できます。" : "退避日数を確認してください。木材1・繊維1でも魚を守れます。"}`;
    pushToast("荒波の予報", text, forecast.avoided ? "good" : "warn"); pushLog("荒波の予報", text, "-");
    if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("auto-move-stop"));
  }
}

/**
 * 日数を使わない表示でも斥候増員による早期予報を認識する。予定日と固定乱数は変更しない。
 * @returns {void}
 */
export function recognizeDangerousWeather() {
  const current = data(), before = JSON.stringify(current.regions);
  const forecasts = Object.fromEntries(Object.entries(current.regions).map(([id, region]) => [id, region.forecast && { ...region.forecast }]));
  updateDangerousWeather(current, absDay(state), snapshotOutfitting(state).scouts, Math.random, false);
  if (JSON.stringify(current.regions) !== before) { notifyNewDangerousForecasts(forecasts); saveGameToStorage(); }
}

/**
 * 初回の案内は継続行動や戦闘・危険の解決が済んだ境界で一度だけ表示する。
 * 保存に成功してから通知し、復帰や同じ海域への再進入で重複させない。
 * @returns {boolean} 初回の案内を表示したか。
 */
export function processDangerousSeaIntroduction() {
  const current = state.dangerousSeas, sea = dangerousSeaAt(state.position);
  if (!current || current.tutorialSeen || !sea || current.action || current.pendingHazard || current.explorationPending
    || state.modeLabel !== MODE_LABEL.NORMAL || state.pendingEncounter?.active || state.eventQueue?.length
    || state.expansion?.fishing?.pending || state.expansion?.exploration?.pending || state.expansion?.charts?.pending
    || (elements.fishingModal && !elements.fishingModal.hidden) || (elements.battleBlock && !elements.battleBlock.hidden)
    || (elements.battleResultModal && !elements.battleResultModal.hidden)) return false;
  current.tutorialSeen = true;
  if (!saveGameToStorage()) { current.tutorialSeen = false; return false; }
  enqueueEvent({ kind: "dangerous_sea_intro", title: "危険海域へ到達しました",
    body: `${dangerousSeaName(sea.regionId)}では希少魚や図鑑未登録の魚を狙えます。海域・季節・水深の制限はありませんが、餌の条件は有効です。滞在で警戒が高まり、強敵が接近します。荒波は12～18日周期です。斥候が多いほど早く予報を察知し、安全な潮筋や船団を発見しやすくなります。予報と退避までの日数を確認し、木材1・繊維1も備えましょう。警戒は海域外に出て3日目から下がります。` });
  return true;
}

/**
 * 行動・他のイベント・戦後結果が閉じた後に一件だけ危険を表示する。途中の釣りを再読込しても先に襲撃しない。
 * 荒波の表示済み保存に通知が無い場合も同じ固定損失の通知を復元する。
 * @returns {boolean} 表示または準備が開始したか。
 */
export function processDangerousSeaHazards() {
  const current = state.dangerousSeas;
  if (Array.isArray(state.eventQueue)) state.eventQueue = state.eventQueue.filter(event => event.kind !== "dangerous_raid_warning"
    || (current?.pendingHazard?.kind === "raid" && current.pendingHazard.stage === "warning"
      && event.actions?.some(action => action.payload?.id === current.pendingHazard.id)));
  if (!current || state.wanted?.detention || state.pendingEncounter?.active || state.modeLabel === MODE_LABEL.BATTLE) return false;
  if (state.expansion?.fishing?.pending || state.expansion?.exploration?.pending || state.expansion?.charts?.pending || (current.explorationPending && !current.explorationPending.pausedForHazard) || (current.events?.pending && !current.events.pending.pausedForHazard)) return false;
  if ((elements.fishingModal && !elements.fishingModal.hidden) || (elements.battleBlock && !elements.battleBlock.hidden)
    || (elements.battleResultModal && !elements.battleResultModal.hidden)) return false;
  if (current.action) finishDangerousSeaAction();
  const hazard = current.pendingHazard;
  if (!hazard || ["battle", "evading", "watch"].includes(hazard.stage)) return false;
  if (state.eventQueue?.length) return false;
  if (hazard.kind === "raid") {
    if (hazard.detected && !hazard.warningAccepted) {
      hazard.stage = "warning";
      if (!saveGameToStorage()) { hazard.stage = "ready"; notifyHazardSaveFailure(hazard.id); return false; }
      enqueueEvent({ kind: "dangerous_raid_warning", title: "斥候が船団を察知",
        body: `強敵船団（推定${hazard.encounter.total}人）が明日の航路を探しています。活動を続けると、次の1日の終わりに襲撃されます。釣り・探索に入る前に、活動を続けるか、1日かけて回避航路を探すか選べます。`,
        actions: [{ label: "活動を続ける・翌日の襲撃に備える", type: "dangerous_raid_continue", payload: { id: hazard.id } },
          { label: "1日かけて回避航路を探す", type: "dangerous_raid_evade", payload: { id: hazard.id } }] });
      return true;
    }
    const previous = state.pendingEncounter, previousMode = state.modeLabel;
    state.pendingEncounter = { active: true, dangerousHazardId: hazard.id, dangerousRegionId: hazard.regionId,
      enemyFormation: structuredClone(hazard.encounter.formation), enemyTotal: hazard.encounter.total,
      strength: "elite", terrain: "sea", enemyFactionId: "pirates", eventTag: "dangerous_raid" };
    state.modeLabel = MODE_LABEL.PREP; hazard.stage = "battle";
    if (!saveGameToStorage()) {
      state.pendingEncounter = previous; state.modeLabel = previousMode; hazard.stage = "ready";
      notifyHazardSaveFailure(hazard.id); return false;
    }
    failedHazardId = null;
    setOutput("危険海域の襲撃", `強敵船団が迫ります（推定${hazard.encounter.total}人）。戦闘・逃走・降伏を選んでください。`, [{ text: "戦闘準備", kind: "warn" }]);
    pushLog("危険海域の襲撃", `${dangerousSeaName(hazard.regionId)} / ${hazard.encounter.total}人`, "-");
    if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("auto-move-stop"));
    return true;
  }
  hazard.losses ||= rollRoughWaveLosses(state.expansion?.fishing?.counts);
  hazard.stage = "displaying";
  if (!saveGameToStorage()) { hazard.stage = "ready"; notifyHazardSaveFailure(hazard.id); return false; }
  failedHazardId = null;
  const lost = Object.values(hazard.losses).reduce((sum, n) => sum + n, 0);
  const canProtect = (state.supplies?.wood || 0) >= 1 && (state.supplies?.fiber || 0) >= 1;
  const actions = [];
  if (lost && canProtect) actions.push({ label: "木材1・繊維1で魚を守る", type: "dangerous_wave_protect", payload: { id: hazard.id } });
  actions.push({ label: lost ? `対策せず魚${lost}匹を失う` : "被害なし・航海を続ける", type: "dangerous_wave_accept", payload: { id: hazard.id } });
  enqueueEvent({ kind: "dangerous_wave", title: "危険海域の荒波", body: lost
    ? `船倉へ荒波が押し寄せています。魚${lost}匹が流されます。木材1・繊維1で積荷を守れます。${canProtect ? "" : "対策材料が足りません。"}`
    : "荒波を受けましたが、流された魚はありませんでした。", actions });
  return true;
}

/** @param {object} encounter 解決した遭遇。 @returns {void} 固定襲撃の勝敗・逃走を一度だけ完了する。 */
export function finishDangerousSeaEncounter(encounter) {
  const current = state.dangerousSeas;
  if (encounter?.dangerousHazardId != null && current?.pendingHazard?.id === encounter.dangerousHazardId) {
    handOverDeferredWave(current, current.pendingHazard);
    current.raidSafeUntil = absDay(state) + 3;
  }
}

/**
 * 襲撃中に当日発生した荒波を一件だけ引き継ぐ。損失はその時点の釣果から固定する。
 * @param {object} current 危険海域状態。 @param {object} hazard 解決した襲撃。 @returns {void}
 */
function handOverDeferredWave(current, hazard) {
  current.pendingHazard = hazard.deferredWave ? { id: current.nextEventId++, kind: "wave", ...hazard.deferredWave,
    stage: "ready", sourceActionId: null, losses: rollRoughWaveLosses(state.expansion?.fishing?.counts) } : null;
}

/**
 * 斥候の警告を固定結果で処理する。回避の1日にも警戒・食料・維持費を適用し、保存失敗は巻き戻す。
 * @param {object} action 警告の選択。 @returns {boolean} 有効な選択を処理したか。
 */
export function handleDangerousRaidAction(action) {
  const current = state.dangerousSeas, hazard = current?.pendingHazard;
  if (!hazard || hazard.kind !== "raid" || hazard.stage !== "warning" || hazard.id !== action.payload?.id) return false;
  const before = structuredClone(state), world = structuredClone(snapshotWorld());
  if (action.type === "dangerous_raid_evade") {
    hazard.stage = "evading";
    current.action = { id: current.nextActionId++, kind: "raid_evasion", startedAbs: absDay(state) };
    if (advanceDayWithEvents(1, { activity: "raid_evasion", suppressDangerRaid: true }) !== 1) { Object.assign(state, before); restoreWorld(world); return false; }
    current.action = null;
    if (hazard.evasionSuccess) {
      handOverDeferredWave(current, hazard); current.raidSafeUntil = absDay(state) + 3;
      pushLog("船団を回避", "1日かけて航跡を外しました。次の3日間は日次襲撃を受けません。", "-");
    } else { hazard.warningAccepted = true; hazard.stage = "ready"; pushToast("回避航路を見つけられませんでした", "戦闘準備で戦闘・逃走・降伏を選んでください。", "warn"); }
  } else if (action.type === "dangerous_raid_continue") { hazard.warningAccepted = true; hazard.stage = "watch"; }
  else return false;
  if (!saveGameToStorage()) { Object.assign(state, before); restoreWorld(world); pushToast("保存できません", "選択は適用していません。再試行してください。", "warn"); return false; }
  return true;
}
