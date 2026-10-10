# UIの船・潮の施設のピクセル絵

2026年10月10日。画像生成スキルの組み込み画像生成を使用。元のSVG図形をなぞらず、承認された代表見本とマップの質感を参照して新規制作した。マップ素材と兵種GIFは変更していない。

## 保存した素材

- 船11種と潮の施設5段階の元アトラス: `image/ui/atlases/ships-tides.png`
- 船の表示素材: `image/ui/ship-{caravel,knarr,longship,cog,galley,carrack,galleass,galleon,fluyt,fishing_boat,viking_ship}.png`
- 潮の施設: `image/ui/tide-stage-{0,1,2,3,4}.png`
- 再切り出しの範囲とサイズ: `image/ui/atlases/ships-tides.json`
- 切り出し: `scripts/extractUIAtlas.cjs`。生成された図柄は描き換えず、透過で離れた各図柄を指定範囲で切り出す。船・施設は128×128。
- キャッシュ更新番号: `20261010-maritime-ui`

施設は全段階でミントグリーンの海の波紋章を使う。炎・焚き火・十字架は使わない。既存の関数とSVGクラスを保ち、SVG内の画像として表示する。

## 2026年10月11日の魚図鑑の復元

ユーザー指定により、魚図鑑の一般魚・大物・超大物・未発見は、PNGへの変更前のSVGシルエットへ戻した。`src/fishing/fishingCodexArt.js` はコミット `2a685ee` の実装と同じ。未発見は点線の円と疑問符を使い、分類を明かさない。未使用になった魚のPNG・元アトラス・切り出し記録は削除した。

## 参照画像

- `image/ui/studies/representative-v2.png`: 承認されたUIの画風・素材感・輪郭の参照。炎と単独の部隊員は採用しない。
- `image/map/sprites-pixel.png`: 既存のマップの木・石・布・金属の色とピクセル粒度の参照。マップ自体は変更しない。

## 生成元

- 船・施設: `C:/Users/peepk/.codex/generated_images/01a12543-0a4a-7d33-a4db-3d0f97c381ac/exec-65b5fb86-607e-4434-b1a0-9e9b04fd76e2.png`

## 船・施設の最終プロンプト

```text
Use case: stylized-concept. Asset type: production transparent game UI sprite atlas.
Create one EXACTLY 4-column by 4-row equal-cell sprite sheet, 16 distinct isolated icons, with real transparent alpha background, no text, no numbers, no frames or gridlines.
Reference 1 is the approved UI pixel-art direction: rich recognizable material shading, clear dark navy outline, sensible object shape, deliberate pixel clusters. Reference 2 shows the accepted game map art and must only guide medieval wooden/stone materials and pixel density. Do not copy the flame or single warrior from reference 1. This sheet is new subjects.
Each icon must be clean mature hand-crafted pixel art at approximately 48x48 logical-pixel complexity, then enlarged nearest-neighbor: definite pixel steps, coherent broad shade clusters, only 5-7 shades per material. Readable at 32px and 24px. NOT low-poly vector art, NOT painterly fine detail. Dark navy outlines, warm wood, cream canvas, iron-grey steel, muted olive. Consistent upper-left light. Keep EVERY object including ropes/masts/paddles within its own cell and leave at least 15% completely transparent padding on all four sides of EACH CELL. Fill about 70% of cell. Background fully transparent.
All vessels use readable left-to-right side/three-quarter view, simple soft-blue water wake confined to lower silhouette. Existing game is medieval Northern/Western European fantasy; no engines or modern fittings. Vary silhouette and large distinguishing features rather than tiny clutter. Exact subjects in row-major order:
Row 1 col 1: small caravel with TWO triangular lateen cream sails, low wooden hull.
Row 1 col 2: broad Norse KNARR cargo boat, ONE square cream sail, deep belly hull, two obvious barrels on deck.
Row 1 col 3: slender LONGSHIP, ONE cream square sail, several broad oars, round red-and-gold shields along hull, simple upturned bow, NO dragon.
Row 1 col 4: medieval COG, ONE broad square cream sail, tall square wooden sterncastle, heavy blunt cargo hull.
Row 2 col 1: GALLEY, very long narrow low hull, two triangular lateen sails, fan of oars.
Row 2 col 2: CARRACK, three masts, two high cream square sails and a small triangular sail, raised fore and aft castles, rounded full hull.
Row 2 col 3: GALLEASS, heavy wide war galley, two cream square sails, high sterncastle, strong visible bank of broad oars.
Row 2 col 4: GALLEON, sleek large hull, three cream square sails across three masts, very high decorated stepped sterncastle.
Row 3 col 1: FLUYT, bulbous cargo hull, narrow deck and high rounded stern, three simple cream square sails, no oars.
Row 3 col 2: small FISHING BOAT, one little triangular sail, clearly readable olive-green rolled fishing net and hanging fish basket, low wooden hull.
Row 3 col 3: VIKING DRAGONSHIP, ONE boldly striped rust-red and cream square sail, prominent carved wooden dragon head prow, broad oars, round shields.
Row 3 col 4: a humble sea-faith gathering place: simple cream canvas canopy supported by timber posts, two log benches, one small large-visible sea-green banner bearing a simple curling wave. No flame or campfire anywhere.
Row 4 col 1: sea-faith little WOODEN SHRINE with steep olive shingled roof, wooden posts, a prominent luminous mint-green curling wave medallion over dark doorway, small base stones.
Row 4 col 2: sea-faith STONE ALTAR: broad squared grey stone altar with a mint-green curling ocean-wave carved on its FRONT, two short timber uprights and little hanging cream cloth behind; NO flame, NO glowing crystal.
Row 4 col 3: sea-faith TEMPLE: medium Norse timber hall with tall steep wooden roof, stone footing, readable large mint-green ocean-wave emblem over entrance; no crosses, no flames.
Row 4 col 4: sea-faith GRAND TEMPLE: substantial grey stone sanctuary with tiered slate roof, broad entrance flanked by two columns, mint-green circular curling ocean-wave emblem centered high; medieval Nordic-western architecture, no crosses, no flames.
Keep facility sizes visually proportional as icons, stages clearly progress humble cloth -> wooden shrine -> stone altar -> hall -> grand stone sanctuary. Do not add labels. Accurate row and column order essential.
```

