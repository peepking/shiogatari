import { state } from "./state.js";
import { MODE_LABEL, PLACE } from "./constants.js";
import { setOutput, pushLog, pushToast } from "./dom.js";
import { getSettlementAtPosition, getLocationStatus, getTerrainAt } from "./map.js";
import { calcSupplyCap, totalSupplies } from "./supplies.js";
import { calcTroopCap, totalTroops } from "./troops.js";
import { advanceDayWithEvents } from "./time.js";
import { TROOP_STATS } from "./troops.js";
import { clamp } from "./util.js";

/**
 * エンカウント歩数
 */
const ENCOUNTER_MIN = 10;
const ENCOUNTER_MAX = 15;
/**
 * 強プール確率
 */
const STRONG_POOL_CHANCE = 0.25;
/**
 * 名声に比例した敵戦力の計算に使用する点
 */
const NORMAL_ANCHORS = [
  { fame: 0, min: 3, max: 5 },
  { fame: 100, min: 7, max: 8 },
  { fame: 500, min: 35, max: 40 },
  { fame: 1000, min: 70, max: 80 },
];
/**
 * 名声に比例した敵戦力の計算に使用する点（強プール）
 */
const STRONG_ANCHORS = [
  { fame: 100, min: 8, max: 9 },
  { fame: 500, min: 40, max: 45 },
  { fame: 1000, min: 80, max: 90 },
];

const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

/**
 * 名声に近いアンカーから人数レンジを補間して取得する。
 * @param {number} fame 名声
 * @param {Array<{fame:number,min:number,max:number}>} anchors アンカー配列
 * @returns {{min:number,max:number}} 人数レンジ
 */
function pickAnchorRange(fame, anchors) {
  const list = [...anchors].sort((a, b) => a.fame - b.fame);
  if (fame <= list[0].fame) return { min: list[0].min, max: list[0].max };
  if (fame >= list[list.length - 1].fame)
    return { min: list[list.length - 1].min, max: list[list.length - 1].max };
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i];
    const b = list[i + 1];
    if (fame >= a.fame && fame <= b.fame) {
      const t = (fame - a.fame) / Math.max(1, b.fame - a.fame);
      const lerp = (x, y) => Math.round(x + (y - x) * t);
      return { min: lerp(a.min, b.min), max: lerp(a.max, b.max) };
    }
  }
  return { min: list[0].min, max: list[0].max };
}

/**
 * エンカウント進捗と閾値をリセットする。
 * @returns {void}
 */
export function resetEncounterMeter() {
  state.encounterProgress = 0;
  state.encounterThreshold = randInt(ENCOUNTER_MIN, ENCOUNTER_MAX);
}

/**
 * 名声と強敵フラグから敵編成を生成する。
 * @param {"normal"|"elite"|null} forceStrength 強敵プール強制指定
 * @returns {{formation:Array, total:number, strength:string, terrain?:string}} 生成結果
 */
export function buildEnemyFormation(forceStrength) {
  const fame = Math.max(0, state.fame || 0);
  const useStrong =
    forceStrength === "elite"
      ? true
      : forceStrength === "normal"
        ? false
        : fame >= 100 && Math.random() < STRONG_POOL_CHANCE;
  const range = useStrong
    ? pickAnchorRange(fame, STRONG_ANCHORS)
    : pickAnchorRange(fame, NORMAL_ANCHORS);
  const total = randInt(range.min, range.max);
  const pool = useStrong
    ? Object.keys(TROOP_STATS)
        .slice()
        .sort(() => Math.random() - 0.5)
        .slice(0, 6)
    : ["infantry", "archer", "scout", "marine"];
  const formation = [];
  let remain = total;
  while (remain > 0) {
    const type = pool[randInt(0, pool.length - 1)];
    const level = useStrong ? randInt(1, 3) : 1;
    const chunk = Math.min(remain, Math.max(1, randInt(5, 10)));
    formation.push({ type, count: chunk, level });
    remain -= chunk;
  }
  return { formation, total, strength: useStrong ? "elite" : "normal" };
}

/**
 * エンカウントを発火し、戦闘準備モードへ遷移する。
 * @param {Function} syncUI UI同期関数
 * @returns {void}
 */
function triggerEncounter(syncUI) {
  const { formation, total, strength } = buildEnemyFormation();
  const terrain = getTerrainAt(state.position.x, state.position.y) || "plain";
  state.pendingEncounter = {
    active: true,
    enemyFormation: formation,
    enemyTotal: total,
    strength,
    terrain,
  };
  state.modeLabel = MODE_LABEL.PREP;
  resetEncounterMeter();
  setOutput(
    "敵襲",
    `外洋海賊と遭遇しました（推定${total}人 / ${strength === "elite" ? "強編成" : "通常編成"}）。行動を選んでください。`,
    [
      { text: "戦闘準備", kind: "warn" },
      { text: "行動選択", kind: "warn" },
    ]
  );
  pushLog(
    "敵襲",
    `外洋海賊と遭遇（推定${total}人 / ${strength === "elite" ? "強編成" : "通常編成"}）。`,
    state.lastRoll ?? "-"
  );
  syncUI?.();
}

/**
 * 移動進捗に応じてエンカウントをチェックする。
 * @param {Function} syncUI UI同期関数
 * @returns {boolean} 発生したか
 */
function maybeTriggerEncounter(syncUI) {
  if (state.pendingEncounter?.active) return false;
  const loc = getLocationStatus();
  // 村/街タイル上ではエンカウントしないが、リセットもしない（入場時のみリセット）
  if (loc?.place === PLACE.VILLAGE || loc?.place === PLACE.TOWN) return false;
  const threshold = clamp(state.encounterThreshold || ENCOUNTER_MIN, ENCOUNTER_MIN, ENCOUNTER_MAX);
  state.encounterProgress = (state.encounterProgress || 0) + 1;
  if (state.encounterProgress >= threshold) {
    triggerEncounter(syncUI);
    pushToast("敵襲", "外洋海賊が接近中！ 戦闘準備をしてください。", "warn");
    return true;
  }
  return false;
}

/**
 * マップ境界内への移動か判定する。
 * @param {{x:number,y:number}} from 現在位置
 * @param {{x:number,y:number}} to 目標位置
 * @returns {boolean}
 */
export function isValidMove(from, to) {
  if (!to) return false;
  const dx = Math.abs((to.x ?? 0) - (from.x ?? 0));
  const dy = Math.abs((to.y ?? 0) - (from.y ?? 0));
  // 上下左右方向で最大1マスまで移動可
  if (dx === 0 && dy === 1) return true;
  if (dy === 0 && dx === 1) return true;
  return false;
}

/**
 * 選択したマスへ移動し、エンカウントやUI更新を行う。
 * @param {Function} showActionMessage アクションメッセージ表示
 * @param {Function} syncUI UI同期関数
 * @returns {boolean} 移動成功か
 */
export function moveToSelected(showActionMessage, syncUI) {
  if (state.pendingEncounter?.active) {
    showActionMessage?.("戦闘準備中は移動できません。行動を選んでください。", "warn");
    return false;
  }
  if (state.modeLabel === MODE_LABEL.BATTLE) {
    showActionMessage?.("戦闘中は移動できません。地図に戻ってください。", "warn");
    return false;
  }
  // 物資/部隊が上限を超えている場合は移動を封じ、破棄/解雇を促す。
  const supplyTotal = totalSupplies();
  const supplyCap = calcSupplyCap(state.ships);
  if (supplyTotal > supplyCap) {
    setOutput("移動不可", `物資が上限を超えています（${supplyTotal}/${supplyCap}）。`, [
      { text: "物資超過", kind: "warn" },
      { text: "破棄が必要", kind: "warn" },
    ]);
    showActionMessage?.("物資が上限を超えています。破棄してください。", "error");
    return false;
  }
  const troopTotal = totalTroops();
  const troopCap = calcTroopCap(state.ships);
  if (troopTotal > troopCap) {
    setOutput("移動不可", `部隊が上限を超えています（${troopTotal}/${troopCap}）。`, [
      { text: "部隊超過", kind: "warn" },
      { text: "解雇が必要", kind: "warn" },
    ]);
    showActionMessage?.("部隊が上限を超えています。解雇してください。", "error");
    return false;
  }
  const dest = state.selectedPosition;
  if (!dest) {
    setOutput("移動不可", "移動先が選択されていません。", [
      { text: "移動", kind: "warn" },
      { text: "選択必須", kind: "warn" },
    ]);
    showActionMessage?.("移動先を選択してください。", "error");
    return false;
  }
  if (!isValidMove(state.position, dest)) {
    setOutput("移動不可", "現在地の上下左右1マスのみ移動できます。", [
      { text: "範囲外", kind: "warn" },
      { text: "移動", kind: "" },
    ]);
    showActionMessage?.("移動できるのは上下左右1マス以内です。", "error");
    return false;
  }
  // 拠点内なら自動で外へ出る
  if (state.modeLabel === MODE_LABEL.IN_VILLAGE) {
    state.modeLabel = MODE_LABEL.NORMAL;
  }
  if (state.modeLabel === MODE_LABEL.IN_TOWN) {
    state.modeLabel = MODE_LABEL.NORMAL;
  }
  state.position = { ...dest };
  advanceDayWithEvents(1);
  setOutput("移動", `(${dest.x + 1}, ${dest.y + 1}) へ移動しました。`, [
    { text: "移動", kind: "" },
    { text: "日数+1", kind: "" },
  ]);
  pushLog("移動", `選択マスへ移動 (${dest.x + 1}, ${dest.y + 1})`, state.lastRoll ?? "-");
  showActionMessage?.("", "info");
  maybeTriggerEncounter(syncUI);
  syncUI?.();
  return true;
}

/**
 * 村/街への入場を試みる。
 * @param {"village"|"town"} target 入場先種別
 * @param {Function} clearActionMessage 表示中のメッセージを消す
 * @param {Function} syncUI UI同期関数
 * @returns {boolean} 入場できたか
 */
export function attemptEnter(target, clearActionMessage, syncUI) {
  const loc = getLocationStatus();
  const targetPlace = target === "village" ? PLACE.VILLAGE : PLACE.TOWN;
  const insideLabel = target === "village" ? MODE_LABEL.IN_VILLAGE : MODE_LABEL.IN_TOWN;
  if (loc?.place !== targetPlace) {
    setOutput("入場できません", `${targetPlace}にいません。`, [
      { text: targetPlace, kind: "warn" },
      { text: "移動が必要", kind: "warn" },
    ]);
    return false;
  }
  state.modeLabel = insideLabel;
  resetEncounterMeter();
  setOutput("入場", `${targetPlace}に入りました。`, [
    { text: targetPlace, kind: "" },
    { text: "滞在", kind: "" },
  ]);
  pushLog("入場", `${targetPlace}に入りました`, state.lastRoll ?? "-");
  clearActionMessage?.();
  syncUI?.();
  return true;
}

/**
 * 村/街から出る処理を行い通常モードへ戻す。
 * @param {"village"|"town"} target 退出対象
 * @param {object} elements DOM要素群
 * @param {Function} clearActionMessage メッセージ消去
 * @param {Function} setTradeError 取引エラー設定
 * @param {Function} syncUI UI同期
 * @returns {boolean} 退出できたか
 */
export function attemptExit(target, elements, clearActionMessage, setTradeError, syncUI) {
  const label = target === "village" ? MODE_LABEL.IN_VILLAGE : MODE_LABEL.IN_TOWN;
  const place = target === "village" ? PLACE.VILLAGE : PLACE.TOWN;
  if (state.modeLabel !== label) {
    setOutput("出られません", `${label}ではありません。`, [
      { text: "場所", kind: "warn" },
      { text: "移動が必要", kind: "warn" },
    ]);
    return false;
  }
  state.modeLabel = MODE_LABEL.NORMAL;
  resetEncounterMeter();
  setOutput("出発", `${place}を出ました。`, [
    { text: "移動", kind: "" },
    { text: "通常", kind: "" },
  ]);
  pushLog("出発", `${place}を出ました`, state.lastRoll ?? "-");
  if (elements?.ctxEl) elements.ctxEl.value = "move";
  clearActionMessage?.();
  setTradeError?.("");
  syncUI?.();
  return true;
}

/**
 * 1日経過処理を行いUIを更新する。
 * @param {object} elements DOM要素群
 * @param {Function} clearActionMessage メッセージ消去
 * @param {Function} syncUI UI同期
 * @returns {void}
 */
export function waitOneDay(elements, clearActionMessage, syncUI) {
  if (state.pendingEncounter?.active) {
    setOutput("待機できません", "戦闘準備中は待機できません。行動を選んでください。", [
      { text: "戦闘準備", kind: "warn" },
      { text: "待機不可", kind: "warn" },
    ]);
    return false;
  }
  if (state.modeLabel === MODE_LABEL.BATTLE) {
    setOutput("待機できません", "戦闘中は待機できません。地図に戻ってください。", [
      { text: "戦闘中", kind: "warn" },
      { text: "待機不可", kind: "warn" },
    ]);
    return false;
  }
  advanceDayWithEvents(1);
  setOutput("待機", "1日待機しました。", [
    { text: "待機", kind: "" },
    { text: "日数+1", kind: "" },
  ]);
  pushLog("待機", "1日待機", state.lastRoll ?? "-");
  clearActionMessage?.();
  if (elements?.ctxEl) elements.ctxEl.value = "move";
  syncUI?.();
  return true;
}

/**
 * 現在位置の拠点情報を返す。
 * @returns {object|null} 拠点情報
 */
export function getCurrentSettlement() {
  return getSettlementAtPosition(state.position.x, state.position.y);
}
