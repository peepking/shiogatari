# 設計書の案内

本フォルダは現行のゲーム仕様と設計方針を扱う。ゲーム全体の狙い・機能の関係・共通の構造は [全体設計](design.md)、数値・条件・保存規則は下記の担当文書へ集約する。プレイヤー向けの操作説明は [ゲームのREADME](../README.md) を参照する。

JavaScriptは `src/` の機能別フォルダへ配置する。各フォルダの責務とテストの読み込み方法は [JavaScriptの配置](../src/README.md) を参照する。

画風・モチーフ・縮尺ごとの表現と素材仕様は [アート方針](../artwork/README.md) にまとめる。ゲームで使う画像は `image/`、原画・切り出し設定は `artwork/` に置く。

## 仕様の参照先

| 対象 | 担当文書 |
| --- | --- |
| 兵・船・艤装の図鑑、比較、在籍・取得来歴の保存 | [兵・船・艤装の図鑑](asset-codex-design.md) |
| 任意の結末・最終航海の解放条件・航海統計 | [最終航海・航海統計](final-voyage-design.md) |
| 海賊五列強の物語・海賊王の海図・海没神話 | [海賊王の海図・海没神話](pirate-king-story-design.md) |
| 戦闘基盤・士気・敗走・援軍投入・勝敗・戦後精算 | [戦闘基盤](battle-redesign.md) |
| 兵の移動・攻撃5カテゴリ・艤装砲座と時間差斉射・表示時計・負荷と視認性 | [兵・艤装の戦闘演出](battle-effects-design.md) |
| 部隊ごとの5陣形・兵種別おまかせ・一時停止中の個別／一括指示 | [部隊陣形・一時停止指示](battle-unit-formations.md) |
| 部隊別の進軍・待機・攻撃目標・担当区域・後退と立て直し、既定のおまかせAI | [部隊行動・攻撃目標・立て直し](battle-tactical-orders.md) |
| 常駐NPC賞金首・討伐報酬・固有船・大会戦の前線効果 | [賞金首・固有船・大会戦](bounty-system-design.md) |
| 犯罪・勢力別手配・施設制限・清算・手配追跡・黒ひげの経済補正 | [勢力別賞金・犯罪・清算](faction-bounty-expansion-design.md) |
| 無法港の配置・海賊兵・禁制品・海賊依頼・検問の基本処理、海図断片の取引 | [無法港・海賊勢力](pirate-havens-design.md) |
| 自然探索・海図の入手と発見・艤装 | [探索・海図・艤装](expansion-design.md) |
| 南西・南東の危険海域、釣り優遇・警戒・天候周期・斥候・追加探索・限定イベント・賞金首 | [危険海域](dangerous-seas-design.md) |
| 通常船種・船種効果・造船所・船取引 | [船種・造船所](shipyard-design.md) |
| 物資価格・交易UI | [物資相場・交易](trade-design.md) |
| 国力・季節回復・戦争による消耗 | [国力](national-power-design.md) |
| 現在信仰による恩恵・祈りの余潮 | [信仰による恩恵](faith-design.md) |
| 神託の受領・奉納・移動・戦闘・施し・巡礼・漂流物探索・潮盟支援 | [神託](oracle-expansion-design.md) |
| 潮盟拠点の建設・支援・季節信仰・神託補正 | [潮盟拠点](tide-alliance-design.md) |
| 釣り操作・生息条件・餌・竿・釣果・図鑑 | [釣り詳細](fishing-design.md) |
| 竿以外の図鑑報酬・漁船 | [釣り図鑑の追加報酬](fishing-rewards.md) |
| 魚種の選定・名称・分類・生息条件の方針 | [魚種の設計方針](shiogatari_fishing_species_master.md) |

魚種ごとの定義は `src/fishing/fishingConfig.js` の `FISH_SPECIES` を参照する。

## 更新方針

文書を更新する前に、[AGENTS.mdの「設計・アート文書の更新規則」](../AGENTS.md#design-docs) を必ず参照する。現行仕様と採用理由を担当文書で管理し、作業ログ・旧草案・未採用案を追記しない。

プレイヤー向けのREADMEは操作や判断に使う情報を説明する。担当文書と実装が食い違う場合は差異を確認し、文書整理だけでゲームの数値や挙動を変更しない。
