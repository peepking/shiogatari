import { getCurrentSettlement } from "./actions.js";
import { elements, pushToast } from "./dom.js";
import { getSettlementById, focusMapPosition } from "./map.js";
import { chartLabel } from "./chartWorld.js";
import {
  acceptQuest,
  canCompleteQuest,
  completeQuest,
  getAvailableQuestsForSettlement,
  getQuests,
  QUEST_TYPES,
} from "./quests.js";
import { absDay, manhattan } from "./questUtils.js";
import { state } from "./state.js";
import { questPowerRewardHtml } from "./nationalPowerUI.js";
import { SUPPLY_ITEMS } from "./supplies.js";
import { TROOP_STATS } from "./troops.js";
import { getQuestProgress } from "./questProgress.js";
import { escapeHtml } from "./util.js";
import { resourceIcon, resourceList } from "./resourceUI.js";
import { modalDeadlineText } from "./questDeadlines.js";

const ITEM_NAMES = Object.fromEntries(SUPPLY_ITEMS.map(item => [item.id, item.name]));
const TROOP_NAMES = Object.fromEntries(Object.entries(TROOP_STATS).map(([id, stat]) => [id, stat.name]));

/**
 * 数量の進捗と到着・合流の条件を読み上げ可能な行へ変換する。
 * @param {object} row
 * @returns {string}
 */
function renderProgressRow(row) {
  const label = escapeHtml(row.label);
  const text = escapeHtml(row.text);
  return `<div class="quest-progress-row ${row.done ? "is-done" : ""}"><div class="quest-progress-label"><span>${resourceIcon(row.icon)}${label}</span><b>${text}</b></div>${row.total > 0 ? `<progress max="${row.total}" value="${row.current}" aria-label="${label} ${text}"></progress>` : ""}${row.note ? `<div class="tiny">${escapeHtml(row.note)}</div>` : ""}</div>`;
}

/**
 * 依頼の必要物資・部隊員・資金を内部IDからアイコン付きで表示する。
 * @param {object} q
 * @returns {string}
 */
export function renderQuestConditions(q) {
  const items = q.items || (q.itemId ? [{ id: q.itemId, qty: q.qty }] : []);
  const resources = items.map(item => ({ id: item.id, label: ITEM_NAMES[item.id] || item.id, value: `×${item.qty}` }));
  if (q.troopType) resources.push({ id: q.troopType, label: TROOP_NAMES[q.troopType] || q.troopType, value: "×1人" });
  if (q.costFunds != null) resources.push({ id: "funds", label: "必要資金", value: q.costFunds });
  return resources.length ? resourceList(resources) : "";
}

/**
 * 依頼の確定報酬をアイコン付きで表示する。
 * @param {object} q
 * @returns {string}
 */
export function renderQuestRewards(q) {
  const resources = [];
  if (q.rewardFragment) resources.push({ id: "chart", label: `${chartLabel(q.rewardFragment)}の断片`, value: "+1（資金の代わり）" });
  else if (q.reward) resources.push({ id: "funds", label: "資金", value: `+${q.reward}` });
  if (q.rewardFaith) resources.push({ id: "faith", label: "信仰", value: `+${q.rewardFaith}` });
  if (q.rewardFame) resources.push({ id: "fame", label: "名声", value: `+${q.rewardFame}` });
  const power = questPowerRewardHtml(q);
  return (resources.length ? resourceList(resources) : power ? "" : "報酬は依頼内容を参照") + power;
}

const TYPE_LABEL = {
  [QUEST_TYPES.SUPPLY]: "調達",
  [QUEST_TYPES.DELIVERY]: "配達",
  [QUEST_TYPES.REFUGEE_ESCORT]: "護送",
  [QUEST_TYPES.ORACLE_SUPPLY]: "神託",
  [QUEST_TYPES.ORACLE_MOVE]: "神託",
  [QUEST_TYPES.ORACLE_TROOP]: "神託",
  [QUEST_TYPES.ORACLE_HUNT]: "神託",
  [QUEST_TYPES.ORACLE_ELITE]: "神託",
  [QUEST_TYPES.PIRATE_HUNT]: "討伐",
  [QUEST_TYPES.BOUNTY_HUNT]: "討伐",
  [QUEST_TYPES.NOBLE_SUPPLY]: "貴族依頼",
  [QUEST_TYPES.NOBLE_SCOUT]: "貴族依頼",
  [QUEST_TYPES.NOBLE_SECURITY]: "貴族依頼",
  [QUEST_TYPES.NOBLE_REFUGEE]: "貴族依頼",
  [QUEST_TYPES.NOBLE_LOGISTICS]: "貴族依頼",
  [QUEST_TYPES.NOBLE_HUNT]: "貴族依頼",
  [QUEST_TYPES.WAR_DEFEND_RAID]: "前線行動",
  [QUEST_TYPES.WAR_ATTACK_RAID]: "前線行動",
  [QUEST_TYPES.WAR_SKIRMISH]: "前線行動",
  [QUEST_TYPES.WAR_SUPPLY]: "前線行動",
  [QUEST_TYPES.WAR_ESCORT]: "前線行動",
  [QUEST_TYPES.WAR_BLOCKADE]: "前線行動",
  [QUEST_TYPES.WAR_TRUCE]: "前線行動",
};

/**
 * 座標を表示用の文字列に整形する。
 * @param {{x:number,y:number}} pos 座標
 * @returns {string} "(x, y)"形式の文字列
 */
function formatCoords(pos) {
  if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return "(不明)";
  return `(${pos.x + 1}, ${pos.y + 1})`;
}

/**
 * 拠点情報を表示用の文字列に整形する。
 * @param {object|null} s 拠点
 * @returns {string} 拠点名と座標
 */
function formatSettlement(s) {
  if (!s) return `不明${formatCoords({ x: 0, y: 0 })}`;
  return `${s.name}${formatCoords(s.coords)}`;
}

/**
 * 物資リストを「名称 x数量」に整形する。
 * @param {Array} items 物資配列
 * @returns {string} 整形後文字列
 */
function formatItems(items = []) {
  return items
    .map((it) => `${SUPPLY_ITEMS.find((i) => i.id === it.id)?.name || it.id} x${it.qty}`)
    .join(" / ");
}

/**
 * 依頼の種類に応じて場所ラベルを組み立てる。
 * @param {object} q 依頼オブジェクト
 * @param {object} ctx 付随情報（origin/targetなど）
 * @returns {string} 場所の説明文
 */
function buildPlaceLabel(q, ctx) {
  const { origin, target, supplyInfo, blockadeTarget, blockadeLeft, blockadeEstimate, estText } = ctx;
  switch (q.type) {
    case QUEST_TYPES.SUPPLY:
      return `${formatSettlement(origin)}で納品`;
    case QUEST_TYPES.DELIVERY:
      return `${formatSettlement(target)}へ配送`;
    case QUEST_TYPES.REFUGEE_ESCORT:
      return `護送 ${formatCoords(target?.coords || q.target)}`;
    case QUEST_TYPES.ORACLE_SUPPLY:
      return "神託 加工品を捧げよ";
    case QUEST_TYPES.ORACLE_MOVE:
      return `神託 ${formatCoords(q.target)}へ移動`;
    case QUEST_TYPES.ORACLE_TROOP:
      return "神託 人身を捧げよ";
    case QUEST_TYPES.ORACLE_HUNT:
      return "神託 討伐（通常編成）";
    case QUEST_TYPES.ORACLE_ELITE:
      return "神託 討伐（強編成）";
    case QUEST_TYPES.PIRATE_HUNT:
    case QUEST_TYPES.BOUNTY_HUNT:
      return `討伐 ${formatCoords(q.target)}`;
    case QUEST_TYPES.NOBLE_SUPPLY:
      return `${formatSettlement(origin)}で納品`;
    case QUEST_TYPES.NOBLE_LOGISTICS:
      return `兵站調達: ${formatSettlement(origin)}`;
    case QUEST_TYPES.NOBLE_SCOUT:
      return `地点偵察 ${formatCoords(q.target)}`;
    case QUEST_TYPES.NOBLE_REFUGEE:
      return `難民受け入れ ${formatCoords(q.target)} → ${formatSettlement(origin)}`;
    case QUEST_TYPES.NOBLE_SECURITY:
      return `治安回復: 残り${blockadeLeft ?? (q.fights || []).filter((f) => !f.done).length}戦 @${formatSettlement(origin)}${estText}`;
    case QUEST_TYPES.NOBLE_HUNT:
      return `敵軍討伐 ${formatCoords(q.target)}${estText}`;
    case QUEST_TYPES.WAR_DEFEND_RAID:
      return `補給路迎撃 ${formatCoords(q.target)}${estText}`;
    case QUEST_TYPES.WAR_ATTACK_RAID:
      return `補給路襲撃 ${formatCoords(q.target)}${estText}`;
    case QUEST_TYPES.WAR_SKIRMISH:
      return `小規模戦闘 ${formatCoords(q.target)}${estText}`;
    case QUEST_TYPES.WAR_SUPPLY:
      return `${formatSettlement(origin)}で食糧搬入（${supplyInfo || "必要物資不明"}）`;
    case QUEST_TYPES.WAR_ESCORT:
      return `輸送護衛 ${formatCoords(q.target)}から輸送隊を回収`;
    case QUEST_TYPES.WAR_TRUCE:
      return `停戦工作 ${formatSettlement(origin)}`;
    case QUEST_TYPES.WAR_BLOCKADE: {
      const left = blockadeLeft ?? (q.fights || []).filter((f) => !f.done).length;
      return `補給封鎖 ${formatCoords(blockadeTarget)} 残り${left}箇所${blockadeEstimate ? ` / 推定${blockadeEstimate}人` : ""}`;
    }
    default:
      return "";
  }
}

/**
 * 依頼本文の表示テキストを組み立てる。
 * @param {*} q 依頼
 * @param {string} itemName 物資名
 * @param {string} supplyInfo 物資説明文
 * @returns {string} 本文テキスト
 */
function buildBodyText(q, itemName, supplyInfo) {
  if (q.type === QUEST_TYPES.ORACLE_SUPPLY) return supplyInfo || q.desc || "";
  if (q.type === QUEST_TYPES.ORACLE_MOVE) return q.desc || "";
  if (q.type === QUEST_TYPES.ORACLE_TROOP) return `${TROOP_STATS[q.troopType]?.name || q.troopType} x1`;
  if (q.type === QUEST_TYPES.WAR_SUPPLY) return supplyInfo || q.desc || "";
  if (q.type === QUEST_TYPES.NOBLE_LOGISTICS || q.type === QUEST_TYPES.WAR_SUPPLY) return supplyInfo || q.desc || "";
  return q.desc || `${itemName} x${q.qty ?? 0}`;
}

/**
 * 推定人数などの補足テキストを組み立てる。
 * @param {*} q 依頼
 * @returns {string} 補足テキスト
 */
function buildEstimateText(q) {
  if (
    (q.type === QUEST_TYPES.WAR_DEFEND_RAID ||
      q.type === QUEST_TYPES.WAR_ATTACK_RAID ||
      q.type === QUEST_TYPES.WAR_SKIRMISH ||
      q.type === QUEST_TYPES.WAR_BLOCKADE ||
      q.type === QUEST_TYPES.NOBLE_HUNT ||
      q.type === QUEST_TYPES.NOBLE_SECURITY) &&
    q.estimatedTotal
  ) {
    return ` / 推定${q.estimatedTotal}人`;
  }
  return "";
}

/**
 * 依頼一覧UIを最新状態に描画する。
 * @param {Function} syncUI 依頼完了後などに呼ぶ同期処理
 * @returns {void}
 */
export function renderQuestUI(syncUI) {
  const quests = getQuests();
  if (elements.questBody) elements.questBody.hidden = Boolean(quests.collapsed);
  const listEl = elements.questList;
  if (!listEl) return;
  const active = quests.active || [];
  if (!active.length) {
    listEl.innerHTML = state.expansion?.charts?.active?.length ? "" : `<div class="tiny">受注中の依頼はありません。</div>`;
    return;
  }
  const now = absDay(state);
  listEl.innerHTML = active
    .map((q) => {
      const origin = getSettlementById(q.originId);
      const target = getSettlementById(q.targetId);
      const itemName = SUPPLY_ITEMS.find((i) => i.id === q.itemId)?.name || q.itemId;
      const supplyInfo = formatItems(q.items || []);
      const blockadeTarget =
        (q.fights || []).find((f) => !f.done)?.target || (q.fights || [])[0]?.target || q.target || null;
      const blockadeLeft = (q.fights || []).filter((f) => !f.done).length;
      const blockadeEstimate =
        q.type === QUEST_TYPES.WAR_BLOCKADE && (q.fights || []).find((f) => !f.done)?.estimatedTotal
          ? (q.fights || []).find((f) => !f.done)?.estimatedTotal
          : null;
      const estText = buildEstimateText(q);
      const typeLabel = TYPE_LABEL[q.type] || "";
      const placeLabel = buildPlaceLabel(q, {
        origin,
        target,
        supplyInfo,
        blockadeTarget,
        blockadeLeft,
        blockadeEstimate,
        estText,
      });
      const progress = getQuestProgress(q, state, { now, canFinish: canCompleteQuest(q), origin, target, itemNames: ITEM_NAMES, troopNames: TROOP_NAMES });
      const bodyText = buildBodyText(q, itemName, supplyInfo);
      return `
        <div class="sideBlock mb-8 quest-progress-card quest-${progress.status}">
          <div class="quest-card-meta"><span>${escapeHtml(typeLabel)}</span><span class="quest-deadline ${progress.urgent ? "is-urgent" : ""}">${progress.deadline}</span></div>
          <h3>${escapeHtml(q.title || itemName || "依頼")}</h3>
          <span class="quest-status">${progress.statusText}</span>
          <div class="quest-progress-rows">${progress.rows.map(renderProgressRow).join("")}</div>
          <p class="quest-next">${escapeHtml(progress.next)}</p>
          ${progress.destination ? `<button class="btn quest-location" data-x="${progress.destination.x}" data-y="${progress.destination.y}">${q.type === QUEST_TYPES.DELIVERY ? "配達先を地図で強調" : "目的地を地図で確認"}</button>` : ""}
          <details class="quest-description"><summary>依頼の詳細・報酬</summary><div class="tiny">${escapeHtml(placeLabel)}</div><div class="tiny">${renderQuestConditions(q)}${escapeHtml(bodyText)}</div><div class="tiny">${renderQuestRewards(q)}</div></details>
          ${progress.automatic && !progress.ready ? `<div class="tiny quest-auto-note">${progress.automaticLabel}</div>` : `<button class="btn good quest-complete" data-id="${q.id}" ${progress.ready ? "" : "disabled"}>完了して報酬を受取</button>`}
        </div>
      `;
    })
    .join("");
  listEl.querySelectorAll(".quest-location").forEach((btn) => {
    btn.addEventListener("click", () => {
      focusMapPosition({ x: Number(btn.dataset.x), y: Number(btn.dataset.y) });
    });
  });
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
 * 依頼受注モーダルを描画する。
 * @param {object|null} settlement 対象拠点
 * @param {Function} syncUI 受注後などに呼ぶ同期処理
 * @returns {void}
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
      const supplyInfo = formatItems(q.items || []);
      const blockadeTarget =
        (q.fights || []).find((f) => !f.done)?.target || (q.fights || [])[0]?.target || q.target || null;
      const blockadeLeft = (q.fights || []).filter((f) => !f.done).length;
      const blockadeEstimate =
        q.type === QUEST_TYPES.WAR_BLOCKADE && (q.fights || []).find((f) => !f.done)?.estimatedTotal
          ? (q.fights || []).find((f) => !f.done)?.estimatedTotal
          : null;
      const estText = buildEstimateText(q);
      const typeLabel = TYPE_LABEL[q.type] || "";
      const placeLabel = buildPlaceLabel(q, {
        origin,
        target,
        supplyInfo,
        blockadeTarget,
        blockadeLeft,
        blockadeEstimate,
        estText,
      });
      const deadlineText = modalDeadlineText(q, now);
      const bodyText = buildBodyText(q, itemName, supplyInfo);
      return `
        <tr>
          <td>
            <div class="tiny">${typeLabel} / ${placeLabel}</div>
            ${q.type === QUEST_TYPES.DELIVERY && target ? `<div class="tiny">最短距離: ${manhattan(settlement.coords, target.coords)}マス（移動のみで${manhattan(settlement.coords, target.coords)}日） / 基本報酬: 距離 × 50資金。寄り道・待機は別途日数が必要です。</div>` : ""}
            <div><b>${q.title || itemName}</b></div>
            <div class="tiny">${renderQuestConditions(q)}${escapeHtml(bodyText)}</div>
          </td>
          <td class="ta-center">${renderQuestRewards(q)}</td>
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
      if (!current) {
        pushToast("受注不可", "街・村の中でのみ受注できます。", "warn");
        return;
      }
      acceptQuest(id, current);
      renderQuestModal(current, syncUI);
      renderQuestUI(syncUI);
      syncUI?.();
    });
  });
}
