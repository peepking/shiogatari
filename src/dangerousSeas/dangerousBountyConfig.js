/** 危険海域の賞金首は通常の十人枠と独立し、各海域二人まで配置する。 */
export const DANGEROUS_BOUNTY_CONFIG = Object.freeze({ perRegion: 2, lifetime: 600, historyLimit: 100, ownFavor: -3, otherFavor: 1 });

/** 人数は十人部隊へ分割し、名声に依存しない固定編成と賞金を保存する。 */
export const DANGEROUS_BOUNTY_TEMPLATES = [
  { id: "danger_ironwake", epithet: "鉄波の", regions: ["sw"], level: 4, reward: 34000, troops: { pirate_shield: 50, pirate_spear: 40, pirate_archer: 50 }, description: "荒潮に盾を連ね、航路を塞ぐ船長。" },
  { id: "danger_saltbone", epithet: "塩骨の", regions: ["sw"], level: 4, reward: 36000, troops: { pirate_shield: 60, pirate_spear: 50, pirate_axe: 40 }, description: "難破船の積荷を集め、厚い戦列で守る船長。" },
  { id: "danger_splitmast", epithet: "裂帆の", regions: ["sw"], level: 4, reward: 38000, troops: { pirate_axe: 80, pirate_shield: 40, pirate_archer: 40 }, description: "折れたマストを旗印に、斧兵を率いる船長。" },
  { id: "danger_greyhold", epithet: "灰船倉の", regions: ["sw"], level: 4, reward: 40000, troops: { pirate_shield: 80, pirate_spear: 50, pirate_archer: 40 }, description: "船倉の財宝を堅い盾の船団で囲う船長。" },
  { id: "danger_falsebeacon", epithet: "偽灯の", regions: ["se"], level: 4, reward: 42000, troops: { marine: 70, seaArcher: 70, pirate_shield: 40 }, description: "霧中の灯火で船を誘い、海兵と射手で挟み撃ちする船長。" },
  { id: "danger_hollowmist", epithet: "虚霧の", regions: ["se"], level: 5, reward: 44000, troops: { seaArcher: 80, pirate_spear: 60, pirate_shield: 40 }, description: "霧の奥から熟練の射手を差し向ける船長。" },
  { id: "danger_nightsurge", epithet: "夜潮の", regions: ["se"], level: 5, reward: 46000, troops: { pirate_assault: 80, marine: 60, pirate_archer: 50 }, description: "夜の潮に紛れ、突撃兵と海兵で甲板を奪う船長。" },
  { id: "danger_silentreef", epithet: "黙礁の", regions: ["se"], level: 5, reward: 49000, troops: { pirate_shield: 60, pirate_spear: 60, seaArcher: 80 }, description: "沈黙する礁の陰で精鋭の戦列を構える船長。" },
  { id: "danger_outercrown", epithet: "外洋冠の", regions: ["sw", "se"], level: 5, reward: 52000, troops: { pirate_shield: 50, pirate_spear: 50, pirate_axe: 40, pirate_archer: 60 }, description: "二つの危険海域を渡る最大規模の海賊船団の長。" },
];
for (const template of DANGEROUS_BOUNTY_TEMPLATES) {
  Object.freeze(template.regions); Object.freeze(template.troops); Object.freeze(template);
}
Object.freeze(DANGEROUS_BOUNTY_TEMPLATES);
