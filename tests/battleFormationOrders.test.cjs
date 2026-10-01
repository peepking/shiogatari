const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readSource } = require("./helpers/source.cjs");

/** @param {string} source 本体。 @param {string} name 関数名。 @returns {string} 接続検証用の本体関数。 */
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}

/** @returns {object} 選択肢とイベントを保持する簡易画面要素。 */
function element() {
  return { value: "", options: [], disabled: false, hidden: false, open: false, events: {}, html: "",
    set innerHTML(value) {
      this.html = value;
      this.options = [...value.matchAll(/<option value="([^"]*)"([^>]*)>/g)].map(match => ({ value: match[1], selected: match[2].includes("selected") }));
      this.value = this.options.find(option => option.selected)?.value ?? this.options[0]?.value ?? "";
    },
    get innerHTML() { return this.html; },
    addEventListener(name, handler) { this.events[name] = handler; },
  };
}

/** @returns {Promise<void>} 全兵種の対象選択・実際の保存と予約・画面操作の検証。 */
async function main() {
  const dom = Object.fromEntries(["Editor", "Target", "Order", "Apply", "Note", "Feedback"].map(suffix => [`bulk${suffix}`, element()]));
  const context = vm.createContext({ document: { getElementById: id => dom[id] } });
  const modules = {};
  for (const name of ["battleUnitFormation", "battleUnitFormationOrders", "battleUnitFormationUI"])
    modules[`./${name}.js`] = new vm.SourceTextModule(readSource(`${name}.js`), { context });
  await modules["./battleUnitFormationUI.js"].link(name => modules[name]);
  await modules["./battleUnitFormationUI.js"].evaluate();
  const f = modules["./battleUnitFormation.js"].namespace;
  const orders = modules["./battleUnitFormationOrders.js"].namespace;
  const ui = modules["./battleUnitFormationUI.js"].namespace;
  const troops = vm.runInNewContext(`(${readSource("troops.js").match(/export const TROOP_STATS = ([\s\S]*?\n});/)[1]})`);
  const entries = Object.keys(troops).map((type, index) => ({ type, count: 10, rosterUnitId: `roster-${index + 1}`, formationOrder: "line" }));
  assert.equal(entries.length, 17);
  const expected = {
    infantry: ["infantry", "marine", "halberd", "pirate_spear", "pirate_axe", "pirate_assault"],
    shield: ["shield", "pirate_shield"], cavalry: ["cavalry", "cavalier", "raider_cavalry"],
    ranged: ["archer", "crossbow", "seaArcher", "pirate_archer"], support: ["medic", "scout"],
  };
  for (const [group, types] of Object.entries(expected)) {
    assert.deepEqual(Array.from(orders.selectFormationOrderRecipients(entries, `group:${group}`), item => item.type).sort(), [...types].sort());
    for (const type of types) assert.equal(orders.formationOrderGroup({ type, role: troops[type].role }), group);
  }
  assert.equal(orders.selectFormationOrderRecipients(entries, "all").length, 17);
  assert.equal(orders.selectFormationOrderRecipients(entries, "melee").length, 11);
  assert.equal(orders.selectFormationOrderRecipients(entries, "type:halberd")[0].type, "halberd");
  for (const invalid of ["", "group:__proto__", "group:unknown", "type:missing", "横陣"])
    assert.equal(orders.selectFormationOrderRecipients(entries, invalid).length, 0);
  const names = type => troops[type].name;
  const choices = orders.formationOrderTargets(entries, names);
  assert.equal(choices.length, 24);
  assert.equal(choices.find(choice => choice.id === "type:halberd").name, "鉾槍兵");
  assert.equal(orders.formationOrderTargets([entries.find(item => item.type === "archer")], names).length, 3);

  const roster = { sortie: entries.filter(item => item.type !== "seaArcher"), reserve: [entries.find(item => item.type === "seaArcher")] };
  const units = entries.map((entry, index) => ({ ...entry, id: `ally-${index}`, side: "ally", hp: 100, maxHp: 100,
    status: entry.type === "seaArcher" ? "reserve" : "active" }));
  for (const unit of units) f.initializeUnitFormation(unit);
  Object.assign(context, { ...orders, battleRoster: roster, battleState: { units, started: false, running: false, result: "", tick: 0,
    battleKind: "grand", size: 8, randomSeed: 42, grid: [], customSlots: {}, allyFormation: "balance" },
  state: { pendingEncounter: { active: true } }, battleStrategy: {}, buildDeploySlots: () => [],
  renderRosterUI() {}, updateBattleInfo() {}, renderBattle() {} });
  let saves = 0, pauses = 0;
  context.saveGameToStorage = () => { saves++; };
  context.pauseBattle = () => { pauses++; context.battleState.running = false; };
  const raw = readSource("battle.js");
  for (const name of ["rosterSignature", "saveGrandPreparation", "changeBulkFormationOrder"])
    vm.runInContext(extract(raw, name), context);
  context.appliedRosterSignature = vm.runInContext("rosterSignature()", context);
  vm.runInContext("changeBulkFormationOrder('all','auto'); changeBulkFormationOrder('group:shield','shieldWall'); changeBulkFormationOrder('type:halberd','circle')", context);
  assert.equal(saves, 3);
  for (const entry of entries) {
    const expectedOrder = entry.type === "halberd" ? "circle" : expected.shield.includes(entry.type) ? "shieldWall" : "auto";
    assert.equal(entry.formationOrder, expectedOrder);
    assert.equal(units.find(unit => unit.rosterUnitId === entry.rosterUnitId).formationOrder, expectedOrder);
  }
  assert.equal(context.state.pendingEncounter.preparation.version, 3);
  assert.equal(context.state.pendingEncounter.preparation.roster.reserve[0].formationOrder, "auto");
  assert.equal(vm.runInContext("rosterSignature()", context), context.appliedRosterSignature);
  const draft = { type: "archer", count: 1, rosterUnitId: "roster-99", formationOrder: "line" };
  roster.sortie.push(draft);
  vm.runInContext("changeBulkFormationOrder('type:archer','spread')", context);
  assert.equal(draft.formationOrder, "spread"); assert.equal(saves, 3, "未反映の人数・編成を保存しない");
  roster.sortie.pop();

  const saved = JSON.stringify(context.state.pendingEncounter.preparation);
  context.battleState.started = true; context.battleState.running = true; context.battleState.tick = 5;
  units[0].formationChangeAt = 8; units[1].formationChangeAt = 6;
  units[2].status = "routing"; units[3].hp = 0; units[4].status = "escaped";
  const enemy = { ...units[5], id: "enemy", side: "enemy" }; units.push(enemy);
  const before = JSON.stringify({ entries, tick: context.battleState.tick });
  vm.runInContext("changeBulkFormationOrder('all','charge')", context);
  assert.equal(pauses, 1); assert.equal(context.battleState.running, false);
  assert.equal(units[0].pendingFormationOrder, "charge"); assert.equal(units[0].formationChangeAt, 8);
  assert.equal(units[1].pendingFormationOrder, "charge"); assert.equal(units[1].formationChangeAt, 6);
  for (const unit of [units[2], units[3], units[4], enemy]) assert.equal(unit.pendingFormationOrder, null);
  const reserve = units.find(unit => unit.status === "reserve");
  assert.equal(reserve.formationOrder, "charge"); assert.equal(reserve.pendingFormationOrder, null);
  vm.runInContext("changeBulkFormationOrder('all','spread')", context);
  assert.equal(units[0].pendingFormationOrder, "spread");
  assert.equal(f.resolveUnitFormation(units[0], 6, () => assert.fail()), false);
  assert.equal(f.resolveUnitFormation(units[0], 8, () => assert.fail()), true);
  assert.equal(units[0].formationId, "spread");
  assert.equal(JSON.stringify({ entries, tick: context.battleState.tick }), before);
  assert.equal(JSON.stringify(context.state.pendingEncounter.preparation), saved); assert.equal(saves, 3);
  context.battleState.result = "終了";
  const finished = JSON.stringify(units); vm.runInContext("changeBulkFormationOrder('all','circle')", context);
  assert.equal(JSON.stringify(units), finished);

  // 選択だけでは指示せず、対象消滅で全体に広がらず、明示ボタンと自動停止を確認する。
  const panel = { started: false, disabled: false, nameForType: names, reserveItems: roster.reserve };
  const sync = () => ui.syncBulkFormationPanel("bulk", entries, panel);
  sync(); assert.equal(dom.bulkOrder.value, ""); assert.equal(dom.bulkApply.disabled, true);
  dom.bulkTarget.value = "group:ranged"; dom.bulkOrder.value = "spread"; sync();
  assert.equal(dom.bulkApply.textContent, "4部隊に指示"); assert.match(dom.bulkNote.textContent, /前衛3・予備隊1/);
  assert.equal(dom.bulkApply.disabled, false);
  dom.bulkTarget.value = "type:halberd"; sync();
  ui.syncBulkFormationPanel("bulk", entries.filter(item => item.type !== "halberd"), panel);
  assert.equal(dom.bulkTarget.value, ""); assert.equal(dom.bulkApply.disabled, true);
  let applied = 0, stopped = 0;
  ui.wireBulkFormationPanel("bulk", { pause: () => { stopped++; }, sync, change: () => { applied++; return 1; } });
  dom.bulkEditor.open = true; dom.bulkEditor.events.toggle(); assert.equal(stopped, 1);
  dom.bulkTarget.value = "all"; dom.bulkTarget.events.change();
  assert.equal(applied, 0); dom.bulkApply.events.click(); assert.equal(applied, 1); assert.equal(stopped, 2);
  assert.equal(dom.bulkFeedback.textContent, "1部隊に散開を指示しました。");
  panel.disabled = true; sync(); assert.equal(dom.bulkApply.disabled, true);
  dom.bulkApply.events.click(); assert.equal(applied, 1);
  console.log("陣形一括指示: 17兵種・5分類・全体と個別・予備隊・保存・予約制限・除外・対象数・自動停止: 全項目成功");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
