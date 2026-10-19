import { statNumber } from "../core/voyageStats.js";
import { DAY_PER_YEAR, DAY_PER_SEASON } from "../core/calendar.js";

/** 絶対日を表示用の暦へ変換する。 @param {number} day 絶対日。 @returns {string} 日付。 */
export function dateText(day) {
  const value = Math.max(1, statNumber(day)) - 1;
  return `神歴${Math.floor(value / DAY_PER_YEAR)}年 ${["春", "夏", "秋", "冬"][Math.floor(value % DAY_PER_YEAR / DAY_PER_SEASON)]} ${value % DAY_PER_SEASON + 1}日`;
}

/** 統計の数値を桁区切りにする。 @param {*} value 数値。 @returns {string} 表示値。 */
function number(value) { return statNumber(value).toLocaleString("ja-JP"); }

/** 画面と出力で共用する統計の分類・表示値を作る。 @param {object} stats 統計。 @returns {Array} 分類と項目。 */
export function voyageStatisticGroups(stats) {
  /** 原因別の数値を安全な整数の上限内で合算する。 @param {object} values 内訳。 @returns {number} 合計。 */
  const sum = values => Object.values(values || {}).reduce((n, value) => Math.min(Number.MAX_SAFE_INTEGER, n + statNumber(value)), 0);
  const groups = [
    ["旅と戦い", [
      ["航海期間", `${number(Math.floor(stats.elapsed / DAY_PER_YEAR))}年 ${number(stats.elapsed % DAY_PER_YEAR)}日`],
      ["訪問拠点", `村 ${number(stats.visitCounts?.village)} / 街 ${number(stats.visitCounts?.town)} / 無法港 ${number(stats.visitCounts?.haven)}`],
      ["海図の達成数", `${number(stats.chartsCompleted)}件（報酬回収済み）`],
      ["戦闘", `勝利 ${number(stats.battles?.win)} / 敗北 ${number(stats.battles?.lose)} / 引き分け ${number(stats.battles?.draw)}`],
      ["撃破した敵兵", `${number(stats.enemyDefeated)}人（戦闘不能）`],
      ["累計兵士損耗", `${number(sum(stats.losses))}人`],
      ["損耗の内訳", `戦闘 ${number(stats.losses?.battle)} / 食料不足 ${number(stats.losses?.food)} / 維持費不足 ${number(stats.losses?.upkeep)} / 災い ${number(stats.losses?.calamity)} / その他 ${number(stats.losses?.other)}`],
      ["賞金首討伐", `${number(stats.bountiesDefeated)}件`],
    ]],
    ["資産", [
      ["累計収入", number(stats.income)], ["累計支出", number(sum(stats.expenses))],
      ["支出の内訳", `取引 ${number(stats.expenses?.trade)} / 雇用 ${number(stats.expenses?.hire)} / 維持費 ${number(stats.expenses?.upkeep)} / 支援 ${number(stats.expenses?.support)} / その他 ${number(stats.expenses?.other)}`],
      ["累計手配賞金", number(stats.wantedEarned)], ["累計獲得信仰", number(stats.faithEarned)],
      ["固有船", `累計獲得 ${number(stats.variantsAcquired)}隻 / 記録時の保有 ${number(stats.variantsOwned)}隻`],
      ["最高規模", `船団 ${number(stats.peaks?.ships)}隻 / 部隊 ${number(stats.peaks?.troops)}人 / 名声 ${number(stats.peaks?.fame)}`],
    ]],
    ["人々への支援", [
      ["救助した難民", `${number(stats.refugeesRescued)}人`], ["潮盟へ送り出した担い手", `${number(stats.tidePeople)}人`], ["潮盟への資金支援", number(stats.tideFunds)],
    ]],
    ["釣り", [
      ["魚図鑑", `${number(stats.fishSpecies)} / ${number(stats.fishTotal)}種（${stats.fishTotal ? Math.floor(stats.fishSpecies / stats.fishTotal * 100) : 0}%）`],
      ["釣り上げた魚", `${number(stats.fishCaught)}匹`],
      ["最大の魚", stats.largestFish ? `${stats.largestFish.name} ${stats.largestFish.size}cm / ${dateText(stats.largestFish.day)}` : "まだ記録がありません"],
    ]],
  ];
  return groups;
}

/** 途中から計測した統計の注記を作る。 @param {object} stats 統計。 @returns {string} 注記。 */
export function voyageMeasurementNote(stats) {
  return stats.partial ? `累計・最高値・訪問記録は${dateText(stats.measuredAbs)}から計測しています。図鑑と航海期間は引き継いでいます。` : "";
}

/** 文字列が装飾・リンク・メンションとして解釈されないようにする。 @param {*} value 表示値。 @returns {string} Markdown用文字列。 */
function escapeMarkdown(value) {
  return String(value).replace(/([\\`*_{}[\]()<>#+\-.!|~])/g, "\\$1").replace(/@/g, "@\u200b");
}

/** 神話と表示中の統計を、引用と箇条書き中心のMarkdownへ整形する。 @param {object} ending 神話。 @param {object} record 初回記録。 @param {object} stats 出力する統計。 @param {boolean} currentStats 現在の統計か。 @returns {string} BOMなしの本文。 */
export function formatVoyageMarkdown(ending, record, stats, currentStats = false) {
  const lines = [
    `# 潮語り — 最終航海・${escapeMarkdown(ending.name)}`,
    "",
    `神話の記録日：${dateText(record.day)}`,
    "",
    ...escapeMarkdown(ending.body).split(/\r?\n/).map(line => `> ${line}`),
    "",
    `## ${currentStats ? "現在の航海" : "この神話を記録した時点の航海統計"}`,
    "",
    `統計の日付：${dateText(stats.day)}`,
    "",
  ];
  const note = voyageMeasurementNote(stats);
  if (note) lines.push(note, "");
  for (const [title, rows] of voyageStatisticGroups(stats)) {
    lines.push(`### ${title}`, "", ...rows.map(([label, value]) => `- **${label}**：${escapeMarkdown(value)}`), "");
  }
  return lines.join("\n");
}
