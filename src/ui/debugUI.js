import { DEBUG_MODE } from "../core/debugMode.js";
import { state } from "../core/state.js";
import { elements, pushLog } from "./dom.js";
import { normalizeFleet, totalShips } from "../fleet/fleet.js";
import { formatTroopDisplay } from "../resources/troops.js";
import { formatSupplyDisplay } from "../resources/supplies.js";
import { unlockAllCodex } from "../fishing/fishing.js";

/**
 * デバッグ起動時だけ管理操作を接続し、通常起動では手動クリックでも変更しない。
 * 管理操作で変更したゲーム状態は、従来と同じ保存経路へ反映する。
 * @param {{openModal:Function, bindModal:Function, syncUI:Function}} options 共通の画面操作。
 * @returns {void}
 */
export function wireDebugTools({ openModal, bindModal, syncUI }) {
  if (!DEBUG_MODE) return;
  elements.manualModalBtn?.addEventListener("click", () => {
    if (DEBUG_MODE) openModal(elements.manualModal);
  });
  bindModal(elements.manualModal, elements.manualModalClose);
  document.getElementById("syncBtn")?.addEventListener("click", () => {
    if (!DEBUG_MODE) return;
    state.fleet = normalizeFleet(state.fleet);
    state.fleet.counts.cog = normalizeFleet(Math.max(0, Math.floor(Number(elements.shipsIn?.value) || 0))).counts.cog;
    state.faith = Math.max(0, Number(elements.faithIn?.value) || 0);
    state.funds = Math.max(0, Number(elements.fundsIn?.value) || 0);
    state.fame = Math.max(0, Number(elements.fameIn?.value) || 0);
    syncUI();
    const troopDisplay = formatTroopDisplay();
    const supplyDisplay = formatSupplyDisplay();
    pushLog("手動更新",
      `従船=${totalShips(state.fleet)} / 部隊=${troopDisplay.total}/${troopDisplay.cap} / 信仰=${state.faith} / 物資=${supplyDisplay.total}/${supplyDisplay.cap} / 資金=${state.funds} / 名声=${state.fame}`,
      state.lastRoll ?? "-");
  });
  document.getElementById("unlockCodexBtn")?.addEventListener("click", () => {
    if (!DEBUG_MODE || !confirm("魚図鑑を全開放しますか？")) return;
    unlockAllCodex(state);
    syncUI();
    const completion = Object.keys(state.expansion.fishing.codex).length;
    pushLog("魚図鑑全開放", `全 ${completion} 種を図鑑に登録しました。`);
  });
}
