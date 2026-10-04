/** 危険海域の表示名と、滞在日数に応じた日次危険率。 */
export const DANGEROUS_SEAS = Object.freeze({
  sw: { name: "南西・嵐の船墓場", flavor: "荒い潮流の向こうに、沈んだ船団の影が見える。" },
  se: { name: "南東・霧の深淵", flavor: "深い霧の中から、名も知らぬ魚と船影が現れる。" },
});

/** 警戒度による日次襲撃率。荒波は独立した天候周期を使用する。 */
export const DANGEROUS_HAZARD_RATES = Object.freeze([
  { max: 2, raid: 0.05 },
  { max: 5, raid: 0.10 },
  { max: 8, raid: 0.18 },
  { max: 12, raid: 0.25 },
]);

/** @param {string} regionId 海域ID。 @returns {string} 表示名。 */
export function dangerousSeaName(regionId) { return DANGEROUS_SEAS[regionId]?.name || "危険海域"; }
