/* eslint-env node */
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** 確認とガイドの重なり・委譲イベント・フォーカスを検証する最小画面要素。 */
class TestElement {
  /** @param {string} tag 要素名。 @param {object|null} document 画面。 */
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.children = []; this.listeners = {}; this.dataset = {}; this.className = "";
    this.hidden = false; this.text = "";
  }

  /** @param {string} value 表示内容。 子要素も消して設定する。 */
  set textContent(value) { this.text = String(value); this.children = []; }
  /** @returns {string} 子要素を含む表示内容。 */
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  /** @returns {object} 確認画面の表示クラスを管理する。 */
  get classList() {
    return {
      /** @param {string} name クラス。 @param {boolean} enabled 付与するか。 @returns {void} */
      toggle: (name, enabled) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(" ");
      },
      /** @param {string} name クラス。 @returns {boolean} 付与されているか。 */
      contains: name => this.className.split(/\s+/).includes(name),
    };
  }
  /** @param {...object} nodes 子要素。 @returns {void} 親への伝播先も記録する。 */
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  /** @param {string} type イベント名。 @param {Function} handler 処理。 @returns {void} */
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  /** @param {string} selector 検索条件。 @returns {boolean} 条件に一致するか。 */
  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    if (selector === "[data-guide-dialog]") return !!this.dataset.guideDialog;
    return this.tagName.toLowerCase() === selector;
  }
  /** @param {string} selector 検索条件。 @returns {object[]} 配下の一致要素。 */
  querySelectorAll(selector) {
    const selectors = selector.split(",").map(value => value.trim()), found = [];
    for (const child of this.children) {
      if (selectors.some(value => child.matches(value))) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  /** @param {string} selector 検索条件。 @returns {object|null} 最初の一致要素。 */
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  /** @param {string} selector 検索条件。 @returns {object|null} 自身または最寄りの一致する親。 */
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  /** @returns {void} 操作後に戻るフォーカスを記録する。 */
  focus() { this.ownerDocument.activeElement = this; }
  /** @returns {void} 指定した質問へスクロールしたことを記録する。 */
  scrollIntoView() { this.scrolled = true; }
  /** @returns {object[]} 表示中の操作だけをフォーカス移動の対象にする。 */
  getClientRects() { return this.hidden ? [] : [{}]; }
  /** @param {string} type イベント名。 @param {object} [values] キーなど。 @returns {object} 親へ伝播したイベント。 */
  trigger(type, values = {}) {
    const event = { target: this, ...values, defaultPrevented: false, stopped: false,
      /** @returns {void} 通常の操作を止める。 */
      preventDefault() { this.defaultPrevented = true; },
      /** @returns {void} 下の確認画面への伝播を止める。 */
      stopPropagation() { this.stopped = true; } };
    let current = this;
    while (current) {
      for (const listener of current.listeners[type] || []) listener(event);
      if (event.stopped) break;
      current = current.parentElement;
    }
    return event;
  }
}

/** @returns {object} 初期画面を作る。 */
function createDocument() {
  const document = new TestElement("document", null); document.ownerDocument = document;
  /** @param {string} tag 要素名。 @returns {object} 動的要素。 */
  document.createElement = tag => new TestElement(tag, document);
  /** @param {string} id 識別子。 @returns {object|null} 登録済み要素。 */
  document.getElementById = id => document.querySelector(`#${id}`);
  return document;
}

/** @param {object} document 画面。 @param {Function} confirm フォールバック。 @returns {Promise<object>} 実際の確認・ガイド処理。 */
async function loadUI(document, confirm) {
  const context = vm.createContext({ document, window: { confirm } });
  const values = {
    "./state.js": { state: {} }, "./storage.js": { scheduleGameSave() {} },
    "./logStore.js": { MAX_LOG_ENTRIES: 100, normalizeLogs: value => value },
    "./util.js": { escapeHtml: value => String(value), formatGameTime: () => "", nowStr: () => "" },
  };
  const module = new vm.SourceTextModule(readSource("dom.js"), { context });
  await module.link(name => new vm.SyntheticModule(Object.keys(values[name]),
    /** @returns {void} 確認画面と無関係な保存・ログ依存を差し替える。 */
    function publish() { for (const [key, value] of Object.entries(values[name])) this.setExport(key, value); }, { context }));
  await module.evaluate();
  const guide = new vm.SourceTextModule(readSource("guideUI.js"), { context });
  await guide.link(() => {}); await guide.evaluate();
  return { ...module.namespace, ...guide.namespace };
}

/** @returns {Promise<void>} 項目・互換性・一度だけの実行・ガイドからの復帰を検証する。 */
async function main() {
  const document = createDocument();
  /** @param {string} tag 要素名。 @param {string} id 識別子。 @param {object} [parent] 表示先。 @returns {object} 画面へ置いた要素。 */
  function element(tag, id, parent = document) { const node = document.createElement(tag); node.id = id; parent.append(node); return node; }
  const modal = element("div", "confirmModal"); modal.hidden = true;
  const title = element("h2", "confirmTitle", modal), body = element("div", "confirmBody", modal);
  const ok = element("button", "confirmOk", modal), cancel = element("button", "confirmCancel", modal), close = element("button", "confirmClose", modal);
  const help = element("div", "helpModal"), trouble = element("div", "troubleModal");
  for (const dialog of [help, trouble]) {
    dialog.hidden = true;
    const button = element("button", `${dialog.id}Close`, dialog); button.className = "modal-close";
    const content = element("div", `${dialog.id}Body`, dialog); content.className = "modal-bd";
  }
  const topic = element("details", "guide-quests", trouble.querySelector(".modal-bd")); topic.className = "guide-question";
  const summary = element("summary", "questSummary", topic);
  const other = element("details", "guide-other", trouble.querySelector(".modal-bd")); other.className = "guide-question"; other.open = true;
  element("summary", "otherSummary", other);
  let inheritedEscape = 0; document.addEventListener("keydown", () => { inheritedEscape++; });
  const ui = await loadUI(document, () => { throw new Error("画面があるためフォールバックしない"); }); ui.wireGuideHelp();
  let performed = 0;
  const sections = [{ title: "費用", items: ["資金1000", "所要1日"] }, { title: "不利益", items: ["好感度−3", "敗北時は報酬なし"] }];
  ui.confirmAction({ title: "行動の確認", body: "実行内容", sections, onConfirm: () => { performed++; } });
  assert.equal(title.textContent, "行動の確認"); assert.equal(modal.hidden, false);
  for (const text of ["実行内容", "費用", "資金1000", "所要1日", "不利益", "好感度−3", "敗北時は報酬なし"]) assert.ok(body.textContent.includes(text));
  assert.equal(body.querySelectorAll("li").length, 4);
  cancel.trigger("click"); ok.trigger("click"); assert.equal(performed, 0, "取消後には古い実行処理を呼ばない");
  ui.confirmAction({ title: "旧形式", body: "本文だけ\n資金500", onConfirm: () => { performed++; } });
  assert.equal(body.textContent, "本文だけ\n資金500"); assert.equal(modal.classList.contains("confirmation-structured"), false);
  ok.trigger("click"); ok.trigger("click"); assert.equal(performed, 1, "連打・再表示でも実行は一度だけ");
  ui.confirmAction({ title: "閉じる", body: "未実行", onConfirm: () => { performed++; } });
  close.trigger("click"); ok.trigger("click"); assert.equal(performed, 1);
  ui.confirmAction({ title: "背景で閉じる", onConfirm: () => { performed++; } });
  modal.trigger("click"); ok.trigger("click"); assert.equal(performed, 1);
  ui.confirmAction({ title: "ガイドを読む", sections, guideTopic: "guide-quests", onConfirm: () => { performed++; } });
  const textBefore = body.textContent, guideButton = body.querySelector("[data-guide-dialog]"); guideButton.focus();
  const open = guideButton.trigger("click");
  assert.equal(open.defaultPrevented, true); assert.equal(trouble.hidden, false); assert.equal(help.hidden, true);
  assert.equal(topic.open, true); assert.equal(other.open, false); assert.equal(topic.scrolled, true); assert.equal(document.activeElement, summary);
  assert.equal(modal.hidden, false); assert.equal(body.textContent, textBefore); assert.equal(performed, 1, "ガイドを読むだけでは行動しない");
  const escape = summary.trigger("keydown", { key: "Escape" });
  assert.equal(escape.defaultPrevented, true); assert.equal(escape.stopped, true); assert.equal(inheritedEscape, 0);
  assert.equal(trouble.hidden, true); assert.equal(modal.hidden, false); assert.equal(document.activeElement, guideButton);
  ok.trigger("click"); ok.trigger("click"); assert.equal(performed, 2, "ガイドから戻っても確認中の実行処理を維持する");

  let accepted = false, fallbackText = "", fallbackPerformed = 0;
  const fallback = await loadUI(createDocument(), text => { fallbackText = text; return accepted; });
  const options = { title: "標準確認", body: "本文", sections, onConfirm: () => { fallbackPerformed++; } };
  fallback.confirmAction(options); assert.equal(fallbackPerformed, 0);
  assert.equal(fallbackText, "標準確認\n\n本文\n\n費用\n資金1000\n所要1日\n\n不利益\n好感度−3\n敗北時は報酬なし", "標準確認でも全項目と不利益を残す");
  accepted = true; fallback.confirmAction(options); assert.equal(fallbackPerformed, 1);
  console.log("ガイド・確認画面: 費用/不利益・旧本文・全文フォールバック・一度だけの実行・動的ガイド/フォーカス復帰: 成功");
}

/** @param {Error} error 検証失敗。 @returns {void} 終了コードへ反映する。 */
function reportFailure(error) { console.error(error); process.exitCode = 1; }
main().catch(reportFailure);
