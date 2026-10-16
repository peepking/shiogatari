# 行動UIアイコン

## 目的と画風

20〜24pxでも道具や用途を見分けられるピクセル絵とし、木・鉄・真鍮・帆布を中心にした海洋世界の素材感で統一する。色と粒度は [UIの共通方針](README.md) に合わせる。

## 原画と切り出し

- 原画: `artwork/ui/atlases/actions.png`。1402×1122px、RGBA、5列×4行。
- 切り出し設定: `artwork/ui/atlases/actions.json`。行動19種の実測範囲を指定する。
- 賞金首の原画・設定: `artwork/map/redraw/sprites-before-redraw.png`、`artwork/ui/atlases/map-bounty.json`。
- 表示素材: `image/ui/action-*.svg`。基本128pxの透過PNGをSVGへ埋め込み、viewBoxは24×24。

`scripts/extractUIAtlas.cjs` で範囲の切り出し・余白の整理・最近傍での縮小を行う。賞金首は `[303, 780, 176, 207]` の切り出し画素をそのまま使い、街の一覧・通常海域の現地確認・危険海域の現地確認で共用する。

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
| 共用 | action-bounty.svg | マップと同じ手配書 | 賞金首 |
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

所属・身分は共用原画の紋章盾を利用する。雇用は複数人の部隊アイコン、信仰・神託・祈りはミント色の波アイコン、海賊五列強は海賊旗、戦闘は武具、食糧搬入は食糧、献金・賄賂は資金とそれぞれ意味をそろえる。釣りボタンは状態によって釣り竿と魚図鑑を切り替える。

退出扉は灰色の丸アーチの石枠に、右の柱へ蝶番を固定した木の扉を組み合わせる。扉は手前に開き、厚み・上下の辺・金具・自由端の取っ手を同じ向きへ揃える。

実際の行動ボタンと小さい表示・拡大表示は `tests/uiArtPreview.html` で確認する。
