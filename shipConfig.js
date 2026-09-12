export const SHIP_SELL_RATE = 0.8;
export const SHIP_REWARD_WEIGHT_EXPONENT = 1;
export const SHIP_TYPES = Object.freeze({
  caravel: { name: "キャラベル", price: 4000, supplies: 35, troops: 10, limit: 5, effects: { upkeepReduction: 2 } },
  knarr: { name: "クナール", price: 4500, supplies: 45, troops: 10, limit: 5, effects: { supplyCap: 2 } },
  longship: { name: "ロングシップ", price: 5000, supplies: 30, troops: 15, limit: 5, effects: { atk: 2 } },
  cog: { name: "コグ", price: 5500, supplies: 75, troops: 10, limit: 0, effects: {} },
  galley: { name: "ガレー", price: 6000, supplies: 25, troops: 25, limit: 4, effects: { troopCap: 2.5 } },
  carrack: { name: "キャラック", price: 10000, supplies: 90, troops: 30, limit: 0, effects: {} },
  galleass: { name: "ガレアス", price: 12000, supplies: 55, troops: 35, limit: 2, effects: { supportPower: 10, cannonReduction: 1 } },
  galleon: { name: "ガレオン", price: 15000, supplies: 80, troops: 35, limit: 2, effects: { def: 5 } },
});
for (const ship of Object.values(SHIP_TYPES)) { Object.freeze(ship.effects); Object.freeze(ship); }
export const SHIP_STOCK_TIERS = Object.freeze([
  { types: ["caravel", "knarr", "longship", "cog"], slots: 2, min: 2, max: 3 },
  { types: ["galley", "carrack"], slots: 1, min: 1, max: 2 },
  { types: ["galleass", "galleon"], slots: 1, min: 1, max: 1 },
]);
