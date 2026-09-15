import { settleTideSeason } from "./tideAlliance.js";
import { grantFaithSeason } from "./faith.js";
import { calcSupplyCap } from "./supplies.js";
import { startTravelEncounter } from "./actions.js";
import { MODE_LABEL } from "./constants.js";
import { pushLog, pushToast } from "./dom.js";
import { enqueueEvent } from "./events.js";
import { applySupportDrift, maybeQueueHonorInvite, tickDailyWar, tickRelationDrift } from "./faction.js";
import { questTickDay } from "./quests.js";
import { absDay } from "./questUtils.js";
import { advanceDay as baseAdvanceDay, state } from "./state.js";
import { TROOP_STATS, applyTroopLosses, totalTroops } from "./troops.js";
import { FOOD_CONSUMPTION_DAYS, getUpkeepForecast } from "./upkeep.js";
import { updateExplorationWorld } from "./explorationUI.js";
import { payShipUpkeep } from "./shipUpkeep.js";
import { SHIP_TYPES } from "./shipConfig.js";

/**
 * 日付更新と、それに連動するイベント処理を進める。
 * @param {number} [days=1]
 */
export function advanceDayWithEvents(days = 1) {
  for (let i = 0; i < days; i++) {
    baseAdvanceDay(1);
    const d = state.day;
    if (d === 1) {
      settlements.forEach(s => refreshShipyard(s, shipyardSeason(state)));
      applySeasonUpkeep();
      const gift = grantFaithSeason(state, calcSupplyCap());
      if (gift?.amount) {
        const body = `潮の縁者が航海の糧を融通してくれました。食料＋${gift.received}` + (gift.missed ? `（容量不足で${gift.missed}個は受け取れませんでした）` : "");
        pushToast("潮待ちの恵み", body, "good");
        pushLog("潮待ちの恵み", body, "-");
      }
    }
    if (d === 1) {
      const tide = settleTideSeason(state);
      if (tide?.count) {
        pushToast("潮盟の支え", `潮盟の${tide.count}拠点から支えが届きました。信仰＋${tide.gain} / 今季の神託報酬＋${tide.bonus}%`, "good");
        pushLog("潮盟の支え", `信仰＋${tide.gain} / 神託＋${tide.bonus}%`, "-");
      }
    }
    if (FOOD_CONSUMPTION_DAYS.includes(d)) {
      applyPeriodicFood();
    }
    const today = absDay(state);
    updateExplorationWorld(true);
    tickDailyWar(today);
    tickRelationDrift(today);
    maybeQueueHonorInvite(today);
    if (state.day % 7 === 0) {
      applySupportDrift();
    }
    processScheduledOmens(today);
  }
  // 日付進行に合わせて依頼の期限/季節更新を処理する。
  questTickDay(days);
}

/**
 * 季節1日に部隊、船の順に維持費を支払う。部隊分の不足は兵員損耗、船分の不足は安価な船の売却で補う。
 * 今季の額は支払前に確定し、船売却益を部隊の不足額へ遡って充当しない。
 * @returns {void}
 */
function applySeasonUpkeep() {
  const forecast = getUpkeepForecast(state, TROOP_STATS);
  const upkeepCost = forecast.troopFunds;

  const fundsBefore = state.funds || 0;
  const fundsPaid = Math.min(fundsBefore, upkeepCost);
  const deficitFunds = Math.max(0, upkeepCost - fundsPaid);
  state.funds = Math.max(0, fundsBefore - upkeepCost);

  if (forecast.funds === 0) return;

  // 資金不足時は不足額/6人ぶんの兵士を損耗（人数比で按分、余りは順繰り）
  let lossCount = 0;
  if (deficitFunds > 0) {
    lossCount = Math.floor(deficitFunds / 6);
    if (lossCount > 0) {
      applyTroopLosses(buildLossesMap(lossCount));
    }
  }
  const shipPayment = payShipUpkeep(state, forecast.shipFunds);
  if (shipPayment.sold.length) {
    const soldText = shipPayment.sold.map(row => `${SHIP_TYPES[row.id].name} ${row.count}隻（資金＋${row.proceeds}）`).join(" / ");
    enqueueEvent({ title: "船維持費のため自動売却", body: `${soldText}\n船維持費 ${shipPayment.cost}を支払いました。残り資金 ${state.funds}。積載上限が減るため、物資・兵員の超過を確認してください。` });
    pushLog("船の自動売却", soldText, "-");
  }
  pushLog(
    "維持費・消費",
    `資金 -${fundsPaid + shipPayment.paid}（部隊 ${fundsPaid}/${upkeepCost}・船 ${shipPayment.paid}/${shipPayment.cost}` +
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
  const need = getUpkeepForecast(state, TROOP_STATS).food;
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
export function processScheduledOmens(todayAbs) {
  if (!Array.isArray(state.pendingOmens)) return;
  const remaining = [];
  state.pendingOmens.forEach((o) => {
    if (!o || o.handled) return;
    if (todayAbs < o.day) {
      remaining.push(o);
      return;
    }
    if (state.expansion?.exploration.pending || state.expansion?.charts.pending || state.pendingEncounter?.active || state.modeLabel === MODE_LABEL.BATTLE) {
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
import { settlements } from "./map.js";
import { refreshShipyard, shipyardSeason } from "./shipyard.js";
