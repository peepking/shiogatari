# UIアイコンの代表見本

本番へ反映する前に、画風と小さい表示の読みやすさを確認した8図柄の原画。

この原画から唐辛子・所属盾・禁制品4種を本番へ採用した。信仰は海の波、部隊は3人組へ変更した。旧比較ページは全77種を扱う `tests/uiArtPreview.html` に統合し、削除した。以下のプロンプトと原画は、採用した6種の再生成元として保持する。

- 見本画像: `representative-v2.png`
- 比較ページ: `tests/uiArtPreview.html`（原寸・拡大、およびボタン・物資欄の見本）
- 並び: 上段は唐辛子、雇用する戦士、所属の紋章盾、ミント色の信仰の灯火。下段は違法薬物、密造酒、盗品工芸品、盗品武具。
- 画像生成スキルの組み込みツールで作成。参照画像は承認済みの `image/map/sprites-pixel.png` と `image/map/party-norse-pixel.png`。画風だけを参照し、マップは編集していない。
- 元画像: `C:/Users/peepk/.codex/generated_images/01a121ec-ab48-7871-944a-f4403a99fc5a/exec-e169606f-bd55-462c-8096-080db7065b68.png`
- 画像は加工せず透過を保持したまま複製。採用図柄の切り出し範囲は `image/ui/atlases/approved-samples.json` に記録する。

## 使用したプロンプト

```text
Use case: stylized-concept
Asset type: a single transparent game UI icon sample atlas, precisely FOUR columns by TWO rows, eight equal square cells, overall aspect ratio 2:1.
Primary request: create eight NEW, beautifully readable pixel-art UI inventory/action icons for a Japanese medieval Northern European / Viking maritime game. This is a style exploration sheet, not a modification of either reference.
Input images: Image 1 is the accepted map atlas, a STYLE reference only. Image 2 is the accepted Norse traveler group, a STYLE/material/color reference only. Do not reproduce the map, do not copy whole scenes.
Composition: eight individual isolated icons centered on an exact uniform 4-column 2-row grid. Each icon occupies about 78–82% of its own cell with transparent padding. All artwork must stay in its cell. Flat transparent background everywhere, no grid lines, no labels, no text, no tile frames. All cells square and equally sized. Prefer overall 1536 x 768 or another exact 2:1 output.
Order, left to right:
TOP row 1: (1) SPICE: one large vivid red curved CHILI PEPPER with a clearly separate green stem, simple iconic hook silhouette, slight material shading. (2) HIRE TROOPS: ONE cropped bust of a bearded Norse warrior, practical steel nasal helmet WITHOUT HORNS, rusty red wool cloak, broad chest; visible face, no miniature crowd, no weapons obscuring face. (3) IDENTITY / ALLEGIANCE: ONE wooden heraldic shield with a gold rim and blue-and-cream quartered face; bold clean shield silhouette, no wings or antlers or faces. (4) FAITH / ORACLE: ONE small stone altar carrying a clearly shaped luminous LIGHT MINT GREEN flame, #7dffb2 family, warm pale stone base. Mint flame is the dominant shape. Do not add cross, text, deity, skull, complicated runes or decorative particles.
BOTTOM row 2: (5) ILLEGAL DRUG: a small OPEN tan cloth/paper sachet containing off-white fictional herbal powder, a single dark purple leafy herbal sprig tucked against its side, clear open-package silhouette, no modern syringe, pills or real drug branding. (6) ILLICIT BREW: ONE coarse dark reddish-brown ceramic alcohol jug, short neck, cloth stopper tied with rope, single curved handle, visibly different from a wooden beer mug. (7) STOLEN CRAFT: ONE ornate GOLD GOBLET with a bold RED GEM in its cup, wide cup, narrow stem and solid foot, restrained ornament, obvious valuable vessel. (8) STOLEN ARMS: ONE prominent steel-headed wood-handled AXE partly wrapped in a rust-red cloth strip around lower blade/haft, simple clear axe silhouette.
Style/medium: high-quality hand-placed pixel art matching the references' rich yet restrained material shading. Think approximately 48–56 meaningful pixels per icon, with coherent larger pixel clusters and crisp stepped outlines, not simplified geometric SVG, not extremely chunky 16-pixel pictograms, not painterly blur. Clear large shapes first, 3–5 shade clusters per material, no noisy dithering or thin detail webs. Dark navy/charcoal outline, brighter edge highlights for legibility on navy interface. Warm wood, iron, cream wool, brass, rust red, olive. Chili saturated red and faith light mint remain distinctive.
Lighting: consistent soft upper-left highlights, tangible volume with simple controlled shading, no cast background shadows.
Constraints: These will be displayed as small 20–24 px UI icons. Design SILHOUETTES AND COLOR BLOCKS that remain instantly recognizable when reduced. One main subject per cell. Natural coherent objects and anatomy, no mangled props, no abstract emblems. Real alpha transparency, no opaque black or checkerboard background. No words, letters, numbers, title, watermark, border, labels, arrows, surrounding environment or extra objects.
```

