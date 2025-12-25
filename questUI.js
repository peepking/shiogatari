import { elements } from "./dom.js";
import { state } from "./state.js";
import { SUPPLY_ITEMS } from "./supplies.js";
import {
  getQuests,
  getAvailableQuestsForSettlement,
  acceptQuest,
  canCompleteQuest,
  completeQuest,
  QUEST_TYPES,
} from "./quests.js";
import { getSettlementById } from "./map.js";
import { getCurrentSettlement } from "./actions.js";
import { TROOP_STATS } from "./troops.js";
import { absDay } from "./questUtils.js";

/**
 * 受注中の依頼一覧を描画する。
 * @param {Function} syncUI
 */
export function renderQuestUI(syncUI) {
  const quests = getQuests();
  if (elements.questBody) elements.questBody.hidden = Boolean(quests.collapsed);
  const listEl = elements.questList;
  if (!listEl) return;
  const active = quests.active || [];
  if (!active.length) {
    listEl.innerHTML = `<div class="tiny">受注中の依頼はありません。</div>`;
    return;
  }
  const now = absDay(state);
  // 受注中の依頼のみ一覧に表示する。
  listEl.innerHTML = active
    .map((q) => {
      const origin = getSettlementById(q.originId);
      const target = getSettlementById(q.targetId);
      const itemName = SUPPLY_ITEMS.find((i) => i.id === q.itemId)?.name || q.itemId;
      const remain = q.deadlineAbs != null ? Math.max(0, q.deadlineAbs - now) : null;
      const remainText = remain == null ? "期限なし" : `残り${remain}日`;
      const typeLabel =
        q.type === QUEST_TYPES.SUPPLY
          ? "調達"
          : q.type === QUEST_TYPES.DELIVERY
            ? "配達"
            : q.type === QUEST_TYPES.REFUGEE_ESCORT
              ? "護送"
            : q.type === QUEST_TYPES.ORACLE_SUPPLY ||
                q.type === QUEST_TYPES.ORACLE_MOVE ||
                q.type === QUEST_TYPES.ORACLE_TROOP ||
                q.type === QUEST_TYPES.ORACLE_HUNT ||
                q.type === QUEST_TYPES.ORACLE_ELITE
              ? "神託"
              : q.type === QUEST_TYPES.PIRATE_HUNT || q.type === QUEST_TYPES.BOUNTY_HUNT
                ? "討伐"
                : q.type === QUEST_TYPES.NOBLE_SUPPLY ||
                    q.type === QUEST_TYPES.NOBLE_SCOUT ||
                    q.type === QUEST_TYPES.NOBLE_SECURITY ||
                    q.type === QUEST_TYPES.NOBLE_REFUGEE ||
                    q.type === QUEST_TYPES.NOBLE_LOGISTICS ||
                    q.type === QUEST_TYPES.NOBLE_HUNT
                  ? "貴族依頼"
                : q.type === QUEST_TYPES.WAR_DEFEND_RAID ||
                    q.type === QUEST_TYPES.WAR_ATTACK_RAID ||
                    q.type === QUEST_TYPES.WAR_SKIRMISH ||
                    q.type === QUEST_TYPES.WAR_SUPPLY ||
                    q.type === QUEST_TYPES.WAR_ESCORT ||
                    q.type === QUEST_TYPES.WAR_BLOCKADE
                  ? "前線行動"
                : "";
      const placeLabel =
        q.type === QUEST_TYPES.SUPPLY
          ? `${origin?.name ?? "不明"}(${(origin?.coords?.x ?? 0) + 1}, ${(origin?.coords?.y ?? 0) + 1})で納品`
          : q.type === QUEST_TYPES.DELIVERY
            ? `${target?.name ?? "不明"}(${(target?.coords?.x ?? 0) + 1}, ${(target?.coords?.y ?? 0) + 1})へ配送`
            : q.type === QUEST_TYPES.REFUGEE_ESCORT
              ? `護送: (${(target?.coords?.x ?? 0) + 1}, ${(target?.coords?.y ?? 0) + 1})`
            : q.type === QUEST_TYPES.ORACLE_SUPPLY
              ? `神託: 加工品を捧げよ`
            : q.type === QUEST_TYPES.ORACLE_MOVE
              ? `神託: (${(q.target?.x ?? 0) + 1}, ${(q.target?.y ?? 0) + 1})へ移動`
            : q.type === QUEST_TYPES.ORACLE_TROOP
              ? `神託: 人身を捧げよ`
            : q.type === QUEST_TYPES.ORACLE_HUNT
              ? `神託: 討伐（通常編成）`
            : q.type === QUEST_TYPES.ORACLE_ELITE
              ? `神託: 討伐（強編成）`
            : q.type === QUEST_TYPES.PIRATE_HUNT || q.type === QUEST_TYPES.BOUNTY_HUNT
              ? `討伐: (${(q.target?.x ?? 0) + 1}, ${(q.target?.y ?? 0) + 1})`
              : q.type === QUEST_TYPES.NOBLE_SUPPLY
                ? `${origin?.name ?? "不明"}(${(origin?.coords?.x ?? 0) + 1}, ${(origin?.coords?.y ?? 0) + 1})で納品`
                : q.type === QUEST_TYPES.NOBLE_LOGISTICS
                  ? `兵站納品: (${(origin?.coords?.x ?? 0) + 1}, ${(origin?.coords?.y ?? 0) + 1})`
                  : q.type === QUEST_TYPES.NOBLE_SCOUT
                    ? `偵察: (${(q.target?.x ?? 0) + 1}, ${(q.target?.y ?? 0) + 1})`
                    : q.type === QUEST_TYPES.NOBLE_REFUGEE
                      ? `難民受け入れ: (${(q.target?.x ?? 0) + 1}, ${(q.target?.y ?? 0) + 1})→${origin?.name ?? "拠点"}(${(origin?.coords?.x ?? 0) + 1}, ${(origin?.coords?.y ?? 0) + 1})`
                      : q.type === QUEST_TYPES.NOBLE_SECURITY
                        ? `治安回復: 指定2戦 @${origin?.name ?? "拠点"}(${(origin?.coords?.x ?? 0) + 1}, ${(origin?.coords?.y ?? 0) + 1})`
                      : q.type === QUEST_TYPES.NOBLE_HUNT
                        ? `敵軍討伐 (${(q.target?.x ?? 0) + 1}, ${(q.target?.y ?? 0) + 1})`
                      : q.type === QUEST_TYPES.WAR_DEFEND_RAID
                        ? `補給路迎撃 (${(q.target?.x ?? 0) + 1}, ${(q.target?.y ?? 0) + 1})`
                      : q.type === QUEST_TYPES.WAR_ATTACK_RAID
                        ? `補給路襲撃 (${(q.target?.x ?? 0) + 1}, ${(q.target?.y ?? 0) + 1})`
                      : q.type === QUEST_TYPES.WAR_SKIRMISH
                        ? `小規模戦闘 (${(q.target?.x ?? 0) + 1}, ${(q.target?.y ?? 0) + 1})`
                      : q.type === QUEST_TYPES.WAR_SUPPLY
                        ? `${origin?.name ?? "拠点"}食糧搬入`
                      : q.type === QUEST_TYPES.WAR_ESCORT
                        ? `輸送護衛 (${(q.target?.x ?? 0) + 1}, ${(q.target?.y ?? 0) + 1})`
                      : q.type === QUEST_TYPES.WAR_BLOCKADE
                        ? `補給封鎖 ??${(q.fights || []).filter((f) => !f.done).length}??`
                      : "";
      const canFinish = remain == null ? canCompleteQuest(q) : remain >= 0 && canCompleteQuest(q);
      const rewardExtra =
        q.type === QUEST_TYPES.ORACLE_HUNT ||
        q.type === QUEST_TYPES.ORACLE_ELITE ||
        q.type === QUEST_TYPES.ORACLE_SUPPLY ||
        q.type === QUEST_TYPES.ORACLE_MOVE ||
        q.type === QUEST_TYPES.ORACLE_TROOP
          ? `信仰+${q.rewardFaith ?? 0}`
          : "";
      return `
        <div class="sideBlock mb-8">
          <div class="sbTitle sbTitle-quest">
            <div>
              <div class="tiny">${typeLabel} / ${placeLabel}</div>
              <b>${q.title || itemName}</b>
            </div>
            <div class="row gap-6">
              <span class="pill">報酬 <b>${q.reward ?? 0}</b></span>
              ${rewardExtra ? `<span class="pill">${rewardExtra}</span>` : ""}
              <span class="pill">${remainText}</span>
              <button class="btn good quest-complete" data-id="${q.id}" ${canFinish ? "" : "disabled"
        } aria-disabled="${canFinish ? "false" : "true"}">完了</button>
            </div>
          </div>
          <div class="sbBody">${q.type === QUEST_TYPES.ORACLE_SUPPLY
          ? (q.items || [])
            .map((it) => `${SUPPLY_ITEMS.find((i) => i.id === it.id)?.name || it.id} x${it.qty}`)
            .join(" / ")
          : q.type === QUEST_TYPES.ORACLE_MOVE
            ? q.desc || ""
            : q.type === QUEST_TYPES.ORACLE_TROOP
              ? `${TROOP_STATS[q.troopType]?.name || q.troopType} x1`
              : q.desc || `${itemName} x${q.qty ?? 0}`
        }</div>
        </div>
      `;
    })
    .join("");
  listEl.querySelectorAll(".quest-complete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-id"));
      if (!id) return;
      if (completeQuest(id)) {
        renderQuestUI(syncUI);
        syncUI?.();
      }
    });
  });
}

/**
 * 依頼モーダルを描画する。
 * @param {object} settlement
 * @param {Function} syncUI
 */
export function renderQuestModal(settlement, syncUI) {
  const body = elements.questModalBody;
  if (!body) return;
  if (!settlement) {
    body.innerHTML = `<tr><td colspan="4" class="ta-center pad-10">街・村の中でのみ受注できます。</td></tr>`;
    return;
  }
  const available = getAvailableQuestsForSettlement(settlement.id);
  if (!available.length) {
    body.innerHTML = `<tr><td colspan="4" class="ta-center pad-10">利用可能な依頼はありません。</td></tr>`;
    return;
  }
  const now = absDay(state);
  body.innerHTML = available
    .map((q) => {
      const origin = getSettlementById(q.originId);
      const target = getSettlementById(q.targetId);
      const itemName = SUPPLY_ITEMS.find((i) => i.id === q.itemId)?.name || q.itemId;
      const typeLabel =
        q.type === QUEST_TYPES.SUPPLY
          ? "調達"
          : q.type === QUEST_TYPES.DELIVERY
            ? "配達"
            : q.type === QUEST_TYPES.ORACLE_SUPPLY ||
                q.type === QUEST_TYPES.ORACLE_MOVE ||
                q.type === QUEST_TYPES.ORACLE_TROOP ||
                q.type === QUEST_TYPES.ORACLE_HUNT ||
                q.type === QUEST_TYPES.ORACLE_ELITE
              ? "神託"
              : q.type === QUEST_TYPES.PIRATE_HUNT || q.type === QUEST_TYPES.BOUNTY_HUNT
                ? "討伐"
                : "";
      const placeLabel =
        q.type === QUEST_TYPES.SUPPLY
          ? `${origin?.name ?? "不明"}(${(origin?.coords?.x ?? 0) + 1}, ${(origin?.coords?.y ?? 0) + 1})で納品`
          : q.type === QUEST_TYPES.DELIVERY
            ? `${target?.name ?? "不明"}(${(target?.coords?.x ?? 0) + 1}, ${(target?.coords?.y ?? 0) + 1})へ配送`
            : q.type === QUEST_TYPES.ORACLE_SUPPLY
              ? `神託: 加工品を捧げよ`
              : q.type === QUEST_TYPES.ORACLE_MOVE
                ? `神託: (${(q.target?.x ?? 0) + 1}, ${(q.target?.y ?? 0) + 1})へ移動`
                : q.type === QUEST_TYPES.ORACLE_TROOP
                  ? `神託: 人身を捧げよ`
                  : q.type === QUEST_TYPES.ORACLE_HUNT
                    ? `神託: 討伐（通常編成）`
                    : q.type === QUEST_TYPES.ORACLE_ELITE
                      ? `神託: 討伐（強編成）`
                      : q.type === QUEST_TYPES.PIRATE_HUNT || q.type === QUEST_TYPES.BOUNTY_HUNT
                        ? `討伐: (${(q.target?.x ?? 0) + 1}, ${(q.target?.y ?? 0) + 1})`
                        : "";
      const deadlineText = q.deadlineAbs ? `残り${Math.max(0, q.deadlineAbs - now)}日` : "受注から30日";
      return `
        <tr>
          <td>
            <div class="tiny">${typeLabel} / ${placeLabel}</div>
            <div><b>${q.title || itemName}</b></div>
            <div class="tiny">${q.type === QUEST_TYPES.ORACLE_TROOP
            ? `${TROOP_STATS[q.troopType]?.name || q.troopType} x1`
            : q.desc || `${itemName} x${q.qty ?? 0}`
          }</div>
          </td>
          <td class="ta-center">${q.reward ?? 0}</td>
          <td class="ta-center">${deadlineText}</td>
          <td class="ta-center"><button class="btn primary quest-accept" data-id="${q.id}">受注</button></td>
        </tr>
      `;
    })
    .join("");
  body.querySelectorAll(".quest-accept").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-id"));
      if (!id) return;
      const current = getCurrentSettlement();
      if (!current) return;
      acceptQuest(id, current);
      renderQuestModal(current, syncUI);
      renderQuestUI(syncUI);
      syncUI?.();
    });
  });
}
