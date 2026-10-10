# 勢力3種の紋章

2026年10月11日、北海連合・群島同盟・湾岸城塞群を盾型の紋章へ変更した。北海連合は青地に生成りの長船と波、群島同盟は緑地に海鳥と三つの島、湾岸城塞群は金地に紺の三塔の城門。外洋海賊と貴族・四季の原画は変更していない。

内蔵の画像生成ツール（built-in image_gen）で `atlases/faction-crests.png`（2172×724、RGBA）を新規制作した。`atlases/faction-crests.json` と `scripts/extractUIAtlas.cjs` で透過PNGを埋め込んだ本番 `image/factions/north.svg`・`archipelago.svg`・`citadel.svg` を再現できる。旧 `heraldry.json` から再生成する場合は最後にこの新しい指定を適用する。

生成元: `C:/Users/peepk/.codex/generated_images/01a121ec-ab48-7871-944a-f4403a99fc5a/exec-1c456436-d784-4621-84c7-d9386338ffaf.png`

## 生成指示

```text
Use case: stylized-concept.
Asset type: ONE production transparent pixel-art HERALDRY atlas, exactly three equally sized square cells in ONE horizontal row. Three faction coats of arms for the medieval Northern European maritime game Shiogatari. This is heraldic symbolism, not miniature scenery or free-standing objects.
Input image: STYLE ONLY, the polished material-aware pixel art of approved UI objects. Do not copy its layout or subjects.
Primary request: THREE handsome medieval shield-shaped coats of arms with a restrained old brass rim, the same clear shield silhouette and dimensions, painted colored fields and bold SIMPLE flat heraldic charges. Each coat reads in a20–24px UI. Exactly one large graphic motif per shield, consistent structural logic, no extraneous scenery. Moderate dark navy contour, chunky deliberate pixel clusters at48x48 logical pixels, 2–4 shading steps for brass and enamel, light from upper-left. Heraldic charges should be recognizable flat painted symbols within their shield, not three-dimensional creatures, ships or buildings stuck onto the front.
LEFT, NORTH SEA UNION: deep muted BLUE enamel shield, an IVORY heraldic Nordic longship symbol, a simple curved hull and one bold square sail, TWO short pale blue wave bars beneath. Clear central sail and prow silhouette, no tiny rigging, no weapons.
CENTER, ARCHIPELAGO ALLIANCE: muted rich GREEN enamel shield, ONE large IVORY seabird with symmetrical spread wings seen frontally, THREE simple small pale gold island shapes in a horizontal group below, separated from wings, no scenery or real trees.
RIGHT, COASTAL CITADELS: warm GOLD/OCHRE enamel shield, ONE large dark NAVY heraldic three-towered fortress silhouette with square battlements and one clearly open gold arched gateway. Center tower slightly taller, side towers symmetrical. Charge is a painted graphic silhouette, not a rendered stone building.
Colors consistent with existing faction blue #7aa7ff, green #7dffb2, gold #ffd27a but rich muted fields for contrast, ivory #ddcb9e, brass #c5a460, ink #283b3d.
Framing: 3:1 landscape RGBA PNG, each complete shield centered in its equal square cell, occupies about72–78% of height and64–72% of width, fully transparent generous padding on all sides, clear gutters. No fourth icon. Actual alpha transparency outside shields.
Avoid: words, runes, letters, labels, numbers, crowns, laurels, scrolls, banner tails, skulls, pirate flag, crosses, religious motifs, flames, micro-engraving, busy ornaments, dozens of rivets, realistic metal scratches, painted grain, dithering, gradients, blur, soft glow, floor, cast shadow, backdrop, checkerboard, grid, frames outside shield, watermark.
```
