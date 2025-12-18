/**
 * 画像アセット（データURI）。
 * @type {Record<string,string>}
 */
export const ASSETS = {
  ships:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='90' viewBox='0 0 140 90'><rect width='140' height='90' rx='14' fill='%23111a33'/><path d='M18 58 L70 24 L122 58 Z' fill='%237aa7ff'/><rect x='62' y='30' width='6' height='20' fill='%23e8efff'/><rect x='56' y='50' width='18' height='6' fill='%23e8efff'/><path d='M26 60 L114 60 L100 70 L40 70 Z' fill='%23202940'/></svg>",
  companions:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='90' viewBox='0 0 140 90'><rect width='140' height='90' rx='14' fill='%23111a33'/><circle cx='46' cy='36' r='12' fill='%237dffb2'/><rect x='35' y='50' width='22' height='18' rx='6' fill='%237dffb2'/><circle cx='94' cy='36' r='12' fill='%237aa7ff'/><rect x='83' y='50' width='22' height='18' rx='6' fill='%237aa7ff'/><rect x='30' y='70' width='80' height='6' rx='3' fill='%23202940'/></svg>",
  faith:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='90' viewBox='0 0 140 90'><rect width='140' height='90' rx='14' fill='%23111a33'/><circle cx='70' cy='32' r='16' fill='%23ffd27a'/><path d='M70 18 L70 46' stroke='%23e8efff' stroke-width='4' stroke-linecap='round'/><path d='M54 50 Q70 72 86 50' stroke='%237aa7ff' stroke-width='4' fill='none' stroke-linecap='round'/><circle cx='56' cy='52' r='4' fill='%237dffb2'/><circle cx='84' cy='52' r='4' fill='%237dffb2'/></svg>",
  supplies:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='90' viewBox='0 0 140 90'><rect width='140' height='90' rx='14' fill='%23111a33'/><rect x='30' y='30' width='80' height='36' rx='8' fill='%23ffd27a'/><rect x='24' y='46' width='92' height='26' rx='6' fill='%23cba35a'/><path d='M52 28 L52 66 M70 28 L70 66 M88 28 L88 66' stroke='%23202940' stroke-width='4'/></svg>",
  funds:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='90' viewBox='0 0 140 90'><rect width='140' height='90' rx='14' fill='%23111a33'/><circle cx='52' cy='44' r='18' fill='%23ffd27a'/><circle cx='88' cy='50' r='18' fill='%237aa7ff'/><text x='52' y='49' text-anchor='middle' font-size='14' fill='%23202940' font-family='Segoe UI, sans-serif'>G</text><text x='88' y='55' text-anchor='middle' font-size='14' fill='%23202940' font-family='Segoe UI, sans-serif'>C</text><path d='M32 70 H108' stroke='%23e8efff' stroke-width='4' stroke-linecap='round'/></svg>",
  fame:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='90' viewBox='0 0 140 90'><rect width='140' height='90' rx='14' fill='%23111a33'/><path d='M28 62 L70 16 L112 62 Z' fill='%23ffd27a'/><path d='M40 62 L70 30 L100 62 Z' fill='%23ffefb2'/><rect x='64' y='34' width='12' height='32' rx='3' fill='%23111a33'/><circle cx='70' cy='30' r='10' fill='%237aa7ff'/><path d='M70 26 L70 34 M66 30 L74 30' stroke='%23e8efff' stroke-width='3' stroke-linecap='round'/></svg>",
  flag1:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80' viewBox='0 0 120 80'><rect width='120' height='80' rx='12' fill='%23111a33'/><path d='M16 64 L16 16 L78 20 L40 36 L78 52 Z' fill='%237aa7ff'/><circle cx='92' cy='40' r='8' fill='%23e8efff'/></svg>",
  flag2:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80' viewBox='0 0 120 80'><rect width='120' height='80' rx='12' fill='%23111a33'/><path d='M18 18 H78 L64 40 L78 62 H18 Z' fill='%237dffb2'/><circle cx='94' cy='40' r='9' fill='%2323b47b'/></svg>",
  flag3:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80' viewBox='0 0 120 80'><rect width='120' height='80' rx='12' fill='%23111a33'/><path d='M18 24 L70 18 L102 40 L70 62 L18 56 Z' fill='%23ffd27a'/><circle cx='40' cy='40' r='10' fill='%23202940'/></svg>",
  noble:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='120' viewBox='0 0 96 120'><rect width='96' height='120' rx='14' fill='%23111a33'/><circle cx='48' cy='32' r='16' fill='%237aa7ff'/><rect x='28' y='54' width='40' height='26' rx='10' fill='%237dffb2'/><rect x='18' y='82' width='60' height='26' rx='12' fill='%23202940'/></svg>",
  pirate:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80' viewBox='0 0 120 80'><rect width='120' height='80' rx='12' fill='%23111a33'/><path d='M18 20 L70 18 L102 40 L70 62 L18 60 Z' fill='%23ff7a7a'/><circle cx='40' cy='40' r='10' fill='%23e8efff'/><circle cx='38' cy='38' r='2.4' fill='%23111a33'/><rect x='43' y='37' width='7' height='3.4' rx='1.2' fill='%23111a33'/><path d='M36 46 C40 48 44 48 48 46' stroke='%23111a33' stroke-width='3' stroke-linecap='round'/><path d='M54 30 L82 40 L54 50 Z' fill='%23202940'/><rect x='20' y='20' width='6' height='40' rx='3' fill='%23ffb27a'/></svg>",
};

/**
 * 勢力の態度ラベル。
 * @type {Record<string,string>}
 */
export const ATTITUDE_LABELS = {
  friendly: "友好",
  trade: "取引",
  neutral: "中立",
  wary: "敵対",
  hostile: "敵対",
};

/**
 * 勢力データ。
 * @type {Array}
 */
export const FACTIONS = [
  {
    id: "north",
    name: "北海連合",
    tagline: "航路を抑える海商連合",
    color: "#7aa7ff",
    sigil: ASSETS.flag1,
    attitude: "neutral",
    nobles: [
      { id: "north_wave", name: "波間伯", title: "港湾の守り手", img: ASSETS.noble },
      { id: "north_tide", name: "潮路伯", title: "関税と航路の監督", img: ASSETS.noble },
    ],
  },
  {
    id: "archipelago",
    name: "群島同盟",
    tagline: "島嶼の緩いつながりと航路の共有",
    color: "#7dffb2",
    sigil: ASSETS.flag2,
    attitude: "neutral",
    nobles: [
      { id: "arch_reef", name: "礁の旗主", title: "外洋見張り", img: ASSETS.noble },
      { id: "arch_atoll", name: "環礁執政", title: "島間の調停役", img: ASSETS.noble },
    ],
  },
  {
    id: "citadel",
    name: "湾岸城塞群",
    tagline: "本土港を守る城塞群",
    color: "#ffd27a",
    sigil: ASSETS.flag3,
    attitude: "neutral",
    nobles: [
      { id: "citadel_cape", name: "岬の代官", title: "港湾徴発の長", img: ASSETS.noble },
      { id: "citadel_fort", name: "砦の守備卿", title: "船団入港の判定役", img: ASSETS.noble },
    ],
  },
  {
    id: "pirates",
    name: "外洋海賊",
    tagline: "旗なき襲撃者たち",
    color: "#ff7a7a",
    sigil: ASSETS.pirate,
    attitude: "hostile",
    nobles: [],
  },
];

/**
 * オーメン（雰囲気文）定義。
 * @type {object}
 */
export const OMEN = {
  direction: {
    留まれ: "潮は、ここに留まることを良しとしている。",
    補え: "潮は、欠けたものに目を向けさせる。",
    動け: "潮は、道を示している。",
    触れよ: "潮は、接触を避けるなと告げている。",
    奪え: "潮は、争いを避けられないと囁く。",
    越えよ: "潮は、危険の向こうに価値を見る。",
  },
  intensity: {
    拒絶: "潮は抗われ、その流れを変えようとしている。",
    沈黙: "海は何も語らない。それ自体が兆しだ。",
    最小: "潮は、最小限の応答で足りると示す。",
    通常: "潮は、常の判断を許している。",
    過剰: "潮は、代償を伴うことを隠してはいない。",
    全力: "潮は、一切退路を残さないと言う。",
  },
};

/**
 * 方向神託テーブル。
 * @type {object}
 */
export const DIRECTIONS = {
  1: {
    key: "留まれ",
    do: ["ワールドマップで1日経過させる", "近くに敵が来ても迎撃せず様子を見る"],
    dont: ["移動開始", "取引・徴兵・戦闘の開始"],
    tag: "方向=留まれ",
  },
  2: {
    key: "補え",
    do: ["最寄りの港へ移動する", "港で修理・補給・売却・捕虜処理を行う", "余裕があれば徴兵する"],
    dont: ["別都市への長距離移動", "戦闘開始"],
    tag: "方向=補え",
  },
  3: {
    key: "動け",
    do: ["目標を一つ決め最短ルートで移動（海路優先）", "途中の遭遇は受容し、交戦の有無は強度に従う"],
    dont: ["港に立ち寄って長居する", "大きな買い物・徴兵"],
    tag: "方向=動け",
  },
  4: {
    key: "触れよ",
    do: ["港・勢力に接触し会話/交渉まで行う", "情報収集や依頼確認"],
    dont: ["傭兵契約/士官任官の強行", "戦闘開始（奪えでなければ）"],
    tag: "方向=触れよ",
  },
  5: {
    key: "奪え",
    do: ["敵船/敵部隊を選んで攻撃する", "勝敗と損害は受容する"],
    dont: ["目標変更のための振り直し"],
    tag: "方向=奪え",
  },
  6: {
    key: "越えよ",
    do: ["危険海域や敵近海・未踏域へ直行（海路優先）", "可能な限り港を避けて進む"],
    dont: ["補給/徴兵のための寄り道", "安定行動の長期化"],
    tag: "方向=越えよ",
  },
};

/**
 * 強度神託テーブル。
 * @type {object}
 */
export const INTENSITIES = {
  1: {
    key: "拒絶",
    dontExtra: ["この行動は中止/撤退し、最小の損失で収める"],
    note: "次のターンでニュートラルに戻し方向から決め直す。",
    tag: "強度=拒絶",
  },
  2: {
    key: "沈黙",
    dontExtra: [
      "攻撃/契約/増強・徴兵・大規模補給を禁止",
      "戦闘は回避し、やむを得ない場合は撤退優先",
    ],
    note: "沈黙日数+1。7日で供物要求、さらに7日で沈黙エンド候補。",
    tag: "強度=沈黙",
  },
  3: {
    key: "最小",
    note: "行動は最低限だけ実行（寄り道せず、会話は要点のみ）。",
    tag: "強度=最小",
  },
  4: {
    key: "通常",
    note: "通常の判断で実行（方向は固定）。",
    tag: "強度=通常",
  },
  5: {
    key: "過剰",
    note: "不利条件を受容する（準備不足・悪天候・士気低下など）。撤退は原則なし。",
    tag: "強度=過剰",
  },
  6: {
    key: "全力",
    note: "撤退禁止・全力遂行。損害が出ても継続。",
    tag: "強度=全力",
  },
};

/**
 * 供物/仲間の運命テーブル。
 * @type {object}
 */
export const COMPANION_FATE = {
  1: { t: "即死（仲間1名）", do: ["対象仲間を死亡扱いで外す"], note: "ゲーム内仲間が無い場合は解釈で代用。", kind: "bad" },
  2: { t: "行方不明（仲間1名）", do: ["対象仲間を行方不明扱いで外す"], note: "解釈で代用可。", kind: "bad" },
  3: { t: "精神崩壊（弱体）", do: ["対象仲間に弱体/縛りを課す"], note: "例：役割固定、前線禁止など。", kind: "warn" },
  4: { t: "疑念・裏切りフラグ", do: ["対象仲間を当面前線に出さない"], note: "次の大きな沈黙で離脱させてもよい。", kind: "warn" },
  5: { t: "無事（供物未達）", do: ["対象仲間は無事（別の供物が来る）"], note: "次の供物時は優先対象にしてもよい。", kind: "" },
  6: { t: "啓示・強化", do: ["対象仲間に強化/縛りを与える"], note: "例：旗手専任など。", kind: "good" },
};

/**
 * 傭兵契約の転化テーブル。
 * @type {object}
 */
export const MERC_MORPH = {
  1: {
    t: "私掠許可・半認可",
    do: ["傭兵契約を維持しつつ海戦中は自由行動"],
    note: "海上襲撃を主行動にするRP。",
    kind: "good",
  },
  2: {
    t: "非公式協力（曖昧な契約）",
    do: ["契約を結ばず善意で支援（報酬少なめ）"],
    note: "依頼は触れよ/奪えで拾う。",
    kind: "warn",
  },
  3: {
    t: "一時士官（期限付き）",
    do: ["傭兵契約の代用として短期士官を結ぶ"],
    note: "期限後に士官手紙が来た扱いとしてよい。",
    kind: "warn",
  },
  4: {
    t: "正式士官への推薦",
    do: ["士官手紙が来た扱いとして判定へ"],
    note: "次のコンテキストを士官手紙に変更して振る。",
    kind: "good",
  },
  5: {
    t: "他国への入港禁止・敵対",
    do: ["中立でも敵対行動を許可し報復を受容"],
    note: "敵勢力や部族の船を襲撃して再現。",
    kind: "bad",
  },
  6: {
    t: "罠・即敵対",
    do: ["敵対が顕在化したとして『奪え』を優先"],
    note: "危険が顕在化する。",
    kind: "bad",
  },
};
