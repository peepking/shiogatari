/** 賞金首・犯罪の調整値。増援戦の設定とは独立させる。 */
export const BOUNTY_CONFIG = Object.freeze({ count: 10, lifetime: 600, historyLimit: 100, perTroop: 100, base: 100, multiplier: 1.5, ownFavor: -3, otherFavor: 1 });
/** 犯罪は選択成立時、海賊依頼だけは達成時に加算する。 */
export const CRIME_REWARDS = Object.freeze({ merchant_attack: 1000, merchant_rescue_raid: 1000, refugee_raid: 1500, checkpoint_force: 2000, pirate_checkpoint: 2000, pirate_quest: 500 });
/** 犯罪歴は直近50件を保存し、手配解除後も過去の記録として保持する。 */
export const CRIME_HISTORY_LIMIT = 50;
/** 犯罪の表示名。判定には内部IDを使用する。 */
export const CRIME_LABELS = Object.freeze({ merchant_attack: "商人襲撃", merchant_rescue_raid: "商人襲撃", refugee_raid: "難民襲撃", checkpoint_force: "検問強行突破", pirate_checkpoint: "検問強行突破", pirate_quest: "海賊依頼への加担" });
/** 修飾詞・所属・編成の固定テンプレート。行の人数は10人部隊の数。 */
export const BOUNTY_TEMPLATES = [
  { id: "red_sail", epithet: "赤帆の", factionId: "pirates", level: 2, troops: { pirate_spear: 3, pirate_archer: 2 }, description: "小船団を率いる沿岸の略奪者。" },
  { id: "mist", epithet: "霧渡りの", factionId: "archipelago", level: 2, troops: { marine: 4, archer: 3 }, description: "島陰から船を襲う私掠船長。" },
  { id: "chain", epithet: "鉄鎖の", factionId: "citadel", level: 3, troops: { shield: 4, crossbow: 2, infantry: 2 }, description: "拿捕船を鎖でつなぐ徴税官崩れ。" },
  { id: "wolf", epithet: "白狼の", factionId: "north", level: 3, troops: { pirate_axe: 4, halberd: 3, archer: 3 }, description: "護送船を狙う北方の武人。" },
  { id: "shark", epithet: "黒鮫の", factionId: "pirates", level: 3, troops: { pirate_assault: 5, pirate_shield: 4, pirate_archer: 3 }, description: "接近戦で押し切る強襲船団。", ship: "longship", flagship: "黒鮫号" },
  { id: "lamp", epithet: "青灯の", factionId: "archipelago", level: 4, troops: { seaArcher: 6, marine: 4, shield: 4 }, description: "偽の灯火へ船を誘う射手隊。" },
  { id: "crown", epithet: "灰冠の", factionId: "citadel", level: 5, troops: { cavalier: 4, shield: 2, crossbow: 2 }, description: "少数の熟練兵を抱える追放騎士。" },
  { id: "fang", epithet: "冬牙の", factionId: "north", level: 4, troops: { halberd: 6, pirate_axe: 6, crossbow: 4 }, description: "航路を封じる厚い戦列。" },
  { id: "devourer", epithet: "海喰らいの", factionId: "pirates", level: 4, troops: { pirate_shield: 6, pirate_axe: 6, pirate_archer: 6 }, description: "持久戦を得意とする大船団。", ship: "carrack", flagship: "海喰らい号" },
  { id: "tide", epithet: "断潮の", factionId: "north", level: 5, troops: { cavalier: 5, halberd: 5, shield: 5, crossbow: 5 }, description: "兵種を組み合わせた最大規模の強敵。" },
];
