/**
 * 定義を再帰的に固定し、表示や処理から設定値を書き換えないようにする。
 * @param {object} value 定義。
 * @returns {object} 固定した定義。
 */
function freezeDefinition(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") freezeDefinition(child);
  }
  return Object.freeze(value);
}

/** 自然探索の初期調整値。確率は1日ごと、報酬は名声等で拡大しない。 */
export const EXPLORATION_CONFIG = freezeDefinition({
  commonLimit: 5,
  wreckLimit: 2,
  lifetimeDays: 120,
  commonDailyChance: 3 / 60,
  wreckDailyChance: 1 / 60,
  landChance: 0.5,
  initialCounts: { drift: 1, battlefield: 1, wreck: 1 },
  dangerLevels: [0, 0.25, 0.5, 0.75, 1],
  exploreDays: 1,
  commonReward: { funds: [450, 550], goods: [2, 4], kinds: 2 },
  wreckReward: { funds: [900, 1100], goods: [4, 8], kinds: 2, troops: [3, 5], level: 1, shipChance: 0.2, ships: 1 },
});

/** 海図の初期調整値。危険度・海図種別・サイズの抽選は候補内で均等。 */
export const CHART_CONFIG = freezeDefinition({
  sizes: [3, 5],
  battleFragmentChance: 0.005,
  questFragmentChance: 0.03,
  rumorChance: 0.05,
  explorationFragmentChance: { drift: 0.05, battlefield: 0.05, wreck: 0.1 },
  merchants: {
    sailor: { chance: 0.01, price: 1000, success: 0.25 },
    archivist: { chance: 0.1, price: 2000, success: 0.5 },
  },
  rumorDistance: [10, 15],
  destinationDistance: [10, 20],
  exploreDays: 1,
  fame: { 3: [9, 11], 5: [18, 22] },
  rewards: {
    altar: { name: "古い祭壇", 3: { faith: [90, 110] }, 5: { faith: [180, 220] } },
    inlet: { name: "隠れた入り江", 3: { goods: 100, ships: 2 }, 5: { goods: 200, ships: 4 } },
    treasure: { name: "財宝の隠し場所", 3: { funds: 25000 }, 5: { funds: 50000 } },
  },
});

/** 装備枠は船団で共有し、初期1枠・最大5枠。 */
export const OUTFITTING_CONFIG = freezeDefinition({ initialSlots: 1, maxSlots: 5, unlockPrices: { 2: 5000, 3: 10000, 4: 15000, 5: 20000 }, supportLimit: 10 });

/** 艤装定義。効果の割合は百分率の整数で保持し、計算時に一度だけ除算する。 */
export const OUTFITTING_ITEMS = freezeDefinition({
  harpoon: { name: "モリ投擲", category: "attack", price: 5000, attack: { interval: 5, power: 30 } },
  ballista: { name: "バリスタ", category: "attack", price: 15000, attack: { interval: 10, power: 100 } },
  fire_ballista: { name: "ファイヤバリスタ", category: "attack", price: 15000, attack: { interval: 15, power: 150 } },
  grape_ballista: { name: "ブドウ弾バリスタ", category: "attack", price: 15000, attack: { interval: 6, power: 30, allEnemies: true } },
  fire_grape_ballista: { name: "火炎ブドウ弾バリスタ", category: "attack", price: 15000, attack: { interval: 12, power: 60, allEnemies: true } },
  cannon: { name: "砲撃支援", category: "attack", price: 25000, attack: { interval: 20, power: 250 } },
  iron_coating: { name: "鉄の被膜", category: "buff", price: 15000, effects: { def: 5 } },
  round_shields: { name: "舷の丸盾", category: "buff", price: 15000, effects: { meleeDef: 10 } },
  canopy: { name: "天蓋", category: "buff", price: 15000, effects: { rangedDef: 10 } },
  brazier: { name: "火鉢", category: "buff", price: 15000, effects: { atk: 5 } },
  ram: { name: "衝角", category: "buff", price: 15000, effects: { meleeAtk: 10 } },
  arrow_box: { name: "矢の箱", category: "buff", price: 15000, effects: { rangedAtk: 10 } },
  cargo_tent: { name: "貨物テント", category: "logistics", price: 5000, effects: { supplyCap: 20 } },
  bulwark: { name: "胸壁", category: "logistics", price: 5000, effects: { troopCap: 20 } },
  expanded_hold: { name: "拡張船倉", category: "logistics", price: 5000, effects: { supplyCap: 10, troopCap: 10 } },
  deck_tent: { name: "甲板のテント", category: "logistics", price: 5000, effects: { foodReduction: 10 } },
  storm_cover: { name: "嵐対策用の覆い", category: "logistics", price: 5000, effects: { upkeepReduction: 10 } },
  shipwright: { name: "船大工の設備", category: "logistics", price: 5000, effects: { shipUpkeepReduction: 10 } },
  lifesaving: { name: "救命設備", category: "logistics", price: 10000, effects: { medics: 5 } },
  lookout: { name: "見張り台", category: "logistics", price: 10000, effects: { scouts: 5 } },
});
