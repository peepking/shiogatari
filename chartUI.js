import { state } from "./state.js";
import { MODE_LABEL } from "./constants.js";
import { CHART_CONFIG as CONFIG } from "./expansionConfig.js";
import { visibleChartSites, rollChartReward, claimFragment } from "./charts.js";
import { chartLabel, announceFragment } from "./chartWorld.js";
import { confirmAction, pushToast, pushLog } from "./dom.js";
import { enqueueEvent } from "./events.js";
import { SUPPLY_ITEMS, SUPPLY_TYPES } from "./supplies.js";
import { advanceDayWithEvents } from "./time.js";
import { snapshotWorld, restoreWorld, focusMapPosition } from "./map.js";
import { saveGameToStorage } from "./storage.js";
import { escapeHtml } from "./util.js";
import { resourceList, resourceIcon } from "./resourceUI.js";

/** @param {object} chart 海図。 @returns {string} 獲得前は数量を明かさず、報酬の種類だけを示す。 */
function expectedReward(chart) {
  const r = CONFIG.rewards[chart.kind][chart.size];
  const resources = [{ id: "fame", label: "名声", value: "" }];
  if (r.funds) resources.unshift({ id: "funds", label: "資金", value: "" });
  if (r.faith) resources.unshift({ id: "faith", label: "信仰", value: "" });
  if (r.ships) resources.unshift({ id: "ships", label: "船", value: "" });
  if (r.goods) resources.unshift({ id: "supplies", label: "高級品", value: "" });
  return resourceList(resources);
}

/**
 * 下部の海図欄に取得枚数と予約を区別して表示する。完成地点は完成前に公開しない。
 * @returns {void}
 */
export function renderChartCards() {
  const panel = document.getElementById("chartPanel");
  if (!panel) return;
  const charts = state.expansion.charts.active;
  panel.hidden = !charts.length;
  panel.innerHTML = charts.map(c => {
    const complete = c.fragments === c.size;
    const position = complete ? c.destination : c.rumor;
    const status = complete ? "海図完成・現地を探索" : c.fragments ? "断片を収集中" : c.rumor ? "噂の手掛かり" : "依頼報酬を予約中";
    return `<article class="chart-card quest-progress-card"><div class="chart-heading">${resourceIcon("chart")}<b>${escapeHtml(chartLabel(c))}</b><span>${c.fragments}/${c.size}枚</span></div><div class="tiny">${status}</div>
      <progress max="${c.size}" value="${c.fragments}" aria-label="${escapeHtml(chartLabel(c))} 取得${c.fragments}枚"></progress>
      ${position ? `<button class="btn chart-location" data-x="${position.x}" data-y="${position.y}">${complete ? "発見地点" : "噂の場所"}を地図で確認</button>` : ""}
      <details class="quest-description"><summary>海図の内容・報酬</summary>${expectedReward(c)}<div class="tiny">${complete ? "現地で1日使って探索できます。" : `あと${c.size - c.fragments}枚で場所が判明します。`}</div></details></article>`;
  }).join("");
  panel.querySelectorAll(".chart-location").forEach(button => {
    button.addEventListener("click", () => focusMapPosition({ x: Number(button.dataset.x), y: Number(button.dataset.y) }));
  });
}

/**
 * 完成報酬を船から順に全量付与する。上限超過分も保持し、既存の整理操作へつなぐ。
 * @param {object} reward 保存済み報酬。 @returns {Array} 表示資源。
 */
function applyReward(reward) {
  const resources = [];
  addShips(state, prepareShipReward(reward));
  if (reward.ships) resources.push({ id: "ships", label: "発見した船", value: shipListText(reward.shipTypes) });
  for (const [id, label] of [["funds", "資金"], ["faith", "信仰"], ["fame", "名声"]]) {
    if (!reward[id]) continue;
    state[id] += reward[id];
    resources.push({ id, label, value: `+${reward[id]}` });
  }
  for (const [id, qty] of Object.entries(reward.supplies)) {
    const item = SUPPLY_ITEMS.find(i => i.id === id);
    if (!item) continue;
    state.supplies[id] = (state.supplies[id] || 0) + qty;
    resources.push({ id, label: item.name, value: `+${qty}` });
  }
  return resources;
}

/**
 * 日数適用前後のチェックポイントから再開する。保存失敗時は世界を含め適用前に戻す。
 * 回収後は予約・海図を消費してから結果を保存し、同一報酬の再加算を防ぐ。
 * @param {Function} syncUI 表示同期。 @returns {void}
 */
export function resumeChartExploration(syncUI) {
  const data = state.expansion.charts;
  const pending = data.pending;
  if (!pending) return;
  const chart = data.active.find(c => c.id === pending.chartId);
  if (!chart) { data.pending = null; return; }
  if (pending.reward) {
    prepareShipReward(pending.reward);
    if (!saveGameToStorage()) {
      state.modeLabel = MODE_LABEL.PREP;
      pushToast("保存できません", "探索を再開して再試行してください。", "warn"); syncUI(); return;
    }
  }
  if (!pending.dayApplied) {
    const before = structuredClone(state); const world = structuredClone(snapshotWorld());
    state.modeLabel = MODE_LABEL.NORMAL;
    advanceDayWithEvents(CONFIG.exploreDays);
    pending.dayApplied = true;
    if (!saveGameToStorage()) {
      Object.assign(state, before); restoreWorld(world); state.modeLabel = MODE_LABEL.PREP;
      pushToast("保存できません", "探索を中断しました。保存容量を確認し、探索を再開してください。", "warn");
      syncUI(); return;
    }
  }
  if (pending.kind === "rumor") {
    if (claimFragment(chart, "rumor")) announceFragment(chart, "噂の現地回収");
  } else {
    const resources = applyReward(pending.reward);
    data.active = data.active.filter(c => c.id !== chart.id);
    enqueueEvent({ title: `${CONFIG.rewards[chart.kind].name}を発見`, body: "海図を読み解き、隠された場所を発見しました。上限を超えた物資は詳細画面で整理できます。", resources });
    pushLog("海図の発見", `${chartLabel(chart)} / ${resources.map(r => `${r.label}${r.value}`).join(" / ")}`, "-");
  }
  data.pending = null;
  state.modeLabel = MODE_LABEL.NORMAL;
  saveGameToStorage();
  syncUI();
}

/**
 * 現在地で噂回収・完成地点探索を確認し、報酬を固定保存してから進める。
 * @param {Function} syncUI 表示同期。 @returns {void}
 */
function beginChartExploration(syncUI) {
  if (state.expansion.charts.pending) { resumeChartExploration(syncUI); return; }
  const site = visibleChartSites(state.expansion.charts).find(s => s.position.x === state.position.x && s.position.y === state.position.y);
  if (!site || state.modeLabel !== MODE_LABEL.NORMAL || state.pendingEncounter?.active || state.expansion.exploration.pending) return;
  const chart = state.expansion.charts.active.find(c => c.id === site.chartId);
  confirmAction({ title: site.kind === "rumor" ? "噂の断片を回収" : `${chartLabel(chart)}を探索`,
    body: "1日使って探索します。探索自体に戦闘はありません。日々の食料消費や維持費は通常どおり発生します。", confirmText: "1日使って探索",
    onConfirm: () => {
      if (state.modeLabel !== MODE_LABEL.NORMAL || state.expansion.charts.pending || state.expansion.exploration.pending || state.pendingEncounter?.active || state.position.x !== site.position.x || state.position.y !== site.position.y) return;
      const kind = site.kind === "rumor" ? "rumor" : "destination";
      const reward = kind === "destination" ? rollChartReward(chart, SUPPLY_ITEMS.filter(i => i.type === SUPPLY_TYPES.processed).map(i => i.id)) : null;
      state.expansion.charts.pending = { chartId: chart.id, kind, dayApplied: false, reward };
      if (!saveGameToStorage()) { state.expansion.charts.pending = null; pushToast("保存できません", "探索は開始していません。", "warn"); return; }
      document.dispatchEvent(new CustomEvent("auto-move-stop"));
      resumeChartExploration(syncUI);
    } });
}

/** @param {Function} syncUI 表示同期。 @returns {void} 現在地の海図探索操作を表示する。 */
export function renderChartControl(syncUI) {
  const button = document.getElementById("chartExploreBtn");
  if (!button) return;
  const pending = state.expansion.charts.pending;
  const site = visibleChartSites(state.expansion.charts).find(s => s.position.x === state.position.x && s.position.y === state.position.y);
  button.hidden = !(pending || (site && state.modeLabel === MODE_LABEL.NORMAL && !state.pendingEncounter?.active && !state.expansion.exploration.pending));
  button.textContent = pending ? "海図の探索を再開" : site?.kind === "rumor" ? "噂の断片を回収" : "海図の発見地点を探索";
  button.onclick = () => beginChartExploration(syncUI);
}
import { addShips, prepareShipReward, shipListText } from "./fleet.js";
