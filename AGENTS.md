# Codex Agent Instructions (REQUIRED)

This file defines **hard constraints** for Codex when editing this repository.
All rules here MUST be followed unless explicitly overridden by the user.

If Codex behavior conflicts with this file, **this file takes priority.**

---

## 🚨 Encoding & File Safety (CRITICAL)

All files MUST be written in:
- UTF-8
- WITHOUT BOM

To prevent encoding corruption:

- Prefer `apply_patch` for all modifications
- Never rewrite entire files unless explicitly requested; use minimal diffs via apply_patch.
- NEVER use PowerShell default encoding commands:
  - `Set-Content`
  - `Out-File`
- Only use tools that explicitly guarantee UTF-8 (no BOM) if writing files is unavoidable

Violating this rule is considered a critical failure.

---

## 🧱 Coding Rules

- Do NOT directly use `<style>` tags or inline CSS
  - Use CSS classes instead
  - Exception: content generated via `innerHTML`
- Do NOT compare 2-byte (full-width) characters in logic
  - Use internal IDs or normalized internal values for comparison

---

## 📛 Naming

- Follow the **existing JS / HTML / CSS naming conventions**
- Do not introduce new naming styles unless explicitly requested

---

## 🧩 Module Structure

If a file or function becomes large or complex:
- Split by responsibility
- Use feature-based modules

---

## 📝 Comments & Documentation

### JSDoc
- All functions must use JSDoc
- If a function already has comments:
  - Remove old comments
  - Write a new JSDoc instead

### Language
- All comments must be written in Japanese.
- JSDoc descriptions MUST be written in Japanese
- JSDoc tags (@param, @returns, etc.) must remain standard and must not be translated.

### Internal behavior
For logic involving:
- Randomness
- Priority rules
- Distribution rules (e.g. damage, wear, allocation)

Explain the rules clearly in function-level comments.

Avoid line-by-line commentary.
Prefer block-level explanations describing intent.

---

## 🧠 Codex Operating Rules

- This file MUST be treated as system-level instructions
- If unsure, Codex must ask rather than violate these rules
- If a request conflicts with these rules, Codex must point out the conflict

---

## 🔒 User Authority

Only the user may modify or override the rules in this file.
Codex must not change this file unless explicitly told to.

---
