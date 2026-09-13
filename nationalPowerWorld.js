import { state } from "./state.js";
import { FACTIONS } from "./lore.js";
import { settlements } from "./map.js";
import { getRelation } from "./faction.js";
import { pushLog } from "./dom.js";
import { enqueueEvent } from "./events.js";
import { completeQuestPower } from "./nationalPowerRules.js";

/** @param {string} a 国家。 @param {string} b 相手国家。 @returns {boolean} 現在交戦中か。 */
export function nationalPowerAtWar(a, b) { return getRelation(a, b) === "war"; }

/** @param {Array} changes 増減。 @returns {Array} 実増減の報告用資源。 */
export function nationalPowerResources(changes) {
  return (changes || []).map(row => ({ id: "nationalPower", label: `${FACTIONS.find(f => f.id === row.factionId)?.name || row.factionId}の国力`, value: `${row.delta >= 0 ? "+" : ""}${row.delta.toLocaleString("ja-JP", { maximumFractionDigits: 3 })}` }));
}

/** @param {object} q 完了依頼。 @returns {void} 依頼全体の達成時に付与し、既存の結果報告に利用できる形で保持する。 */
export function awardQuestNationalPower(q) {
  const changes = completeQuestPower(state, q, FACTIONS, settlements, nationalPowerAtWar);
  if (!changes.length) return;
  const resources = nationalPowerResources(changes);
  pushLog("国力への貢献", `${q.title} / ${resources.map(r => `${r.label} ${r.value}`).join(" / ")}`, "-");
  if (q.type.startsWith("war_")) enqueueEvent({ title: "前線への貢献", body: q.title, resources });
}
