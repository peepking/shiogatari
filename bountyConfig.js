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
  { id: "shark", epithet: "黒鮫の", factionId: "pirates", level: 3, troops: { pirate_assault: 5, pirate_shield: 4, pirate_archer: 3 }, description: "接近戦で押し切る強襲船団。" },
  { id: "lamp", epithet: "青灯の", factionId: "archipelago", level: 4, troops: { seaArcher: 6, marine: 4, shield: 4 }, description: "偽の灯火へ船を誘う射手隊。" },
  { id: "crown", epithet: "灰冠の", factionId: "citadel", level: 5, troops: { cavalier: 4, shield: 2, crossbow: 2 }, description: "少数の熟練兵を抱える追放騎士。" },
  { id: "fang", epithet: "冬牙の", factionId: "north", level: 4, troops: { halberd: 6, pirate_axe: 6, crossbow: 4 }, description: "航路を封じる厚い戦列。" },
  { id: "devourer", epithet: "海喰らいの", factionId: "pirates", level: 4, troops: { pirate_shield: 6, pirate_axe: 6, pirate_archer: 6 }, description: "持久戦を得意とする大船団。" },
  { id: "tide", epithet: "断潮の", factionId: "north", level: 5, troops: { cavalier: 5, halberd: 5, shield: 5, crossbow: 5 }, description: "兵種を組み合わせた最大規模の強敵。" },
  {"id":"gull","epithet":"潮鴎の","factionId":"pirates","level":2,"troops":{"pirate_spear":2,"pirate_archer":2},"description":"浅瀬で小舟を待ち伏せる船長。"},
  {"id":"reed","epithet":"葦笛の","factionId":"archipelago","level":2,"troops":{"marine":3,"archer":3},"description":"葦笛を合図に襲いかかる密航者。"},
  {"id":"amber","epithet":"琥珀の","factionId":"north","level":2,"troops":{"infantry":4,"archer":3},"description":"琥珀の積荷を狙う交易路荒らし。"},
  {"id":"raven","epithet":"夜鴉の","factionId":"north","level":3,"troops":{"halberd":3,"pirate_axe":3,"archer":3},"description":"夜陰に船団へ忍び寄る放浪の武人。"},
  {"id":"bell","epithet":"沈鐘の","factionId":"citadel","level":3,"troops":{"shield":4,"crossbow":3,"infantry":3},"description":"沈めた船の鐘を集める元守備隊長。"},
  {"id":"thorn","epithet":"黒棘の","factionId":"citadel","level":3,"troops":{"halberd":4,"shield":4,"crossbow":3},"description":"槍の戦列で甲板を埋める追放兵。"},
  {"id":"viper","epithet":"海蛇の","factionId":"pirates","level":3,"troops":{"pirate_spear":4,"pirate_assault":4,"pirate_archer":4},"description":"櫂船で獲物を取り囲む略奪者。"},
  {"id":"mirror","epithet":"水鏡の","factionId":"archipelago","level":3,"troops":{"marine":5,"seaArcher":4,"shield":4},"description":"凪の海から護送船を追う船長。"},
  {"id":"salt","epithet":"塩風の","factionId":"pirates","level":4,"troops":{"pirate_shield":5,"pirate_spear":5,"pirate_archer":4},"description":"塩と禁制品を奪う大船団の主。"},
  {"id":"moon","epithet":"欠月の","factionId":"archipelago","level":4,"troops":{"marine":5,"seaArcher":5,"halberd":5},"description":"月明かりを避けて航行する私掠者。"},
  {"id":"stone","epithet":"黒礁の","factionId":"citadel","level":4,"troops":{"shield":6,"halberd":5,"crossbow":5},"description":"岩礁を砦とする元艦隊指揮官。"},
  {"id":"storm","epithet":"嵐呼びの","factionId":"north","level":4,"troops":{"pirate_axe":6,"halberd":6,"archer":5},"description":"荒天でも帆を畳まない豪胆な船長。"},
  {"id":"ember","epithet":"残火の","factionId":"pirates","level":4,"troops":{"pirate_assault":6,"pirate_shield":6,"pirate_archer":6},"description":"燃え残った船を繋ぎ合わせて戦う海賊。"},
  {"id":"anvil","epithet":"鉄槌の","factionId":"citadel","level":5,"troops":{"cavalier":6,"shield":7,"crossbow":6},"description":"港の鎖を断ち切る元海軍将校。"},
  {"id":"eclipse","epithet":"日蝕の","factionId":"north","level":5,"troops":{"cavalier":5,"halberd":5,"pirate_axe":5,"archer":5},"description":"黒い帆の下に精鋭を集める反逆者。"},
  {"id":"abyss","epithet":"深淵の","factionId":"pirates","level":5,"troops":{"pirate_assault":5,"raider_cavalry":5,"pirate_shield":5,"pirate_archer":5},"description":"深い海を縄張りにする大船団の王。"},
  {"id":"throne","epithet":"空位の王座の","factionId":"citadel","level":5,"troops":{"cavalier":5,"shield":5,"halberd":5,"crossbow":5},"description":"失った領土を海上に求める亡命貴族。"},
];
