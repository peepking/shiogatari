/** 海賊システムの調整値。 */
export const PIRATE_CONFIG = {
  ports: 10, nobleId: "pirate_blackbeard", favorDelta: 3,
  wantedFavor: 30, wantedNobleFavor: -20, wantedChance: 0.3, bountyChance: 0.15,
  recordDays: 30, inspectionChance: 0.5, bribeBase: 200, bribePerItem: 10,
  bribeBaseChance: 0.4, bribeFameScale: 2000, bribeTroopScale: 1000, bribeItemPenalty: 0.005,
  bribeMin: 0.2, bribeMax: 0.8, bribeFailureFavor: -3, recordPenalty: -3,
  minScale: 0.5, maxScale: 1.5, raidScale: 1.25, raidRewardScale: 1.5,
  minimum: { normal: 3, elite: 30, bounty: 20, regular: 40 },
  contrabandStock: 12, demandLow: [1,3], demandHigh: [8,10],
};

/** 内部兵種IDと提供済み画像名の対応。 */
export const PIRATE_IMAGES = {
  pirate_shield: "p_shield", pirate_spear: "p_spear", pirate_archer: "p_archer",
  raider_cavalry: "p_cavalry", pirate_axe: "p_axe", pirate_assault: "p_stormtrooper",
};

/** 禁制品は通常の加工品抽選と分離する。 */
export const CONTRABAND = [
  { id: "illegal_drug", name: "違法薬物", type: "contraband", basePrice: 100 },
  { id: "illicit_brew", name: "密造酒", type: "contraband", basePrice: 100 },
  { id: "stolen_arms", name: "盗品武具", type: "contraband", basePrice: 150 },
  { id: "stolen_craft", name: "盗品工芸品", type: "contraband", basePrice: 200 },
];

/** @param {string} id 兵種ID。 @returns {string} 既存画像または提供済みの海賊画像のパス。 */
export function troopImage(id) { return `image/troops/${PIRATE_IMAGES[id] || id}.gif`; }

/**
 * 名声から得た範囲の中央値へ一様な倍率を掛け、最低人数と200人上限を適用する。
 * @param {{min:number,max:number}} range 基礎範囲。 @param {string} kind 敵種別。
 * @param {number} scale 依頼の規模倍率。 @param {Function} random 乱数源。 @returns {number} 実際の人数。
 */
export function pirateEnemyCount(range, kind, scale = 1, random = Math.random) {
  const base = (range.min + range.max) / 2;
  return Math.min(200, Math.max(PIRATE_CONFIG.minimum[kind] || 3,
    Math.round(base * scale * (PIRATE_CONFIG.minScale + random() * (PIRATE_CONFIG.maxScale - PIRATE_CONFIG.minScale)))));
}
