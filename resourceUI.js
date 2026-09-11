import { escapeHtml } from "./util.js";

const ICONS = {
  chart: "chart",
  ships: "ship", funds: "funds", faith: "faith", fame: "fame", supplies: "supplies", troops: "troops",
  food: "food", wood: "wood", stone: "stone", iron: "iron", fiber: "fiber", salt: "salt",
  spice: "spice", arms: "arms", textile: "textile", brew: "brew", leather: "leather",
};
const TROOP_IDS = ["infantry", "halberd", "medic", "marine", "archer", "scout", "cavalry", "cavalier", "crossbow", "shield", "seaArcher"];

/**
 * 内部IDに対応する装飾アイコンを返す。未知IDのURLは生成しない。
 * @param {string} id
 * @returns {string}
 */
export function resourceIcon(id) {
  const src = Object.hasOwn(ICONS, id) ? `./image/ui/${ICONS[id]}.svg`
    : TROOP_IDS.includes(id) ? `./image/troops/${id}.gif` : null;
  return src ? `<img class="resource-icon" src="${src}" alt="" aria-hidden="true">` : "";
}

/**
 * 名称と数量をアイコン付きで表示する。表示テキストは必ずエスケープする。
 * @param {{id:string,label:string,value?:string|number}} resource
 * @returns {string}
 */
export function resourceToken({ id, label, value = "" }) {
  return `<span class="resource-token">${resourceIcon(id)}<span>${escapeHtml(label)}${value !== "" ? ` <b>${escapeHtml(String(value))}</b>` : ""}</span></span>`;
}

/**
 * 構造化された報酬・条件を折り返せる一覧として表示する。
 * @param {Array} resources
 * @returns {string}
 */
export function resourceList(resources = []) {
  return `<div class="resource-list">${resources.map(resourceToken).join("")}</div>`;
}

/**
 * 戦果の1行を表示する。保存用の本文にHTMLやアイコンを混ぜない。
 * @param {string|{text:string,icon?:string,resources?:Array,label?:string}} line
 * @returns {string}
 */
export function renderReportLine(line) {
  if (typeof line === "string") return escapeHtml(line).replace(/\n/g, "<br>");
  if (line.resources) return `${escapeHtml(line.label || "")}${resourceList(line.resources)}`;
  return `${resourceIcon(line.icon)}${escapeHtml(line.text).replace(/\n/g, "<br>")}`;
}

/**
 * ログ・出力欄向けに装飾前の本文を取得する。
 * @param {string|{text:string}} line
 * @returns {string}
 */
export function reportLineText(line) {
  return typeof line === "string" ? line : line.text;
}
