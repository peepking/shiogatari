const SINGLE_SUPPLY_TYPES = ["supply", "delivery"];
const MULTI_SUPPLY_TYPES = ["oracle_supply", "noble_supply", "noble_logistics", "war_supply"];
const BATTLE_TYPES = ["oracle_hunt", "oracle_elite", "pirate_hunt", "bounty_hunt", "noble_hunt", "noble_security", "war_defend_raid", "war_attack_raid", "war_skirmish", "war_blockade"];

/**
 * 座標が一致するかを判定する。
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function isAt(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

/**
 * プレイヤー向けの目的地名と1始まりの座標を返す。
 * @param {object|null} destination
 * @returns {string}
 */
function placeName(destination) {
  const pos = destination?.coords || destination;
  if (!Number.isFinite(pos?.x) || !Number.isFinite(pos?.y)) return "指定地点";
  return `${destination?.name || "地点"} (${pos.x + 1}, ${pos.y + 1})`;
}

/**
 * 数量条件を表示用にする。超過所持は表示に残し、達成量だけを上限で丸める。
 * @param {string} label
 * @param {number} owned
 * @param {number} required
 * @param {string} [icon]
 * @returns {object}
 */
function quantityRow(label, owned, required, icon) {
  const current = Math.max(0, Number(owned) || 0);
  const total = Math.max(0, Number(required) || 0);
  const missing = Math.max(0, total - current);
  return { label, icon, current: Math.min(current, total), total, text: `${current} / ${total}`, note: missing ? `あと${missing}` : "必要数あり", done: missing === 0 };
}

/**
 * 依頼の条件と次の行動を、ゲーム状態を変更せず組み立てる。
 * 所持品は依頼ごとの判定であり予約・合算しない。完了可否は既存の判定を優先する。
 * 期限当日は有効、翌日から期限切れ。戦闘・護送は手動完了と区別する。
 * @param {object} q
 * @param {object} state
 * @param {{now:number,canFinish:boolean,origin:object,target:object,itemNames:object,troopNames:object}} context
 * @returns {object}
 */
export function getQuestProgress(q, state, { now, canFinish, origin, target, itemNames = {}, troopNames = {} }) {
  const remaining = q.deadlineAbs == null ? null : q.deadlineAbs - now;
  const expired = remaining != null && remaining < 0;
  const rows = [];
  let next = "依頼の内容を確認してください。";
  let automatic = false;
  let destination = null;
  const supply = SINGLE_SUPPLY_TYPES.includes(q.type) || MULTI_SUPPLY_TYPES.includes(q.type);
  if (supply) {
    const items = SINGLE_SUPPLY_TYPES.includes(q.type) ? [{ id: q.itemId, qty: q.qty }] : q.items || [];
    for (const item of items) rows.push(quantityRow(itemNames[item.id] || item.id, state.supplies?.[item.id], item.qty, item.id));
    destination = q.type === "oracle_supply" ? null : q.type === "delivery" ? target : origin;
    next = rows.some(row => !row.done) ? "不足している物資を集めてください。" : destination ? `${placeName(destination)}で納品してください。` : "物資を捧げて完了できます。";
  } else if (q.type === "oracle_troop") {
    const levels = state.troops?.[q.troopType];
    const count = typeof levels === "number" ? levels : Object.values(levels || {}).reduce((sum, n) => sum + Number(n || 0), 0);
    rows.push(quantityRow(`${troopNames[q.troopType] || q.troopType}（人）`, count, 1, q.troopType));
    next = rows[0].done ? "部隊員を1人捧げて完了できます。" : "指定の兵種を1人雇用してください。";
  } else if (q.type === "war_truce") {
    rows.push(quantityRow("資金", state.funds, q.costFunds || 0, "funds"));
    destination = origin;
    next = rows[0].done ? `${placeName(origin)}で停戦工作を完了してください。` : "停戦工作に必要な資金を用意してください。";
  } else if (["oracle_move", "noble_scout"].includes(q.type)) {
    destination = q.target;
    next = `${placeName(destination)}へ移動してください。`;
  } else if (["noble_refugee", "war_escort"].includes(q.type)) {
    const picked = !!q.picked;
    rows.push({ label: "合流", done: picked, text: picked ? "合流済み" : "未合流" });
    destination = picked ? origin : q.target;
    next = picked ? `${placeName(origin)}まで護送してください。` : `${placeName(q.target)}で合流してください。`;
    automatic = true;
    if (picked && isAt(state.position, origin?.coords)) next = "帰還先への到着で護送が完了します。";
  } else if (q.type === "refugee_escort") {
    destination = target || q.target;
    automatic = true;
    rows.push({ label: "護送", done: true, text: "同行中" });
    next = isAt(state.position, destination?.coords || destination) ? "拠点に入ると護送が完了します。" : `${placeName(destination)}まで護送し、拠点に入ってください。`;
  } else if (BATTLE_TYPES.includes(q.type)) {
    automatic = true;
    const fights = q.fights || [];
    const total = fights.length || 1;
    const done = fights.filter(fight => fight.done).length;
    rows.push({ label: "討伐", current: done, total, text: `${done} / ${total}戦`, note: `残り${total - done}戦`, done: done === total });
    const fightTarget = fights.find(fight => !fight.done)?.target || q.target;
    next = isAt(state.position, fightTarget) ? "行動欄から戦闘へ。勝利すると進捗が更新されます。" : `${placeName(fightTarget)}で討伐してください。`;
  }
  if (destination) {
    const arrived = isAt(state.position, destination.coords || destination);
    rows.push({ label: placeName(destination), done: arrived, text: arrived ? "到着済み" : "未到着" });
  }
  const ready = !!canFinish && !expired;
  if (ready) next = "条件がそろいました。「完了して報酬を受取」で完了できます。";
  if (expired) next = "期限を過ぎています。";
  return {
    rows, next, ready, automatic,
    automaticLabel: BATTLE_TYPES.includes(q.type) ? "必要な戦闘すべてに勝利すると自動完了" : "護送先への到着・入場で自動完了",
    status: expired ? "expired" : ready ? "ready" : "active",
    statusText: expired ? "期限切れ" : ready ? "完了できます" : "進行中",
    deadline: remaining == null ? "期限なし" : remaining < 0 ? "期限切れ" : remaining === 0 ? "本日が期限" : `残り${remaining}日`,
    urgent: remaining != null && remaining <= 3,
  };
}
