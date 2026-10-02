/** 物語の調整値。噂の確率は既存海図と独立して一か所で変更する。 */
export const PIRATE_KING_CONFIG = Object.freeze({ rumorChance: 0.10, fameThreshold: 1000, rumorDistance: [10, 15] });

/** 人数を10人ずつ、指定兵種の順に分割する。抽選は使わず再挑戦でも同じ敵を作る。
 * @param {object} counts 兵種別人数。 @param {number} level レベル。 @returns {Array} 固定編成。
 */
export function storyFormation(counts, level) {
  return Object.entries(counts).flatMap(([type, count]) => Array.from({ length: count / 10 }, () => ({ type, count: 10, level })));
}

export const PIRATE_LORDS = Object.freeze([
  { id: "bjorn", name: "豪勇のビョルン", variantId: "story_bjorn", level: 4,
    troops: { pirate_axe: 100, pirate_shield: 20, pirate_spear: 20, pirate_archer: 20, pirate_assault: 20, raider_cavalry: 20 },
    rumor: "海賊五列強と呼ばれる六人の船長を知っているか。豪勇のビョルンの斧は、船縁ごと敵を割るという。長い船影が、沖に現れたそうだ。" },
  { id: "erik", name: "赤毛のエイリク", variantId: "story_erik", level: 4,
    troops: { pirate_archer: 100, pirate_shield: 20, pirate_spear: 20, pirate_axe: 20, pirate_assault: 20, raider_cavalry: 20 },
    rumor: "赤毛のエイリクの帆を見た者がいる。近づく船には矢が雨のように降り、逃げる船にもその赤い髪が見えるという。" },
  { id: "ivar", name: "骨無しのイーヴァル", variantId: "story_ivar", level: 4,
    troops: { pirate_spear: 100, pirate_shield: 20, pirate_archer: 20, pirate_axe: 20, pirate_assault: 20, raider_cavalry: 20 },
    rumor: "骨無しのイーヴァルは、自ら槍を振るうより先に、敵の退路を塞ぐそうだ。荷船のような船腹に、幾重もの槍が隠れている。" },
  { id: "ragnar", name: "強襲のラグナル", variantId: "story_ragnar", level: 4,
    troops: { pirate_assault: 100, pirate_shield: 20, pirate_spear: 20, pirate_archer: 20, pirate_axe: 20, raider_cavalry: 20 },
    rumor: "強襲のラグナルが潮を待っている。大きな船が横付けしたときには、もう甲板にその兵が立っているという。" },
  { id: "sigvard", name: "蛇の目のシーヴァルド", variantId: "story_sigvard", level: 4,
    troops: { raider_cavalry: 100, pirate_shield: 20, pirate_spear: 20, pirate_archer: 20, pirate_axe: 20, pirate_assault: 20 },
    rumor: "蛇の目のシーヴァルドの船を見た、と船乗りが声を潜めた。逃げ道を探すほど、その目に見透かされるらしい。" },
  { id: "thorkell", name: "巨躯のトルケル", variantId: "story_thorkell", level: 4,
    troops: { pirate_spear: 80, pirate_shield: 80, pirate_archer: 20, pirate_assault: 20 },
    rumor: "巨躯のトルケルが動いた。盾と槍を連ねた船団の奥に、ひときわ高い影がある。あの男が守るものを知って、戻った者はいない。" },
].map(Object.freeze));

export const PIRATE_KING = Object.freeze({ id: "olav", name: "海賊王オーラヴ", level: 4, finalLevel: 5,
  troops: { pirate_shield: 40, pirate_spear: 40, pirate_axe: 40, pirate_archer: 30, pirate_assault: 30, raider_cavalry: 20 },
  finalTroops: { cavalier: 30, raider_cavalry: 30, pirate_spear: 40, crossbow: 40, pirate_shield: 30, pirate_assault: 30 },
  reserves: { raider_cavalry: 80, cavalier: 20 } });

/** @param {string} id 物語の対象ID。 @returns {object|undefined} 対象の定義。 */
export function pirateStoryTarget(id) { return id === PIRATE_KING.id ? PIRATE_KING : PIRATE_LORDS.find(lord => lord.id === id); }
