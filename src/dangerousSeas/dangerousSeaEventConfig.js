/** 海域限定の出来事の初期調整値。各海域の一枠は途中選択・戦闘・結果確認中も占有する。 */
export const DANGEROUS_SEA_EVENT_CONFIG = Object.freeze({ dailyChance: 0.05, marginDays: 10, migrationMultiplier: 2 });

/** 斥候の実効人数による発見距離と事故率。人数上限は十人、ゼロ人でも現地で参加できる。 */
export const DANGEROUS_EVENT_SCOUT_RULES = Object.freeze([
  { min: 10, radius: 5, accidentMultiplier: 0.3 },
  { min: 5, radius: 3, accidentMultiplier: 0.6 },
  { min: 1, radius: 1, accidentMultiplier: 0.85 },
  { min: 0, radius: 0, accidentMultiplier: 1 },
]);

/** 種類ごとの適性、所要日数、事故の基本確率と排他的な固定報酬。新魚種・新兵種は追加しない。 */
export const DANGEROUS_SEA_EVENT_DEFS = Object.freeze({
  storm_aftermath: { name: "嵐の置き土産", regions: ["sw", "se"], days: 1, accident: 0.1,
    choices: { recover: "漂着した積荷を回収する" },
    rewards: { recover: { funds: 1800, supplies: { wood: 4, fiber: 3, salt: 2 }, troops: {} } } },
  fog_light: { name: "霧中の灯火", regions: ["sw", "se"], days: 1, accident: 0.1,
    choices: { investigate: "灯火へ近づく" },
    rewards: {
      rescue: { funds: 500, supplies: {}, troops: { marine: 3, medic: 1 } },
      trap: { funds: 2400, supplies: { iron: 3 }, troops: {} },
      empty: { funds: 1500, supplies: { wood: 3, fiber: 2 }, troops: {} },
    } },
  fish_migration: { name: "巨大魚の回遊", regions: ["sw", "se"], days: 1, accident: 0, choices: {}, rewards: {} },
  sinking_treasure: { name: "沈みかけた宝船", regions: ["sw", "se"], days: 1, accident: 0.2,
    choices: { cargo: "積荷を優先する", rescue: "乗員の救助を優先する" },
    rewards: { cargo: { funds: 3000, supplies: { spice: 4, textile: 3 }, troops: {} },
      rescue: { funds: 300, supplies: {}, troops: { marine: 4, scout: 2 } } } },
  seabed_bell: { name: "海底からの鐘", regions: ["se"], days: 3, accident: 0.15,
    choices: { listen: "鐘の音を聞き分ける", descend: "沈んだ聖堂を調べる", answer: "鐘へ応える" },
    rewards: { listen: { funds: 0, supplies: {}, troops: {} }, descend: { funds: 0, supplies: {}, troops: {} },
      answer: { funds: 2200, supplies: { salt: 4, spice: 2 }, troops: {} } } },
});

/** 実効斥候人数から保存に使う段階を返す。 @param {number} scouts 実効人数。 @returns {object} 段階の効果。 */
export function dangerousEventScoutRules(scouts = 0) {
  return DANGEROUS_EVENT_SCOUT_RULES.find(rule => Math.min(10, Math.max(0, scouts)) >= rule.min);
}
