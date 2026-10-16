# 勢力3種の紋章

北海連合・群島同盟・湾岸城塞群は、同じ形の盾に勢力色と大きな象徴を配した紋章で表す。画風は [UIの共通方針](README.md) に合わせる。

## 原画と表示素材

- 原画: `artwork/ui/atlases/faction-crests.png`。2172×724、RGBA、3列1段。
- 切り出し設定: `artwork/ui/atlases/faction-crests.json`。
- 表示素材: `image/factions/north.svg`、`archipelago.svg`、`citadel.svg`。128×128の透過PNGを埋め込み、viewBoxは64×64。
- 再切り出し: `node scripts/extractUIAtlas.cjs artwork/ui/atlases/faction-crests.json`。

## 勢力色と象徴

| 位置 | 勢力 | 盾の地色 | 象徴 |
| --- | --- | --- | --- |
| 左 | 北海連合 | 青 | 生成りの北欧の長船と、その下の二本の波。 |
| 中央 | 群島同盟 | 緑 | 翼を広げた生成りの海鳥と、その下の三つの島。 |
| 右 | 湾岸城塞群 | 金・黄土 | 紺の三塔の城塞と、開いたアーチ門。 |

真鍮の縁と濃い紺の輪郭を共通にし、20〜24pxで盾と象徴を見分けられる形にする。盾の中の象徴は平面的な紋章として描き、立体の船・鳥・城を貼り付けた構成にしない。

勢力色の基準は青 `#7aa7ff`、緑 `#7dffb2`、金 `#ffd27a`。盾の地色は落ち着いた濃さとし、生成り `#ddcb9e`、真鍮 `#c5a460`、輪郭 `#283b3d` と対比させる。王冠・飾り帯・細かな彫刻を増やさず、大きな象徴を優先する。

外洋海賊の旗は [海賊旗・人物・四季](heraldry-art.md) を参照する。勢力一覧と拡大表示は `tests/uiArtPreview.html` で確認する。
