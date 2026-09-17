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

---

## User Authority

Only the user may modify or override these rules. Do not change this file unless explicitly told to.
