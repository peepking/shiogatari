const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
/** @returns {Promise<void>} 重複・占領後の前線・依頼・要請の整理と、新規重複攻撃の防止を検証する。 */
async function main() {
  const module = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, "../warFronts.js"), "utf8"));
  await module.link(() => {}); await module.evaluate();
  const reconcile = module.namespace.reconcileWarFronts;
  const settlements = [{ id: "town", factionId: "archipelago" }];
  const old = { id: "old", settlementId: "town", attacker: "north", defender: "citadel", startAbs: 1 };
  const newer = { id: "newer", settlementId: "town", attacker: "citadel", defender: "archipelago", startAbs: 30 };
  const first = { id: "first", settlementId: "town", attacker: "north", defender: "archipelago", startAbs: 20 };
  const state = { warLedger: { entries: [{ activeFronts: [old, newer] }, { activeFronts: [first] }] },
    funds: 1234, fame: 100,
    quests: { active: [{ type: "war_escort", frontSettlementId: "town", frontId: "old" },
      { type: "war_blockade", frontSettlementId: "town", frontId: "first" },
      { type: "delivery", originId: "town" }] },
    eventQueue: [{ actions: [{ payload: { frontId: "old" } }] }, { title: "unrelated" }] };
  reconcile(state, settlements);
  assert.equal(state.warLedger.entries[0].activeFronts.length, 0);
  assert.equal(state.warLedger.entries[1].activeFronts[0], first);
  assert.equal(state.quests.active.length, 2);
  assert.equal(state.eventQueue.length, 1);
  assert.equal(state.funds, 1234); assert.equal(state.fame, 100);
  const after = JSON.stringify(state);
  reconcile(state, settlements);
  assert.equal(JSON.stringify(state), after);
  const source = await fs.readFile(path.join(__dirname, "../faction.js"), "utf8");
  const context = vm.createContext({ state, settlements, Math: { random: () => 0 }, FACTIONS: [] });
  for (const name of ["isSettlementUnderSiege", "maybeStartFront", "resolveFront"]) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
  }
  context.entry = { factions: ["citadel", "archipelago"], score: 0, activeFronts: [] };
  settlements.push({ id: "attacker", factionId: "citadel" });
  vm.runInContext("maybeStartFront(entry, 40, 60)", context);
  assert.equal(context.entry.activeFronts.length, 0);
  context.old = old;
  vm.runInContext("resolveFront(entry, old, true)", context);
  assert.equal(settlements[0].factionId, "archipelago");
  settlements[0].factionId = "citadel";
  reconcile(state, settlements);
  assert.equal(state.warLedger.entries[1].activeFronts.length, 0);
  assert.equal(state.quests.active.length, 1);
  console.log("1拠点1前線・旧前線整理・不正な再占領防止: 全項目成功");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
