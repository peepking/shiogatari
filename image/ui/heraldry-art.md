# 勢力・貴族・季節のUI原画

2026年10月11日、海賊以外の勢力3種は盾型の紋章へ更新した。現在の原画と生成指示は [勢力3種の紋章](faction-crests-art.md) を参照。以下は貴族・四季・外洋海賊として継続する初回原画の記録を含む。

承認された代表見本 `image/ui/studies/representative-v2.png` の、読みやすい輪郭と素材の陰影を勢力4種・貴族6種・季節4種へ適用した。マップの一行は服装の参照だけに使い、マップの素材や表示は変更していない。

- 生成方法: 画像生成スキルの組み込みツール。透過を指定し、元のアルファを保持。
- 元画像: `C:/Users/peepk/.codex/generated_images/01a12543-46cd-7923-8700-4c69d52d0397/exec-29fbc7b9-68a0-4dc8-8d96-74293c837aeb.png`
- 保存画像: `image/ui/atlases/heraldry.png`（1261×1247、RGBA）。元画像をそのまま複製。
- 切り出し記録: `image/ui/atlases/heraldry.json`。貴族・四季・外洋海賊の11種を、生成された図柄の間隔に合わせた範囲から切り出す。更新済みの勢力3種を上書きしないよう、初回のセル0〜2は設定から除いた。
- 本番素材: `image/factions/*.svg`、`image/nobles/*.svg`、`image/ui/season-*.svg`。PNGを埋め込み、既存のファイル名とviewBoxを維持。
- 勢力: 北の長船は青と生成り、列島の鳥と島は緑、城塞は金の石造、海賊は赤黒の髑髏旗。
- 貴族: 北は青、列島は緑、城塞は金と赤。実用的な鼻当て兜・鎖帷子・羊毛の外套・簡素な冠で役職を描き分ける。角付き兜や魔術師の帽子は使わない。
- 季節: 春の白い花、夏の太陽、秋の紅葉、冬の雪結晶。

## 使用したプロンプト

```text
Use case: stylized-concept. Asset type: production pixel art UI sprite sheet, 14 sprites on one transparent atlas. Image 1 is STYLE reference only (approved rich pixel art UI objects). Image 2 is STYLE reference for medieval Nordic clothing only. Create a fresh image, do not copy any icons from references. Match reference 1's refined clear pixel clusters, broad readable silhouettes, textured wood/iron/cloth with convincing highlights, warm top-left lighting, dark navy contour, 48 by 48 logical pixel fidelity per icon. Not flat SVG polygons, not photorealism, no blur. All motifs need to remain recognizable as tiny 24px UI icons.
LAYOUT: exact 4 columns by 4 rows equal square cells, 16 cells. First 14 occupied, last 2 completely empty transparent. Each object centered in own cell, at least 15% fully transparent padding on all four sides, no contact or overlap between cells. Transparent background, no frames, no shields as backgrounds except a motif expressly calls for one, no labels, text, numerals, shadows on ground, borders or grid lines.
ROW 1, left to right: (1) North faction heraldry: a compact wooden Nordic longship with a single blue and ivory striped square sail, small curved prow, one pale blue wave under hull. (2) Archipelago faction heraldry: a clearly readable ivory seabird spreading its wings over three small lush green island silhouettes, restrained brass accent. (3) Citadel faction heraldry: one sturdy golden sandstone castle with three square crenellated towers, bold silhouette, warm gold ochre. (4) Pirates faction heraldry: one weathered red-black cloth pirate flag with large ivory skull, flag on short wooden pole; simple unmistakable pirate emblem.
ROW 2, left to right, six distinct HEAD AND SHOULDERS portraits. All facing camera or slight three-quarter, normal handsome rugged people, large faces, no tiny full bodies, no ornate circular frame: (5) North harbor warden: brown bearded man, practical steel nasal helmet, blue wool cloak fastened with iron brooch, chainmail collar, calm vigilant face. (6) North route-tax jarl: older grey-bearded Nordic man, shoulder-length grey hair, simple narrow brass circlet, deep blue fur-trimmed cloak, dignified authority. (7) Archipelago sea watch retainer: dark-haired male island warrior, practical simple steel cap helmet with nasal guard, sage-green cloak, chainmail collar, purposeful alert face. (8) Archipelago mediator prince: young brown-haired nobleman, narrow bronze circlet, green and cream wool shoulder garments, composed friendly face.
ROW 3, left to right: (9) Citadel harbor requisition steward: older balding man with short grey beard, no hat, burgundy wool robe with ochre collar, a single small rolled cream parchment beside shoulder optional only if clear. (10) Citadel fortress knight: sturdy brown-bearded man in polished steel medieval nasal helmet and chainmail collar, ochre-gold shoulder cloak, red cloth accent; open face, no faceplate. (11) Spring: one large ivory-white blossom with five round petals and warm gold center, two fresh green leaves. (12) Summer: warm golden sun with a large round disk and eight bold clean rays, no face, rich amber-orange shading.
ROW 4, left to right: (13) Autumn: one recognizable oak leaf, broad rusty red and orange lobes with gold highlight, small short brown stem, no other object. (14) Winter: one bright icy blue and ivory snowflake with six thick branching arms, clean readable radial silhouette, no face. (15) fully empty transparent. (16) fully empty transparent.
Materials harmonious with reference 1, same palette and shading complexity across sheet. Keep portraits consistent with Norse/Western medieval world. Forbidden: horned helmets, wizard hats, magic flames, glowing effects, modern clothes, illegible tiny details, multicolored clutter, excessive canvas filling. Each figure/object must be isolated on actual transparent alpha.
```
