import { state } from "../core/state.js";
import { saveGameToStorage } from "../core/storage.js";
import { settlements } from "../world/map.js";
import { confirmAction, pushLog, pushToast } from "../ui/dom.js";
import { enqueueEvent } from "../app/events.js";
import { fishOffering, completeExpandedOracle, restoreOracleState } from "./oracleExpansion.js";

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
