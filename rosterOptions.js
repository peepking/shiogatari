const STORAGE_KEY = "shiogatari-roster-options";
const SIZE_MODES = ["any", "min7", "full"];

/**
 * 保存済みの編成条件を検証し、古い・不正な設定は既定値に戻す。
 * @param {object} value
 * @returns {{excludeSupport:boolean, sizeMode:string}}
 */
export function normalizeRosterOptions(value) {
  return {
    excludeSupport: value?.excludeSupport === true,
    sizeMode: SIZE_MODES.includes(value?.sizeMode) ? value.sizeMode : "any",
  };
}

/**
 * 戦闘中の進行保存とは独立した、ブラウザ共通の編成設定を読む。
 * @returns {object}
 */
function loadRosterOptions() {
  try {
    return normalizeRosterOptions(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return normalizeRosterOptions(null);
  }
}

export const rosterOptions = loadRosterOptions();

/**
 * 自動編成の対象兵種かを判定する。手動での出撃は制限しない。
 * @param {string} type
 * @param {object} options
 * @returns {boolean}
 */
export function canAutoDeploy(type, options) {
  return !options.excludeSupport || (type !== "scout" && type !== "medic");
}

/**
 * 同じ兵種を最大10人ずつに分ける。
 * 7人以上では出撃人数を最大化し、必要最小の部隊数に均等配分する。
 * 例：23人は7・8・8人、13人は10人と待機3人。10人のみでは端数を待機に残す。
 * 制限なしでは従来どおり10人ずつと端数に分ける。
 * @param {number} total
 * @param {string} mode
 * @returns {number[]}
 */
export function splitRosterCounts(total, mode) {
  if (!Number.isSafeInteger(total) || total <= 0) return [];
  if (mode === "full") return Array(Math.floor(total / 10)).fill(10);
  if (mode === "min7") {
    const slots = Math.min(Math.ceil(total / 10), Math.floor(total / 7));
    if (!slots) return [];
    const deployed = Math.min(total, slots * 10);
    const base = Math.floor(deployed / slots);
    const extra = deployed % slots;
    const counts = [];
    for (let i = 0; i < slots; i++) counts.push(base + (i >= slots - extra ? 1 : 0));
    return counts;
  }
  const counts = Array(Math.floor(total / 10)).fill(10);
  if (total % 10) counts.push(total % 10);
  return counts;
}

/**
 * 編成欄の条件を初期化する。変更は次回の自動編成から適用する。
 * @returns {void}
 */
export function initRosterOptions() {
  document.getElementById("rosterExcludeSupport").checked = rosterOptions.excludeSupport;
  document.getElementById("rosterSizeMode").value = rosterOptions.sizeMode;
  document.getElementById("rosterOptions").addEventListener("change", saveRosterOptions);
}

/**
 * 条件だけを即時保存し、戦闘途中のゲーム状態は保存しない。
 * 保存先が利用できない場合も、この起動中は設定を使える。
 * @returns {void}
 */
function saveRosterOptions() {
  Object.assign(rosterOptions, normalizeRosterOptions({
    excludeSupport: document.getElementById("rosterExcludeSupport").checked,
    sizeMode: document.getElementById("rosterSizeMode").value,
  }));
  const status = document.getElementById("rosterOptionsStatus");
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rosterOptions));
    status.textContent = "設定を保存しました。「おまかせ編成」で今の編成にも適用できます。";
  } catch {
    status.textContent = "設定を保存できませんでした。この画面では適用できますが、再読み込みすると元に戻ります。";
  }
}
