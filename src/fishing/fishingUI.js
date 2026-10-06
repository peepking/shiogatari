import { state } from "../core/state.js";
import { openCodexModal, wireCodexModal } from "./fishingCodexUI.js";
import { MODE_LABEL } from "../core/constants.js";
import { elements, confirmAction, pushLog, pushToast } from "../ui/dom.js";
import { getTerrainAt, snapshotWorld, restoreWorld } from "../world/map.js";
import { advanceDayWithEvents } from "../app/time.js";
import { saveGameToStorage } from "../core/storage.js";
import { SEASONS, escapeHtml } from "../core/util.js";
import { FISHING_CONFIG, FISH_REGIONS, BAIT_DEFS, ROD_DEFS, DEPTH_NAMES } from "./fishingConfig.js";
import { fishingRegionAt, rollCatch, windowFor, rollSize, recordCatch, dressCatch, speciesById, categoryTone, atariMessage, catchRecordFacts, consumeBait, processToBait, checkRodUpgrade, sessionDayRule, fishSalePrice } from "./fishing.js";
import { rollDangerousSeaCatch } from "../dangerousSeas/dangerousSeaFishing.js";
import { migrationFishIds } from "../dangerousSeas/dangerousSeaEventState.js";
import { dangerousSeaAt } from "../dangerousSeas/dangerousSeaWorld.js";
import { dangerousSeaName } from "../dangerousSeas/dangerousSeaConfig.js";
import { beginDangerousSeaAction, finishDangerousSeaAction, dangerousSeaActionBlocked } from "../dangerousSeas/dangerousSeaHazards.js";

/** 釣りパネルを開いた際に渡される表示同期。 bite/キャスト後に使う。 */
let panelSync = null;
/** パネルを開いた場所と操作モード。移動や戦闘移行で閉じるために使う。 */
let panelLocation = null;
/** 待機とアタリの経過を監視するタイマー。 */
let sessionTimer = null;
/** アタリの猶予時間切れ基準時刻。 */
let biteDeadline = 0;
/**
 * 釣果発表の一時表示情報。成功時は正体（魚名・サイズ・記録）を、失敗時は逃げられた表示を保持する。
 * 保存対象外の一時状態で、リロード時は消える（釣果データ自体は成功時点で保存済み）。
 * 成功: { success:true, speciesId, size, firstCatch, maxUpdate } / 失敗: { success:false }。
 */
let resultScreen = null;
/**
 * 釣り竿報酬モーダルの表示状態。
 * { rodId, name } または null。
 */
let rodReward = null;

/**
 * game時間から絶対日を算出する。fishing.js の absDay と同じ式。questUtils への依存を避けて独立して維持する。
 * @param {object} state ゲーム状態。
 * @returns {number} 現在の絶対日。
 */
const absDay = (state) => state.year * 120 + state.season * 30 + state.day;

/**
 * セッションの日付整合を整える。日が変わっていれば破棄し、旧保存は当日分として扱う。
 * @returns {void}
 */
function refreshFishingDay() {
  const data = state.expansion.fishing;
  const pending = data.pending;
  if (!pending) return;
  const rule = sessionDayRule(pending, absDay(state));
  if (rule === "discard") {
    data.pending = null;
    finishDangerousSeaAction("fishing");
  } else if (rule === "migrate") {
    pending.lastDay = absDay(state);
  } else {
    return;
  }
  saveGameToStorage();
}

/**
 * 現在地の釣り環境を返す。
 * @returns {{regionId:string,season:number,depth:string,sea:boolean,dangerousSea:object|null}}
 */
function currentEnv() {
  const terrain = getTerrainAt(state.position.x, state.position.y);
  return {
    regionId: fishingRegionAt(state.position.x, state.position.y),
    season: state.season,
    depth: terrain,
    sea: terrain === "sea" || terrain === "shoal",
    dangerousSea: dangerousSeaAt(state.position),
  };
}

/**
 * 同日の釣り行動を継続できる保留と、解決待ちで操作を止める保留を区別する。
 * 続行済みの予定襲撃は日数適用前も許し、当日の実襲撃は釣りの終了まで保留する。
 * @returns {boolean} 釣り操作と釣果管理を危険が妨げるか。
 */
function fishingDangerBlocked() {
  const current = state.dangerousSeas;
  const sameFishing = current?.action?.kind === "fishing" && state.expansion.fishing.pending;
  if (sameFishing && (!current.pendingHazard || ["watch", "action_running"].includes(current.pendingHazard.stage))) return false;
  return dangerousSeaActionBlocked();
}

/**
 * 戦闘・探索・解決待ちの危険に割り込まず、釣りを進められるかを返す。
 * 同日の釣り行動が進行中なら、その終了後に発生する保留危険は妨げない。
 * @returns {boolean} 釣り操作を進められるか。
 */
function canContinueFishing() {
  return state.modeLabel === MODE_LABEL.NORMAL &&
    !state.pendingEncounter?.active &&
    !state.expansion.exploration?.pending &&
    !state.expansion.charts?.pending &&
    !state.dangerousSeas?.explorationPending &&
    !state.dangerousSeas?.events?.pending &&
    !fishingDangerBlocked();
}

/**
 * 所持している釣果があるか判定する。
 * @returns {boolean} 所持があれば true。
 */
function hasAnyFish() {
  return Object.keys(state.expansion.fishing.counts).length > 0;
}

/**
 * 現在地で釣果を売却できるか判定する。
 * @returns {boolean} 街・村の内部なら true。
 */
function canSell() {
  return state.modeLabel === MODE_LABEL.IN_TOWN || state.modeLabel === MODE_LABEL.IN_VILLAGE;
}

/**
 * アタリの発生中か判定する。
 * @returns {boolean} アタリ中なら true。
 */
function biteActive() {
  return !!state.expansion.fishing.pending?.catch;
}

/**
 * アタリ待ち（糸を垂れている）中か判定する。
 * @returns {boolean} 待機中なら true。
 */
function isWaiting() {
  const pending = state.expansion.fishing.pending;
  return !!pending?.waitUntil && !!pending.hookSpeciesId;
}

/**
 * 旅の釣り・図鑑ボタンと、施設の釣り小屋ボタンを別々に更新する。
 * 海上ではセッション開始・継続、それ以外では図鑑を開く。街・村の管理は釣り小屋へ分離する。
 * 釣り竿未所持の海上では「釣り竿が必要」と表示し無効化する。
 * @param {Function} syncUI 表示同期。
 * @returns {void}
 */
export function renderFishingControl(syncUI) {
  if (panelLocation && (panelLocation.x !== state.position.x || panelLocation.y !== state.position.y || panelLocation.mode !== state.modeLabel)) {
    if (elements.fishingModal) elements.fishingModal.hidden = true;
    panelLocation = null;
    cancelBite();
  }
  const button = elements.fishBtn;
  if (!button) return;
  refreshFishingDay();
  const env = currentEnv();
  const manage = canSell();
  const hut = elements.fishingHutBtn;
  if (hut) {
    hut.hidden = !manage;
    hut.disabled = !manage;
    hut.onclick = () => { if (canSell()) openFishingPanel(syncUI); };
  }
  const fishing = state.expansion.fishing;
  const hasRod = !!fishing?.rodId;
  const online =
    hasRod &&
    env.sea &&
    canContinueFishing();
  const pending = !!fishing?.pending;
  let label;
  let action;
  if (pending) {
    label = "釣り（続き）";
    action = () => openFishingPanel(syncUI);
    button.disabled = !canContinueFishing();
  } else if (online) {
    label = "釣り";
    action = () => openFishingPanel(syncUI);
    button.disabled = false;
  } else if (!hasRod && env.sea && !manage) {
    label = "釣り竿が必要";
    action = null;
    button.disabled = true;
  } else {
    label = "魚図鑑";
    action = openCodexModal;
    button.disabled = false;
  }
  button.hidden = false;
  button.textContent = label;
  button.onclick = action;
}

/**
 * 釣り竿報酬モーダルを表示する。
 * @param {string} rodId 竿ID
 * @param {string} rodName 竿名
 * @param {Function} onConfirm 確認時のコールバック
 */
function showRodRewardModal(rodId, rodName, onConfirm) {
  rodReward = { rodId, rodName };
  const backdrop = document.getElementById("rodRewardModal");
  const modal = backdrop?.querySelector(".modal.rod-reward-modal");
  const nameEl = document.getElementById("rodRewardName");
  const contextEl = document.getElementById("rodRewardContext");
  const flavorEl = document.getElementById("rodRewardFlavor");
  const effectEl = document.getElementById("rodRewardEffect");
  const okBtn = document.getElementById("rodRewardOk");
  if (!backdrop || !modal || !nameEl || !contextEl || !flavorEl || !okBtn) {
    onConfirm?.();
    return;
  }
  nameEl.textContent = rodName;
  const rodDef = ROD_DEFS[rodId];
  contextEl.textContent = rodDef?.context || "";
  flavorEl.textContent = rodDef?.flavor || "";
  if (effectEl) effectEl.textContent = state.expansion.fishing.rodId ? "魚が掛かった後、引き上げるまでの猶予が長くなります。" : "海・浅瀬で釣りができるようになります。";
  backdrop.hidden = false;
  const handler = () => {
    okBtn.removeEventListener("click", handler);
    backdrop.hidden = true;
    rodReward = null;
    onConfirm?.();
  };
  okBtn.addEventListener("click", handler);
}

/**
 * 釣りパネルを描画して開く。
 * @param {Function} [syncUI] 表示同期。
 * @returns {void}
 */
export function openFishingPanel(syncUI) {
  if (typeof syncUI === "function") panelSync = syncUI;
  if (elements.fishingModal && !elements.fishingModal.hidden) {
    document.getElementById("fishingTitle")?.focus({ preventScroll: true });
    return;
  }
  refreshFishingDay();

  const fishing = state.expansion.fishing;
  const hasRod = !!fishing.rodId;

  // 竿未所持の場合
  if (!hasRod) {
    if (canSell()) {
      // 街・村の釣り小屋で初回入手イベント
      showRodRewardModal("rod_basic", ROD_DEFS.rod_basic.name, () => {
        state.expansion.fishing.rodId = "rod_basic";
        saveGameToStorage();
        renderFishingPanel();
        showFishingWorkspace();
      });
      return;
    }
    // 海上で竿なしならメッセージ表示してパネルを開く
    pushToast("釣り", "釣り竿を持っていません。街・村の釣り小屋で入手してください。", "warn");
    renderFishingPanel();
    showFishingWorkspace();
    return;
  }

  // 竿所持時の竿アップグレード判定
  if (canSell()) {
    const newRod = checkRodUpgrade(state);
    if (newRod) {
      const rodDef = ROD_DEFS[newRod];
      showRodRewardModal(newRod, rodDef.name, () => {
        state.expansion.fishing.rodId = newRod;
        saveGameToStorage();
        renderFishingPanel();
        showFishingWorkspace();
      });
      return;
    }
  }

  renderFishingPanel();
  showFishingWorkspace();
}

/** @returns {void} 他の中央パネルを閉じ、釣り画面へフォーカスを移す。 */
function showFishingWorkspace() {
  if (!elements.fishingModal) return;
  document.getElementById("outfittingClose")?.click();
  document.getElementById("tideClose")?.click();
  document.dispatchEvent(new CustomEvent("auto-move-stop"));
  panelLocation = { ...state.position, mode: state.modeLabel };
  elements.fishingModal.hidden = false;
  const inventory = document.querySelector(".fishing-storage");
  if (inventory && canSell()) inventory.open = true;
  document.getElementById("fishingTitle")?.focus({ preventScroll: true });
}

/**
 * 未完了の釣りセッションを再開する。起動時の復帰に使う。
 * セッション開始時の1日適用が残っていれば適用し、途中のアタリは破棄する。
 * @returns {boolean} 再開できたか。
 */
export function resumeFishing() {
  const data = state.expansion.fishing;
  const pending = data.pending;
  if (!pending) return false;
  refreshFishingDay();
  if (!data.pending) return false;
  if (!canContinueFishing()) return false;
  const current = data.pending;
  if (current.catch) current.catch = null;
  current.waitUntil = null;
  current.hookSpeciesId = null;
  if (!current.dayApplied) {
    const before = structuredClone(state);
    const world = structuredClone(snapshotWorld());
    if (!state.dangerousSeas?.action && !beginDangerousSeaAction("fishing")) return false;
    const startingDay = absDay(state);
    advanceDayWithEvents(1);
    if (absDay(state) === startingDay) {
      Object.assign(state, before);
      restoreWorld(world);
      return false;
    }
    current.dayApplied = true;
    current.lastDay = absDay(state);
    if (!saveGameToStorage()) {
      Object.assign(state, before);
      restoreWorld(world);
      pushToast("保存できません", "釣りの日数適用に失敗しました。", "warn");
      if (elements.fishingModal && !elements.fishingModal.hidden) renderFishingPanel();
      return false;
    }
  }
  if (elements.fishingModal && !elements.fishingModal.hidden) renderFishingPanel();
  else openFishingPanel();
  return true;
}

/**
 * 釣り開始を確認し、セッションを作って1日を消費する。
 * @returns {void}
 */
function beginFishing() {
  const data = state.expansion.fishing;
  if (data.pending) {
    if (!data.pending.dayApplied) resumeFishing();
    return;
  }
  if (!data.rodId) {
    pushToast("釣り", "釣り竿を持っていません。街・村の釣り小屋で入手してください。", "warn");
    return;
  }
  const env = currentEnv();
  if (!env.sea || !canContinueFishing()) {
    pushToast("釣り", "今は釣りを始められません。", "warn");
    return;
  }
  const pos = { ...state.position };
  const mode = state.modeLabel;
  confirmAction({
    title: "釣りを始める",
    body: `最大${FISHING_CONFIG.castsPerSession}回釣れます。`,
    sections: [{ title: "所要日数", items: ["1日（食料・維持費は通常どおり）"] }],
    guideTopic: "guide-fishing",
    confirmText: "1日使って釣る",
    cancelText: "キャンセル",
    onConfirm: () => {
      if (state.modeLabel !== mode || state.position.x !== pos.x || state.position.y !== pos.y) return;
      if (!canContinueFishing()) return;
      const previousDanger = structuredClone(state.dangerousSeas);
      if (!beginDangerousSeaAction("fishing")) return;
      data.pending = { dayApplied: false, castsLeft: FISHING_CONFIG.castsPerSession, catch: null, lastResult: null, lastDay: null };
      if (!saveGameToStorage()) {
        data.pending = null;
        state.dangerousSeas = previousDanger;
        pushToast("保存できません", "釣りは開始していません。", "warn");
        return;
      }
      if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("auto-move-stop"));
      resumeFishing();
    },
  });
}

/**
 * アタリまでの待機時間（実時間ミリ秒）をランダムに返す。
 * @returns {number} 待機ミリ秒。
 */
function biteWaitMs() {
  const min = FISHING_CONFIG.minBiteWaitMs;
  const max = FISHING_CONFIG.maxBiteWaitMs;
  return min + Math.floor(Math.random() * Math.max(1, max - min + 1));
}

/**
 * 1回の釣りを実行する。
 * 対象魚がその条件に存在しない場合は待機なしで空振りを告知する。
 * 掛かればランダムな待機時間の後にアタリが発生する。
 * @returns {void}
 */
function doCast() {
  const data = state.expansion.fishing;
  const pending = data.pending;
  if (!pending || biteActive() || isWaiting() || (pending.castsLeft ?? 0) <= 0) return;
  if (!canContinueFishing()) return;
  if (!pending.dayApplied) {
    resumeFishing();
    return;
  }
  // 現在選択中の餌を取得
  const select = document.getElementById("fishingBaitSelect");
  const currentBaitId = select?.value;
  if (!currentBaitId || !BAIT_DEFS[currentBaitId]) {
    pushToast("餌が選択されていません", "餌を選択してから釣るを押してください。", "warn");
    return;
  }
  const snapshot = structuredClone(data.pending);
  const previousBaitCount = data.bait[currentBaitId];
  // 餌消費
  if (!consumeBait(state, currentBaitId)) {
    pushToast("餌が足りません", `${BAIT_DEFS[currentBaitId]?.name || currentBaitId} がありません。`, "warn");
    return;
  }
  // このキャストで使用する餌を確定
  pending.currentBaitId = currentBaitId;
  const env = currentEnv();
  const species = env.dangerousSea
    ? rollDangerousSeaCatch({ baitId: currentBaitId, codex: data.codex,
      migrationFishIds: migrationFishIds(state, env.dangerousSea.regionId, absDay(state)) }, Math.random)
    : rollCatch({ regionId: env.regionId, season: env.season, depth: env.depth, baitId: currentBaitId }, Math.random);
  pending.castsLeft -= 1;
  pending.lastResult = null;
  pending.catch = null;
  pending.waitUntil = null;
  pending.hookSpeciesId = species ? species.id : null;
  if (species) pending.waitUntil = Date.now() + biteWaitMs();
  if (!saveGameToStorage()) {
    data.pending = snapshot;
    data.bait[currentBaitId] = previousBaitCount;
    pushToast("保存できません", "釣り実行は保持されません。", "warn");
  } else if (!species) {
    pushLog("釣果", "この場所と時期・餌では魚が掛からない。", "-");
    if ((pending.castsLeft ?? 0) <= 0) {
      data.pending = null;
      finishDangerousSeaAction("fishing");
    }
    saveGameToStorage();
  }
  if (!data.pending && state.dangerousSeas?.pendingHazard?.stage === "ready") {
    closeFishingPanel();
    return;
  }
  panelSync?.();
  renderFishingPanel();
}

/**
 * アタリを解決する。引けた瞬間に呼ぶ場合は時間内判定を渡す。
 * 図鑑登録・最大記録更新・セーブは引けた時点で確定し、通知（ログ・トースト）は出さずに
 * 釣果発表画面（resultScreen）へ遷移する。ログは「次へ」の操作で発行される。
 * @param {boolean} pulled 猶予時間内に引けたか。
 * @returns {void}
 */
function resolveBite(pulled) {
  const data = state.expansion.fishing;
  const pending = data.pending;
  const caught = pending?.catch;
  if (!pending || !caught) return;
  const before = { fishing: structuredClone(data), voyageStats: structuredClone(state.voyageStats) };
  clearSessionTimer();
  pending.catch = null;
  const s = speciesById(caught.speciesId);
  if (pulled) {
    const size = rollSize(caught.speciesId, Math.random);
    const facts = catchRecordFacts(data.codex[caught.speciesId], size);
    recordCatch(state, { species: s, size });
    resultScreen = { success: true, speciesId: caught.speciesId, size, firstCatch: facts.firstCatch, maxUpdate: facts.maxUpdate };
    pending.lastResult = { speciesId: caught.speciesId, size, success: true };
  } else {
    resultScreen = { success: false };
    pending.lastResult = { success: false };
  }
  if ((pending.castsLeft ?? 0) <= 0) data.pending = null;
  if (!saveGameToStorage()) {
    state.expansion.fishing = before.fishing;
    if (before.voyageStats === undefined) delete state.voyageStats;
    else state.voyageStats = before.voyageStats;
    resultScreen = null;
    pushToast("保存できません", "釣果は保持されません。", "warn");
  }
  panelSync?.();
  renderFishingPanel();
}

/**
 * アタリ待ちの完了を解決する。掛かっていればアタリ状態にして猶予タイマーを始める。
 * @returns {void}
 */
function resolveWait() {
  const pending = state.expansion.fishing.pending;
  const speciesId = pending?.hookSpeciesId;
  if (!pending || !speciesId || !pending.waitUntil) return;
  clearSessionTimer();
  pending.waitUntil = null;
  pending.hookSpeciesId = null;
  pending.catch = { speciesId, windowSeconds: windowFor(speciesId, state.expansion.fishing.rodId) };
  saveGameToStorage();
  renderFishingPanel();
}

/**
 * 待機とアタリの経過を監視するタイマーを開始する。
 * 待機中は完了時刻、アタリ中は猶予ゲージの更新と時間切れ判定を行う。
 * @returns {void}
 */
function startSessionTimer() {
  const pending = state.expansion.fishing.pending;
  if (pending?.catch) biteDeadline = Date.now() + pending.catch.windowSeconds * 1000;
  if (!isWaiting() && !biteActive()) return;
  clearSessionTimer();
  sessionTimer = setInterval(() => {
    if (isWaiting()) {
      if (Date.now() >= state.expansion.fishing.pending.waitUntil) resolveWait();
      return;
    }
    const caught = state.expansion.fishing.pending?.catch;
    if (!caught) {
      clearSessionTimer();
      return;
    }
    const remainMs = biteDeadline - Date.now();
    if (remainMs <= 0) {
      resolveBite(false);
      return;
    }
    const ratio = remainMs / (caught.windowSeconds * 1000);
    const gauge = document.getElementById("fishingGauge");
    if (gauge) {
      gauge.value = Math.max(0, Math.min(100, ratio * 100));
      if (FISHING_CONFIG.gaugeStressColor) {
        gauge.classList.toggle("is-low", ratio < FISHING_CONFIG.gaugeStressAt);
      }
    }
  }, 100);
}

/**
 * 待機とアタリの監視タイマーを停止する。
 * @returns {void}
 */
function clearSessionTimer() {
  if (sessionTimer != null) {
    clearInterval(sessionTimer);
    sessionTimer = null;
  }
}

/**
 * パネルを閉じるときにアタリ待ちまたはアタリ中の釣果を破棄する。
 * キャストは消費済みなので保持しない。
 * @returns {void}
 */
function cancelBite() {
  const pending = state.expansion.fishing.pending;
  if (!pending || (!pending.catch && !isWaiting())) return;
  clearSessionTimer();
  pending.catch = null;
  pending.waitUntil = null;
  pending.hookSpeciesId = null;
  saveGameToStorage();
  renderFishingPanel();
  panelSync?.();
}

/**
 * アタリの残り回数や最後の結果を返す。
 * 失敗時は魚名を公開しない（「魚に逃げられた…」のみ表示）。
 * @returns {string} 表示用HTML。
 */
function lastResultText() {
  const pending = state.expansion.fishing.pending;
  const c = pending?.lastResult;
  if (!c) return "";
  if (!c.success) return `<div class="tiny mt-6">前回: 魚に逃げられた…</div>`;
  const name = escapeHtml(speciesById(c.speciesId)?.name || c.speciesId || "？");
  return `<div class="tiny mt-6">前回: ${name}（${c.size}cm）を釣り上げた</div>`;
}

/**
 * 釣果発表の表示HTMLを返す。
 * 成功時はここで初めて魚名とサイズを公開し、初釣果・最大サイズ更新の記録を条件付きで表示する。
 * 失敗時は魚名を公開せず「魚に逃げられた！」とだけ表示する。
 * アクセント色はカテゴリに応じて変える（一般魚=青系・大物=金系・超大物=赤系）。
 * @returns {string} 表示用HTML。
 */
function resultAnnouncementHtml() {
  const info = resultScreen;
  const s = info.success && info.speciesId ? speciesById(info.speciesId) : null;
  const tone = s ? categoryTone(s.category) : "common";
  const badges = [];
  if (info.maxUpdate) badges.push('<span class="fishing-badge">最大記録更新</span>');
  if (info.firstCatch) badges.push('<span class="fishing-badge">初めての釣果</span>');
  const content = info.success
    ? `<div class="fishing-result-caption">釣り上げた！</div>
       <h3 class="fishing-result-name">${escapeHtml(s?.name || "？")}</h3>
       <div class="fishing-result-size">${info.size}<span>cm</span></div>
       <div class="fishing-result-badges">${badges.join("")}</div>`
    : '<div class="fishing-result-caption">波間に姿が消えた</div><h3 class="fishing-result-name">魚に逃げられた…</h3><p>次のアタリを待ちましょう。</p>';
  const more = (state.expansion.fishing.pending?.castsLeft || 0) > 0;
  return fishingStage(content,
    `<button class="btn primary fishing-main-action" id="fishingNextBtn">${more ? "次の一投へ" : "釣果を確認"}</button>`,
    `is-result is-accent-${tone}`);
}

/**
 * 水面・案内・操作を固定した枠へ配置する。装飾は読み上げ対象にしない。
 * @param {string} content 状態説明。 @param {string} controls 操作HTML。
 * @param {string} phase 状態クラス。 @returns {string} 共通の釣り画面。
 */
function fishingStage(content, controls = "", phase = "") {
  const data = state.expansion.fishing;
  const rod = escapeHtml(ROD_DEFS[data.rodId]?.name || "竿なし");
  const remaining = data.pending ? `残り ${data.pending.castsLeft} / ${FISHING_CONFIG.castsPerSession} 回` : "1日を使って釣りをする";
  return `<div class="fishing-stage ${phase}">
    <div class="fishing-stage-meta"><span>${rod}</span><span>${remaining}</span></div>
    <div class="fishing-water"><div class="fishing-float" aria-hidden="true"></div>
      <div class="fishing-stage-message" role="status">${content}</div>
    </div>
    <div class="fishing-command">${controls}</div>
  </div>`;
}

/**
 * 待機・アタリ・釣果で水面と操作欄の高さを共有する。魚名は釣果確定後だけ公開する。
 * @returns {string} 表示用HTML。
 */
function sessionHtml() {
  const data = state.expansion.fishing;
  const env = currentEnv();
  if (resultScreen) return resultAnnouncementHtml();
  if (!data.pending) {
    if (!env.sea) return fishingStage("<p>釣りは海・浅瀬で楽しめます。</p>");
    if (!data.rodId) return fishingStage("<p>街・村の釣り小屋で竿を手に入れましょう。</p>");
    return fishingStage(`<h3>波に耳を澄ませて</h3><p>1日使い、最大${FISHING_CONFIG.castsPerSession}回まで釣れます。</p><p class="tiny">日が変わると残り回数は持ち越せません。</p>`,
      '<button class="btn primary fishing-main-action" id="fishingStartBtn">釣りを始める</button>', "is-ready");
  }
  const pending = data.pending;
  if (!pending.dayApplied) {
    return fishingStage("<h3>釣りの再開待ち</h3><p>再開すると一日が進みます。</p>",
      '<button class="btn primary fishing-main-action" id="fishingStartBtn">釣りを再開</button>', "is-ready");
  }
  if (!pending.catch && !isWaiting()) {
    let selectedBaitId = pending.currentBaitId;
    if (!selectedBaitId || !(data.bait?.[selectedBaitId] > 0)) {
      selectedBaitId = Object.keys(BAIT_DEFS).find(id => (data.bait?.[id] || 0) > 0) || null;
    }
    const baitOpts = Object.entries(BAIT_DEFS).map(([id, b]) => {
      const qty = data.bait?.[id] || 0;
      return `<option value="${id}" ${qty <= 0 ? "disabled" : ""} ${id === selectedBaitId ? "selected" : ""}>${escapeHtml(b.name)}（${qty}）</option>`;
    }).join("");
    const allDisabled = Object.values(data.bait || {}).every(qty => qty <= 0);
    return fishingStage(`<h3>次は何が釣れるだろう</h3><p>${allDisabled ? "餌がありません。街・村で購入するか、釣果を加工できます。" : "餌を選んで、糸を垂らしましょう。"}</p>${lastResultText()}`,
      `<label class="fishing-bait-control" for="fishingBaitSelect">餌<select id="fishingBaitSelect" ${allDisabled ? "disabled" : ""}>${baitOpts}</select></label>
       <button class="btn primary fishing-main-action" id="fishingCastBtn" ${allDisabled ? "disabled" : ""}>糸を垂らす</button>
       <button class="btn ghost fishing-end-action" id="fishingEndBtn">釣りを終了</button>`, "is-ready");
  }
  const caught = pending.catch;
  const s = caught ? speciesById(caught.speciesId) : null;
  const tone = s ? categoryTone(s.category) : "common";
  const bait = escapeHtml(BAIT_DEFS[pending.currentBaitId || pending.baitId]?.name || "？");
  return fishingStage(
    `<h3>${caught ? escapeHtml(atariMessage(s?.category)) : "糸を垂れています…"}</h3>
     <p>${caught ? "今です！ 引き上げましょう。" : "浮きの動きを見守りましょう。"}</p>
     <progress class="fishing-gauge" id="fishingGauge" max="100" value="${caught ? 100 : 0}" aria-label="猶予時間"></progress>`,
    `<div class="fishing-bait-control"><span>使用中の餌</span><strong>${bait}</strong></div>
     <button class="btn primary fishing-main-action" id="fishingPullBtn">引く</button>`,
    caught ? `is-bite is-accent-${tone}` : "is-waiting");
}

/**
 * 釣果インベントリ部を描画する。
 * @returns {string} 表示用HTML。
 */
function inventoryHtml() {
  const data = state.expansion.fishing;
  const busy = biteActive() || isWaiting() || fishingDangerBlocked();
  // 餌所持数表示
  const baitList = Object.entries(data.bait || {})
    .map(([id, qty]) => `<span class="pill">${BAIT_DEFS[id]?.name || id} x${qty}</span>`)
    .join(" ");
  const rows = Object.entries(data.counts)
    .map(([id, qty]) => {
      const s = speciesById(id);
      if (!s) return "";
      const feedInfo = s.feedType ? ` / 餌:${BAIT_DEFS[s.feedType]?.name || s.feedType}+${s.dressFood}` : "";
      return `<div class="fishing-row">
        <span class="pill">${escapeHtml(s.name)} x${qty}</span>
        <span class="tiny">1匹あたり：売値${fishSalePrice(state, s)}資金 / 食料+${s.dressFood}${feedInfo}</span>
        <button class="btn" data-dress="${id}" ${busy ? "disabled" : ""}>全部捌く</button>
        <button class="btn" data-process="${id}" ${busy ? "disabled" : ""}>餌に加工</button>
      </div>`;
    })
    .join("");
  return `<div class="tiny">釣果</div>
    <div class="tiny mt-6">餌所持: ${baitList || "なし"}</div>
    ${rows || `<div class="tiny">まだ釣果はありません。</div>`}`;
}


/**
 * 現在地の情報行を描画する。
 * @returns {string} 表示用テキスト。
 */
function envText() {
  const env = currentEnv();
  const depthName = DEPTH_NAMES[env.depth] || "陸地";
  if (env.dangerousSea) {
    const name = dangerousSeaName(env.dangerousSea.regionId);
    const level = env.dangerousSea.level === "core" ? "核心" : "外縁";
    const migration = migrationFishIds(state, env.dangerousSea.regionId, absDay(state)).length ? " 巨大魚の回遊中。一部の魚が釣れやすくなっています。" : "";
    return `${name}・${level} / 海域・季節・水深にかかわらず釣れます。餌の相性は必要です。${migration}`;
  }
  return `${FISH_REGIONS[env.regionId] || "?"} / 水深: ${depthName} / ${SEASONS[env.season]}`;
}

/**
 * パネル全体を再描画する。街・村の釣り小屋では地形に関係なく釣り操作を隠す。
 * アタリ中はタイマーを再開する。
 * @returns {void}
 */
function renderFishingPanel() {
  const sessionEl = document.getElementById("fishingSession");
  const envEl = document.getElementById("fishingEnv");
  const invEl = document.getElementById("fishingInventory");
  if (!sessionEl) return;
  const restoreFocus = sessionEl.contains(document.activeElement);
  envEl ? (envEl.textContent = envText()) : null;
  const data = state.expansion.fishing;
  const busy = biteActive() || isWaiting() || fishingDangerBlocked();
  const manageOnly = canSell() || (!currentEnv().sea && !data.pending);
  sessionEl.hidden = manageOnly;
  if (!manageOnly) sessionEl.innerHTML = sessionHtml();
  if (invEl) invEl.innerHTML = inventoryHtml();
  wireSessionButtons();
  wireInventoryButtons();
  if (restoreFocus) sessionEl.querySelector(".fishing-main-action")?.focus({ preventScroll: true });
  if (elements.fishingSellBtn) {
    const sellable = canSell() && !busy && hasAnyFish();
    elements.fishingSellBtn.hidden = !sellable;
    elements.fishingSellBtn.disabled = busy;
  }
  if (elements.fishingBaitBuyBtn) {
    elements.fishingBaitBuyBtn.hidden = !canSell();
  }
  if (isWaiting() || biteActive()) startSessionTimer();
}

/**
 * セッション部の操作ボタンを配線する。
 * @returns {void}
 */
function wireSessionButtons() {
  const startBtn = document.getElementById("fishingStartBtn");
  if (startBtn) startBtn.addEventListener("click", beginFishing);
  const castBtn = document.getElementById("fishingCastBtn");
  if (castBtn) castBtn.addEventListener("click", doCast);
  const endBtn = document.getElementById("fishingEndBtn");
  if (endBtn) {
    endBtn.addEventListener("click", () => {
      clearSessionTimer();
      state.expansion.fishing.pending = null;
      resultScreen = null;
      finishDangerousSeaAction("fishing");
      saveGameToStorage();
      pushLog("釣り", "釣りを終了した。", "-");
      if (state.dangerousSeas?.pendingHazard?.stage === "ready") {
        closeFishingPanel();
        return;
      }
      renderFishingPanel();
      panelSync?.();
    });
  }
  const pullBtn = document.getElementById("fishingPullBtn");
  if (pullBtn) {
    pullBtn.addEventListener("click", () => {
      const data = state.expansion.fishing;
      const pending = data.pending;
      if (!pending) return;
      if (isWaiting()) {
        clearSessionTimer();
        pending.catch = null;
        pending.waitUntil = null;
        pending.hookSpeciesId = null;
        if ((pending.castsLeft ?? 0) <= 0) {
          data.pending = null;
          finishDangerousSeaAction("fishing");
        }
        pushLog("釣果", "早すぎて魚は掛かっていなかった…。", "-");
        saveGameToStorage();
        if (!data.pending && state.dangerousSeas?.pendingHazard?.stage === "ready") {
          closeFishingPanel();
          return;
        }
        renderFishingPanel();
        panelSync?.();
        return;
      }
      if (!pending.catch) return;
      resolveBite(Date.now() <= biteDeadline);
    });
  }
  const nextBtn = document.getElementById("fishingNextBtn");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const info = resultScreen;
      if (!info) return;
      if (info.success) {
        const s = info.speciesId ? speciesById(info.speciesId) : null;
        pushLog("釣果", `${s?.name || "？"}（${info.size}cm）を釣り上げた。`, "-");
      } else {
        pushLog("釣果", "魚に逃げられた。", "-");
      }
      resultScreen = null;
      if (!state.expansion.fishing.pending) {
        finishDangerousSeaAction("fishing");
        saveGameToStorage();
        if (state.dangerousSeas?.pendingHazard?.stage === "ready") {
          closeFishingPanel();
          return;
        }
      }
      panelSync?.();
      renderFishingPanel();
      if (!state.expansion.fishing.pending) {
        const inventory = document.querySelector(".fishing-storage");
        if (inventory) inventory.open = true;
      }
    });
  }
}

/**
 * インベントリ部の操作ボタンを配線する。
 * @returns {void}
 */
function wireInventoryButtons() {
  for (const btn of document.querySelectorAll("#fishingInventory [data-dress]")) {
    btn.addEventListener("click", () => {
      if (fishingDangerBlocked()) return;
      const id = btn.getAttribute("data-dress");
      const data = state.expansion.fishing;
      const held = data.counts[id] || 0;
      const s = speciesById(id);
      if (!held || !s) return;
      const food = dressCatch(state, id, held);
      pushLog("捌く", `${s.name} x${held} を捌き、食料+${food}。`, "-");
      pushToast("捌いた", `食料+${food}`, "good");
      saveGameToStorage();
      renderFishingPanel();
      panelSync?.();
    });
  }
  for (const btn of document.querySelectorAll("#fishingInventory [data-process]")) {
    btn.addEventListener("click", () => {
      if (fishingDangerBlocked()) return;
      const id = btn.getAttribute("data-process");
      const data = state.expansion.fishing;
      const held = data.counts[id] || 0;
      const s = speciesById(id);
      if (!held || !s || !s.feedType) return;
      const result = processToBait(state, id, held);
      if (!result) return;
      const baitName = BAIT_DEFS[result.baitId]?.name || result.baitId;
      pushLog("餌加工", `${s.name} x${held} を加工し、${baitName} x${result.amount} を得た。`, "-");
      pushToast("餌加工", `${baitName} +${result.amount}`, "good");
      saveGameToStorage();
      renderFishingPanel();
      panelSync?.();
    });
  }
}

/**
 * 所持している釣果を固定価格で売却する取引を開く。
 * @returns {void}
 */
function openFishSale() {
  if (fishingDangerBlocked() || !canSell()) return;
  const data = state.expansion.fishing;
  const deals = Object.entries(data.counts)
    .map(([id, qty]) => {
      const s = speciesById(id);
      if (!s) return null;
      return { id, name: s.name, price: fishSalePrice(state, s), stock: qty, have: qty, direction: "sell" };
    })
    .filter(Boolean);
  if (!deals.length) return;
  state.eventTrade = { source: "fishing", title: "魚の買い取り", note: "拠点が固定価格で買い取ります。", deals };
  if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("event-trade-open"));
}

/**
 * 餌購入UIを開く。eventTrade パターンを再利用する。
 * @returns {void}
 */
function openBaitPurchase() {
  if (fishingDangerBlocked()) return;
  if (!canSell()) {
    pushToast("餌購入", "街・村の釣り小屋でのみ購入できます。", "warn");
    return;
  }
  const deals = Object.keys(BAIT_DEFS).map((id) => {
    const b = BAIT_DEFS[id];
    return { id, name: b.name, price: b.price, stock: 999, have: 0, direction: "buy" };
  });
  state.eventTrade = { source: "bait", title: "餌購入", note: "釣り用の餌を購入します。", deals };
  if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("event-trade-open"));
}

/**
 * 釣り画面の閉じる操作と、売却後の再描画を配線する。
 * @returns {void}
 */
export function wireFishingUI() {
  if (!elements.fishingModal || typeof document === "undefined") return;
  /** 新規航海へ古い釣り待機を持ち越さない。 */
  document.addEventListener("game-reset", function resetFishingSession() { clearSessionTimer(); panelLocation = null; });
  document.querySelector(".workspace-actions")?.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (button && button !== elements.fishBtn && button !== elements.fishingHutBtn && !elements.fishingModal.hidden) closeFishingPanel();
  }, true);
  elements.fishingModalClose?.addEventListener("click", closeFishingPanel);
  elements.fishingCodexBtn?.addEventListener("click", openCodexModal);
  elements.fishingBaitBuyBtn?.addEventListener("click", openBaitPurchase);
  elements.fishingSellBtn?.addEventListener("click", openFishSale);
  document.addEventListener("fishing-panel-update", () => {
    if (!elements.fishingModal.hidden) renderFishingPanel();
  });
  wireCodexModal();
}

/**
 * 釣りパネルを閉じる。アタリ中なら釣果を破棄する。
 * @returns {void}
 */
function closeFishingPanel() {
  if (elements.fishingModal) elements.fishingModal.hidden = true;
  panelLocation = null;
  cancelBite();
  if (state.expansion.fishing.pending) {
    state.expansion.fishing.pending = null;
    resultScreen = null;
    finishDangerousSeaAction("fishing");
    saveGameToStorage();
  } else if (resultScreen) {
    resultScreen = null;
    finishDangerousSeaAction("fishing");
    saveGameToStorage();
  }
  panelSync?.();
  (canSell() ? elements.fishingHutBtn : elements.fishBtn)?.focus({ preventScroll: true });
}
