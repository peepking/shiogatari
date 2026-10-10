# 地図の画像素材

地図の地形・拠点・現在地・探索地点・賞金首・物語・出来事・ピンを同じ画風で描くための素材。UIの既存画像とは分けて管理する。

## 現在使用するドット絵素材

### 原寸での判読性と構造の修正

2026年10月10日、街・村・無法港・帆船・難破船・入り江・防衛盾・戦場跡・海図・祭壇・鐘・森2種・山2種の15図柄を新しく制作した。追加の出来事も灯火と沈みかけた宝船を同じ構造へ整理した。樹冠と幹、稜線と岩肌、帆とマストと船体が実寸でもつながる形を優先し、旧図柄へ無理に似せていない。

漂流物・宝箱・賞金首・海賊旗・海賊王の紋章・魚・感嘆符・星と、嵐の置き土産は、切り出し範囲内のRGBA画素を変えず再配置した。承認済みの陸の一行と、地形模様・海岸線・水深の接続は維持している。アトラス内の未使用だった旧旅人も、現在の北欧風の一行を配置した。戦場跡は参考画像の赤い旗と残された武具というモチーフから、丸い木盾・剣・鉄兜を含む新しい構成にした。祭壇は海の波を刻んだ石碑と石壇にし、戦場跡と祭壇の全体表示も同じモチーフへ合わせた。

内蔵の画像生成ツール（built-in image_gen）で原画を作成し、切り出し・最近傍縮小・透過画像の配置だけを制作スクリプトで行った。原画、生成指示、生成元の保存先は次の記録にある。

- [森と山岳](redraw/landscape-art.md)
- [街・村・港と船](redraw/maritime-art.md)
- [城壁の街の最終原画](redraw/town-walled-art.md)
- [海図・祭壇・入り江・鐘・盾・灯火](redraw/sites-art.md)
- [戦場跡](redraw/battlefield-art.md)

`redraw/pack.json` から `node scripts/packMapSprites.cjs image/map/redraw/pack.json` で本番の二枚を再配置できる。制作時のみSharpが必要で、ゲーム実行時の追加依存はない。配置結果は `redraw/packed-bounds.json` と `src/world/mapSpriteBounds.js` に記録した。`redraw/*-before-redraw.png` は維持図柄を再現するための元画像で、本番では読み込まない。

確認ページの先頭に全27図柄の原寸欄を追加した。実マス32・41・64px、描画用の長辺40px、40pxの4倍、全体13pxと4倍を本番と同じ処理で比較できる。

2026年10月11日の街の追加修正では、添付の旧画像をモチーフの参照として、城壁の内側に赤屋根の家々が集まる原画を完全に新規制作した。`town-walled.png` が本番の街であり、最初の描き直し案の街とその限定編集案は使わない。賞金首のUIボタンも、マップの賞金首と同じ切り出し原画に統一している。

### 基本素材と描画方式

既存ユニットの歩兵・弓兵・騎兵のGIFを参照し、細かな質感を大きな色面と2〜4段階の陰影へ整理した。旧原画を粗く加工する方式ではなく、内蔵の画像生成ツール（built-in image_gen）で新しく描いた素材を使用する。ユニット画像そのものは変更していない。

- `sprites-pixel.png`: 1024×1536、RGBA、24図柄。街・村・無法港・帆船・旅人・難破船・漂流物・戦場跡・海図・祭壇・入り江・宝箱・賞金首・五列強・海賊王・魚群・鐘・出来事・星・盾・森2種・山2種。各図柄の位置と実寸は `src/world/mapSpriteBounds.js` に記録し、配置順に依存せず切り出す。
- `party-norse-pixel.png`: 1254×1254、RGBA。中世北欧風の陸の一行。鉄の鼻当て付き兜・丸い木盾・短いマント・旅装の3人を描き、陸の現在地はこの単独原画を使う。アトラス内にも同じ一行を配置している。アルファ128超の輪郭は `[111, 251, 1047, 889]`、全体表示も同じ服と兜・丸盾を専用図形で表す。
- `terrain-pixel.png`: 1536×1024、三列二段。上段は深海・浅瀬・草地、下段は森の地面・岩地・甲板。青と青緑、落ち着いた緑、暖かい木の色で統一する。
- `events-pixel.png`: 2172×724、RGBA、三列一段。左から嵐の置き土産・霧中の灯火・沈みかけた宝船。
- `dangerous-seas-pixel.png`: 1774×887、二列一段。南西は緑灰の斜めの白波、南東は藍の潮流と段状の霧。描画時の色合成に頼らず、原画で海域の色を分ける。

図柄は長辺40画素の描画面へ一度だけ切り出し、地形と荒海は四マス128画素で継ぎ目を合わせる。拡大時は補間を止めてドットのまとまりを残す。海岸線の外角・内角、水深の透過マスク、孤島の背景は既存の滑らかな接続を共有し、素材だけの粒度と分けて扱う。全体表示はすべて専用の簡易図柄を使い、詳細表示の同じ素材を過度に縮めない。地図の枠・ボタン・現在地表示も紙と真鍮の色へ合わせる。

全分類・全縮尺・海岸・危険海域・既存ユニットとの比較は `tests/mapArtPreview.html` で確認できる。

## ドット絵の生成指示

図柄はユニット3種を参照して新規生成し、最終調整で旅人・入り江・盾の3セルだけを修正した。生成結果の順序に合わせて全24種の範囲を実測している。余白の代表点は実アルファ0。イベントもユニット3種を参照して生成した。

### 図柄

```text
Use case: stylized-concept. Asset type: COMPLETE production pixel sprite atlas for naval tactics game. The attached tiny infantry/archer/cavalry sprites are the STYLE REFERENCE and the exact intended pixel density. Create a new transparent 1024x1536 pixel PNG, exactly 4 columns x 6 rows, one sprite per square256 cell. Draw deliberately compact sprites at equivalent40x40 logical pixels per sprite, with clean large square pixel blocks enlarged around5x. Match unit pictures' simple strong contour, readable proportions, chunky well-placed 3–8 pixel color clusters, ONLY 3 shade steps per material. This is polished hand-placed retro game pixel art, restrained detail. Small subjects must read instantly as symbolic whole shapes. No realism, no painterly detail, no grain, no gradients, no blur, no anti-aliasing, no tiny rendered object that was merely downsampled. Each sprite occupies70–80% of its equal cell with clear transparent gutters on every side. Simplified three-quarter slightly top-down view, dark blue-gray broken outline #283b3d, warm red roofs #b66a4e, grass #80925b, forest #456246, cream #ddcb9e, gold #cbab58, blue wave #245876 and cyan #4b9eaa. Exactly24 sprites, row-major: ROW1 a small red-roof castle town with 3 towers, a thatch-roof village of 2 houses and a field, pirate harbor jetty with black skull flag, wooden ship with2big white sails and blue pennant. ROW2 three cloaked adventurers, wrecked wooden boat among3rocks, floating wood crate, battlefield crossed swords plus red flag and steel shield. ROW3 parchment treasure chart with redX, stone shrine with big cyan crystal, rocky cove with turquoise inset, golden closed treasure chest. ROW4 wanted parchment poster with pirate head/crossed swords emblem, red flag with white skull, black banner with gold crown/skull, three silvery fish. ROW5 bronze ancient bell on a few rocks, gold diamond with bold dark exclamation mark, gold5pointstar, blue/silver quartered shield. ROW6 rounded broadleaf forest of3trees, rocky mountain with3gray peaks, triangular pine forest of3trees, rocky2peakmountain with green slope. Keep tree crowns simple 3shade chunky leaf masses and peaks broad with2facet planes, not hundreds of leaves or stones. Village/town houses have strong simple roof shapes, only2or3windows. No letters or captions. No grid. Actual transparency outside sprites, no drawn checkerboard or backdrop, no drop shadow. Include every listed sprite exactly once in the exact4x6grid.
```

### 図柄の最終調整

```text
Use case: precise-object-edit. This is a 1024x1536 transparent sprite atlas with4columns and6rows of256pixel square cells. EDIT ONLY THREE CELLS: second row, columns1,2,3. Keep every other sprite unchanged in location, size, color, pixel style and silhouette. Keep transparent alpha background. The current three individual adventurer sprites in row2 columns1–3 must be REPLACED by these three entirely different complete symbols: row2col1 three cloaked travelers standing TOGETHER as one compact party sprite (three people grouped within this onecell; cream/brown/green cloaks); row2col2 a tiny rocky sheltered COVE, crescent gray rocks with one green shrub encircling a curved turquoise lagoon and tiny sand shore; row2col3 a blue-and-silver QUARTERED SHIELD with a gold rim, bold readable simple heraldic shield shape. Keep row2col4 wreck unchanged. Keep every other row completely unchanged including town village pirateharbor ship; crate crossedweapons treasuremap crystalshrine; treasurechest wantedposter redpiratebanner blackpiratekingbanner; fish bell exclamationdiamond goldstar; broadleafforest graymountain pineforest greenmountain. Use the same crisp square 16-bit pixel clusters and3shade steps as the existing atlas, equivalent40logicalpixel symbols. No realism or extra fine texture. Do not shift any cells. Only replace the specified row2 first3objects. Transparent background, no labels, no grid.
```

### 陸の一行の差し替え

内蔵の画像生成ツール（built-in image_gen）で生成。`sprites-pixel.png` と既存の `image/troops/infantry.gif` を画風・粒度の参照に指定し、単独の透過図柄として作成した。生成後の素材の描き換えは行わず、実際の輪郭に合わせた切り出しと既存の40画素描画を使う。

```text
+Use case: stylized-concept.
Asset type: one production TRANSPARENT pixel-art map sprite for the medieval maritime tactics game Shiogatari.
Input images: image 1 is ONLY the existing sprite atlas style and palette reference, especially its simple town, trees, ship, and compact three-person party. Image 2 is ONLY the existing infantry sprite's pixel density and readable proportions. Do NOT reproduce the atlas layout.
Primary request: create ONE compact three-person travelling party with a medieval Northern European / Western European / Viking Age feeling, replacing the current hooded fantasy adventurers.
Subject and composition: three friendly rugged Norse travellers standing tightly together as one clear map icon, full bodies and boots visible, three-quarter slightly top-down game view. Centre slightly forward: a bearded traveller with a plain iron nasal helmet WITHOUT HORNS, rust-red short wool cloak, simple muted blue-gray tunic and leather belt, one round wooden shield with iron boss held low at his side. Left and right, slightly behind: one bareheaded brown-haired companion in an olive short cloak and tan tunic with a small shoulder bag, and one fair-haired companion in a cream tunic with a brown wool mantle and a small travel pack. Clear exposed faces, short practical tunics, trousers and boots. A small sheathed sword or hatchet on a belt is enough; avoid long weapons that overwhelm the silhouette. The whole party is one group, no gaps between separate individual icons.
Style: carefully authored 16-bit pixel game art, equivalent approximately 40 by 36 logical pixels for the WHOLE GROUP, enlarged into crisp square blocks. Strong dark blue-gray contour #283b3d, chunky deliberate color clusters, 2–4 flat shade steps per material, restrained tiny face marks. Same charming readable scale and simple shaded volumes as the reference map icons and unit. Upper-left light. Broad calm color shapes, no fine material texture.
Palette: weathered rust #b66a4e, olive #80925b, warm wool cream #ddcb9e, wood brown #986a43, cool steel #9aaba8, muted blue #52758a, dark outline #283b3d.
Framing: centered on a square transparent canvas, group occupies roughly 76–82 percent of width and height, generous fully transparent padding on ALL edges. Exactly one party sprite, actual RGBA transparency outside its silhouette. No floor, grass, island, pedestal, badge, panel, background, colored halo or cast shadow.
Avoid: wizard hoods, long monk robes, desert cloaks, pointy hats, horned helmets, enormous axes, fantasy armour, realism, painted grain, gradients, blur, soft glow, dithering, a detailed painting merely reduced or pixelated, tiny scattered ornaments, labels, text, numbers, grid, watermark.
```

### 追加の出来事

```text
Use case: stylized-concept. Asset type: three sprite production pixel-art atlas for naval SRPG. Generate a transparent PNG landscape3:1ratio, exactly3equal square cells inone row, three isolated pixel sprites. The attached infantry/archer/cavalry are STYLE ONLY: match simple strong contour and crisp chunky pixel shapes. Approximately40logicalpixels per object enlarged into clean8–12pixel blocks, only3shades per material, broad simple color clusters. These should look crafted at small pixel resolution, not reduced detailed render. No photograph/painterlytexture/no grain/no fine detail/no gradients/no blur/no soft glow/no soft shadows. A restrained slightly top-down three-quarter view. Clear transparent gutters 12%around each sprite. Colors sea#245876, foam#b4d4d0, wood#986a43, cream#ddcb9e, gold#cbab58, darkoutline#283b3d. EXACT LEFT: a compact cluster of5broken wood planks tied by thick coiled rope, one strip green seaweed and three whitepixel wave accents (storm aftermath). EXACT CENTER: one old brass lantern with big ring handle and simple orange-and-cream flame, sitting on tiny3plank raft with one rope coil and small whitepixel wave accents. EXACT RIGHT: a compact sinking wood sailboat leaning to starboard, one big torn cream sail, big OPENgoldtreasurechest aboard, fewwhitepixel waves atbase. Keep lowdetail boldly readable silhouettes at32pixels. No otheritems orsprites. Actualtransparent alpha outside objects, no checkerboard, no backdrop, no text orlabels.
```

### 地形・荒海の生成方針

地形は削除済みの旧原画 `terrain.png` とユニット3種を参照して編集生成した。三列二段の配置と六地形を指定し、各パネル128論理画素の色面、3〜5階調、少数の短い段状の波や草むらを指定した。深海は `#245876`、浅瀬は `#4b9eaa`、草地は `#80925b`、岩地は `#7f9291`、甲板は暖かい栗色。写真・絵画の単なるモザイク化、微細な粒、ぼかし、岸・島・樹冠・建物の描き込みは避け、海岸はゲーム側の描画に任せる。

荒海は削除済みの旧原画 `dangerous-seas.png` を参照して編集生成した。二つの等しい正方形パネル、各四マス周期、128論理画素相当の段状の波頭、2〜4段階の陰影、8〜12色を指定した。左は南西の緑灰 `#30564c` / `#254c45` に泡 `#c3d6c6` の斜めの短い波、右は南東の藍 `#354765` に霧 `#8caeba` の湾曲した潮筋。継ぎ目のない対向辺、全面不透明、物体・文字・大きな渦なし、写真の反射や微細粒・ぼかし・ディザ・モザイク縮小を避ける指定とした。

## 削除済みの旧原画の制作履歴

以下は旧画風の生成記録。記載した旧原画4枚はゲームと現行の再配置設定から参照されていないため、2026年10月11日に削除した（合計10,958,687バイト、約11MB）。現在の描画は上記の `*-pixel.png` を参照する。維持する図柄の再作成に必要な `redraw/*-before-redraw.png` と、採用素材の元画像・切り出し設定は残している。以下の寸法と生成指示は制作履歴として扱う。

- `sprites.png`: 1024×1536、透過PNG。四列六段の24図柄。旧実装では図柄ごとの実測範囲を指定し、縦横比を保ってマス内へ収めていた。
- `terrain.png`: 1536×1024、三列二段の地形模様。上段は深海・浅瀬・平原、下段は森の地面・山の地面・甲板。繰り返しの両端を描画時に薄く重ね、世界座標に合わせて四マス周期で描く。深海と浅瀬は共有辺・四マスの交点で画像の濃さを揃え、陸の切り抜きの背景も周囲の水深へつなぐ。海岸は外角と内角を同じ丸みにする。
- `events.png`: 2172×724、透過PNG。三列一段で、左から嵐の漂流物・霧中の灯火・沈みかけた宝船。旧実装では既存の図柄を画風の参考として追加生成し、各図柄の実測範囲を指定していた。背景の透明度は実際のアルファチャンネルで確認済み。
- `dangerous-seas.png`: 1774×887、非透過PNG。二列一段で、左は嵐の船墓場の斜め潮流と白波、右は霧の深淵の藍色の潮流と薄い霧筋。各887×887の海面模様を通常の地形に重ね、広い海域を連続した荒海として描く。

画像は内蔵の画像生成ツールで作成した。海洋ファンタジーの完成イメージを画風の参考とし、ゲーム用に配置と透過を指定して新しく生成した。元画像の切り貼りは行っていない。

基本四枚の読み込みが揃うまでは既存の図形描画を使い、画像の一部だけが切り替わる状態を避ける。失敗時も図形描画を継続する。荒海模様は危険海域専用の追加画像として読み込む。

全体マップでは画像を縮小せず、`src/world/mapOverviewArt.js` の専用図柄に切り替える。深い青・苔色・象牙色・真鍮色を共通に使い、地点の輪郭と依頼ピンの形・色を小さなマスでも残す。地形6種から海域の出来事5種まで、詳細・簡易の対応は `tests/mapArtPreview.html` で一覧確認できる。

## 図柄の生成指示

```text
Use case: stylized-concept. Asset type: production-ready TRANSPARENT PNG sprite atlas for the maritime fantasy browser game 潮語り航海録. Image 1 is ONLY an art style reference; create a clean new atlas, no reference layout, no text.
Create ONE exact uniform atlas 4 columns by 6 rows, portrait 2:3 aspect ratio (ideally 1024x1536), genuinely transparent background. Each of the 24 square grid slots has ONE isolated illustration at its CENTER, fitting within the middle 76% of its square, generous fully transparent padding on ALL sides; nothing crosses any slot boundary. No labels, no numbers, no visible grid, no panels, no heading, no background rectangle. Equal cell dimensions, equal spacing. Do not rearrange or omit anything.
Match the right-hand gallery in the reference: beautiful crisp hand-painted miniature 2D game art with restrained texture and simple shaded volumes, ivory sails, warm worn wood, terracotta roofs, gray stone, moss greens, small brass details. Consistent light upper left, soft tight contact shadows lower right. Top-down game props with a slightly visible front side, same camera for every object, strong readable silhouettes even at 32px. Rich enough to feel illustrated but avoid microdetail. No thick circular badges. The reference navy must NOT be in the output background: real alpha transparency.
EXACT ROW ORDER, left to right:
row 1: compact stone-walled town with red roofs and small tower, NO colored faction banner; rural village of two thatched cottages and tiny crop patch, NO faction banner; small wooden pirate harbor with buildings pier and black pirate flag; a wooden sailing ship with bright ivory sails.
row 2: three small ivory-cloaked travelers seen from above and slightly in front; broken shipwreck with torn ivory sail and dark wooden hull; drifting wooden crate with two short foam strokes; abandoned battlefield remains with a shield and torn red pennant.
row 3: parchment chart fragment with one red X, NO writing; a gray stone sea altar with a tiny teal crystal; crescent rocky inlet around a little pool of teal seawater; wood and brass treasure chest.
row 4: wanted parchment with small dark silhouette and crossed blades, NO letters; a deep crimson pirate banner on a pole; a black and gold pirate king banner with small gold crown; a school of three silver-blue fish and tiny wave strokes.
row 5: a weathered bronze seabed bell with a little seaweed; an ocher diamond containing a clear dark exclamation mark; an elegant ocher five-point star marker; a steel-rimmed shield split vertically into blue and warm ocher.
row 6: a cluster of three lush olive broadleaf trees, ground edge transparent; a group of two rocky gray mountain peaks with bright left slopes and darker right slopes, ground edge transparent; an alternate cluster of four deep green pines, ground edge transparent; alternate gray craggy mountain outcrop, ground edge transparent.
Objects MUST be centered uniformly on the exact 4x6 raster grid; clean actual alpha transparency is crucial because they will be individually sampled from this image by Canvas drawImage. No white matte, no checkerboard painted into the image.
```

## 地形の生成指示

```text
Use case: stylized-concept. Asset type: production terrain TEXTURE ATLAS for a top-down maritime fantasy square-grid browser game. Image 1 is ONLY a style and palette reference. Create ONE opaque image, landscape 3:2 aspect ratio ideally 1536x1024. EXACTLY 3 equal square columns and 2 equal square rows with NO GUTTERS. Each of six texture squares fills its entire allotted region edge to edge. No labels, text, borders, gridlines, objects, people, ships, houses, trees, mountain peaks, islands, coastlines, arrows, interface, watermark, or vignette.
The textures will be cropped per square and used as repeated terrain bases under independent sprites. Keep variations VERY QUIET, fine small details, uniform average brightness, no strong lighting gradient from edge to edge. Each square should be individually seamless/tileable along its opposite edges.
EXACT ORDER:
Top left: deep indigo blue sea, average hue #17486a, soft small natural marine wave strokes, sparse restrained blue-white highlights. Mostly calm blue surface.
Top middle: clear blue-green shallow sea, average #3f8f9b, very subtle fine underwater sand and delicate translucent ripples, NO shoreline and NO land.
Top right: desaturated olive grassland, average #7d8d54, short fine grass texture, tiny occasional stones and wildflowers, no large rocks, uniform overhead.
Bottom left: subdued dark mossy forest floor, average #526943, fine foliage ground texture with small plants, NO actual trees or canopy objects, uniform overhead.
Bottom middle: gray and olive rocky mountain ground, average #85877a, small gravel texture and hairline rock cracks, NO large stones or mountain peaks, uniform overhead.
Bottom right: weathered warm wooden deck, average #80664a, clear subtle parallel horizontal plank seams and staggered joints, restrained wood grain, NO railing or props.
Style match reference: beautiful restrained hand-painted 2D game art, mature maritime fantasy, crisp texture with gentle brushwork, NOT photoreal, not pixel art, not plastic. Ground textures must be low contrast so the separately painted icons stay readable. All six texture panels have consistent scale and cohesive muted palette. No central objects, NO central focus, just material surface texture.
```

## 危険海域の追加図柄の生成指示

旧原画の制作時は、内蔵の画像生成ツールで削除済みの `sprites.png` を画風の参考として指定した。生成結果は縦横比3:1を保った2172×724となり、その実寸に合わせて切り出し範囲を測定した。背景の四隅のアルファ値は0、画像全体のアルファ値の範囲は0〜255。

```text
Use case: stylized-concept. Asset type: production-ready transparent PNG sprite atlas for a maritime fantasy browser game. Input image 1 is ONLY an art style reference for painterly game icons, materials, lighting, camera and palette; do not reproduce its layout or its existing objects. Create ONE new wide horizontal atlas, exactly 3 equal square columns in ONE row, ideally 1536 x 512. Genuinely transparent background with real alpha. Each sprite centered in its own third, fitting within the middle 78 percent of the slot; generous fully transparent gutters between sprites and on all outer edges. Keep all silhouettes, shadows, fog and foam inside each slot. NO labels, writing, grid, panels, background rectangle, checkerboard, vignette or watermark. Consistent crisp hand-painted miniature 2D game illustration, slightly visible front side and top, soft volume shading, restrained brush texture, ivory, worn warm wood, bronze brass and muted teal. Light from upper left. Strong simple silhouettes readable at 32 px; avoid microscopic clutter. EXACT left to right: (1) storm aftermath flotsam: a visibly broken open wooden cargo crate floating at a diagonal, broken planks, a coil of thick rope, a little seaweed and two compact turquoise foam strokes, no lightning or cloud. (2) fog lantern: a large antique bronze nautical lantern on a small floating wooden support, clear warm amber flame inside glass, tiny restrained pale blue mist curls around its base and small teal foam strokes, lantern dominant, no large surrounding glow. (3) sinking treasure ship: a small wooden sailing ship leaning markedly to the right and half submerged, ivory torn sail, a visibly open golden treasure chest with a few large coins on its exposed deck, two compact teal wave strokes at waterline. All three separate isolated cutout sprites. Match the reference's mature warm painterly maritime style exactly. No ocean or terrain background, all empty pixels truly alpha transparent.
```

## 危険海域の海面模様の生成指示

旧原画の制作時は、内蔵の画像生成ツールで削除済みの `terrain.png` を画風と波の大きさの参考として指定した。生成結果は1774×887のRGB画像で、各パネルは887×887。水平線・船・島を含めず、静止した俯瞰地図で海域ごとの荒れ方を表す。左は波頭と砕ける泡を強く、右は暗い潮流の上へ薄い青白い霧を重ねた。通常地形の画像は変更していない。

南西のパネルは描画時に明暗を保ったまま深い緑灰へ染め、通常の青い海や明るい浅瀬と区別する。全体表示も同系色を使い、南東の藍色と見分けられるようにする。

```text
Use case: stylized-concept.
Asset type: production opaque terrain texture atlas for the top-down maritime fantasy browser game Shiogatari. The supplied existing terrain atlas is ONLY a visual style and scale reference; preserve the restrained hand-painted brushwork and blue marine palette, but make a NEW dangerous-sea texture atlas.
Create ONE opaque PNG image with exact 2:1 landscape aspect ratio, ideally 2048 x 1024. Exactly TWO equal square panels side by side with no gutters or separators. Each panel fills its entire square edge to edge. This is purely ocean WATER SURFACE seen vertically from directly above, never a scene or panorama.
LEFT panel: storm ship-graveyard ocean. Deep navy and steel blue, stronger diagonal irregular rolling currents, many natural medium and small wave crests, broken ivory foam trails, turbulent ripples with darker troughs. Convey a strongly storm-tossed dangerous sea using lively directional wave patterns, NOT a single giant wave. The sea must stay dark rich blue. Uniform distributed details, no central focal point.
RIGHT panel: misty abyss ocean. Deep indigo and subtle violet-blue dark water, intersecting curling currents and a few small eddies distributed uniformly, small pale cyan-white foam crests and delicate flowing blue-white mist ribbons, with restrained faint teal luminescence. Water is turbulent and ominous, yet remains visible through the thin mist. Do not cover it with a white cloud or one big whirlpool; no central focal point.
Style/medium: mature beautiful hand-painted 2D fantasy game terrain, crisp flowing brush strokes and softly shaded wave volumes, matching reference painting style. Detail scale should be similar to the reference's small sea strokes. Moderately clear light foam contours remain readable when these textures are composited at 40 to 60 percent opacity over ordinary sea. Both panels have roughly equal dark brightness. Every panel individually seamless and tileable along all opposite edges, uniform texture density and average brightness across its surface; broad currents continue through edges.
Constraints: WATER SURFACE ONLY. No sky, horizon, coast, islands, land, boats, shipwrecks, skulls, monsters, buildings, objects, symbols, text, letters, numbers, panels, borders, lines, logo, watermark, vignette or directional lighting gradient. No photorealism, no plastic rendering, no pixel art. Do not reproduce any grass, wood or stone from the reference. Do not use red, orange, yellow or gray haze as the base. No large central vortex, circular emblem, radial composition or singular main wave. No white empty space.
```

