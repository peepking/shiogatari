# 資源・物資のピクセル絵

2026年10月10日。画像生成スキルの組み込みツールで、承認された見本を画風の参照として制作。

- 新しい17図柄: `image/ui/atlases/resources.png`。部隊は3人組、信仰はミントグリーンの海の波の紋章。
- 元画像: `C:/Users/peepk/.codex/generated_images/01a121ec-ab48-7871-944a-f4403a99fc5a/exec-6d3aba4a-9b14-4aaa-b23d-bbba5930ce56.png`
- 承認済みの唐辛子・所属盾・禁制品4種は `image/ui/studies/representative-v2.png` を採用。そのプロンプトは `studies/README.md` に保存。
- 切り出し指定: `image/ui/atlases/resources.json`、`approved-samples.json`。`scripts/extractUIAtlas.cjs` で128px透過PNGをSVGに埋め込み、既存の呼び出し形式を維持する。生成後の色は描き換えない。部隊と信仰は隣の図柄の混入だけを最大連結成分の選択で除き、元のRGBAを保持する。
- マップ・兵種GIFは変更していない。

## 使用したプロンプト

```text
Use case: stylized-concept
Asset type: ONE production transparent game UI inventory icon ATLAS, exact 4 columns and 5 rows (17 populated cells, last 3 empty), total aspect ratio 4:5.
Primary request: NEW pixel-art icons for a medieval Norse / Western maritime sandbox, matching Image 1's approved sample shading and pixel clusters.
Input image 1: approved UI sample style/material reference only. Keep the same clear rich wood/iron/cream cloth/brass pixel artwork, but change faith from FIRE to SEA WAVES and troops from one man to THREE PEOPLE.
Layout: STRICT evenly spaced 4x5 grid of equal square cells. Icon centered in its own cell, occupied about 70% of width and height MAX, at least FIFTEEN PERCENT transparent padding on ALL SIDES. Never let one object's pixels touch or leak into the next cell. No drawn cell frames, no backdrop, no labels. Last 3 cells fully empty transparent.
Subjects in exact reading order:
ROW1: 1 SHIP: small graceful wooden sailing ship, one big cream square sail, blue wave under hull, clear sail silhouette. 2 TROOPS: THREE overlapping cropped shoulder-and-head busts, three DISTINCT heads side by side; central steel nasal-helmet bearded Norse warrior with rusty red cloak slightly forward, left olive cloak brown-haired companion, right cream wool blond companion. All three heads large and readable; no horns, no weapons clutter, no full bodies. Main meaning is a party/group of people. 3 FAITH: a SEA WAVE sacred medallion, ONE BIG LIGHT MINT GREEN #7dffb2 curling ocean wave crest above TWO HORIZONTAL rolling water bands, set inside subtle warm brass ring. Clearly horizontal watery surf and curved foam crest; NO flames, no altar, no green fire, no cross, no magical crystal. Mint green dominant; deep teal shadows and pale mint foam. 4 SUPPLIES: sturdy closed WOODEN CRATE with crossed rope binding, slight 3/4 view, simple cube.
ROW2: 5 FUNDS: small stack of broad bright gold COINS with one large upright coin. 6 FAME: one GOLD MEDAL with a prominent five-pointed star and two short red ribbon tails, clear round award silhouette; no face, wings or antlers. 7 FOOD: ONE large scored brown BREAD LOAF with a small golden wheat ear beside it, appetizing cream cuts. 8 WOOD: short bundle of TWO wooden logs, cut circular ends visible, broad warm browns.
ROW3: 9 STONE: cluster of THREE large gray rough ROCKS, distinct uneven silhouettes. 10 IRON: stack of TWO squared blue-gray IRON INGOTS with bright steel edge highlights, smooth trapezoid blocks. 11 FIBER: a loose pale cream SKEIN of flax fiber tied around middle, several broad looping strands, wispy straw color, no narrow busy thread. 12 SALT: squat wooden BOWL filled with WHITE angular SALT CRYSTALS, bright white tops and pale blue shadows.
ROW4: 13 ARMS: ONE diagonal straight IRON SWORD with clear silver blade, brass guard and dark wrapped grip, distinguishable from cloth-wrapped axe. 14 TEXTILE: one rolled deep blue CLOTH with a cream woven border, clear thick cylindrical folded roll and trailing fabric edge. 15 BREW: a broad WOODEN BEER TANKARD, iron hoops, single handle, white foam, distinct from ceramic jug. 16 LEATHER: one tan/brown animal HIDE with naturally scalloped lobes, darker central patch, clear spread hide silhouette.
ROW5: 17 CHART: cream PARCHMENT NAUTICAL CHART, curled edges, a bold simple blue coast line and small red route mark, no text; 18 fully empty; 19 fully empty; 20 fully empty.
Style: actual detailed but compact PIXEL ART, approximately 48–56 meaningful pixels per icon, coherent discrete clusters and visible crisp stepped edges; match the reference's material volume and gentle upper-left highlights. 3–5 shades per material, strong navy-charcoal outer outline. NOT flat geometric SVG pictograms. NOT painterly blur, not extreme 16px blockiness, no noise dithering. Objects must remain clear at 20–24px display. Warm wood, steel, cream, brass, rust, olive, restrained blue. Rich and readable rather than crowded.
Output: genuinely transparent alpha PNG. No checkerboard, no opaque black background, no environment, no cell borders, no text, no watermark. Consistent scale and equal padding.
```

## 2026年10月11日: 小麦と金貨の修正

ユーザー指定により、食料を小麦の穂3本だけの束へ変更し、資金は同じ規格の金貨4枚へ作り直した。画像生成スキルの組み込みツールを使用し、修正前の資源アトラスは画風の参照だけに使った。

- 保存先: `image/ui/food.svg`、`image/ui/funds.svg`。既存の資源アトラス `image/ui/atlases/resources.png` 内の該当2枠も差し替えた。
- 食料の生成元: `C:/Users/peepk/.codex/generated_images/01a121ec-ab48-7871-944a-f4403a99fc5a/exec-f23c6a30-6a5d-469b-be2d-944b76fa8492.png`
- 資金の生成元: `C:/Users/peepk/.codex/generated_images/01a121ec-ab48-7871-944a-f4403a99fc5a/exec-b1767c5a-3a03-46a5-962b-bbebdfb69d9d.png`
- 生成した各図柄を透過のまま切り詰め、既存の枠に最近傍で収めた。範囲は資金 `[26,352,247,222]`、食料 `[579,355,269,221]`。その他15種のRGBA画素を保持した。再切り出しは既存の `resources.json` をそのまま使う。
- 資源・取引・報告、資金ヘッダ、資金と食料の行動ボタン、確認ページの参照を `20261011-wheat-coins` へ更新した。

### 小麦の最終プロンプト

```text
Use case: stylized-concept
Asset type: ONE transparent pixel-art game resource icon, FOOD represented ONLY by WHEAT.
Input image 1: style/material reference of the game's approved UI resource atlas, not an edit target. Match its warm medieval Norse/Western material shading and crisp pixel clusters.
Subject: THREE plump golden WHEAT EARS on short stalks, loosely gathered with a small brown twine tie. Recognizable alternating pointed wheat kernels along each central stem; middle ear upright and slightly taller, side ears gently splayed. Compact broad sheaf silhouette, prominently visible wheat heads, short stems. No other objects.
Style: beautiful compact pixel art about 48–56 meaningful pixels across, crisp discrete clusters with stepped edges, navy-charcoal outline, warm ochre shadows, golden wheat and cream highlights, upper-left light. Similar detail density to reference icons, not noisy. Readable at 20px icon size. Centered with 15 percent transparent margin on every side. Square canvas.
Constraints: WHEAT ONLY. No bread, loaf, buns, plate, basket, sack, berries, leaves, text, letters, watermark, labels, background scenery or checkerboard. Actual transparent alpha background.
```

### 金貨の最終プロンプト

```text
Use case: stylized-concept
Asset type: ONE transparent pixel-art game resource icon representing FUNDS.
Input image 1: style reference of approved UI resource atlas. Match its medieval Norse/Western pixel-art gold material, crisp clustered shading and dark outline. Redesign the money arrangement because the old upright coin was much larger than the others.
Subject: a compact group of FOUR IDENTICAL GOLD COINS of ONE denomination, same physical diameter, same rim design, same thickness, same golden color. Two face-on upright coins partly overlapping, the rear coin slightly to the upper right but its round diameter EXACTLY SAME as the front round coin. Beside these, TWO flat gold coins stacked neatly at lower left. The flat coins' visible widest diameter MUST MATCH the diameter of each upright coin; their face ellipse is compressed only vertically by perspective. Every coin is the SAME SIZE. Simple plain circular inset on each visible coin face; no letters, no currency symbols, no portraits. Keep coherent geometry and clear generous coin rims. Four coins total only. Compact silhouette, no enormous central coin surrounded by tiny coins.
Style: actual compact pixel art about 48–56 meaningful pixels across, warm amber shadows, rich brass gold midtones, cream-yellow upper-left highlights, dark navy-charcoal outside outline, clear stepped edges, 3–5 material shades, no noisy texture. Rich readable RPG inventory sprite at 20–24px. Match reference grain and palette; no flat vector glyph. All coins fit within a centered square with 15 percent transparent margin.
Constraints: actual transparent alpha background, no black backdrop, no checkerboard, no purse, no pouch, no extra props, no text, no watermark. Consistent coin diameters are the top priority.
```


