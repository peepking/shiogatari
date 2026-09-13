import { state } from "./state.js";
import { FACTIONS } from "./lore.js";
import { settlements } from "./map.js";
import { isHonorFaction } from "./faction.js";
import { MODE_LABEL } from "./constants.js";
import { NATIONAL_POWER_CONFIG as CONFIG } from "./nationalPowerConfig.js";
import { getNationalPower, isNationalPowerFaction, nationalPowerRecovery, nationalPowerDailyCost, nationalPowerWarBias, quoteNationalPowerDonation, changeNationalPower } from "./nationalPower.js";
import { nationalPowerFrontCounts, questPowerPlan } from "./nationalPowerRules.js";
import { nationalPowerAtWar, nationalPowerResources } from "./nationalPowerWorld.js";
import { saveGameToStorage } from "./storage.js";
import { pushToast, pushLog } from "./dom.js";
import { escapeHtml } from "./util.js";
import { resourceList } from "./resourceUI.js";

/** @param {number} value 国力。 @param {number} digits 表示桁。 @returns {string} 読みやすい数値表記。 */
function number(value, digits = 1) { return value.toLocaleString("ja-JP", { maximumFractionDigits: digits }); }

/** @param {object} q 依頼。 @returns {string} 状態を変更せず国力の予定報酬を描画する。 */
export function questPowerRewardHtml(q) {
  const plan = questPowerPlan(q, FACTIONS, settlements, nationalPowerAtWar);
  return plan.length ? resourceList(nationalPowerResources(plan)) : "";
}

/** @param {string} factionId 国家。 @returns {string} 回復・消耗・戦況補正を示す勢力シート。 */
export function nationalPowerSheet(factionId) {
  if (!isNationalPowerFaction(factionId)) return "";
  const power = getNationalPower(state.nationalPower, factionId);
  const owned = settlements.filter(s => s.factionId === factionId);
  const villages = owned.filter(s => s.kind === "village").length;
  const towns = owned.filter(s => s.kind === "town").length;
  const { attacks, defenses } = nationalPowerFrontCounts(state, settlements, nationalPowerAtWar)[factionId];
  const wars = FACTIONS.filter(f => isNationalPowerFaction(f.id) && f.id !== factionId && nationalPowerAtWar(factionId, f.id));
  return `<section class="national-power-sheet" aria-label="国力"><div class="national-power-heading"><b>国力</b><span><strong>${number(power)}</strong> / ${number(CONFIG.max)}</span></div><progress max="${CONFIG.max}" value="${power}" aria-label="国力 ${number(power)} / ${CONFIG.max}"></progress><p class="tiny">戦争を続けるための余力。戦況とは別に蓄積します。</p><dl class="national-power-metrics"><div><dt>次季節の回復</dt><dd>＋${number(nationalPowerRecovery(settlements, factionId))}</dd></div><div><dt>所有拠点</dt><dd>街${towns}・村${villages}</dd></div><div><dt>前線の消耗／日</dt><dd>−${number(nationalPowerDailyCost(attacks, defenses), 3)}</dd></div><div><dt>参加中の前線</dt><dd>攻撃${attacks}・防衛${defenses}</dd></div>${wars.map(f => {
    const bias = nationalPowerWarBias(state.nationalPower, factionId, f.id);
    return `<div><dt>対${escapeHtml(f.name)}<small>戦況補正／日</small></dt><dd>${bias >= 0 ? "+" : ""}${number(bias, 4)}</dd></div>`;
  }).join("")}</dl><p class="tiny">回復は所有拠点に基づく予定量です。実際の回復は国力の上限までとなります。</p></section>`;
}

/** @param {Function} getContext 謁見相手。 @returns {string|null} 名誉家臣資格がある謁見中の国家。 */
function donationFaction(getContext) {
  if (state.modeLabel !== MODE_LABEL.AUDIENCE || state.pendingEncounter?.active || state.expansion?.exploration.pending || state.expansion?.charts.pending) return null;
  const ctx = getContext();
  const faction = FACTIONS.find(f => f.nobles?.some(n => n.id === ctx.nobleId));
  return faction && isNationalPowerFaction(faction.id) && isHonorFaction(faction.id) ? faction.id : null;
}

/** @param {Function} getContext 謁見相手。 @returns {void} 提供ボタンと開いている勢力シートを更新する。 */
export function renderNationalPowerControls(getContext) {
  const button = document.getElementById("nationalPowerDonate");
  if (button) button.hidden = !donationFaction(getContext);
  document.querySelectorAll("[data-national-power]").forEach(el => { el.innerHTML = nationalPowerSheet(el.dataset.nationalPower); });
}

/**
 * 任意額の入力と確認を同じ画面で行う。確定時に資格・相手・資産を照合し、保存失敗時は全額を戻す。
 * @param {Function} getContext 謁見相手。 @param {Function} syncUI 全体表示更新。 @returns {void}
 */
export function initNationalPowerUI(getContext, syncUI) {
  const modal = document.getElementById("nationalPowerModal");
  const input = document.getElementById("nationalPowerAmount");
  const submit = document.getElementById("nationalPowerSubmit");
  const back = document.getElementById("nationalPowerBack");
  const preview = document.getElementById("nationalPowerPreview");
  let factionId = null; let confirmation = null;
  /** @returns {string} 確認中の相手・資格・資産変更を検出する。 */
  function signature() { return JSON.stringify([getContext().nobleId, donationFaction(getContext), state.funds, state.nationalPower]); }
  /** @returns {void} 入力中の予告を再計算する。 */
  function update() {
    const quote = quoteNationalPowerDonation(state.nationalPower, factionId, state.funds, Number(input.value));
    input.disabled = !!confirmation; back.hidden = !confirmation;
    submit.disabled = !!quote.error;
    submit.textContent = confirmation ? "軍資金を提供する" : "提供内容を確認";
    const max = quote.maxAmount || 0;
    input.max = String(max);
    preview.textContent = quote.error ? `${quote.error} 提供可能額：${number(max, 0)}資金まで。` : `所持資金 ${number(state.funds, 0)} → ${number(state.funds - quote.amount, 0)}\n国力 ${number(quote.before, 3)} → ${number(quote.after, 3)}（＋${number(quote.delta, 3)}）${confirmation ? "\nこの内容で軍資金を提供します。" : ""}`;
  }
  /** @returns {void} 提供画面を閉じて操作元へ戻す。 */
  function close() { modal.hidden = true; confirmation = null; document.getElementById("nationalPowerDonate").focus(); }
  document.getElementById("nationalPowerDonate").onclick = () => {
    factionId = donationFaction(getContext);
    if (!factionId) return;
    confirmation = null; input.value = "";
    document.getElementById("nationalPowerRecipient").textContent = `${FACTIONS.find(f => f.id === factionId).name}への軍資金提供`;
    document.getElementById("nationalPowerRate").textContent = `${number(CONFIG.donationFundsPerPoint, 0)}資金で国力＋1。日数は消費しません。`;
    modal.hidden = false; update(); input.focus();
  };
  input.oninput = update;
  back.onclick = () => { confirmation = null; update(); input.focus(); };
  document.getElementById("nationalPowerClose").onclick = close;
  modal.onclick = event => { if (event.target === modal) close(); };
  modal.onkeydown = event => { if (event.key === "Escape") close(); };
  submit.onclick = () => {
    if (modal.hidden) return;
    const amount = Number(input.value);
    const quote = quoteNationalPowerDonation(state.nationalPower, factionId, state.funds, amount);
    if (donationFaction(getContext) !== factionId || quote.error) { confirmation = null; update(); pushToast("提供できません", "資格と提供可能額を確認してください。", "warn"); return; }
    if (!confirmation) { confirmation = { signature: signature(), amount }; update(); return; }
    if (confirmation.signature !== signature() || confirmation.amount !== amount) { confirmation = null; update(); pushToast("再確認してください", "状況が変わったため予告を更新しました。", "warn"); return; }
    confirmation = null;
    const before = { funds: state.funds, power: structuredClone(state.nationalPower) };
    state.funds -= amount;
    const actual = changeNationalPower(state.nationalPower, factionId, quote.delta);
    if (!saveGameToStorage()) {
      state.funds = before.funds; state.nationalPower = before.power; update();
      pushToast("保存できません", "軍資金提供を取り消しました。", "warn"); return;
    }
    const text = `${FACTIONS.find(f => f.id === factionId).name} / 資金−${number(amount, 0)} / 国力＋${number(actual, 3)}`;
    close(); pushLog("軍資金提供", text, "-"); pushToast("軍資金を提供しました", text, "good"); syncUI();
  };
}
