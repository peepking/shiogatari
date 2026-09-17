import { state } from "./state.js";
import { MODE_LABEL } from "./constants.js";
import { elements, confirmAction, pushLog, pushToast } from "./dom.js";
import { getTerrainAt, snapshotWorld, restoreWorld } from "./map.js";
import { advanceDayWithEvents } from "./time.js";
import { saveGameToStorage } from "./storage.js";
import { SEASONS, escapeHtml } from "./util.js";
import { FISHING_CONFIG, FISH_REGIONS, FISH_CATEGORIES, BAIT_DEFS, ROD_DEFS, FISH_SPECIES, DEPTH_NAMES } from "./fishingConfig.js";
import { fishingRegionAt, rollCatch, windowFor, rollSize, recordCatch, dressCatch, speciesById, categoryTone, atariMessage, catchRecordFacts, consumeBait, processToBait, checkRodUpgrade, sessionDayRule, matchesCodexFilters, codexCompletion, codexRevealState, codexDetailReveal } from "./fishing.js";

/** 釣りパネルを開いた際に渡される表示同期。 bite/キャスト後に使う。 */
let panelSync = null;
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
/** 図鑑の分類フィルタの選択カテゴリ群。空なら全カテゴリ。 */
let codexCats = new Set();
/** 図鑑の海域フィルタの選択海域キー群。空なら全海域。 */
let codexRegions = new Set();
/** 図鑑の季節フィルタの選択季節インデックス群。空なら全季節。 */
let codexSeasons = new Set();
/** 図鑑の検索キーワード。 */
let codexSearchText = "";
/** 図鑑の詳細表示中の魚種ID。 null は一覧表示。 */
let codexSelectedId = null;

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
  } else if (rule === "migrate") {
    pending.lastDay = absDay(state);
  } else {
    return;
  }
  saveGameToStorage();
}

/**
 * 現在地の釣り環境を返す。
 * @returns {{regionId:string,season:number,depth:string,sea:boolean}}
 */
function currentEnv() {
  const terrain = getTerrainAt(state.position.x, state.position.y);
  return {
    regionId: fishingRegionAt(state.position.x, state.position.y),
    season: state.season,
    depth: terrain,
    sea: terrain === "sea" || terrain === "shoal",
  };
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
 * 現在の釣りボタンの表示と動作を更新する。
 * 海上ではセッション開始・継続、街・村では釣果の管理として開く。
 * 釣り竿未所持の海上では「釣り竿が必要」と表示し無効化する。
 * @param {Function} syncUI 表示同期。
 * @returns {void}
 */
export function renderFishingControl(syncUI) {
  const button = elements.fishBtn;
  if (!button) return;
  refreshFishingDay();
  const env = currentEnv();
  const manage = canSell();
  const fishing = state.expansion.fishing;
  const hasRod = !!fishing?.rodId;
  const online =
    hasRod &&
    env.sea &&
    state.modeLabel === MODE_LABEL.NORMAL &&
    !state.pendingEncounter?.active &&
    !state.expansion.exploration?.pending &&
    !state.expansion.charts?.pending;
  const pending = !!fishing?.pending;
  let label;
  let action;
  if (pending) {
    label = "釣り（続き）";
    action = () => openFishingPanel(syncUI);
    button.disabled = false;
  } else if (online) {
    label = "釣り";
    action = () => openFishingPanel(syncUI);
    button.disabled = false;
  } else if (!hasRod && env.sea) {
    label = "釣り竿が必要";
    action = null;
    button.disabled = true;
  } else if (manage) {
    label = "釣り小屋";
    action = () => openFishingPanel(syncUI);
    button.disabled = false;
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
  const okBtn = document.getElementById("rodRewardOk");
  if (!backdrop || !modal || !nameEl || !contextEl || !flavorEl || !okBtn) {
    onConfirm?.();
    return;
  }
  nameEl.textContent = rodName;
  const rodDef = ROD_DEFS[rodId];
  contextEl.textContent = rodDef?.context || "";
  flavorEl.textContent = rodDef?.flavor || "";
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
        if (elements.fishingModal) elements.fishingModal.hidden = false;
      });
      return;
    }
    // 海上で竿なしならメッセージ表示してパネルを開く
    pushToast("釣り", "釣り竿を持っていません。街・村の釣り小屋で入手してください。", "warn");
    renderFishingPanel();
    if (elements.fishingModal) elements.fishingModal.hidden = false;
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
        if (elements.fishingModal) elements.fishingModal.hidden = false;
      });
      return;
    }
  }

  renderFishingPanel();
  if (elements.fishingModal) elements.fishingModal.hidden = false;
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
  const current = data.pending;
  if (current.catch) current.catch = null;
  current.waitUntil = null;
  current.hookSpeciesId = null;
  if (!current.dayApplied) {
    const before = structuredClone(state);
    const world = structuredClone(snapshotWorld());
    advanceDayWithEvents(1);
    current.dayApplied = true;
    current.lastDay = absDay(state);
    if (!saveGameToStorage()) {
      Object.assign(state, before);
      restoreWorld(world);
      pushToast("保存できません", "釣りの日数適用に失敗しました。", "warn");
      return false;
    }
  }
  openFishingPanel();
  return true;
}

/**
 * 釣り開始を確認し、セッションを作って1日を消費する。
 * @returns {void}
 */
function beginFishing() {
  const data = state.expansion.fishing;
  if (data.pending) return;
  if (!data.rodId) {
    pushToast("釣り", "釣り竿を持っていません。街・村の釣り小屋で入手してください。", "warn");
    return;
  }
  const env = currentEnv();
  if (!env.sea || state.modeLabel !== MODE_LABEL.NORMAL || state.pendingEncounter?.active || state.expansion.exploration?.pending || state.expansion.charts?.pending) {
    pushToast("釣り", "今は釣りを始められません。", "warn");
    return;
  }
  const pos = { ...state.position };
  const mode = state.modeLabel;
  confirmAction({
    title: "釣りを始める",
    body: `1日使って最大${FISHING_CONFIG.castsPerSession}回釣ります。食料消費や維持費は通常どおり発生します。`,
    confirmText: "1日使って釣る",
    cancelText: "キャンセル",
    onConfirm: () => {
      if (state.modeLabel !== mode || state.position.x !== pos.x || state.position.y !== pos.y) return;
      if (state.pendingEncounter?.active || state.expansion.exploration?.pending || state.expansion.charts?.pending) return;
      data.pending = { dayApplied: false, castsLeft: FISHING_CONFIG.castsPerSession, catch: null, lastResult: null, lastDay: null };
      if (!saveGameToStorage()) {
        data.pending = null;
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
  // 現在選択中の餌を取得
  const select = document.getElementById("fishingBaitSelect");
  const currentBaitId = select?.value;
  if (!currentBaitId || !BAIT_DEFS[currentBaitId]) {
    pushToast("餌が選択されていません", "餌を選択してから釣るを押してください。", "warn");
    return;
  }
  // 餌消費
  if (!consumeBait(state, currentBaitId)) {
    pushToast("餌が足りません", `${BAIT_DEFS[currentBaitId]?.name || currentBaitId} がありません。`, "warn");
    return;
  }
  // このキャストで使用する餌を確定
  pending.currentBaitId = currentBaitId;
  const env = currentEnv();
  const species = rollCatch({ regionId: env.regionId, season: env.season, depth: env.depth, baitId: currentBaitId }, Math.random);
  const snapshot = structuredClone(data.pending);
  pending.castsLeft -= 1;
  pending.lastResult = null;
  pending.catch = null;
  pending.waitUntil = null;
  pending.hookSpeciesId = species ? species.id : null;
  if (species) pending.waitUntil = Date.now() + biteWaitMs();
  if (!saveGameToStorage()) {
    data.pending = snapshot;
    pushToast("保存できません", "釣り実行は保持されません。", "warn");
  } else if (!species) {
    pushLog("釣果", "この場所と時期・餌では魚が掛からない。", "-");
    if ((pending.castsLeft ?? 0) <= 0) data.pending = null;
    saveGameToStorage();
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
  clearSessionTimer();
  pending.catch = null;
  const s = speciesById(caught.speciesId);
  const before = { counts: { ...data.counts }, codex: structuredClone(data.codex) };
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
    data.counts = before.counts;
    data.codex = before.codex;
    data.pending = pending;
    pending.catch = caught;
    pending.lastResult = null;
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
  if (!info.success) {
    return `<div class="fishing-session is-result">
      <div class="fishing-result-name">魚に逃げられた！</div>
      <div class="row gap-12 mt-6"><button class="btn primary" id="fishingNextBtn">次へ</button></div>
    </div>`;
  }
  const s = info.speciesId ? speciesById(info.speciesId) : null;
  const tone = s ? categoryTone(s.category) : "common";
  const badges = [];
  if (info.maxUpdate) badges.push(`<span class="fishing-badge">最大サイズ更新！</span>`);
  if (info.firstCatch) badges.push(`<span class="fishing-badge">初めて釣った魚！</span>`);
  return `<div class="fishing-session is-result is-accent-${tone}">
    <div class="fishing-result-name">${escapeHtml(s?.name || "？")} (${info.size}cm) を釣り上げた！</div>
    ${badges.length ? `<div class="fishing-result-badges">${badges.join("")}</div>` : ""}
    <div class="row gap-12 mt-6"><button class="btn primary" id="fishingNextBtn">次へ</button></div>
  </div>`;
}

/**
 * 釣りセッション部を描画する。
 * アタリ中は魚名を公開せず、カテゴリに応じた文言とアクセント色を表示する。
 * 釣果発表（resultScreen）中はその画面を優先して描画する。
 * @returns {string} 表示用HTML。
 */
function sessionHtml() {
  const data = state.expansion.fishing;
  const env = currentEnv();
  if (resultScreen) return resultAnnouncementHtml();
  if (!data.pending) {
    if (!env.sea) return `<div class="tiny">釣りは海上（海・浅瀬）でのみできます。</div>`;
    const hasRod = !!data.rodId;
    if (!hasRod) {
      return `<div class="tiny">釣り竿を持っていません。街・村の釣り小屋で入手してください。</div>`;
    }
    const rodName = ROD_DEFS[data.rodId]?.name || "？";
    return `<div class="row gap-12">
      <button class="btn primary" id="fishingStartBtn">釣り開始</button></div>
      <div class="tiny mt-6">1日使い、最大${FISHING_CONFIG.castsPerSession}回まで釣れます。日が変わるとやり直しになり、回数は持ち越せません。</div>
      <div class="tiny mt-6">釣り竿: ${rodName}</div>`;
  }
  // キャスト待ち（セッション中、待機・アタリでない状態）
  if (!data.pending.catch && !isWaiting()) {
    const pending = data.pending;
    // 前回使用した餌が残っていればそれを選択、なければ所持数>0の最初の餌
    let selectedBaitId = pending.currentBaitId;
    if (selectedBaitId && !(data.bait?.[selectedBaitId] > 0)) {
      selectedBaitId = Object.keys(BAIT_DEFS).find(id => (data.bait?.[id] || 0) > 0) || null;
    }
    const baitOpts = Object.entries(BAIT_DEFS)
      .map(([id, b]) => {
        const qty = data.bait?.[id] || 0;
        const disabled = qty <= 0;
        const selected = id === selectedBaitId;
        return `<option value="${id}" ${disabled ? "disabled" : ""} ${selected ? "selected" : ""}>${escapeHtml(b.name)}（${qty}）</option>`;
      })
      .join("");
    const allDisabled = Object.values(data.bait || {}).every(qty => qty <= 0);
    return `<div class="row gap-12">
      <label class="tiny" for="fishingBaitSelect">餌</label>
      <select id="fishingBaitSelect" ${allDisabled ? "disabled" : ""}>${baitOpts}</select>
      <button class="btn primary" id="fishingCastBtn" ${allDisabled ? "disabled" : ""}>釣る（残り${pending.castsLeft}回）</button>
    </div>
    <div class="tiny mt-6">釣り竿: ${ROD_DEFS[data.rodId]?.name || "？"}</div>
    ${lastResultText()}
    <div class="fishing-end-wrapper">
      <button class="btn" id="fishingEndBtn" style="white-space: nowrap;">釣りを終了</button>
    </div>`;
  }
  if (isWaiting() || data.pending.catch) {
    const caught = data.pending.catch;
    const s = caught ? speciesById(caught.speciesId) : null;
    const tone = s ? categoryTone(s.category) : "common";
    const status = caught ? `<b>${escapeHtml(atariMessage(s?.category))}</b>` : `<b>糸を垂れています…</b>`;
    const baitName = BAIT_DEFS[data.pending.currentBaitId || data.pending.baitId]?.name || "？";
    return `<div class="fishing-session${caught ? ` is-bite is-accent-${tone}` : ""}">
      <div class="fishing-status">${status}</div>
      <div class="row gap-12 mt-6"><button class="btn primary" id="fishingPullBtn">引く</button></div>
      <progress class="fishing-gauge" id="fishingGauge" max="100" value="${caught ? 100 : 0}" aria-label="猶予時間"></progress>
    </div>
    <div class="tiny mt-6">釣り竿: ${ROD_DEFS[data.rodId]?.name || "？"} / 餌: ${baitName}</div>`;
  }
  return `<div class="row gap-12">
      <button class="btn primary" id="fishingCastBtn">釣る（残り${data.pending.castsLeft}回）</button>
      <button class="btn" id="fishingEndBtn">終了する</button>
    </div>
    <div class="tiny mt-6">釣り竿: ${ROD_DEFS[data.rodId]?.name || "？"}</div>
    ${lastResultText()}`;
}

/**
 * 釣果インベントリ部を描画する。
 * @returns {string} 表示用HTML。
 */
function inventoryHtml() {
  const data = state.expansion.fishing;
  const busy = biteActive() || isWaiting();
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
        <span class="tiny">売値${s.sellPrice} / 捌いて食料+${s.dressFood}${feedInfo}</span>
        <button class="btn" data-dress="${id}" ${busy ? "disabled" : ""}>全部捌く</button>
        <button class="btn" data-process="${id}" ${busy ? "disabled" : ""}>餌に加工</button>
      </div>`;
    })
    .join("");
  return `<div class="tiny">釣果インベントリ（上限なし）</div>
    <div class="tiny mt-6">餌所持: ${baitList || "なし"}</div>
    ${rows || `<div class="tiny">まだ釣果はありません。</div>`}`;
}

/**
 * 餌の表示名一覧を返す。
 * @param {object} s 種定義。
 * @returns {string} 餌名の連結。
 */
function baitLabel(s) {
  return Object.entries(s.baits)
    .filter(([, w]) => w > 0)
    .map(([id]) => BAIT_DEFS[id]?.name)
    .join("・");
}

/**
 * 生息域の省略表示を返す。全4海域なら「全海域」に集約する。
 * @param {object} s 種定義。
 * @returns {string} 一覧用の海域表示。
 */
function regionShortLabel(s) {
  if ((s.regions || []).length >= Object.keys(FISH_REGIONS).length) return "全海域";
  return s.regions.map((r) => FISH_REGIONS[r]).join("・");
}

/**
 * 季節の省略表示を返す。4季節すべてなら「通年」、連続範囲（年跨ぎ含む）なら
 * 「春〜秋」形式、それ以外は「・」連結で表す。
 * @param {number[]} list 季節インデックスの配列。
 * @returns {string} 一覧用の季節表示。
 */
function seasonShortLabel(list) {
  const n = Object.keys(SEASONS).length;
  if (list.length >= n) return "通年";
  const sorted = [...list].sort((a, b) => a - b);
  for (let start = 0; start < n; start++) {
    const seq = sorted.map((_, k) => (start + k) % n);
    if (seq.every((v, k) => v === sorted[k])) {
      return `${SEASONS[seq[0]]}〜${SEASONS[seq[seq.length - 1]]}`;
    }
  }
  return sorted.map((i) => SEASONS[i]).join("・");
}

/**
 * 水深の表示名を返す。config の並び順（浅瀬→海）に従ってソートして連結する。
 * @param {object} s 種定義。
 * @returns {string} 水深名の連結。
 */
function depthLabel(s) {
  const order = Object.keys(DEPTH_NAMES);
  return [...s.depth]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((d) => DEPTH_NAMES[d] || d)
    .join("・");
}

/**
 * 絶対日数をゲーム内の年月日に変換する。
 * @param {number} abs 絶対日数。
 * @returns {string} 「年 季節 日」形式の表示。
 */
function absToGameDate(abs) {
  const year = Math.floor(abs / 120);
  const rem = abs % 120;
  const season = Math.floor(rem / 30);
  const day = rem % 30 + 1;
  return `${year}年 ${SEASONS[season]}${day}日`;
}

/**
 * 図鑑の一覧と詳細のどちらを描画するかを分岐する。
 * 詳細表示中はフィルタ・検索バーを隠して一覧領域を広げる。
 * @returns {void}
 */
function renderCodexModal() {
  const body = elements.codexBody;
  if (!body) return;
  const toolsHidden = !!codexSelectedId;
  if (elements.codexModal) {
    const tools = elements.codexModal.querySelector(".codex-tools");
    if (tools) tools.hidden = toolsHidden;
  }
  if (codexSelectedId) {
    renderCodexDetail(body);
    return;
  }
  renderCodexList(body);
}

/**
 * 図鑑の一覧を描画する。
 * 図鑑No.（number）の昇順に並べ、No.・魚名・分類・最大サイズ・主な海域・季節を1行に収める。
 * 未発見魚は魚名等を非公開としつつ、図鑑完成率に応じて公開済みの海域・季節だけを表示する。
 * @param {HTMLElement} body 描画先。
 * @returns {void}
 */
function renderCodexList(body) {
  const data = state.expansion.fishing;
  const completion = codexCompletion(data.codex);
  const filterable = FISH_SPECIES.filter((s) => {
    const caught = (data.codex[s.id]?.count || 0) > 0;
    return matchesCodexFilters(
      s,
      { categories: codexCats, regions: codexRegions, seasons: codexSeasons },
      { caught, seasonsRevealed: completion.ratio >= 0.25, search: codexSearchText }
    );
  }).sort((a, b) => a.number - b.number);
  const rows = filterable
    .map((s) => {
      const entry = data.codex[s.id];
      const caught = !!entry && entry.count > 0;
      const no = `No.${String(s.number).padStart(3, "0")}`;
      if (!caught) {
        const reveal = codexRevealState(completion.ratio);
        return `<tr class="codex-not-discovered" data-codex="${s.id}">
        <td class="ta-center">${no}</td>
        <td class="ta-left">？？？</td>
        <td class="ta-center">未発見</td>
        <td class="ta-center">？？？</td>
        <td class="ta-left">${regionShortLabel(s)}</td>
        <td class="ta-center">${reveal.seasons ? seasonShortLabel(s.seasons) : "？？？"}</td>
      </tr>`;
      }
      return `<tr data-codex="${s.id}">
        <td class="ta-center">${no}</td>
        <td class="ta-left">${escapeHtml(s.name)}</td>
        <td class="ta-center">${FISH_CATEGORIES[s.category] || s.category}</td>
        <td class="ta-center">${entry.maxSize}cm</td>
        <td class="ta-left">${regionShortLabel(s)}</td>
        <td class="ta-center">${seasonShortLabel(s.seasons)}</td>
      </tr>`;
    })
    .join("");
  body.innerHTML = `<div class="tiny">釣り図鑑（${completion.caught}/${completion.total}）${codexSearchText ? ` / 「${escapeHtml(codexSearchText)}」の検索結果 ${filterable.length}件` : ""}</div>
    <div class="table mt-10">
      <table class="trade-table">
        <thead>
          <tr>
            <th class="ta-center">No.</th>
            <th class="ta-left">魚</th>
            <th class="ta-center">分類</th>
            <th class="ta-center">最大</th>
            <th class="ta-left">主な海域</th>
            <th class="ta-center">季節</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td class="ta-center" colspan="6">該当する釣果はありません。</td></tr>`}</tbody>
      </table>
    </div>`;
}

/**
 * 図鑑の魚詳細を描画する。一覧の行クリックから遷移する。
 * 上部に図鑑No.・魚名・学名・分類をひとまとまりで表示し、続けて説明文、
 * その下に最大記録と生態・釣り情報を縦方向へ並べる。
 * 未発見の魚では正体（魚名・学名・説明文・記録・カテゴリ）を出さずに「？？？」とし、
 * 図鑑完成率に応じて公開済みの生息域・季節・水深・有効な餌だけを表示する（段階公開）。
 * 一度でも釣った発見済みの魚は完成率に関係なく全項目を公開する。
 * @param {HTMLElement} body 描画先。
 * @returns {void}
 */
function renderCodexDetail(body) {
  const data = state.expansion.fishing;
  const s = FISH_SPECIES.find((item) => item.id === codexSelectedId);
  if (!s) {
    codexSelectedId = null;
    renderCodexList(body);
    return;
  }
  const entry = data.codex[s.id];
  const discovered = (entry?.count || 0) > 0;
  const completion = codexCompletion(data.codex);
  const reveal = codexDetailReveal(discovered, completion.ratio);
  const record =
    entry != null && entry.maxSizeAbs != null && entry.maxSizePos
      ? `${absToGameDate(entry.maxSizeAbs)}\u3000${FISH_REGIONS[fishingRegionAt(entry.maxSizePos.x, entry.maxSizePos.y)] || "?"}`
      : "不明";
  const maxSize = entry != null && entry.maxSize > 0 ? `${entry.maxSize}cm` : "未記録";
  const category = FISH_CATEGORIES[s.category] || s.category;
  const no = `No.${String(s.number).padStart(3, "0")}`;
  const topInfo = discovered
    ? `<div class="codex-number">${no}</div>
      <h3>${escapeHtml(s.name)}</h3>
      ${s.scientificName ? `<div class="codex-scientific">${escapeHtml(s.scientificName)}</div>` : ""}
      <div class="tiny">${category}</div>`
    : `<div class="codex-number">${no}</div>
      <h3>？？？</h3>
      <div class="tiny">未発見</div>`;
  const description = discovered && s.description ? `<p class="codex-desc">${escapeHtml(s.description)}</p>` : "";
  const recordBlock = discovered
    ? `<div class="codex-record">
      <span class="codex-record-label">最大記録</span>
      <strong>${maxSize}</strong>
      <div class="codex-record-note">${record}</div>
    </div>`
    : "";
  const ecology = `<dl class="two codex-ecology">
      <div><dt>生息域</dt><dd>${regionShortLabel(s)}</dd></div>
      <div><dt>季節</dt><dd>${reveal.seasons ? seasonShortLabel(s.seasons) : "？？？"}</dd></div>
      <div><dt>水深</dt><dd>${reveal.depth ? depthLabel(s) : "？？？"}</dd></div>
      <div><dt>有効な餌</dt><dd>${reveal.baits ? baitLabel(s) || "なし" : "？？？"}</dd></div>
    </dl>`;
  body.innerHTML = `<div class="codex-detail">
    <div class="row gap-12 mt-6"><button class="btn" id="codexBackBtn">一覧に戻る</button></div>
    <div class="codex-detail-head">
      ${topInfo}
    </div>
    ${description}
    ${recordBlock}
    ${ecology}
  </div>`;
}

/**
 * 図鑑モーダルを開き、一覧を描画する。
 * @returns {void}
 */
function openCodexModal() {
  codexSelectedId = null;
  renderCodexModal();
  if (elements.codexModal) elements.codexModal.hidden = false;
}

/**
 * 図鑑モーダルを閉じる。
 * @returns {void}
 */
function closeCodexModal() {
  if (elements.codexModal) elements.codexModal.hidden = true;
}

/**
 * フィルタグループ名から選択中のSetを返す。
 * @param {string} group グループ名（category|region|season）。
 * @returns {Set} 選択中のSet。
 */
function filterSet(group) {
  if (group === "category") return codexCats;
  if (group === "region") return codexRegions;
  return codexSeasons;
}

/**
 * フィルタボタンの表示名を返す。海域は「北西海域」から「北西」へ短縮する。
 * @param {string} group グループ名。
 * @param {string} label 元ラベル。
 * @returns {string} 表示名。
 */
function filterLabel(group, label) {
  return group === "region" ? label.replace(/海域$/, "") : label;
}

/**
 * フィルタボタン押下時に選択をトグルする。
 * 季節はインデックス文字列を数値へ変換して保持する。
 * @param {string} group グループ名（category|region|season）。
 * @param {string} key 選択キー。
 * @returns {void}
 */
function toggleCodexFilter(group, key) {
  const value = group === "season" ? Number(key) : key;
  const set = filterSet(group);
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

/**
 * 図鑑のフィルタボタン（分類・海域・季節の3グループ）を生成して配線する。
 * 各グループは複数選択（再クリックで解除）で、未選択グループは絞り込みなし。
 * @returns {void}
 */
function wireCodexFilters() {
  const wrap = elements.codexFilterWrap;
  if (!wrap) return;
  const groups = [
    ["category", FISH_CATEGORIES],
    ["region", FISH_REGIONS],
    ["season", SEASONS],
  ];
  for (const [group, source] of groups) {
    const box = wrap.querySelector(`[data-group="${group}"]`);
    if (!box) continue;
    box.textContent = "";
    for (const [key, label] of Object.entries(source)) {
      const selected = filterSet(group).has(group === "season" ? Number(key) : key);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn" + (selected ? " primary" : "");
      btn.setAttribute("aria-pressed", String(selected));
      btn.textContent = filterLabel(group, label);
      btn.addEventListener("click", () => {
        toggleCodexFilter(group, key);
        renderCodexModal();
        wireCodexFilters();
      });
      box.appendChild(btn);
    }
  }
}

/**
 * 図鑑モーダルの閉じる操作・検索・フィルタを配線する。
 * @returns {void}
 */
function wireCodexModal() {
  if (!elements.codexModal || typeof document === "undefined") return;
  elements.codexModal.addEventListener("click", (e) => {
    if (e.target === elements.codexModal) closeCodexModal();
  });
  elements.codexModalClose?.addEventListener("click", closeCodexModal);
  elements.codexSearch?.addEventListener("input", (e) => {
    codexSearchText = e.target.value.trim();
    renderCodexModal();
  });
  elements.codexBody?.addEventListener("click", (e) => {
    const row = e.target.closest("[data-codex]");
    if (row) {
      codexSelectedId = row.dataset.codex;
      renderCodexModal();
      return;
    }
    if (e.target.closest("#codexBackBtn")) {
      codexSelectedId = null;
      renderCodexModal();
    }
  });
  document.addEventListener("fishing-panel-update", () => {
    if (elements.codexModal && !elements.codexModal.hidden) renderCodexModal();
  });
  wireCodexFilters();
}

/**
 * 現在地の情報行を描画する。
 * @returns {string} 表示用テキスト。
 */
function envText() {
  const env = currentEnv();
  const depthName = DEPTH_NAMES[env.depth] || "陸地";
  return `${FISH_REGIONS[env.regionId] || "?"} / 水深: ${depthName} / ${SEASONS[env.season]}`;
}

/**
 * パネル全体を再描画する。アタリ中はタイマーを再開する。
 * @returns {void}
 */
function renderFishingPanel() {
  const sessionEl = document.getElementById("fishingSession");
  const envEl = document.getElementById("fishingEnv");
  const invEl = document.getElementById("fishingInventory");
  if (!sessionEl) return;
  envEl ? (envEl.textContent = envText()) : null;
  const data = state.expansion.fishing;
  const busy = biteActive() || isWaiting();
  const manageOnly = !currentEnv().sea && !data.pending;
  sessionEl.hidden = manageOnly;
  if (!manageOnly) sessionEl.innerHTML = sessionHtml();
  if (invEl) invEl.innerHTML = inventoryHtml();
  wireSessionButtons();
  wireInventoryButtons();
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
      saveGameToStorage();
      pushLog("釣り", "釣りを終了した。", "-");
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
        if ((pending.castsLeft ?? 0) <= 0) data.pending = null;
        pushLog("釣果", "早すぎて魚は掛かっていなかった…。", "-");
        saveGameToStorage();
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
      panelSync?.();
      renderFishingPanel();
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
  const data = state.expansion.fishing;
  const deals = Object.entries(data.counts)
    .map(([id, qty]) => {
      const s = speciesById(id);
      if (!s) return null;
      return { id, name: s.name, price: s.sellPrice, stock: qty, have: qty, direction: "sell" };
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
  elements.fishingModal.addEventListener("click", (e) => {
    if (e.target === elements.fishingModal) closeFishingPanel();
  });
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
  cancelBite();
  if (elements.fishingModal) elements.fishingModal.hidden = true;
}