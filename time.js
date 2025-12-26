import { advanceDay as baseAdvanceDay, state } from "./state.js";
import { questTickDay } from "./quests.js";
import { TROOP_STATS, totalTroops, applyTroopLosses } from "./troops.js";
import { pushLog } from "./dom.js";
import { absDay } from "./questUtils.js";
import { tickDailyWar, tickRelationDrift, maybeQueueHonorInvite, applySupportDrift } from "./faction.js";
import { enqueueEvent } from "./events.js";
import { startTravelEncounter } from "./actions.js";
import { MODE_LABEL } from "./constants.js";

/**
 * 日付更新と、それに連動するイベント処理を進める。
 * @param {number} [days=1]
 */
export function advanceDayWithEvents(days = 1) {
  const prevSeason = state.season;
  const prevYear = state.year;
  for (let i = 0; i < days; i++) {
    baseAdvanceDay(1);
    const d = state.day;
    if (d === 10 || d === 30) {
      applyPeriodicFood();
    }
    const today = absDay(state);
    tickDailyWar(today);
    tickRelationDrift(today);
    maybeQueueHonorInvite(today);
    if (state.day % 7 === 0) {
      applySupportDrift();
    }
    processScheduledOmens(today);
  }
  // 季節が進んだ回数だけ維持費処理を行う。
  const prevIndex = prevYear * 4 + prevSeason;
  const nowIndex = state.year * 4 + state.season;
  const seasonSteps = Math.max(0, nowIndex - prevIndex);
  for (let i = 0; i < seasonSteps; i++) {
    applySeasonUpkeep();
  }
  // 日付進行に合わせて依頼の期限/季節更新を処理する。
  questTickDay(days);
}

/**
 * 季節の切り替わり時に維持費と食料消費を適用する。
 */
function applySeasonUpkeep() {
  let upkeepCost = 0;
  Object.entries(state.troops || {}).forEach(([type, levels]) => {
    const stat = TROOP_STATS[type];
    const upkeep = stat?.upkeep ?? 0;
    if (typeof levels === "number") {
      upkeepCost += upkeep * levels;
      return;
    }
    Object.values(levels || {}).forEach((cnt) => {
      upkeepCost += upkeep * Number(cnt || 0);
    });
  });

  const fundsBefore = state.funds || 0;
  const fundsPaid = Math.min(fundsBefore, upkeepCost);
  const deficitFunds = Math.max(0, upkeepCost - fundsPaid);
  state.funds = Math.max(0, fundsBefore - upkeepCost);

  if (upkeepCost === 0) return;

  // 資金不足時は不足額/6人ぶんの兵士を損耗（人数比で按分、余りは順繰り）
  let lossCount = 0;
  if (deficitFunds > 0) {
    lossCount = Math.floor(deficitFunds / 6);
    if (lossCount > 0) {
      applyTroopLosses(buildLossesMap(lossCount));
    }
  }
  pushLog(
    "維持費・消費",
    `資金 -${fundsPaid}（必要資金 ${upkeepCost}` +
      (lossCount > 0 ? ` / 資金不足による損耗 -${lossCount}` : "") +
      "）",
    state.lastRoll ?? "-"
  );
}

/**
 * 10/30日に食料を消費し、足りなければ損耗させる。
 */
function applyPeriodicFood() {
  const troopCount = totalTroops();
  if (troopCount <= 0) return;
  if (!state.supplies) state.supplies = {};
  const need = Math.floor(troopCount / 4);
  if (need <= 0) return;
  const foodBefore = state.supplies.food || 0;
  const foodPaid = Math.min(foodBefore, need);
  const deficit = need - foodPaid;
  state.supplies.food = Math.max(0, foodBefore - need);

  let lossCount = 0;
  if (deficit > 0) {
    const unfed = deficit * 4;
    lossCount = Math.floor(unfed * 0.5);
    lossCount = Math.min(lossCount, totalTroops()); // 安全上の上限を設ける
    applyTroopLosses(buildLossesMap(lossCount));
  }

  pushLog(
    "食料消費",
    `日${state.day}: 食料 -${foodPaid}/${need}` + (lossCount > 0 ? ` / 兵損耗 -${lossCount}` : ""),
    state.lastRoll ?? "-"
  );
}

/**
 * 兵種ごとの損耗する数を生成する
 * @param {object} totalLoss 
 * @returns 
 */
function buildLossesMap(totalLoss) {
  // 兵種ごとの人数比に応じて損耗数を按分し、余りは多い順で順繰りに配分する（ランダムではない）
  const counts = {};
  Object.entries(state.troops || {}).forEach(([type, levels]) => {
    if (typeof levels === "number") {
      counts[type] = (counts[type] || 0) + levels;
      return;
    }
    Object.values(levels || {}).forEach((qty) => {
      counts[type] = (counts[type] || 0) + Number(qty || 0);
    });
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return {};
  const losses = {};
  if (totalLoss >= total) {
    Object.entries(counts).forEach(([type, cnt]) => (losses[type] = cnt));
    return losses;
  }
  let remaining = totalLoss;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  entries.forEach(([type, cnt], idx) => {
    if (remaining <= 0) return;
    const share = idx === entries.length - 1 ? remaining : Math.min(remaining, Math.floor((totalLoss * cnt) / total));
    const take = Math.min(cnt, share);
    losses[type] = take;
    remaining -= take;
  });
  let idx = 0;
  while (remaining > 0 && entries.length) {
    const [type, cnt] = entries[idx % entries.length];
    const current = losses[type] || 0;
    if (current < cnt) {
      losses[type] = current + 1;
      remaining -= 1;
    }
    idx += 1;
  }
  return losses;
}

/**
 * スケジュールされた災いイベントを処理する。
 * @param {number} todayAbs
 */
function processScheduledOmens(todayAbs) {
  if (!Array.isArray(state.pendingOmens)) return;
  const remaining = [];
  state.pendingOmens.forEach((o) => {
    if (!o || o.handled) return;
    if (todayAbs < o.day) {
      remaining.push(o);
      return;
    }
    if (state.pendingEncounter?.active || state.modeLabel === MODE_LABEL.BATTLE) {
      remaining.push(o);
      return;
    }
    const roll = Math.random();
    if (roll < 0.5) {
      startTravelEncounter({
        forceStrength: "elite",
        enemyFactionId: "pirates",
        title: "災いの襲撃",
        flavor: "災いが形を取り、敵が迫ります。",
        eventTag: "omen_attack",
        eventContext: {},
      });
      enqueueEvent({
        title: "災い",
        body: "不吉な兆しが現実となり、敵が接近しています。",
        actions: [{ label: "戦闘準備", type: "close" }],
      });
    } else {
      const total = totalTroops();
      const loss = Math.max(1, Math.floor(total * 0.1));
      applyTroopLosses(buildLossesMap(loss));
      pushLog("災い", `災いにより兵士を失いました（-${loss}人）。`, "-");
      enqueueEvent({
        title: "災い",
        body: `災いにより兵士を${loss}人失いました。`,
        actions: [{ label: "閉じる", type: "close" }],
      });
    }
    o.handled = true;
  });
  state.pendingOmens = remaining;
}
