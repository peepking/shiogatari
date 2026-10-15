import { state } from "../core/state.js";
import { saveGameToStorage, scheduleGameSave } from "../core/storage.js";
import { MODE_LABEL } from "../core/constants.js";
import { settlements } from "../world/map.js";
import { confirmAction, pushLog, pushToast } from "../ui/dom.js";
import { enqueueEvent } from "../app/events.js";
import { fishOffering, completeExpandedOracle, restoreOracleState, advanceExpandedOracle } from "./oracleExpansion.js";

/**
 * 拠点のマスへの到着で巡礼を進める。防衛中・入場拒否でも位置だけで判定する。
 * 移動の日数処理後に保存し、失敗時は移動先を保持したまま進捗と報酬を戻す。再描画・ロードで同じ到着を再確認できる。
 * 戦闘準備中の到着は移動・戦闘の既存保存へ含め、神託だけを先に保存しない。
 * @returns {boolean} 巡礼の進捗を確定したか。
 */
export function updatePilgrimageArrival() {
  if (state.dangerousSeas?.action) return false;
  const visit = state.quests?.active?.filter(q => q.type === "oracle_pilgrimage")
    .flatMap(q => q.visits || []).find(v => v && !v.done && v.target?.x === state.position.x && v.target?.y === state.position.y);
  if (!visit) return false;
  const before = structuredClone(state);
  const progress = advanceExpandedOracle(state, { kind: "arrival", settlementId: visit.id }, settlements);
  if (!progress.changed) return false;
  const deferred = state.pendingEncounter?.active || state.modeLabel === MODE_LABEL.BATTLE;
  if (!deferred && !saveGameToStorage()) {
    restoreOracleState(state, before);
    pushToast("保存できません", "到着位置は保持し、巡礼の進捗と報酬を取り消しました。保存できる状態で再確認します。", "warn");
    return false;
  }
  announceOracleResults(progress.outcomes);
  if (deferred) scheduleGameSave();
  return true;
}

/** @param {Array} outcomes 確定済みの結果。 @returns {void} 神託の達成・失敗を通知する。 */
export function announceOracleResults(outcomes) {
  for (const result of outcomes) {
    const resources = result.faith ? [{ id: "faith", label: "信仰", value: `+${result.faith}` }] : [];
    pushLog(result.title, `${result.body}${result.faith ? ` / 信仰+${result.faith}` : ""}`, "-");
    pushToast(result.title, result.body, result.success ? "good" : "bad");
    enqueueEvent({ title: result.title, body: result.body, resources });
  }
}

/** @param {object} q 神託。 @returns {boolean} 資産消費と信仰・完了を一括保存し、失敗なら復元する。 */
export function commitExpandedOracle(q) {
  const before = structuredClone(state), result = completeExpandedOracle(state, q, settlements);
  if (!result) return false;
  if (!saveGameToStorage()) {
    restoreOracleState(state, before);
    pushToast("保存できません", "奉納と神託の達成を取り消しました。", "warn");
    return false;
  }
  announceOracleResults([result]);
  return true;
}

/**
 * 実際に消費する魚種・単価・匹数または食料の残量を示す。確認後に変わった内訳は再確認する。
 * @param {object} q 神託。 @param {Function} onComplete 表示同期。 @returns {void}
 */
export function confirmExpandedOracle(q, onComplete) {
  const fish = q.type === "oracle_fish";
  const offering = fish ? fishOffering(state, q) : null;
  const fingerprint = JSON.stringify(fish ? offering : [state.supplies?.food, state.position, state.modeLabel]);
  confirmAction({ title: q.title, body: "次の内容を奉納して神託を達成します。", confirmText: "奉納する",
    sections: [{ title: "奉納するもの", items: fish ? offering.items.map(item => `${item.name} ×${item.qty}匹（売値${item.price} / 匹）`)
      : [`食料 ${q.qty}`, `奉納後の食料 ${(state.supplies?.food || 0) - q.qty}`] }],
    onConfirm: () => {
      const current = state.quests?.active?.find(quest => quest.id === q.id);
      if (!current) return;
      const updated = JSON.stringify(fish ? fishOffering(state, current) : [state.supplies?.food, state.position, state.modeLabel]);
      if (updated !== fingerprint) { confirmExpandedOracle(current, onComplete); return; }
      if (commitExpandedOracle(current)) onComplete?.();
      else { pushToast("奉納できません", "現在地・必要数・期限を確認してください。", "warn"); onComplete?.(); }
    }
  });
}
