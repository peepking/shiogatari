import { state } from "./state.js";
import { buildEnemyFormation } from "./actions.js";
import { getTerrainAt } from "./map.js";
import { THEFT_TYPES, theftReason, commitTheft, crimeScale, rollCrimeReward } from "./settlementCrime.js";
import { CRIME_REWARDS } from "./bountyConfig.js";
import { calcSupplyCap, totalSupplies, SUPPLY_ITEMS } from "./supplies.js";
import { adjustSupport, adjustNobleFavor } from "./faction.js";
import { FACTIONS } from "./lore.js";
import { confirmAction, pushToast, pushLog } from "./dom.js";
import { saveGameToStorage } from "./storage.js";
import { MODE_LABEL } from "./constants.js";

/** 確認時と実行時の拠点・季節・所属を照合し、保存失敗時は資産・関係・犯罪を戻す。
 * @param {HTMLElement} card 表示先。 @param {Function} current 現在拠点。 @param {Function} refresh 再表示。 @returns {void}
 */
export function appendTheftActions(card, current, refresh) {
  const settlement = current();
  if (!settlement || ![MODE_LABEL.NORMAL, MODE_LABEL.IN_TOWN, MODE_LABEL.IN_VILLAGE].includes(state.modeLabel)) return;
  const details = document.createElement("details"), summary = document.createElement("summary");
  summary.textContent = "犯罪行動（窃盗・襲撃は別枠）"; details.open = true; details.append(summary);
  for (const [kind, rule] of Object.entries(THEFT_TYPES)) {
    if (state.modeLabel === MODE_LABEL.NORMAL && !rule.raid) continue;
    const reason = theftReason(state, settlement, kind, calcSupplyCap() - totalSupplies());
    const button = document.createElement("button");
    button.className = "btn"; button.textContent = rule.name; button.disabled = !!reason;
    details.append(button);
    if (reason) { const note = document.createElement("p"); note.className = "tiny"; note.textContent = reason; details.append(note); }
    button.onclick = () => {
      const factionId = settlement.factionId, nobleId = settlement.nobleId;
      const scale = crimeScale(settlement);
      const support = Math.round(rule.support * scale), favor = Math.round(rule.favor * scale);
      const season = `${state.year}:${state.season}`;
      const goods = Object.entries(rule.supplies).map(([id, n]) => `${SUPPLY_ITEMS.find(item => item.id === id)?.name || id} ${Math.floor(n * scale * 0.8)}～${Math.ceil(n * scale * 1.2)}`).join("・");
      const faction = FACTIONS.find(f => f.id === factionId)?.name || factionId;
      const enemy = rule.battle ? buildEnemyFormation("elite", factionId, { scale: (rule.enemyScale || 1) * scale }) : null;
      confirmAction({ title: rule.name, body: `${settlement.name}で${rule.raid ? "襲撃" : "窃盗"}を行います。${enemy ? "勝利時の追加" : ""}報酬：資金${Math.floor(rule.funds * scale * 0.8)}～${Math.ceil(rule.funds * scale * 1.2)}・${goods}。${faction}の賞金＋${CRIME_REWARDS[kind]}、拠点支持度${support}${nobleId ? `・担当貴族好感度${favor}` : ""}。${rule.raid ? `窃盗とは別の今季の襲撃枠を消費し、開始時から${rule.banDays}日間この拠点を利用できなくなります。占領はしません。` : "市場・兵糧庫・武器庫で共通の今季の窃盗枠を消費します。"}${enemy ? `守備隊${enemy.total}人との戦闘になります。敗北・引き分け・逃走でも賞金と実行枠は戻りません。戦利品による容量超過は手動で整理してください。` : "戦闘・日数消費はありません。"}`, onConfirm: () => {
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
  card.append(details);
}
