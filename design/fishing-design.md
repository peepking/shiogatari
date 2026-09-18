# 釣りシステム 詳細設計書

作成日: 2026-09-18  
状態: 実装済み仕様を文書化  

---

## 1. 釣りセッションの基本仕様

### 1.1 基本仕様

- **実行場所**: 海上（海・浅瀬）のみ
- **開始条件**: 海上で「釣り」ボタンを押下、確認ダイアログで「1日使って釣る」を選択
- **日数消費**: セッション開始時に1日消費（最大5回まで釣行可能）
- **回数制限**: 1セッション最大5回のキャスト
- **終了条件**: 5回キャスト完了、または「釣りを終了」ボタン押下、竿未所持

### 1.2 セッション状態遷移

```
通常（海上・竿所持） → 釣り開始（1日消費・セッション作成）
  ↓
キャスト待ち（餌選択 → 釣るボタン） 
  ↓
待機（糸を垂れています…） → アタリ発生（猶予時間内に「引く」）
  ↓
結果判定（成功・失敗・空振り）
  ↓
釣果発表（成功時のみ：魚名・サイズ・初釣果・最大更新）
  ↓
「次へ」でキャスト待ちへ戻る（残り回数減少）
  ↓
5回終了 または 終了ボタン → セッション終了 → 通常画面へ
```

---

## 2. 餌システム

### 2.1 餌の種類と価格

| 餌ID | 表示名 | 価格 | 分類 |
|------|--------|------|------|
| `insect` | 虫餌 | 2 | 一般魚向け |
| `shell` | 甲殻類 | 5 | 大物向け |
| `cut` | 魚肉団子 | 7 | 大物・超大物向け |
| `small` | 小魚 | 10 | 一般魚・大物向け |

### 2.2 餌の所持・消費

- **保存場所**: `state.expansion.fishing.bait` （各餌IDごとの個数）
- **消費タイミング**: キャスト実行時（`doCast` 呼び出し時）
- **消費量**: 1キャストにつき選択中の餌を1個消費
- **所持0の餌**: 選択不可（セレクトボックスで disabled）、キャスト不可

### 2.3 餌の入手方法

1. **購入**: 街・村の釣り小屋で購入可能（`openBaitPurchase`、eventTradeパターン）
2. **加工**: 釣った魚を「餌に加工」で変換（`processToBait`）
   - 全数加工（個数指定なし、全匹一括）
   - 獲得量 = 匹数 × `dressFood`
   - 変換先は魚種ごとの `feedType` による

### 2.4 魚から餌への加工（feedType）

各魚種に `feedType` を定義し、加工時の餌の種類を決定する。

| feedType | 対象魚介類 | 変換先餌 |
|---------|-----------|---------|
| `shell` | エビ・カニ・シャコ | 甲殻類 |
| `cut` | イカ・タコ・ウミヘビ・大型魚・深海魚・古代魚 | 魚肉団子 |
| `small` | 小型魚（イワシ・アジ・サンマ・キス・メバル等） | 小魚 |

- `insect` になる魚介類はなし
- `feedType` は `FISH_SPECIES` の各エントリに定義

### 2.5 餌の購入

- **場所**: 街・村の釣り小屋（`canSell()` 真の場所）
- **UI**: イベント取引パターン（`eventTrade`、数量入力UI）
- **在庫**: 無制限（stock: 999）
- **制限**: 街・村以外ではボタン非表示、購入不可（`canSell()` で制御）

---

## 3. 釣り竿システム

### 3.1 竿の段階と性能

| 竿ID | 表示名 | 倍率 | 必要完成率 |
|------|--------|------|------------|
| `rod_basic` | 粗末な釣り竿 | 0.500 | 0% (初期) |
| `rod_sturdy` | 丈夫な釣り竿 | 0.625 | 10% |
| `rod_fine` | 上等な釣り竿 | 0.750 | 30% |
| `rod_master` | 名人の釣り竿 | 0.875 | 55% |
| `rod_ancient` | 古き海の釣り竿 | 1.000 | 80% |

### 3.2 効果

- **影響範囲**: アタリ発生後の入力猶予時間（タイミング窓）のみ
- **計算式**: `actualWindow = Math.floor(baseWindow * multiplier)`
- **下限**: 2秒保証（`Math.max(2, multiplied)`）
- **影響しないもの**: 魚の出現率、サイズ、餌の重み、大物率、category、サイズ抽選、釣りタイミング難易度以外

### 3.3 解放条件

- **判定基準**: 魚図鑑完成率（発見済み魚種数 ÷ 全魚種数）
- **判定タイミング**: 釣り小屋（街・村）を開いたとき
- **判定方式**: `completion.ratio >= requiredRatio` （以上判定）
- **複数段階スキップ**: 条件を満たす最高ランクのみ1回で取得（連続表示しない）
- **取得済み管理**: `state.expansion.fishing.rodId` で現在の竿を管理

### 3.4 受け取りフロー

1. 街・村で「釣り小屋」ボタン押下 → `openFishingPanel()` 呼び出し
2. `canSell()` 真なら `checkRodUpgrade(state)` で判定
3. 新しい竿がある場合 `showRodRewardModal()` で報酬モーダル表示
3. 「受け取る」ボタンで確定 → `rodId` 更新・保存 → パネル再描画
4. 報酬モーダル：竿名・フレーバーテキスト・コンテキスト表示、自動高さ調整

---

## 4. 釣りの一連のフロー

### 4.1 キャスト

- **開始**: 「釣る（残りN回）」ボタン押下 → `doCast()` 呼び出し
- **餌選択**: セレクトボックスで現在選択中の餌を使用
- **餌消費**: `consumeBait(state, currentBaitId)` で1個消費
- **抽選実行**: `rollCatch(env, currentBaitId)` で魚種決定
- **待機開始**: `pending.waitUntil = Date.now() + biteWaitMs()`（2〜5秒）

### 4.2 待機

- 表示: 「糸を垂れています…」
- タイマー: `biteWaitMs()`（2000〜5000ms）後、`resolveWait()` 呼び出し
- 早すぎる「引く」: 「早すぎて魚は掛かっていなかった…」ログ、回数消費、餌消費済み

### 4.3 アタリ

- 表示: カテゴリ別メッセージ
  - 一般魚: 「アタリ！ 魚が掛かった！」
  - 大物: 「アタリ！ 強い引きだ！」
  - 超大物: 「アタリ！ とんでもない引きだ！」
- 表示: 「引く」ボタン、ゲージ（猶予時間）
- 色分け: 一般魚=青系、大物=金系、超大物=赤系（枠線・ゲージ・背景）

### 4.4 結果判定

- **成功**: 猶予時間内に「引く」押下
  - サイズ抽選（`rollSize`）
  - 釣果記録（`recordCatch`：在庫・図鑑・最大サイズ更新）
  - `resultScreen` に成功情報セット
  - `pending.lastResult = { speciesId, size, success: true }`
- **失敗**: 時間切れまたは早すぎ
  - `resultScreen` に失敗情報セット
  - `pending.lastResult = { success: false }`（魚名非公開）
  - ログ: 「魚に逃げられた。」

### 4.5 釣果発表（成功時のみ）

- 表示: 魚名、サイズ、バッジ（初釣果・最大サイズ更新）
- 色分け: 竿と同じカテゴリカラー
- 「次へ」ボタンで次へ進行

### 4.6 次の釣り

- 「次へ」押下で `resultScreen = null` → 再描画
- 前回の餌が残っていれば選択維持、0個なら所持数>0の最初の餌へ自動切替
- 全餌0なら未選択・キャスト不可

### 4.7 終了

- 「釣りを終了」ボタンで `pending = null`、保存、ログ出力
- セッション終了、通常のキャスト待ち画面へ

---

## 5. 釣果表示

### 5.1 表示項目

| 項目 | 内容 |
|------|------|
| 魚名 | 釣った魚の名前 |
| サイズ | cm単位（整数） |
| 初釣果 | その魚種の図鑑カウントが0→1になった場合のみ表示 |
| 最大サイズ更新 | 今回のサイズが図鑑の最大サイズを超えた場合のみ表示 |

### 5.2 表示順序

1. 魚名＋「を釣り上げた！」
2. サイズ（cm）
3. バッジ（最大サイズ更新！ → 初釣果！ の順）
4. 「次へ」ボタン

### 5.3 色分け

- 一般魚: 青系（#69cfca 系）
- 大物: 金系（#bca16a 系）
- 超大物: 赤系（#e06c6c 系、box-shadow 付き）

---

## 6. 釣り竿獲得時の表示

### 6.1 表示内容

- タイトル: 「釣り竿ゲット」
- メッセージ: 「新しい釣り竿を手に入れた！」
- 竿名（大文字見出し）
- コンテキスト（釣り小屋の主人からの贈り言葉）
- フレーバー（竿の由来・特徴）
- 「受け取る」ボタン

### 6.2 レイアウト

- ダイアログ高さ: コンテンツに合わせて自動調整（`height: auto`）
- 下端は「受け取る」ボタンの少し下まで
- 既存の間隔・余白を維持
- 横幅は既存のまま

### 6.3 発生タイミング

- 街・村で「釣り小屋」ボタン押下時のみ
- 海上で竿なしの場合はトースト表示のみ（パネルには「釣り竿を持っていません」表示）

---

## 7. 釣り小屋の役割

### 7.1 機能

| 機能 | 場所 | 条件 |
|------|------|------|
| 釣りセッション継続・開始 | 海上・街・村 | 竿所持時 |
| 魚の売却 | 街・村 | 魚所持時・非アタリ中 |
| 図鑑閲覧 | 常時 | - |
| **初回竿受け取り** | 街・村 | 竿未所持時のみ |
| **竿アップグレード受け取り** | 街・村 | 図鑑完成率到達時 |
| **餌購入** | 街・村 | 常時（`canSell()` 真の時のみ表示） |
| **魚の加工（餌・食料）** | 常時 | 魚所持時・非アタリ中 |

### 7.2 釣り小屋での処理フロー

1. 「釣り小屋」ボタン押下 → `openFishingPanel()`
2. 竿未所持なら初回竿受け取りイベント
3. 竿所持かつ街/村なら竿アップグレード判定
4. パネル表示（セッション・インベントリ・フッター）

---

## 8. 魚図鑑との連携

### 8.1 図鑑登録

- **タイミング**: 釣り上げ成功時（`recordCatch` 呼び出し時）
- **内容**: `counts` 加算、`codex` 登録・更新（count, maxSize, maxSizeAbs, maxSizePos）
- **初釣果判定**: 図鑑 count が 0→1 になる場合
- **最大サイズ更新**: 今回のサイズ > 既存 maxSize の場合

### 8.2 完成率による竿解放

- 完成率 = 発見済み魚種数 ÷ 全魚種数（286種）
- 閾値: 10%/30%/55%/80% で順次解放
- 判定: `completion.ratio >= requiredRatio`（以上判定）

### 8.3 図鑑データ構造

```javascript
codex[speciesId] = {
  count: number,           // 釣獲回数
  maxSize: number,         // 最大サイズ
  maxSizeAbs: number,      // 最大サイズ記録日（絶対日）
  maxSizePos: {x, y}       // 最大サイズ記録場所
}
```

---

## 9. 関連する保存データ・主要データ構造

### 9.1 釣り状態 (`state.expansion.fishing`)

```javascript
{
  rodId: string | null,           // 現在の竿ID（未所持なら null）
  counts: { [speciesId]: number }, // 所持魚の個数
  codex: { [speciesId]: CodexEntry }, // 図鑑データ
  bait: { insect: number, shell: number, cut: number, small: number }, // 餌所持数
  pending: FishingPending | null, // 進行中セッション
  // 以下は釣りセッション中のみ
  // baitId: string (互換用、セッション固定餌・新規では null)
  // currentBaitId: string (現在のキャストで使用中の餌、実行時のみ)
  // castsLeft: number, dayApplied: boolean, catch, waitUntil, hookSpeciesId, lastResult, lastDay
}
```

### 9.2 セッション中の一時データ (`pending`)

```javascript
{
  baitId: string | null,          // 互換用（新規セッションでは null）
  currentBaitId: string | null,   // 現在のキャストで使用中の餌（実行時のみ）
  castsLeft: number,              // 残りキャスト数（初期5）
  dayApplied: boolean,            // 日数消費済みフラグ
  catch: { speciesId, windowSeconds } | null, // アタリ中の魚
  waitUntil: number | null,       // 待機完了時刻
  hookSpeciesId: string | null,   // 掛かった魚のID（待機中）
  lastResult: LastResult | null,  // 前回結果
  lastDay: number | null          // セッション開始日（絶対日）
}
```

### 9.3 結果画面用一時データ (`resultScreen`)

```javascript
// 成功時
{ success: true, speciesId, size, firstCatch: boolean, maxUpdate: boolean }
// 失敗時
{ success: false }
```

### 9.4 図鑑エントリ (`codex`)

```javascript
{
  count: number,
  maxSize: number,
  maxSizeAbs: number | null,
  maxSizePos: { x, y } | null
}
```

---

## 10. 主要関数・モジュール対応表

| 機能 | モジュール | 主な関数 |
|------|-----------|----------|
| セッション管理 | `fishingUI.js` | `beginFishing`, `doCast`, `resolveWait`, `resolveBite`, `openFishingPanel` |
| 餌消費・加工・購入 | `fishing.js` | `consumeBait`, `processToBait`, `purchaseBait` |
| 抽選・窓計算 | `fishing.js` | `rollCatch`, `windowFor`, `rollSize`, `getCurrentRod`, `checkRodUpgrade` |
| 図鑑・記録 | `fishing.js` | `recordCatch`, `codexCompletion`, `speciesById` |
| UI描画 | `fishingUI.js` | `sessionHtml`, `resultAnnouncementHtml`, `inventoryHtml`, `wireSessionButtons` |
| 報酬モーダル | `fishingUI.js` | `showRodRewardModal` |
| 状態保存・復元 | `fishing.js` | `createFishingState`, `normalizeFishing`, `sessionDayRule` |
| 図鑑完成率 | `fishing.js` | `codexCompletion`, `codexRevealState` |

---

## 11. 設定定数 (`fishingConfig.js`)

```javascript
FISHING_CONFIG = {
  castsPerSession: 5,
  seaQuadrantSize: 25,
  minBiteWaitMs: 2000,
  maxBiteWaitMs: 5000,
  gaugeStressColor: true,
  gaugeStressAt: 0.3,
}

ROD_DEFS = {
  rod_basic:    { name: "粗末な釣り竿", windowMultiplier: 0.5 },
  rod_sturdy:   { name: "丈夫な釣り竿", windowMultiplier: 0.625 },
  rod_fine:     { name: "上等な釣り竿", windowMultiplier: 0.75 },
  rod_master:   { name: "名人の釣り竿", windowMultiplier: 0.875 },
  rod_ancient:  { name: "古き海の釣り竿", windowMultiplier: 1.0 },
}

ROD_UPGRADE_THRESHOLDS = [
  { rodId: "rod_basic", name: "粗末な釣り竿", requiredRatio: 0.0 },
  { rodId: "rod_sturdy", name: "丈夫な釣り竿", requiredRatio: 0.10 },
  { rodId: "rod_fine", name: "上等な釣り竿", requiredRatio: 0.30 },
  { rodId: "rod_master", name: "名人の釣り竿", requiredRatio: 0.55 },
  { rodId: "rod_ancient", name: "古き海の釣り竿", requiredRatio: 0.80 },
}

BAIT_DEFS = {
  insect: { name: "虫餌", price: 2 },
  shell: { name: "甲殻類", price: 5 },
  cut: { name: "魚肉団子", price: 7 },
  small: { name: "小魚", price: 10 },
}
```

---

## 12. 実装ファイル対応表

| ファイル | 役割 |
|---------|------|
| `fishing.js` | 核心ロジック（抽選、窓計算、記録、餌操作、竿判定） |
| `fishingUI.js` | UI描画・イベントハンドリング・モーダル表示 |
| `fishingConfig.js` | 定数定義（竿・餌・閾値・窓設定） |
| `index.html` | モーダル構造（釣り・図鑑・竿報酬） |
| `styles.css` | スタイル（竿色分け、報酬モーダル高さ自動、終了ボタン配置） |
| `fishingConfig.js` | `FISH_SPECIES` に `feedType` 追加済み（286種） |

---

以上、現在実装されている釣りシステムの仕様を文書化しました。