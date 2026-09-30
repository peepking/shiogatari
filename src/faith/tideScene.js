import { tideStage, tideProgress, TIDE_CONFIG } from './tideAlliance.js';

/** 段階・支援後・訪問回数から短い情景を選ぶ。再描画では乱数を使用しない。 */
export function tideSceneText(site) {
  const stage=tideStage(site), busy=stage<4 && tideProgress(site)>=TIDE_CONFIG.busyProgress;
  const scenes=[
    '潮風を避ける布の下に、丸太の腰掛けが並んでいる。まだ小さな集まりだが、訪れる人のために湯が用意されている。',
    '小さな祠の前に掃き清められた道がある。軒下では、潮の縁者が縄を綯いながら旅の話に耳を傾けている。',
    '石の祭壇を囲む広場に、木箱と籠が整然と並ぶ。荷を運ぶ者と休む者が、短い挨拶を交わしている。',
    '寺院の回廊に潮風が通り抜ける。干した布が揺れ、奥の炊事場からは器の触れ合う音が聞こえる。',
    '大きな神殿の足元にも、昔と変わらない腰掛けが残っている。広場を行き交う人々の間を、穏やかな話し声が満たしている。',
  ];
  const conversations=[
    ['「長い旅だったでしょう。まずは、こちらで休んでいってください」','隣の縁者が黙って腰掛けを空けてくれた。'],
    ['「この縄は、もう少し丈夫にできそうだね」','「急がなくていいさ。旅に出る人が困らないようにしよう」'],
    ['「あの人が話していた海は、どんな色だったかな」','「今度いらしたら、もう一度聞いてみよう」'],
    ['「今日はここで一緒に食べていきませんか」','器を並べる手が止まり、いくつもの顔がこちらを向いた。'],
  ];
  const reactions={first:'初めて訪れた潮語りを、人々は少し緊張した面持ちで迎えた。',return:'「おかえりなさい」——顔を覚えていた縁者が、こちらに手を振る。',support:'支えを受け取った人々が、深く頭を下げた。「この場所で、大切に役立てます」',growth:'新しい場を整えた人々が、誇らしげに案内してくれる。ここにまた、一つの営みが根を下ろした。'};
  return { description:scenes[stage], busy:busy?'資材を広げて寸法を確かめる姿がある。次の場を整える相談が、あちこちで進んでいる。':'',
    conversation:conversations[(site?.visits || 0)%conversations.length], reaction:reactions[site?.reaction] || '海の匂いを含んだ風が、静かな集いの場を通り抜ける。' };
}

/** 施設の発展段階を、小さな輪郭アイコンで描き分ける。 */
export function tideStageIcon(site) {
  const shapes = [
    '<path d="M18 69V46L48 25L78 46V69M14 46L48 19L82 46M27 73H40M56 73H69"/><path d="M44 66Q40 58 48 49Q56 58 52 66Z" fill="#d8c68e"/>',
    '<path d="M22 78V40L48 18L74 40V78M16 42L48 13L80 42M39 78V55H57V78M18 81H78"/><path d="M45 37H51"/>',
    '<path d="M17 79H79M23 71H73V79H23ZM29 50H67V71H29ZM23 43H73V50H23ZM39 43V32M57 43V32M33 32H63M48 32V18"/><path d="M43 20Q43 10 48 8Q55 15 53 20"/>',
    '<path d="M16 78H80M23 74V39H73V74M16 39L48 17L80 39M32 43V70M64 43V70M42 74V54H54V74M12 78V51H23M73 51H84V78"/>',
    '<path d="M10 82H86M15 75H81V82H15ZM22 75V38H74V75M15 38L48 20L81 38M30 44V68M66 44V68M42 75V53H54V75M37 24V15H59V24M31 15L48 5L65 15M10 68V49H22M74 49H86V68"/>',
  ];
  return `<svg class="tide-icon" viewBox="0 0 96 96" aria-hidden="true" fill="none" stroke="#d8c68e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${shapes[tideStage(site)]}</svg>`;
}
