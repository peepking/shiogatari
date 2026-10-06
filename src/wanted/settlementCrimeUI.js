import { state } from "../core/state.js";
import { buildEnemyFormation } from "../app/actions.js";
import { getTerrainAt } from "../world/map.js";
import { THEFT_TYPES, theftReason, theftRestriction, commitTheft, crimeScale, rollCrimeReward } from "./settlementCrime.js";
import { CRIME_REWARDS } from "../bounty/bountyConfig.js";
import { calcSupplyCap, totalSupplies, SUPPLY_ITEMS } from "../resources/supplies.js";
import { adjustSupport, adjustNobleFavor } from "../factions/faction.js";
import { FACTIONS } from "../world/lore.js";
import { confirmAction, pushToast, pushLog } from "../ui/dom.js";
import { saveGameToStorage } from "../core/storage.js";
import { MODE_LABEL } from "../core/constants.js";

/** 確認時と実行時の拠点・季節・所属を照合し、保存失敗時は資産・関係・犯罪を戻す。
 * @param {HTMLElement} card 表示先。 @param {Function} current 現在拠点。 @param {Function} refresh 再表示。 @returns {void}
 */
export function appendTheftActions(card, current, refresh) {
  const settlement = current();
  if (!settlement || ![MODE_LABEL.NORMAL, MODE_LABEL.IN_TOWN, MODE_LABEL.IN_VILLAGE].includes(state.modeLabel)) return;
  const details = document.createElement("details"), summary = document.createElement("summary");
  summary.textContent = "犯罪行動"; details.open = true; details.append(summary);
  const reasons = new Map();
  for (const [kind, rule] of Object.entries(THEFT_TYPES)) {
    if (state.modeLabel === MODE_LABEL.NORMAL && !rule.raid) continue;
    const restriction = theftRestriction(state, settlement, kind, calcSupplyCap() - totalSupplies());
    const reason = restriction.text;
    const button = document.createElement("button");
    button.className = "btn"; button.textContent = rule.name; button.disabled = !!reason;
    if (reason) button.title = reason;
    details.append(button);
    if (reason) reasons.set(restriction.id, reason);
    button.onclick = () => {
      const factionId = settlement.factionId, nobleId = settlement.nobleId;
      const scale = crimeScale(settlement);
      const support = Math.round(rule.support * scale), favor = Math.round(rule.favor * scale);
      const season = `${state.year}:${state.season}`;
      const goods = Object.entries(rule.supplies).map(([id, n]) => `${SUPPLY_ITEMS.find(item => item.id === id)?.name || id} ${Math.floor(n * scale * 0.8)}～${Math.ceil(n * scale * 1.2)}`);
      const faction = FACTIONS.find(f => f.id === factionId)?.name || factionId;
      const enemy = rule.battle ? buildEnemyFormation("elite", factionId, { scale: (rule.enemyScale || 1) * scale }) : null;
      confirmAction({ title: rule.name, body: `${settlement.name}で${rule.raid ? "襲撃" : "窃盗"}を行います。`, guideTopic: "guide-crime",
        sections: [
          { title: enemy ? "勝利時の追加報酬" : "報酬", items: [...(rule.funds ? [`資金 ${Math.floor(rule.funds * scale * 0.8)}～${Math.ceil(rule.funds * scale * 1.2)}`] : []), ...goods] },
          { title: "危険と関係への影響", items: [enemy ? `守備隊${enemy.total}人との戦闘` : "戦闘・日数消費なし", `${faction}の賞金＋${CRIME_REWARDS[kind]}`, `拠点支持度${support}${nobleId ? `・担当貴族好感度${favor}` : ""}`] },
          { title: "実行後の制限", items: [rule.raid ? `窃盗とは別の今季の襲撃1回を使用。この拠点を${rule.banDays}日間利用できなくなります（占領はしません）。` : "市場・兵糧庫・武器庫で共通の、今季の窃盗1回を使用。", ...(enemy ? ["敗北・引き分け・逃走でも、賞金の増加と使用した回数は戻りません。"] : [])] }
        ], onConfirm: () => {
        const here = current();
        if (here?.id !== settlement.id || here.factionId !== factionId || here.nobleId !== nobleId || season !== `${state.year}:${state.season}`) { pushToast("再確認してください", "拠点の状況が変わりました。", "warn"); refresh(); return; }
        const previous = structuredClone(state), oldSupport = structuredClone(here.support);
        const reward = rollCrimeReward(here, kind);
        if (!commitTheft(state, here, kind, calcSupplyCap() - totalSupplies(), reward)) { pushToast("実行できません", theftReason(state, here, kind, calcSupplyCap() - totalSupplies()), "warn"); refresh(); return; }
        adjustSupport(here.id, factionId, support);
        if (nobleId) adjustNobleFavor(nobleId, favor);
        if (enemy) {
          state.pendingEncounter = { active: true, enemyFormation: enemy.formation, enemyTotal: enemy.total, strength: enemy.strength, enemyFactionId: factionId, terrain: getTerrainAt(state.position.x, state.position.y), crimeRecorded: true, theftKind: kind, theftReward: reward.supplies, theftFunds: reward.funds };
          state.modeLabel = MODE_LABEL.PREP;
        }
        if (!saveGameToStorage()) {
          for (const key of Object.keys(state)) delete state[key];
          Object.assign(state, previous); here.support = oldSupport;
          pushToast("保存できません", "窃盗・報酬・関係変化は取り消しました。", "warn");
        } else {
          pushLog("窃盗", `${here.name} / ${rule.name} / 賞金＋${CRIME_REWARDS[kind]} / ${enemy ? "守備隊との戦闘準備" : `資金＋${reward.funds}・${Object.entries(reward.supplies).map(([id, n]) => `${SUPPLY_ITEMS.find(item => item.id === id)?.name || id} ${n}`).join("・")}`}`, "-");
          pushToast("窃盗", enemy ? "守備隊が現れました。賞金と実行枠は確定済みです。" : "報酬を得ました。この勢力からの賞金が増えました。", "warn");
        }
        refresh();
        if (state.pendingEncounter?.theftKind) {
          const modal = document.getElementById("locationOfficeModal");
          if (modal) modal.hidden = true;
          document.dispatchEvent(new CustomEvent("auto-move-stop"));
        }
      } });
    };
  }
  for (const reason of reasons.values()) {
    const note = document.createElement("p"); note.className = "tiny"; note.textContent = reason; details.append(note);
  }
  card.append(details);
}
