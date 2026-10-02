import { normalizeTide } from "../faith/tideAlliance.js";
import { normalizeBounties } from "../bounty/bounty.js";
import { normalizeWanted } from "../wanted/playerWanted.js";
import { normalizePiracy } from "../pirates/pirateConfig.js";
import { normalizeFaith } from "../faith/faith.js";
import { fishingRewards } from "../fishing/fishingRewards.js";
import { MODE_LABEL } from "./constants.js";
import { restoreWorld, snapshotWorld } from "../world/map.js";
import { reconcileWarFronts } from "../factions/warFronts.js";
import { migrateFleet } from "../fleet/fleet.js";
import { resetState, state } from "./state.js";
import { normalizeLogs } from "./logStore.js";
import { normalizeExpansionState } from "./expansionState.js";
import { normalizeVoyageStats, recordVisit } from "./voyageStats.js";
import { normalizeFinalVoyage } from "../endings/endings.js";
import { normalizeNationalPower, nationalPowerDay } from "../factions/nationalPower.js";
import { bindQuestPower } from "../factions/nationalPowerRules.js";
import { FACTIONS } from "../world/lore.js";
import { collectAssetCodex } from "../codex/assetCodex.js";
import { normalizePirateKingStory, pirateStoryEncounter, currentPirateStoryEncounter } from "../pirates/pirateKingStory.js";

const SAVE_KEY = "shiogatari-save";
let saveScheduled = false;

/**
 * 同期処理内の更新をまとめ、イベント解決などの処理完了後に保存する。
 * @returns {void}
 */
export function scheduleGameSave() {
  if (saveScheduled) return;
  saveScheduled = true;
  queueMicrotask(flushGameSave);
}

/**
 * 予約済みの保存を実行する。
 * @returns {void}
 */
function flushGameSave() {
  saveScheduled = false;
  saveGameToStorage();
}

/**
 * シンプルなハッシュ（32bit）を計算する。
 * @param {string} str
 * @returns {string}
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

/**
 * ゲーム状態をローカルストレージへ保存する。
 * 原則として戦闘準備・戦闘中は保存しない。固定賞金首・物語の討伐・犯罪成立後・大会戦の反映済み準備は保存できる。
 * @param {{battleComplete?:boolean,battlePreparation?:boolean}} [options] 戦後処理完了・大会戦準備の指定
 * @returns {boolean}
 */
export function saveGameToStorage({ battleComplete = false, battlePreparation = false } = {}) {
  const unsafe = state.modeLabel === MODE_LABEL.BATTLE || state.pendingEncounter?.active;
  const fixedPreparation = state.modeLabel === MODE_LABEL.PREP && state.pendingEncounter?.active && (state.pendingEncounter.bountyId != null || state.pendingEncounter.crimeRecorded === true || currentPirateStoryEncounter(state, state.pendingEncounter));
  const grandPreparation = battlePreparation && state.pendingEncounter?.active && state.pendingEncounter.battleKind === "grand" && state.pendingEncounter.preparation;
  const storyContinuation = battleComplete && currentPirateStoryEncounter(state, state.pendingEncounter) && state.pendingEncounter.storyId === "olav" && state.pendingEncounter.storyPhase === 2;
  if (!battleComplete && unsafe && !fixedPreparation && !grandPreparation) return false;
  try {
    const assetCodex = collectAssetCodex(state);
    const data = {
      state: {
        ...state,
        assetCodex,
        logs: normalizeLogs(state.logs),
        ...(grandPreparation ? { modeLabel: MODE_LABEL.PREP } : {}),
        ...(battleComplete ? {
          modeLabel: storyContinuation ? MODE_LABEL.PREP : MODE_LABEL.NORMAL,
          pendingEncounter: { ...state.pendingEncounter, active: storyContinuation },
        } : {}),
      },
      world: snapshotWorld(),
    };
    const payload = JSON.stringify(data);
    const hash = simpleHash(payload);
    const blob = JSON.stringify({ hash, payload, savedAt: Date.now() });
    localStorage.setItem(SAVE_KEY, blob);
    state.assetCodex = assetCodex;
    return true;
  } catch (e) {
    console.error("saveGameToStorage failed", e);
    return false;
  }
}

/**
 * ローカルストレージからゲーム状態を復元する。
 * @returns {boolean} 復元に成功したら true
 */
export function loadGameFromStorage() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const payload = parsed?.payload;
    const hash = parsed?.hash;
    if (!payload || !hash) return false;
    const actualHash = simpleHash(payload);
    if (actualHash !== hash) {
      console.warn("save data hash mismatch, skip loading");
      return false;
    }
    const snapshot = JSON.parse(payload);
    if (!snapshot?.state) return false;
    resetState();
    if (snapshot.world) {
      restoreWorld(snapshot.world);
    }
    Object.assign(state, snapshot.state);
    state.piracy = normalizePiracy(snapshot.state.piracy);
    state.bounties = normalizeBounties(snapshot.state.bounties);
    state.pirateKingStory = normalizePirateKingStory(snapshot.state.pirateKingStory);
    if (state.pendingEncounter?.active && state.pendingEncounter.storyId) {
      if (currentPirateStoryEncounter(state, state.pendingEncounter)) {
        Object.assign(state.pendingEncounter, pirateStoryEncounter(state.pirateKingStory));
        state.modeLabel = MODE_LABEL.PREP;
      } else { state.pendingEncounter = { active: false }; state.modeLabel = MODE_LABEL.NORMAL; }
    }
    state.wanted = normalizeWanted(snapshot.state.wanted);
    for (const q of [...(state.quests?.active || []), ...Object.values(state.quests?.availableBySettlement || {}).flat()]) {
      if (q.type === "bounty_hunt" && !q.pirateKind) {
        q.title = "海賊船団討伐";
        if (q.target) q.desc = `(${q.target.x + 1}, ${q.target.y + 1})で海賊船団を討伐（推定${q.estimatedTotal}人 / 強編成）`;
      }
    }
    state.tideAlliance = normalizeTide(snapshot.state.tideAlliance);
    state.faithBenefits = normalizeFaith(snapshot.state.faithBenefits);
    if (!snapshot.state.fleet) delete state.fleet;
    migrateFleet(state);
    state.nationalPower = normalizeNationalPower(snapshot.state.nationalPower, nationalPowerDay(state));
    state.logs = normalizeLogs(state.logs);
    state.expansion = normalizeExpansionState(state.expansion);
    state.assetCodex = collectAssetCodex({ ...state, assetCodex: snapshot.state.assetCodex });
    state.voyageStats = normalizeVoyageStats(snapshot.state.voyageStats, state);
    state.finalVoyage = normalizeFinalVoyage(snapshot.state.finalVoyage);
    if (!snapshot.state.voyageStats && [MODE_LABEL.IN_TOWN, MODE_LABEL.IN_VILLAGE, MODE_LABEL.AUDIENCE].includes(state.modeLabel)) {
      recordVisit(state, snapshotWorld().settlements?.find(s => s.coords?.x === state.position?.x && s.coords?.y === state.position?.y));
    }
    fishingRewards(state);
    reconcileCharts(state.expansion.charts, state.quests?.active || []);
    reconcileWarFronts(state, snapshotWorld().settlements || []);
    const powerSettlements = snapshotWorld().settlements || [];
    for (const q of state.quests?.active || []) bindQuestPower(q, FACTIONS, powerSettlements);
    return true;
  } catch (e) {
    console.error("loadGameFromStorage failed", e);
    return false;
  }
}
import { reconcileCharts } from "../exploration/charts.js";
