/** ユニットに合わせた地図専用のドット絵原画の大きさ。 */
export const PIXEL_SPRITE_ATLAS_SIZE = [1024, 1536];

/** 危険海域の出来事用ドット絵原画の大きさ。 */
export const PIXEL_EVENT_ATLAS_SIZE = [2172, 724];

/** 中世北欧風の陸の一行を描いた、単独の透過原画の大きさ。 */
export const PIXEL_PARTY_ATLAS_SIZE = [1254, 1254];

/** 顔・兜・丸盾・足元を含む一行の輪郭を測り、透明な余白を除いた範囲。 */
export const PIXEL_PARTY_SPRITE = [111, 251, 1047, 889];

/** 透明な余白と隣接図柄を除き、各図柄の輪郭から実測した範囲。 */
export const PIXEL_SPRITES = {
  town: [16, 31, 224, 193],
  village: [272, 43, 224, 170],
  pirateHarbor: [528, 25, 224, 205],
  ship: [784, 17, 224, 222],
  party: [16, 289, 224, 190],
  inlet: [272, 287, 224, 194],
  shield: [552, 272, 175, 224],
  wreck: [784, 290, 224, 188],
  crate: [20, 569, 215, 142],
  battlefield: [280, 528, 207, 224],
  rumor: [528, 535, 224, 210],
  altar: [784, 532, 224, 216],
  treasure: [34, 818, 187, 156],
  bounty: [296, 792, 176, 207],
  pirateLord: [542, 797, 195, 197],
  pirateKing: [804, 786, 184, 219],
  fish: [33, 1054, 190, 195],
  bell: [275, 1040, 217, 224],
  event: [553, 1063, 173, 177],
  star: [799, 1056, 194, 192],
  forest: [16, 1301, 224, 214],
  mountain: [272, 1321, 224, 174],
  forestAlt: [528, 1305, 224, 206],
  mountainAlt: [784, 1345, 224, 126],
};

/** 三列一段の出来事原画から、それぞれの図柄だけを切り出す範囲。 */
export const PIXEL_EVENT_SPRITES = {
  storm: [77, 146, 570, 431],
  lantern: [776, 38, 620, 648],
  sinkingShip: [1486, 66, 648, 591],
};
