# 探索地点・盾・灯火の再制作

内蔵の画像生成ツール（built-in image_gen）で新しく制作した。原画は `sites-atlas.png`、1536×1024、3列2段の透過PNG。元の図柄の形を強制せず、40pxで読める道具・石・水面の構造を指定した。参照画像は新UIの船の画風だけに使用した。

生成元: `C:/Users/peepk/.codex/generated_images/01a121ec-ab48-7871-944a-f4403a99fc5a/exec-d68c9b3c-f17f-4c37-b54f-00fa8e23b7c1.png`

## 生成指示

```text
Use case: stylized-concept.
Asset type: ONE production transparent pixel-art map-object atlas for a medieval Northern European maritime browser game. Exactly 3 columns by 2 rows, six separated objects, one in each equal square cell. Landscape 3:2 PNG with actual RGBA transparent background, generous transparent gutters, no labels or grid.
Input image: ONLY a style reference for well-formed material-aware pixel art, NOT a subject to copy. Match its readable warm wood/brass/cream and carefully clustered color planes.
Primary request: Draw six NEW coherent map symbols. Their real screen size is a 40-pixel longest dimension. Design at about 48 logical pixels for each object, not a detailed painting later pixelated. Clearly authored 16-bit game pixel art with restrained dark blue-gray #283b3d contour, broad 2–4-shade material clusters, clean structure, light upper left. Native-size clarity is paramount. Never force malformed shapes from any old map art.
Exact row-major contents:
TOP LEFT rumor/nautical chart: a broad cream parchment map with naturally rolled upper-left and lower-right edges, a simple blue coastline line and one distinct RED X. Map corners consistent, flat legible sheet, no words, no scattered random marks.
TOP CENTER sea altar: a low two-step gray stone plinth with ONE upright rounded stone slab bearing a large simple MINT-GREEN curling wave relief, 2 large dark carved recesses at most; gently worn stone volumes. No flame, glowing crystal, magical aura, giant rocks or temple roof.
TOP RIGHT sheltered inlet: a crescent of THREE broad natural gray rock outcrops with one small olive shrub, curling around a clearly visible turquoise sheltered water pool opening toward the lower right, a narrow pale sand edge. Top-down/three-quarter map prop, not a full square island or water tile. Water only within this compact crescent.
BOTTOM LEFT old seabed bell: ONE recognizable old brass ship's bell with a sturdy top suspension loop, broad flared lower lip and a clearly visible dark hollow opening/clapper, a little green seaweed at its base, two small gray stones. Natural metal bell structure, no stack of disconnected rings, no vague shrine.
BOTTOM CENTER defensive shield: ONE sturdy medieval heater shield, cream and muted blue QUARTERED face, plain brass rim and tiny iron central boss. Symmetric coherent shield face, thick enough rim to read, no swords, badges or text.
BOTTOM RIGHT fog lantern: ONE old brass nautical oil lantern with broad metal top and a large ring handle, a rectangular blue-glass body containing a small warm amber light, mounted on THREE flat wood raft planks with a simple rope coil, two tiny white water accents. Correct connected handle/top/body/base. No vast flame, fog cloud, aura or scenery.
Framing: each whole object centered in its own equally sized cell, occupies 74-80% of cell, nothing near neighboring object. Crisp intentional square pixels of consistent size, rather than diagonal vector outlines or isolated texture specks. Actual transparency all around. Palettes stone #9aaba8/#617979, brass #c5a460, ivory #ddcb9e, sea #245876/#4b9eaa, moss #456246.
Avoid: antialiasing, blur, soft glow, gradients, smooth painted texture, mottled speckles, dozens of tiny ornaments, gibberish ornament, inconsistent geometry, checkerboard background, cast shadow, floor, terrain tiles, watermark, text, captions.
```
