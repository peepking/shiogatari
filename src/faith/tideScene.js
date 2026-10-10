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

/**
 * 海の波紋章を共通に、布の集いから石造神殿へ育つ施設を描き分ける。
 * @param {object} site 潮の縁の拠点。
 * @returns {string} 装飾用SVG。
 */
export function tideStageIcon(site) {
  return `<svg class="tide-icon" viewBox="0 0 96 96" aria-hidden="true" focusable="false"><image href="./image/ui/tide-stage-${tideStage(site)}.png?v=20261010-maritime-ui" width="96" height="96" preserveAspectRatio="xMidYMid meet"/></svg>`;
}
