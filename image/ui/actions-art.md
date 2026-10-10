# 行動UIアイコンの制作記録

## 目的と画風

承認済みの `studies/representative-v2.png` に合わせ、20–24pxでも道具や用途を見分けられるピクセル絵へ描き直す。古い図形の輪郭には合わせず、木・鉄・真鍮・帆布を中心にした海洋世界の素材感で統一する。マップ素材は変更しない。

## ファイルと生成方法

- 生成方法: 組み込み画像生成ツール。透明背景を指定。
- スタイル参照: `image/ui/studies/representative-v2.png`。
- 元の生成ファイル: `C:/Users/peepk/.codex/generated_images/01a12542-c817-7310-904e-4b5e59234d2d/exec-489208ef-3730-43b3-abb8-f45713a384a6.png`。
- 保存先: `image/ui/atlases/actions.png`。1402×1122px、RGBA、5列×4行。
- 切り出し記録: `image/ui/atlases/actions.json`。
- 共通切り出し: `scripts/extractUIAtlas.cjs`。図柄の描き替えをせず、範囲の切り出し・余白の整理・最近傍での縮小を行い、128pxの透過PNGをSVGへ埋め込む。
- 生成時のセル位置にずれがあるため、記録には実測した切り出し範囲を明示。最終航海の星も同じ範囲に含める。

## 2026年10月11日の賞金首の共用

ユーザー指定により、賞金首のUIはマップと同じ手配書へ統一した。保存した変更前のマップアトラス `image/map/redraw/sprites-before-redraw.png` の `[303, 780, 176, 207]` を切り出し、画素を変更せず `image/ui/action-bounty.svg` へ埋め込む。街の一覧・通常海域の現地確認・危険海域の現地確認に共用する。再切り出しは `node scripts/extractUIAtlas.cjs image/ui/atlases/map-bounty.json`。元の行動アトラスは他19種の再生成用に保持し、未採用のセル7は切り出し設定から除いた。

## モチーフと割り当て

| セル | ファイル | モチーフ | 用途 |
| --- | --- | --- | --- |
| 0 | action-fish.svg | 魚と木製釣り竿 | 釣り |
| 1 | action-quest.svg | 赤い封蝋の巻紙 | 依頼・貴族依頼 |
| 2 | action-wait.svg | 砂時計 | 1日待機 |
| 3 | action-shield.svg | 鉄縁の丸盾 | 迎撃・護衛 |
| 4 | action-blockade.svg | 港の杭と太い鎖 | 補給封鎖 |
| 5 | action-surrender.svg | 白い旗 | 降伏 |
| 6 | action-exit.svg | 開いた木の扉 | 入退場・逃走・辞官 |
| 8 | action-crime.svg | 暗いフードと小袋 | 裏の行動 |
| 9 | action-audience.svg | 赤い宝石の王冠 | 謁見 |
| 10 | action-office.svg | 帳簿と羽ペン | 窓口で交渉 |
| 11 | action-fishing-hut.svg | 木枠に吊った魚 | 釣り小屋 |
| 12 | action-fish-codex.svg | 魚が描かれた開いた本 | 魚図鑑 |
| 13 | action-final-voyage.svg | 星に向かう帆船 | 最終航海 |
| 14 | action-explore.svg | 真鍮のコンパス | 探索・海図の地点探索 |
| 15 | action-grand-battle.svg | 旗と交差した斧 | 大会戦 |
| 16 | action-sea-event.svg | 波と渦と船 | 危険海域の出来事 |
| 17 | action-rescue.svg | 縄と木製の浮き | 難破船の生存者救助 |
| 18 | action-shipyard.svg | 建造中の船とハンマー | 造船所 |
| 19 | action-trade.svg | 布と金貨を入れた木箱 | 物資取引・難破船の積荷回収 |

所属・身分は承認見本の紋章盾を別途利用。雇用は複数人の部隊アイコン、信仰・神託・祈りはミント色の波アイコン、海賊五列強は海賊旗、戦闘は武具、食糧搬入は食糧、献金・賄賂は資金とそれぞれ意味をそろえる。釣りボタンは状態によって釣り竿と魚図鑑を切り替える。

## 最終プロンプト

```text
Use case: stylized-concept
Asset type: a single production game UI sprite atlas, twenty isolated icons on transparent alpha, EXACT 5 columns by 4 rows, twenty equal square cells, no labels.
Input image: representative-v2.png is a STYLE REFERENCE ONLY. Use its rich readable hand-painted low-resolution pixel art language: bold dark silhouette, warm brass, cream linen, brown timber, rusty red cloth, silver iron, ocean blue. Do not copy its individual subjects. Pixel cluster art, not simple flat geometrical SVG symbols. Each icon should look intentional and beautiful enlarged AND instantly legible when reduced to 23px. Roughly 48 logical pixels across the subject, hard stepped pixels, clustered highlights and shadow, restrained details.
Composition: exactly one centered icon in each equal-sized cell. Keep each entire subject within the middle 70 percent of its cell; 15 percent transparent margin on every edge. No contact across cells. Genuine transparent background, no dark panels, no borders, no drop shadow outside silhouettes, no text, no letters, no numbers, no watermark.
Setting: fantasy medieval Northern European sea travel, practical Viking-age wood, wool, linen and iron. No modern gear, no horned helmet. Main motif dominates.
Subjects in strict reading order:
Row 1 column 1: fishing, a curved timber fishing rod with a taut curved line and one clearly recognizable silver-blue fish.
Row 1 column 2: quest, one large cream rolled parchment tied with one red wax seal, no writing.
Row 1 column 3: wait, a brass and dark timber hourglass with visible cream sand.
Row 1 column 4: defend or escort, a sturdy round timber shield with iron rim and central iron boss.
Row 1 column 5: blockade, a large heavy dark iron chain with three bold links stretched across a timber harbor post.
Row 2 column 1: surrender, one white linen flag on a timber pole, clear fluttering white silhouette.
Row 2 column 2: leave or escape, an open timber medieval doorway with a clearly visible dark opening and warm threshold, no arrow.
Row 2 column 3: bounty hunter, a cream wanted parchment with a large dark hooded face silhouette and two conspicuous gold reward coins at bottom, no lettering.
Row 2 column 4: secret criminal action, one dark plum hood with a partly shadowed face and one small burgundy coin pouch, readable mysterious hooded profile.
Row 2 column 5: audience with nobility, a large single gold crown with three simple points and red gemstone.
Row 3 column 1: negotiation at an office, a large open cream ledger with one blue feather quill diagonally across it.
Row 3 column 2: fishing hut, a large silver-blue fish hanging from a simple timber shop sign with a short crossbar, not a whole building.
Row 3 column 3: fish codex, a large open cream book with a single blue fish pictured across its open pages, strong book silhouette.
Row 3 column 4: final voyage, one compact dark timber ship with one cream square sail against a small deep blue horizon wave and a single pale gold guiding star, avoid tiny busy detail.
Row 3 column 5: exploration, one large brass compass rose set in a round brass compass case with navy blue face and cream pointed needle.
Row 4 column 1: grand battle, two bold crossed Viking axes with silver blades and dark timber handles, a small rust-red banner behind them.
Row 4 column 2: event at sea, one bold teal ocean whirlpool with cream-white foam and a tiny timber ship on its edge, clear swirling silhouette.
Row 4 column 3: rescue from shipwreck, one large coiled tan rope with a loop and a small timber float, no modern orange lifesaver.
Row 4 column 4: shipyard, a timber boat hull on supports with one large iron hammer diagonally crossing the hull, readable hull and hammer.
Row 4 column 5: goods trade, one open timber cargo crate containing a rolled cream cloth and two gold coins.
Constraints: twenty icons exactly, correct strict cell order, crisp pixel-art painting matching the reference's sophistication. No flames, no religious crosses, no modern glossy 3D, no smooth vector design, no character groups except requested hood, no rendered UI board.
```

