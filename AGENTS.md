# Agent Instructions (REQUIRED)

All rules here are hard constraints unless explicitly overridden by the user.

---

## Encoding & File Safety (CRITICAL)

All files MUST be UTF-8 without BOM.

- Prefer `apply_patch` for modifications; use minimal diffs
- Never rewrite entire files unless explicitly requested
- NEVER use PowerShell encoding commands: `Set-Content`, `Out-File`
- Only use tools that guarantee UTF-8 (no BOM)

---

## Project Overview

- **Shiogatari** — TRPG-style browser sandbox game (日本語)
- Zero bundler / zero framework. Runs as native ES modules via `<script type="module">`
- Dev server: use Live Server (e.g. VS Code extension). No build step needed
- All source files are flat in the repository root (~60 `.js` files)
- Entry point: `main.js` → imports from `ui.js`, `layout.js`, `rosterOptions.js`, `numberInputUI.js`

---

## Commands

```bash
npm test          # runs all 24 tests sequentially (pretest + test)
npx eslint .      # lint (no `lint` script defined; use npx directly)
```

**No lint script** — `package.json` has no `lint` or `format` script.

---

## Testing

- Tests live in `tests/*.test.cjs` (CJS, not ES modules)
- **No test framework** — uses `node:assert/strict` only
- Most tests require `node --experimental-vm-modules` (see `package.json` scripts)
- Tests load ES module source files via `vm.SourceTextModule` and extract exports manually
- Some tests create mock browser contexts via `vm.createContext` with hand-built `document`, `elements`, etc.
- Run a single test: `node --experimental-vm-modules tests/<name>.test.cjs`
- Tests run sequentially via `&&` in npm scripts — a failure stops the chain

---

## Coding Rules

- **No inline CSS** — do not use `<style>` tags or `style=` attributes. Use CSS classes. Exception: content injected via `innerHTML`
- **No full-width character comparisons** — use internal IDs or normalized values instead
- Follow existing naming conventions across JS / HTML / CSS; do not introduce new styles

---

## Comments & Documentation

- All comments and JSDoc descriptions must be in **Japanese**
- JSDoc tags (`@param`, `@returns`, etc.) remain standard (not translated)
- All functions must have JSDoc
- For logic involving randomness, priority rules, or distribution rules (damage, wear, allocation), explain the rules in function-level comments
- Prefer block-level intent comments over line-by-line commentary

---

## Module Structure

If a file becomes large or complex, split by responsibility into feature-based modules. Current large files to be aware of: `battle.js`, `ui.js`, `quests.js`, `map.js`, `actions.js`, `faction.js`.

---

## Design Docs

Game design documents are in `design/*.md` — consult these before implementing game mechanics.

### 設計・アート文書の更新規則（必須）

`design/` と `artwork/` の文書は、**現行の仕様および採用済みの設計・デザイン方針の正本**とする。以下は両フォルダ内のすべての文書に適用する。

- 記載するのは現行仕様、採用理由、調整方針、整合性の条件。数値・抽選・優先順位・保存形式・旧保存との互換性も設計として扱う。
- アート文書には現行の画風・構図・配色・モチーフ・寸法・余白・透過条件、原画と表示素材の対応、必要な切り出し・再配置手順を記載する。
- **AIの作業メモを記録しない。** 会話や承認の経緯、引き継ぎ、作業進捗、実装の段取り、完了報告、特定日のテスト・画面確認結果、AIの作業・実行環境に由来する制約や失敗理由は記載しない。
- 画像生成プロンプト、個人環境の絶対パス、生成・実行IDは記載しない。必要な画風や素材の条件は、現行の仕様として日本語で整理する。
- 置き換え済みの旧仕様・草案、未採用案・未実装案は残さない。上記の禁止内容を両フォルダ内の別文書・付録・履歴用フォルダへ移して保存することも禁止する。
- 仕様変更時は古い本文を置き換え、現行の仕様と理由へ統合する。読者に追記の優先順位や過去の作業段階を解釈させない。同じ仕様は担当文書へ集約し、他の文書には概要とリンクを置く。
- 作業記録にだけある現行仕様は、本文へ移してから作業記録を削除する。コード参照・計算式・保存互換・素材の再加工設定や手順は保持する。文書整理だけでゲームの数値・挙動や採用素材を変更しない。
- ゲーム内AIの判断規則、ゲーム中の進捗・完了条件・保存状態、対応ブラウザや素材形式など製品の制約は現行仕様であり、AIの作業ログと混同しない。

---

## User Authority

Only the user may modify or override these rules. Do not change this file unless explicitly told to.
