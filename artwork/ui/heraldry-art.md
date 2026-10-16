# 海賊旗・貴族・季節のUI原画

外洋海賊の旗・貴族6種・季節4種は、読みやすい輪郭と素材の陰影で表す。画風は [UIの共通方針](README.md)、北海連合・群島同盟・湾岸城塞群の紋章は [勢力3種の紋章](faction-crests-art.md) を参照する。

## 原画と表示素材

- 原画: `artwork/ui/atlases/heraldry.png`。1261×1247、RGBA。
- 切り出し設定: `artwork/ui/atlases/heraldry.json`。貴族・四季・外洋海賊の11種を実測範囲から切り出す。
- 表示素材: `image/factions/pirates.svg`、`image/nobles/*.svg`、`image/ui/season-*.svg`。
- 貴族は128×144の透過PNGをviewBox 64×72へ、海賊旗は128×128を64×64へ、季節は128×128を24×24へ埋め込む。
- 再切り出し: `node scripts/extractUIAtlas.cjs artwork/ui/atlases/heraldry.json`。

## モチーフ

外洋海賊は赤黒の髑髏旗と木の旗竿で表す。貴族は顔と肩を大きく描き、北は青、列島は緑、城塞は金と赤を基調とする。実用的な鼻当て兜・鎖帷子・羊毛の外套・簡素な冠で役職を描き分け、角付き兜や魔術師の帽子は使わない。

| 素材ID | 人物・服装 |
| --- | --- |
| north-warden | 茶色の髭、鉄の鼻当て兜、青い外套、鎖帷子の港湾守備役。 |
| north-jarl | 灰色の長髪と髭、細い真鍮の冠、毛皮縁の青い外套を持つ領主。 |
| archipelago-druzhina | 黒髪、実用的な鉄兜、緑の外套、鎖帷子の見張り役。 |
| archipelago-prince | 茶髪、細い青銅の冠、緑と生成りの衣服を持つ調停役。 |
| citadel-steward | 薄い頭髪と短い灰色の髭、赤紫と黄土色の衣服を持つ文官。 |
| citadel-knight | 茶色の髭、鉄の鼻当て兜と鎖帷子、金と赤の外套を持つ騎士。 |

季節は春の白い花と緑の葉、夏の顔を付けない金色の太陽、秋の赤橙色の広い葉、冬の青白い六方向の雪結晶で表す。

小さい表示と拡大表示は `tests/uiArtPreview.html` で確認する。
