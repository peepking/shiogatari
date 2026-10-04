import { state } from "../core/state.js";
import { dangerousSeaAt } from "./dangerousSeaWorld.js";
import { dangerousSeaName } from "./dangerousSeaConfig.js";
import { mapData, settlements } from "../world/map.js";
import { absDay } from "../core/calendar.js";
import { snapshotOutfitting } from "../fleet/outfitting.js";
import { dangerousScoutRules } from "./dangerousSeaWeather.js";
import { dangerousRetreatDistances } from "./dangerousSeaRetreat.js";

/**
 * 海域と遠征拠点で予報・退避距離を表示する。既知予報は斥候が減っても維持する。
 * @param {Function} [sync] 保存失敗後に同じ危険を再表示する画面同期。
 * @returns {void}
 */
export function renderDangerousSeaStatus(sync) {
  const status = document.getElementById("locationStatus");
  if (!status) return;
  let info = document.getElementById("dangerousSeaInfo");
  if (!info) {
    info = document.createElement("p"); info.id = "dangerousSeaInfo"; info.className = "tiny dangerous-sea-info";
    (document.getElementById("locationLabel") || status).insertAdjacentElement("afterend", info);
  }
  const sea = dangerousSeaAt(state.position);
  const haven = settlements.find(site => site.pirateHaven && site.coords.x === state.position.x && site.coords.y === state.position.y);
  const regionId = sea?.regionId || (haven ? (haven.coords.x < mapData[0].length / 2 ? "sw" : "se") : null);
  const current = state.dangerousSeas;
  info.hidden = !regionId && !current?.pendingHazard;
  info.textContent = "";
  if (info.hidden) return;
  const region = regionId && current?.regions[regionId];
  const title = document.getElementById("locationLabel");
  if (sea) {
    if (title) title.textContent = dangerousSeaName(sea.regionId);
    status.textContent = `${sea.level === "core" ? "核心" : "外縁"} · 警戒 ${region?.alert || 0}/12`;
    info.textContent = "滞在で警戒が高まり、襲撃が増えます。釣りは海域・季節・水深を問わず、餌の条件は有効です。警戒は海域外で3日目から下がります。 ";
  }
  if (region) {
    const scouts = snapshotOutfitting(state).scouts, rules = dangerousScoutRules(scouts);
    const forecast = region.forecast, remaining = forecast ? forecast.day - absDay(state) : null;
    info.textContent += `実効斥候 ${scouts}人 / 荒波予報 ${rules.lead}日前 / 日次襲撃 ${Math.round(rules.raidReduction * 100)}%軽減。 `;
    info.textContent += forecast ? `【${dangerousSeaName(regionId)} 荒波まであと${Math.max(0, remaining)}日】${forecast.avoided ? "安全な潮筋を発見済み・被害を回避できます。 " : "木材1・繊維1で魚を守れます。 "}` : "荒波は12～18日周期。現在、察知範囲内の予報はありません。 ";
    if (sea) {
      const distance = dangerousRetreatDistances(mapData, settlements, state.position, dangerousSeaAt);
      const safe = distance.exit;
      info.textContent += `区域外まで${distance.exit ?? "到達不可"}移動 / 最寄り拠点まで${distance.port ?? "到達不可"}移動。 `;
      if (forecast && !forecast.avoided && safe != null) info.textContent += remaining >= safe ? `退避の余裕 ${remaining - safe}日。` : "退避が間に合いません。対策材料を確認してください。";
    }
    if (current.raidSafeUntil >= absDay(state)) info.textContent += ` 日次襲撃の再発まであと${current.raidSafeUntil - absDay(state) + 1}日。`;
  }
  if (current?.pendingHazard?.stage === "watch") info.textContent += " 【船団接近】次の1日の終わりに襲撃されます。港・区域外への到着で回避できます。";
  if (current?.pendingHazard?.stage === "ready" && !current.action && (!current.explorationPending || current.explorationPending.pausedForHazard) && !state.pendingEncounter?.active
    && !state.eventQueue?.length && !state.expansion?.fishing?.pending && !state.expansion?.exploration?.pending && !state.expansion?.charts?.pending) {
    const retry = document.createElement("button"); retry.className = "btn"; retry.textContent = "危険判定の表示を再試行";
    retry.onclick = () => sync?.(); info.append(retry);
  }
}
