# 海の地点・船のマップ図柄の描き直し

## 制作方法

- built-in `image_gen` を使用した新規生成。既存の図柄をなぞった編集ではない。
- 原画: `C:/Users/peepk/.codex/generated_images/01a1255b-3ed4-73a2-8557-01f884f84b68/exec-ae51db5d-333a-4c5d-ae17-dbd1eb8a1edb.png`
- 保存先: `image/map/redraw/maritime-atlas.png`
- 原画寸法: 1536 × 1024、RGBA、背景透過。
- 3列2段の配置。図柄の切り出しは色や形を変更せず、実測範囲と最近傍法で縮小する。
- 本番の切り出し指定: `pack.json`。`scripts/packMapSprites.cjs` で再配置できる。街は別の最終原画を採用し、このアトラスからは村・無法港・帆船・難破船・沈没船の5種を使用する。
- 原寸と拡大表示: 共通の `tests/mapArtPreview.html` で確認する。制作時の比較用PNGと重複する切り出し設定は整理した。
- 原寸の検査では、街の塔と屋根、村の藁葺き2軒、無法港の旗・小屋・桟橋、船の大きい帆と木の船体、難破船の折れたマスト、沈没船の傾きと金の宝箱を確認した。

## 切り出し範囲

左・上・幅・高さは原画内の画素。図柄本体をアルファ100以上の連結領域から実測した範囲で、隣のセルは含まない。

| ID | 左 | 上 | 幅 | 高さ |
| --- | ---: | ---: | ---: | ---: |
| village | 559 | 158 | 435 | 330 |
| pirateHarbor | 1065 | 96 | 426 | 390 |
| ship | 53 | 512 | 425 | 421 |
| wreck | 548 | 561 | 442 | 371 |
| sinkingShip | 1055 | 541 | 434 | 396 |

## 最終プロンプト

```text
Use case: stylized-concept
Asset type: a single production sprite atlas for a medieval northern maritime strategy game's world map.
Primary request: create ONE transparent 3-column by 2-row atlas containing six redesigned small readable map icons. All six independent sprites must be evenly centered in their equal cells with generous transparent margins, no frames, no cell lines, no ground tile and no text. Intended display size: each icon's long edge only 40 pixels. Readability and physically coherent architecture/rigging are more important than ornamental detail.
Style/medium: polished 16-bit pixel art, about 48 logical pixels per sprite, clearly visible intentional stepped pixel clusters, flat pixel edges. Compact attractive silhouettes; 2–4 discrete shade levels per material, broad clear highlights, light from upper left. Dark navy #283b3d thin outlines, warm brown timber, cream ivory canvas, gray stone, muted red roofs, a little mossy green. Transparent background, real alpha. Do not create detailed painted illustrations that are merely mosaicked.
Cell order left to right, top to bottom:
1. TOWN: a compact coherent medieval coastal town, one clearly constructed square gray stone tower with battlements and two distinct red pitched-roof timber houses at its base. Roofs sit on walls, square window openings, all structures clearly separated, small coherent base.
2. VILLAGE: two small distinct thatched timber cottages and a tiny tidy vegetable garden in front. Each has an unmistakable simple golden triangular roof, brown walls and a single dark doorway. Simple lush green patch, no large terrain tile.
3. PIRATE HARBOR: a short sturdy brown wooden pier supported by exactly three thick pilings, one small dark wooden hut at its far end and one black flag on a mast with a very simple readable cream skull. Pier boards form a coherent flat platform, no boats, no sprawling rigging.
4. PLAYER SHIP: one small handsome wooden cog in three-quarter side view, single straight central mast visibly fixed into the deck, one big square cream sail attached to a horizontal yard, compact deep brown hull with raised bow and stern, a few coherent ropes only. Bow points left. No boat cutaway, no multiple sails, no water base.
5. WRECK: a broken brown wooden ship hull lying low, cracked planking, one snapped mast with a short draped cream sail and exactly one gray rock beside it. Readable broken ship silhouette, no tiny scattered splinters, no figures.
6. SINKING SHIP: the same recognizable single-mast wooden cog now tilted to the right and half submerged, left bow raised, lower right hull missing under the waterline; its one square cream sail visibly torn in two big notches; one small open golden treasure chest clearly resting on the exposed deck. A small teal foam line at waterline only, no square sea tile.
Constraints: every icon must work immediately at 40 px; clean deliberate shapes; roofs, walls, hull, mast and sail must connect correctly. No miniature clutter, no tiny random dots, no dense hatching, no nonsensical doors, no melting architecture, no pseudo writing, no accidental object fusion. Keep all six separated and fully within cells. No reflections, no shadow outside sprites, no labels, no watermark.
```

