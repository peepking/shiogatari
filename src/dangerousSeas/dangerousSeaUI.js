import { state } from "../core/state.js";
import { dangerousSeaAt, dangerousSeaForecastRegionAt } from "./dangerousSeaWorld.js";
import { dangerousSeaName } from "./dangerousSeaConfig.js";
import { absDay } from "../core/calendar.js";

/**
 * 海域と遠征拠点で荒波の残日数・対策と接近中の船団だけを知らせる。仕組みの説明はガイドへまとめる。
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
  const regionId = dangerousSeaForecastRegionAt(state.position);
  const current = state.dangerousSeas;
  info.hidden = !regionId && (!current?.pendingHazard || current.pendingHazard.stage === "watch");
  info.textContent = "";
  if (info.hidden) return;
  const region = regionId && current?.regions[regionId];
  const title = document.getElementById("locationLabel");
  if (sea) {
    if (title) title.textContent = dangerousSeaName(sea.regionId);
    status.textContent = `${sea.level === "core" ? "核心" : "外縁"} · 警戒 ${region?.alert || 0}/12`;
  }
  if (region) {
    const forecast = region.forecast;
    if (!sea) info.textContent = `${dangerousSeaName(regionId)}：`;
    info.textContent += forecast ? `荒波まであと${Math.max(0, forecast.day - absDay(state))}日${forecast.avoided ? "（安全な潮筋あり・被害なし）。" : "。"}` : "荒波の予報なし。";
    if (!sea) info.textContent += " 港内は安全です。";
    else if (forecast && !forecast.avoided) info.textContent += " 木材1・繊維1で釣果を守れます。";
  }
  if (sea && current?.pendingHazard?.stage === "watch") info.textContent += " 船団接近：明日襲撃。港・区域外への到着で回避できます。";
  if (current?.pendingHazard?.stage === "ready" && !current.action && (!current.explorationPending || current.explorationPending.pausedForHazard) && !state.pendingEncounter?.active
    && !state.eventQueue?.length && !state.expansion?.fishing?.pending && !state.expansion?.exploration?.pending && !state.expansion?.charts?.pending) {
    const retry = document.createElement("button"); retry.className = "btn"; retry.textContent = "通知を再表示";
    retry.onclick = () => sync?.(); info.append(retry);
  }
}
