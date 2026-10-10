# 森・山岳の再制作記録

今回の地形オブジェクト4種は、既存の輪郭をなぞらず、新規の透過画像として制作した。制作モードは built-in `image_gen` で、CLI・APIキーは使用していない。

- 生成元: `C:/Users/peepk/.codex/generated_images/01a1255a-ff49-7d21-8c48-c38a80d1edac/exec-ebb9e1d7-c75b-4ffd-a0f0-faebcc613f50.png`
- 保存先: `image/map/redraw/landscape-atlas.png`
- 画像: 1254 × 1254 px、透過RGBA、2列 × 2行
- 画風参照: `image/ui/atlases/resources.png`。構造・対象の参照には使わず、画素のまとまりと素材の陰影だけを参照した。
- 本番の `sprites-pixel.png` およびマップ描画処理は、この制作作業では変更していない。

## 切り出し位置

セルは各627 × 627 px。以下の実測範囲を `pack.json` に記録し、本番アトラスへの再配置に使用する。表示時は縦横比を維持して長辺40 pxに縮小する。

| 対象 | セルの範囲 x, y, 幅, 高さ | アルファ100以上の連続した図柄範囲 |
| --- | --- | --- |
| forest / 落葉樹3本 | 0, 0, 627, 627 | 48, 69, 553, 528 |
| mountain / 岩峰2つ | 627, 0, 627, 627 | 636, 139, 589, 458 |
| forestAlt / 針葉樹3本 | 0, 627, 627, 627 | 48, 648, 543, 500 |
| mountainAlt / 低い岩稜3つ | 627, 627, 627, 627 | 631, 780, 594, 334 |

## 確認

原寸と最近傍補間による4倍表示は、共通の `tests/mapArtPreview.html` で確認する。制作時の比較用PNGと重複する切り出し設定は整理した。生成された画像の内容は描き変えず、切り出しと縮小だけを行った。

落葉樹・針葉樹とも、中央と左右に樹冠と幹が3組あり、根元まで対応している。岩峰は左の大峰と右の小峰、岩稜は中央と左右の低い峰が読め、各稜線と明暗面は根元まで連続している。背景の半透明な霞や地面タイルはない。40 pxでも森・針葉樹林・山岳・低い岩稜を区別できることを確認した。

## 生成プロンプト（全文）

```text
Use case: stylized-concept
Asset type: ONE transparent sprite atlas for a medieval nautical RPG, containing four terrain-object sprites on an exact 2 by 2 grid of equal square cells.
Primary request: Create NEW, internally coherent forest and mountain sprites. They will appear at only 40 pixels on the map. Design as if each individual sprite were drawn on a roughly 48 by 48 logical pixel canvas, enlarged with crisp nearest-neighbor pixels. Recognizability and sound construction at 40px are crucial.
Input images: The provided resources atlas is a STYLE REFERENCE ONLY for rich, readable 16-bit pixel clusters and material shading. Do not reproduce any object from it.
Atlas layout, exactly four separate objects:
TOP LEFT: forest — three deciduous trees in a compact cluster, a taller tree behind and two shorter trees in front. Each leafy canopy has a clear, correctly attached brown trunk. Tree roots stand on one narrow dark green ground patch. Sculpted organic leaf clusters rather than three green balls. Visible small gaps distinguish the three trees.
TOP RIGHT: mountain — TWO natural grey rock peaks, a tall peak on the left and a lower peak on the right. Continuous rock faces and coherent ridgelines from summit to foot, a small off-white snow cap only near the tall summit. The peaks share a narrow rocky base. Broad simple planes, no gems or crystal shards.
BOTTOM LEFT: forestAlt — three spruce or fir trees. A taller tree behind and two smaller trees in front, coherent tapered tiers of pointed dark green branches. Each tree has one visible brown trunk attached to its own crown. Compact narrow root patch, not a land tile.
BOTTOM RIGHT: mountainAlt — a low rugged ridge with THREE low irregular rocky summits, highest in the middle. Broad continuous sloping stone faces, a little moss at the narrow foot, no snow. Natural folded rock shapes, not triangular jewels.
Composition/framing: Each sprite is independently centered within its own square cell, with at least 12 percent fully transparent clearance from every cell edge. A consistent three-quarter elevated game-map view. Objects must not overlap or connect between cells. No labels, no gridlines, no numbers.
Style/medium: Hand-designed SNES-era pixel art with rich but restrained material shading, clear big pixel clusters. Thin dark navy-green outline #283b3d, never a heavy black border. Limited 2–4 values per material. No tiny fussy details, no dithering, no gradients or blur. Pixel edges are crisp and deliberate.
Lighting: One light source from upper left on ALL four sprites; upper left rock planes light, right faces darker, trunk shadows consistent.
Color palette: foliage moss green #80925b, olive #637a48, forest #456246; natural cool stone #9aaba8 and #617979; brown trunks; restrained warm ivory snow. Avoid neon green, extreme white highlights, saturated gem colors.
Background: GENUINE transparent RGBA background, including between the objects and outside their narrow foot patches. No colored backdrop, no checkerboard painted into image, no shadow haze, no floating environmental scenery.
Constraints: four sprites only, exact 2x2 atlas. No land/island tile, no ocean or water, no full square base. No accidental branches or disconnected rock pieces. Anatomy and perspective must remain coherent at small size.
```

