# 地図の画像素材

地図の地形・拠点・現在地・探索地点・賞金首・物語・出来事・ピンを同じ画風で描くための素材。UIの既存画像とは分けて管理する。

- `sprites.png`: 1024×1536、透過PNG。四列六段の24図柄。切り出し位置は `src/world/mapAssets.js` の `SPRITES` を参照する。生成された配置は等間隔からずれるため、図柄ごとの実測範囲を指定し、縦横比を保ってマス内へ収める。
- `terrain.png`: 1536×1024、三列二段の地形模様。上段は深海・浅瀬・平原、下段は森の地面・山の地面・甲板。繰り返しの両端を描画時に薄く重ね、世界座標に合わせて四マス周期で描く。深海と浅瀬は共有辺・四マスの交点で画像の濃さを揃え、陸の切り抜きの背景も周囲の水深へつなぐ。海岸は外角と内角を同じ丸みにする。
- `events.png`: 2172×724、透過PNG。三列一段で、左から嵐の漂流物・霧中の灯火・沈みかけた宝船。既存の図柄を画風の参考として追加生成し、切り出し位置は `src/world/mapAssets.js` の `EVENT_SPRITES` に指定する。背景の透明度は実際のアルファチャンネルで確認済み。
- `dangerous-seas.png`: 1774×887、非透過PNG。二列一段で、左は嵐の船墓場の斜め潮流と白波、右は霧の深淵の藍色の潮流と薄い霧筋。各887×887の海面模様を通常の地形に重ね、広い海域を連続した荒海として描く。

画像は内蔵の画像生成ツールで作成した。海洋ファンタジーの完成イメージを画風の参考とし、ゲーム用に配置と透過を指定して新しく生成した。元画像の切り貼りは行っていない。

基本三枚の読み込みが揃うまでは既存の図形描画を使い、画像の一部だけが切り替わる状態を避ける。失敗時も図形描画を継続する。荒海模様は危険海域専用の追加画像として読み込む。

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

内蔵の画像生成ツールを使用し、`sprites.png` を画風の参考として指定した。生成結果は縦横比3:1を保った2172×724となり、その実寸に合わせて切り出し範囲を測定した。背景の四隅のアルファ値は0、画像全体のアルファ値の範囲は0〜255。

```text
Use case: stylized-concept. Asset type: production-ready transparent PNG sprite atlas for a maritime fantasy browser game. Input image 1 is ONLY an art style reference for painterly game icons, materials, lighting, camera and palette; do not reproduce its layout or its existing objects. Create ONE new wide horizontal atlas, exactly 3 equal square columns in ONE row, ideally 1536 x 512. Genuinely transparent background with real alpha. Each sprite centered in its own third, fitting within the middle 78 percent of the slot; generous fully transparent gutters between sprites and on all outer edges. Keep all silhouettes, shadows, fog and foam inside each slot. NO labels, writing, grid, panels, background rectangle, checkerboard, vignette or watermark. Consistent crisp hand-painted miniature 2D game illustration, slightly visible front side and top, soft volume shading, restrained brush texture, ivory, worn warm wood, bronze brass and muted teal. Light from upper left. Strong simple silhouettes readable at 32 px; avoid microscopic clutter. EXACT left to right: (1) storm aftermath flotsam: a visibly broken open wooden cargo crate floating at a diagonal, broken planks, a coil of thick rope, a little seaweed and two compact turquoise foam strokes, no lightning or cloud. (2) fog lantern: a large antique bronze nautical lantern on a small floating wooden support, clear warm amber flame inside glass, tiny restrained pale blue mist curls around its base and small teal foam strokes, lantern dominant, no large surrounding glow. (3) sinking treasure ship: a small wooden sailing ship leaning markedly to the right and half submerged, ivory torn sail, a visibly open golden treasure chest with a few large coins on its exposed deck, two compact teal wave strokes at waterline. All three separate isolated cutout sprites. Match the reference's mature warm painterly maritime style exactly. No ocean or terrain background, all empty pixels truly alpha transparent.
```

## 危険海域の海面模様の生成指示

内蔵の画像生成ツールを使用し、`terrain.png` を画風と波の大きさの参考として指定した。生成結果は1774×887のRGB画像で、各パネルは887×887。水平線・船・島を含めず、静止した俯瞰地図で海域ごとの荒れ方を表す。左は波頭と砕ける泡を強く、右は暗い潮流の上へ薄い青白い霧を重ねた。通常地形の画像は変更していない。

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

