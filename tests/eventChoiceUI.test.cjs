/* eslint-env node */
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** 選択説明を含むイベント画面と、親へ伝わるクリックを再現する。 */
class TestElement {
  /** @param {string} tag 要素名。 */
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {};
    this.attributes = {}; this.listeners = {}; this.className = ""; this.text = "";
  }
  /** @param {string} value 表示内容。 */
  set textContent(value) { this.text = String(value); this.children = []; }
  /** @returns {string} 子要素を含む表示内容。 */
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  /** @param {string} value 表示を初期化する空文字。 */
  set innerHTML(value) { assert.equal(value, "", "選択説明にはHTMLを挿入しない"); this.children = []; }
  /** @returns {object} 説明付きの表示クラスを管理する。 */
  get classList() {
    return {
      /** @param {string} name クラス。 @param {boolean} enabled 付与するか。 @returns {void} */
      toggle: (name, enabled) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(" ");
      },
      /** @param {string} name クラス。 @returns {boolean} 付与されているか。 */
      contains: name => this.className.split(/\s+/).includes(name),
    };
  }
  /** @param {...TestElement} values 子要素。 @returns {void} 親への伝播先も記録する。 */
  append(...values) { for (const value of values) { value.parentElement = this; this.children.push(value); } }
  /** @param {string} name 属性。 @param {string} value 属性値。 @returns {void} */
  setAttribute(name, value) { this.attributes[name] = String(value); }
  /** @param {string} type イベント名。 @param {Function} handler 処理。 @returns {void} */
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  /** @param {string} selector 選択子。 @returns {TestElement|null} 対象ボタン。 */
  closest(selector) { return this.tagName === "BUTTON" && this.dataset.actionId && selector === "button[data-action-id]" ? this : this.parentElement?.closest(selector) || null; }
  /** @returns {void} 登録済みのクリックを親へ伝える。 */
  click() {
    if (this.disabled) return;
    const event = { target: this };
    for (let node = this; node; node = node.parentElement) {
      for (const handler of node.listeners.click || []) handler(event);
    }
  }
}

/** @returns {Promise<void>} 本文の選択説明・ボタンの実行・旧保存の互換を検証する。 */
async function main() {
  const state = { eventQueue: [], eventSeq: 1 }, handled = [], saves = [];
  const elements = {};
  for (const id of ["eventModal", "eventModalClose", "eventModalTitle", "eventModalBody", "eventModalActions"]) elements[id] = new TestElement();
  elements.eventModal.append(elements.eventModalClose, elements.eventModalTitle, elements.eventModalBody, elements.eventModalActions);
  const context = vm.createContext({ console, Date,
    document: { createElement: tag => new TestElement(tag),
      /** @returns {void} 他の画面への通知は検証対象外。 */
      dispatchEvent() {} },
    CustomEvent: class CustomEvent {
      /** @param {string} type 通知名。 */
      constructor(type) { this.type = type; }
    },
  });
  /** @param {object} values 依存の公開値。 @returns {vm.SyntheticModule} 同じ画面を共有する依存。 */
  function mock(values) {
    return new vm.SyntheticModule(Object.keys(values),
    /** @returns {void} 同じ画面と保存先を使う依存を公開する。 */
    function initialize() {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context });
  }
  /** @returns {void} 今回使わない操作。 */
  function noop() {}
  const dependencies = {
    "./actions.js": mock({ handleTravelEventAction: action => { handled.push(action); return true; }, isBattleEventActionBlocked: action => !!action?.payload?.blocked }),
    "./dom.js": mock({ elements, pushLog: noop }),
    "./faction.js": mock({ addHonorFaction: noop, addWarScore: noop, adjustNobleFavor: noop, adjustSupport: noop, getPlayerFactionId: noop }),
    "./state.js": mock({ state }),
    "./storage.js": mock({ scheduleGameSave: () => saves.push(JSON.stringify(state.eventQueue)) }),
    "./resourceUI.js": mock({ resourceList: noop }),
    "./wantedPolicy.js": mock({ crimeRestriction: (current, action) => action?.payload?.crimeReason || "" }),
    "./dangerousSeaHazards.js": mock({ handleDangerousRaidAction: noop, resolveDangerousSeaWave: noop, discardInvalidDangerousWaveNotifications: noop }),
    "./dangerousSeaEventUI.js": mock({ handleDangerousSeaEventAction: noop }),
  };
  const module = new vm.SourceTextModule(readSource("events.js"), { context });
  await module.link(specifier => dependencies[specifier]); await module.evaluate();
  const events = module.namespace;
  events.initEventQueueUI();

  const unsafeText = '<img src=x onerror="alert(1)"> 回収できるかもしれません。';
  events.enqueueEvent({ title: "漂流物", body: "漂流物を見つけました。", actions: [
    { id: "probe", label: "調査する", hint: `  ${unsafeText}  `, type: "wreck_probe", payload: { value: 4 } },
    { id: "leave", label: "立ち去る", type: "close" },
  ] });
  assert.equal(state.eventQueue[0].actions[0].hint, unsafeText, "正規化で前後の空白だけ除き、説明を保持する");
  state.eventQueue = JSON.parse(saves.at(-1)); events.showNextEvent();
  const [button, leave] = elements.eventModalActions.children;
  assert.equal(elements.eventModalBody.textContent, `漂流物を見つけました。\n\n調査する：${unsafeText}`, "旧保存の説明は本文に表示する");
  assert.equal(elements.eventModalBody.children.length, 0, "説明に含まれるHTMLを要素化しない");
  assert.deepEqual(elements.eventModalActions.children.map(node => node.tagName), ["BUTTON", "BUTTON"], "説明があっても従来のボタン列を維持する");
  assert.equal(button.textContent, "調査する"); assert.equal(leave.textContent, "立ち去る");
  events.showNextEvent();
  assert.equal(elements.eventModalBody.textContent, `漂流物を見つけました。\n\n調査する：${unsafeText}`, "再描画しても本文へ説明を重複追加しない");
  elements.eventModalBody.click(); assert.equal(handled.length, 0, "本文だけを押しても行動しない");
  elements.eventModalActions.children[0].click(); assert.equal(handled.length, 1); assert.equal(handled[0].type, "wreck_probe");
  assert.equal(handled[0].payload.value, 4); assert.equal(state.eventQueue.length, 0);

  state.eventQueue = [{ title: "旧保存イベント", body: "以前の通知", actions: [{ id: "old", label: "閉じる", type: "close" }] }];
  events.showNextEvent();
  assert.equal(elements.eventModalBody.textContent, "以前の通知");
  assert.equal(elements.eventModalActions.children[0].tagName, "BUTTON", "説明を持たない旧保存でも従来の選択を表示する");
  events.resolveCurrentEvent();

  const prose = "漂流物を見つけました。調べれば積荷を回収できそうですが、待ち伏せには注意が必要です。";
  events.enqueueEvent({ body: prose, actions: [{ id: "probe", label: "調査する", type: "wreck_probe" }, { id: "leave", label: "立ち去る", type: "close" }] });
  assert.equal(elements.eventModalBody.textContent, prose, "新しい説明は本文の文章として表示する");
  assert.deepEqual(elements.eventModalActions.children.map(node => node.tagName), ["BUTTON", "BUTTON"]);
  events.resolveCurrentEvent();

  events.enqueueEvent({ actions: [{ hint: { text: "不正形式" } }, { hint: "   " }] });
  assert.equal(state.eventQueue[0].actions[0].hint, ""); assert.equal(state.eventQueue[0].actions[1].hint, "");
  assert.equal(elements.eventModalBody.textContent, "");
  events.resolveCurrentEvent();

  events.enqueueEvent({ actions: [{ id: "blocked", label: "救助する", hint: "海賊との戦闘になります。", type: "merchant_rescue_help", payload: { blocked: true, crimeReason: "手配中は救助できません。" } }] });
  const blocked = elements.eventModalActions.children[0];
  assert.equal(blocked.disabled, true);
  assert.equal(elements.eventModalBody.textContent, "救助する：海賊との戦闘になります。");
  assert.equal(elements.eventModalActions.children[1].textContent, "手配中は救助できません。", "行動不可の理由も維持する");
  blocked.click(); assert.equal(handled.length, 1);
  console.log("イベント選択説明: 本文表示・従来のボタン列・保存互換・安全な文字表示・選択実行・行動不可: 成功");
}

/** @param {Error} error 検証失敗。 @returns {void} 終了コードへ反映する。 */
function reportFailure(error) { console.error(error); process.exitCode = 1; }
main().catch(reportFailure);
