# 所属盾・唐辛子・禁制品の共用原画

`representative-v2.png` は、所属盾・唐辛子・禁制品4種の本番素材を切り出す原画。現在使う6図柄と切り出し位置を以下に定める。全体の画風・モチーフの基準は [アート方針](../../README.md) と [UIの方針](../README.md) を参照する。

## 原画と切り出し

- 原画: `artwork/ui/studies/representative-v2.png`。1774×887、RGBA、4列2段。
- 切り出し設定: `artwork/ui/atlases/approved-samples.json`。
- 再切り出し: `node scripts/extractUIAtlas.cjs artwork/ui/atlases/approved-samples.json`。
- 表示素材: `image/ui/*.svg`。128×128の透過PNGを埋め込み、viewBoxは24×24。

## 採用図柄

| 原画内の位置 | 表示素材 | モチーフ・用途 |
| --- | --- | --- |
| 上段左 | spice.svg | 緑の茎を持つ赤い唐辛子。香辛料。 |
| 上段左から3番目 | identity.svg | 真鍮縁と青・生成りの四分割の盾。所属・身分。 |
| 下段左 | illegal-drug.svg | 薬草と白い粉末を入れた小包。違法薬物。 |
| 下段左から2番目 | illicit-brew.svg | 縄で布栓を結んだ赤茶の陶器の酒壺。密造酒。 |
| 下段左から3番目 | stolen-craft.svg | 赤い宝石を持つ金の杯。盗品工芸品。 |
| 下段右 | stolen-arms.svg | 赤い布を巻いた鉄の斧。盗品武具。 |

通常の酒は木のジョッキ、通常の武具は剣とし、禁制品の図柄と区別する。所属盾は勢力固有の紋章と用途を分ける。小さい表示・拡大表示とボタン・物資欄での見え方は `tests/uiArtPreview.html` で確認する。
