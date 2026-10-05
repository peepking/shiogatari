const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/**
 * イベント委譲・要素の同一性・フォーカスを検証できる最小の画面を作る。
 * HTMLの解析は図鑑が操作するボタンだけに限定する。
 * @returns {object} 文書、要素一覧、スクロール領域。
 */
function makeDocument() {
  const document = { activeElement: null, listeners: new Map() };
  /** 図鑑が使用する属性、子要素、イベントを保持する要素。 */
  class Element {
    /** @param {string} [tag] タグ名。 */
    constructor(tag = "div") {
      this.tagName = tag.toUpperCase(); this.id = ""; this.className = "";
      this.dataset = {}; this.attributes = new Map(); this.children = [];
      this.listeners = new Map(); this.hidden = false; this.open = false;
      this.value = ""; this.scrollTop = 0; this.parentElement = null;
      this._text = ""; this._html = "";
      this.classList = {
        /** @param {string} name クラス名。 @param {boolean} force 有効か。 @returns {void} クラスを更新する。 */
        toggle: (name, force) => {
          const names = new Set(this.className.split(/\s+/).filter(Boolean));
          if (force) names.add(name); else names.delete(name);
          this.className = [...names].join(" ");
        },
      };
    }
    /** @returns {string} 子要素を含む表示文言。 */
    get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
    /** @param {string} value 表示文言。 */
    set textContent(value) { this.replaceChildren(); this._html = ""; this._text = String(value); }
    /** @returns {string} 描画されたHTML。 */
    get innerHTML() { return this._html; }
    /** @param {string} value HTML。 */
    set innerHTML(value) {
      this.replaceChildren(); this._html = String(value); this._text = "";
      for (const match of this._html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const button = new Element("button");
        for (const attribute of match[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) button.setAttribute(attribute[1], attribute[2] || "");
        button._html = match[2]; button._text = match[2].replace(/<[^>]*>/g, "");
        this.appendChild(button);
      }
    }
    /** @param {string} name 属性名。 @param {unknown} value 属性値。 @returns {void} 属性を更新する。 */
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === "id") this.id = String(value);
      if (name === "class") this.className = String(value);
      if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g,
        /** @param {string} match 一致。 @param {string} letter 英字。 @returns {string} 属性キー。 */
        (match, letter) => letter.toUpperCase())] = String(value);
    }
    /** @param {string} name 属性名。 @returns {string|null} 属性値。 */
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    /** @param {object} child 子要素。 @returns {object} 追加した要素。 */
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    /** @param {...object} children 子要素。 @returns {void} 子要素を追加する。 */
    append(...children) { children.forEach(child => this.appendChild(child)); }
    /** @returns {void} 親から要素を外し、外した要素のフォーカスを失わせる。 */
    remove() {
      if (this.contains(document.activeElement)) document.activeElement = null;
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    }
    /** @param {...object} children 子要素。 @returns {void} 子要素を交換し、外した要素のフォーカスを失わせる。 */
    replaceChildren(...children) {
      for (const child of this.children) {
        if (child.contains(document.activeElement)) document.activeElement = null;
        child.parentElement = null;
      }
      this.children = []; this._text = ""; this.append(...children);
    }
    /** @param {object} node 要素。 @returns {boolean} 自分または子孫か。 */
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    /** @param {string} selector 選択条件。 @returns {boolean} 要素が一致するか。 */
    matches(selector) {
      if (selector.includes(",")) return selector.split(",").some(part => this.matches(part.trim()));
      const tag = selector.match(/^[a-z]+/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      return [...selector.matchAll(/#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)].every(match => {
        if (match[1]) return this.id === match[1];
        if (match[2]) return this.className.split(/\s+/).includes(match[2]);
        const name = match[3], key = name.slice(5).replace(/-([a-z])/g,
          /** @param {string} value 一致。 @param {string} letter 英字。 @returns {string} 属性キー。 */
          (value, letter) => letter.toUpperCase());
        const value = name.startsWith("data-") ? this.dataset[key] : this.getAttribute(name);
        return value != null && (match[4] === undefined || value === match[4]);
      });
    }
    /** @param {string} selector 選択条件。 @returns {object[]} 一致する子孫。 */
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    /** @param {string} selector 選択条件。 @returns {object|null} 最初の子孫。 */
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    /** @param {string} selector 選択条件。 @returns {object|null} 一致する祖先。 */
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    /** @param {string} type イベント種。 @param {Function} listener 処理。 @returns {void} 処理を登録する。 */
    addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
    /** @returns {void} 要素へフォーカスを移す。 */
    focus() { document.activeElement = this; }
    /** @param {number} x 横位置。 @param {number} y 縦位置。 @returns {void} スクロールする。 */
    scrollTo(x, y) { this.scrollTop = y; }
    /** @param {string} [type] イベント種。 @param {object} [extra] 入力の追加情報。 @returns {void} 親へ伝播する操作を送る。 */
    fire(type = "click", extra = {}) {
      const event = { type, target: this, ...extra,
        /** @returns {void} この検証では既定処理は存在しない。 */
        preventDefault() {} };
      for (let node = this; node; node = node.parentElement) for (const listener of node.listeners.get(type) || []) listener(event);
    }
  }
  const root = new Element(), elements = {};
  /** @param {string} id 要素ID。 @param {object} [parent] 親。 @param {string} [tag] タグ。 @returns {object} 作成した要素。 */
  function add(id, parent = root, tag = "div") { const node = new Element(tag); node.id = id; parent.appendChild(node); elements[id] = node; return node; }
  const modal = add("codexModal"); modal.hidden = true;
  add("codexModalClose", modal, "button"); add("codexProgressText", modal); add("codexProgressBar", modal, "progress");
  const tools = add("codexTools", modal); tools.className = "codex-tools";
  add("codexSearch", tools, "input"); add("codexFilterToggle", tools, "button");
  add("codexClearFilters", tools, "button"); add("codexFilterCount", tools);
  const active = add("codexActiveFilters", tools); add("codexFilterChips", active);
  const panel = add("codexFilterPanel", tools); panel.hidden = true;
  const wrap = add("codexFilterWrap", panel);
  for (const group of ["category", "region", "season"]) { const box = new Element(); box.dataset.group = group; wrap.appendChild(box); }
  add("codexResultCount", tools); add("codexFilterNotice", tools);
  const disclosure = add("codexInfoDisclosure", modal, "details"); add("codexRewards", disclosure);
  const scroll = add("codexList", modal); scroll.className = "codex-list"; add("codexBody", scroll);
  document.createElement = tag => new Element(tag);
  document.getElementById = id => root.querySelector(`#${id}`);
  document.querySelector = selector => root.querySelector(selector);
  document.addEventListener = Element.prototype.addEventListener.bind(document);
  document.dispatchEvent = event => { for (const listener of document.listeners.get(event.type) || []) listener(event); };
  return { document, elements, scroll };
}

/**
 * 実際の図鑑描画・絞り込み・公開ルールを操作イベントから検証する。
 * @returns {Promise<void>} 検証完了。
 */
async function main() {
  const screen = makeDocument(), { document, elements, scroll } = screen;
  const state = { year: 1000, season: 0, day: 1, expansion: { fishing: { codex: {} } } };
  const context = vm.createContext({ document, structuredClone });
  const cache = new Map(), stubs = { "state.js": { state }, "dom.js": { elements } };
  /** @param {string} specifier 依存名。 @returns {vm.Module} 実モジュールまたは画面の差し替え。 */
  function get(specifier) {
    const name = specifier.replace(/^\.\//, "");
    if (!cache.has(name)) {
      const values = stubs[name];
      cache.set(name, values ? new vm.SyntheticModule(Object.keys(values),
        /** @returns {void} 外部の状態・画面を公開する。 */
        function initialize() { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context })
        : new vm.SourceTextModule(readSource(name), { context, identifier: name }));
    }
    return cache.get(name);
  }
  const module = get("fishingCodexUI.js"); await module.link(get); await module.evaluate();
  const ui = module.namespace, species = Array.from(cache.get("fishingConfig.js").namespace.FISH_SPECIES);
  /** @param {object[]} fish 発見済み魚。 @returns {void} 図鑑登録を設定する。 */
  function discover(fish) { state.expansion.fishing.codex = Object.fromEntries(fish.map(item => [item.id, { count: 1, maxSize: 25 }])); }
  /** @returns {string[]} 表示中の魚ID。 */
  function shown() { return elements.codexBody.querySelectorAll("[data-codex]").map(node => node.dataset.codex).sort(); }
  /** @param {string} group グループ。 @param {string|number} key 条件。 @returns {object} 条件ボタン。 */
  function filter(group, key) { const button = elements.codexFilterWrap.querySelector(`[data-codex-filter][data-group="${group}"][data-key="${key}"]`); assert.ok(button); return button; }
  /** @param {string} value 検索語。 @returns {void} 検索入力を送る。 */
  function search(value) { elements.codexSearch.value = value; elements.codexSearch.fire("input"); }
  /** @param {object[]} fish 期待する魚。 @param {string} message 検証内容。 @returns {void} 結果を比較する。 */
  function check(fish, message) { assert.deepEqual(shown(), fish.map(item => item.id).sort(), message); }

  discover(species); ui.wireCodexModal(); ui.openCodexModal();
  ui.wireCodexModal();
  assert.equal(elements.codexModal.hidden, false);
  assert.equal(elements.codexFilterPanel.hidden, true);
  assert.equal(elements.codexFilterToggle.getAttribute("aria-expanded"), "false");
  elements.codexFilterToggle.fire();
  assert.equal(elements.codexFilterPanel.hidden, false);
  assert.equal(elements.codexFilterToggle.getAttribute("aria-expanded"), "true");
  const common = filter("category", "common"), allButtons = elements.codexFilterWrap.querySelectorAll("[data-codex-filter]");
  common.focus(); common.fire();
  check(species.filter(fish => fish.category === "common"), "分類ボタンで絞り込む");
  assert.equal(filter("category", "common"), common, "条件ボタンを作り直さない");
  assert.equal(document.activeElement, common, "絞り込み後も操作ボタンのフォーカスを保つ");
  assert.equal(common.getAttribute("aria-pressed"), "true");
  filter("category", "big").fire();
  check(species.filter(fish => ["common", "big"].includes(fish.category)), "同じ分類グループはORで判定する");
  filter("region", "nw").fire(); filter("region", "ne").fire();
  filter("season", 0).fire(); filter("season", 3).fire();
  const expected = species.filter(fish => ["common", "big"].includes(fish.category)
    && fish.regions.some(region => ["nw", "ne"].includes(region)) && fish.seasons.some(season => [0, 3].includes(season)));
  check(expected, "海域・季節内もOR、グループ間はANDで判定する");
  assert.deepEqual(elements.codexFilterWrap.querySelectorAll("[data-codex-filter]"), allButtons);
  elements.codexFilterToggle.fire();
  assert.equal(elements.codexFilterPanel.hidden, true);
  assert.equal(elements.codexFilterToggle.getAttribute("aria-expanded"), "false");
  const chip = elements.codexFilterChips.querySelector('[data-codex-remove][data-group="region"][data-key="nw"]');
  assert.ok(chip, "閉じた条件欄の外にも選択内容を表示する"); chip.fire();
  assert.equal(filter("region", "nw").getAttribute("aria-pressed"), "false");
  assert.equal(filter("region", "ne").getAttribute("aria-pressed"), "true", "個別解除でほかの条件を保持する");
  const countBeforeSearch = elements.codexFilterCount.textContent;
  search("あじ");
  assert.equal(elements.codexFilterCount.textContent, countBeforeSearch, "絞り込みの件数に検索を混ぜない");
  elements.codexClearFilters.fire();
  assert.equal(elements.codexSearch.value, "", "全解除は検索も空にする"); check(species, "全条件を解除する");
  assert.equal(elements.codexFilterChips.querySelectorAll("[data-codex-remove]").length, 0);
  assert.equal(elements.codexActiveFilters.hidden, true, "条件がないときは解除欄を隠す");
  assert.ok(allButtons.every(button => button.getAttribute("aria-pressed") === "false"));

  const known = species.filter(fish => ["aji", "madai", "sawara"].includes(fish.id));
  const unknown = species.find(fish => !known.includes(fish)); discover(known);
  document.dispatchEvent({ type: "fishing-panel-update" });
  assert.match(elements.codexProgressText.textContent, /3/);
  assert.equal(Number(elements.codexProgressBar.value), 3); assert.equal(Number(elements.codexProgressBar.max), species.length);
  let unknownCard = elements.codexBody.querySelector(`[data-codex="${unknown.id}"]`);
  assert.ok(unknownCard); assert.ok(!unknownCard.innerHTML.includes(unknown.name), "未発見カードに魚名を出さない");
  filter("category", "big").fire(); check(known.filter(fish => fish.category === "big"), "未発見魚の分類は検索条件に利用しない");
  assert.ok(elements.codexFilterNotice.textContent, "非公開情報による除外の理由を表示する");
  elements.codexClearFilters.fire(); filter("season", 0).fire();
  check(known.filter(fish => fish.seasons.includes(0)), "季節公開前は未発見魚を季節で絞り込まない");
  elements.codexClearFilters.fire(); filter("region", unknown.regions[0]).fire();
  assert.ok(shown().includes(unknown.id), "最初から公開された海域は未発見魚にも使う");
  elements.codexClearFilters.fire(); search(unknown.name); assert.equal(shown().length, 0, "未発見魚の名前で正体を探り当てられない");
  assert.match(elements.codexResultCount.textContent, /^0/);
  elements.codexBody.querySelector("[data-codex-clear]").fire();
  assert.equal(elements.codexSearch.value, "", "0件の一覧からも条件を全解除できる");
  unknownCard = elements.codexBody.querySelector(`[data-codex="${unknown.id}"]`); unknownCard.fire();
  assert.ok(!elements.codexBody.innerHTML.includes(unknown.name));
  if (unknown.scientificName) assert.ok(!elements.codexBody.innerHTML.includes(unknown.scientificName));
  if (unknown.description) assert.ok(!elements.codexBody.innerHTML.includes(unknown.description));
  document.getElementById("codexBackBtn").fire();

  elements.codexSearch.value = "あじ"; elements.codexSearch.fire("input", { isComposing: true });
  check(species, "日本語変換中は検索を確定しない");
  document.dispatchEvent({ type: "fishing-panel-update" });
  assert.equal(elements.codexSearch.value, "あじ", "外部更新で日本語変換中の入力を巻き戻さない");
  check(species, "外部更新でも変換中の検索条件は未確定のまま保つ");
  elements.codexSearch.fire("compositionend");
  check(known.filter(fish => fish.id === "aji"), "日本語変換の確定で検索を反映する");
  document.dispatchEvent({ type: "fishing-panel-update" });
  assert.equal(elements.codexSearch.value, "あじ", "確定後の入力も外部更新で保つ");
  elements.codexClearFilters.fire();
  search("あじ"); search("  \t  ");
  check(species, "空白だけの検索は未発見魚も含む全件を表示する");
  assert.equal(elements.codexSearch.value, "  \t  ", "空白だけでも入力自体を保持する");
  assert.equal(elements.codexFilterChips.querySelectorAll("[data-codex-remove]").length, 0, "空白だけの検索条件を表示しない");
  assert.equal(elements.codexActiveFilters.hidden, true);
  assert.equal(elements.codexFilterNotice.hidden, true, "空白だけの検索で未発見除外の注意書きを表示しない");
  assert.equal(elements.codexFilterNotice.textContent, "");
  elements.codexClearFilters.fire();
  filter("category", "common").fire(); filter("region", "nw").fire(); search("あじ");
  check(known.filter(fish => fish.id === "aji"), "ひらがなでカタカナ魚名に一致する");
  elements.codexInfoDisclosure.open = true; search(" あじ ");
  assert.equal(elements.codexInfoDisclosure.open, true, "検索で補足説明の開閉を戻さない");
  scroll.scrollTop = 175;
  const ajiCard = elements.codexBody.querySelector('[data-codex="aji"]'); ajiCard.focus(); ajiCard.fire();
  assert.equal(scroll.scrollTop, 0); assert.equal(document.activeElement.id, "codexBackBtn");
  document.getElementById("codexBackBtn").fire();
  assert.equal(scroll.scrollTop, 175, "詳細から戻ると一覧のスクロールを復元する");
  assert.equal(document.activeElement.dataset.codex, "aji", "戻り先のカードへフォーカスを復元する");
  assert.equal(elements.codexSearch.value, " あじ ");
  assert.equal(filter("category", "common").getAttribute("aria-pressed"), "true");
  assert.equal(filter("region", "nw").getAttribute("aria-pressed"), "true");
  check(known.filter(fish => fish.id === "aji"), "詳細から戻っても検索と条件を保持する");
  assert.equal(elements.codexInfoDisclosure.open, true);
  const searchChip = elements.codexFilterChips.querySelector('[data-codex-remove][data-group="search"]');
  assert.ok(searchChip); searchChip.fire();
  assert.equal(elements.codexSearch.value, ""); assert.equal(common.getAttribute("aria-pressed"), "true", "検索だけを個別解除できる");
  elements.codexClearFilters.fire();

  discover(species.filter(fish => fish.id !== unknown.id).slice(0, Math.ceil(species.length / 4)));
  document.dispatchEvent({ type: "fishing-panel-update" }); filter("season", unknown.seasons[0]).fire();
  assert.ok(shown().includes(unknown.id), "25%達成後は未発見魚の公開済み季節でも絞り込める");
  console.log("fishingCodexUI: 条件選択・個別解除・公開情報・詳細遷移・フォーカスの検証成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
