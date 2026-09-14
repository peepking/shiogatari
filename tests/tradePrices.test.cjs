const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vm = require('node:vm');
const path = require('node:path');

/** 相場の上下限・補正範囲・売却端数・分割時の一致を検証する。 */
async function main() {
  let support = 'high', war = 'losing';
  const dependencies = {
    './quantityUI.js': { quantityControl() {}, wireQuantityControls() {}, refreshQuantity() {} },
    './dom.js': { confirmAction() {}, pushLog() {}, pushToast() {} },
    './faction.js': { getPlayerFactionId: () => 'a', getSupportLabel: () => support, getWarEntry: () => ({score: 0}), getWarScoreLabel: () => war },
    './state.js': {state: {}}, './util.js': {sumValues() {}}, './resourceUI.js': {resourceIcon() {}},
    './upkeep.js': {renderUpkeepForecast() {}}, './outfitting.js': {getOutfittingEffects() {}, applyCapacityBonus() {}},
    './troops.js': {TROOP_STATS: {}}, './fleet.js': {fleetEffects() {}},
  };
  const mod = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, '../supplies.js'), 'utf8'));
  const faith = new vm.SourceTextModule(await fs.readFile(path.join(__dirname, '../faith.js'), 'utf8'));
  await faith.link(() => {});
  await mod.link(name => name === './faith.js' ? faith : new vm.SyntheticModule(Object.keys(dependencies[name]), function () {
    for (const [key, value] of Object.entries(dependencies[name])) this.setExport(key, value);
  }));
  await mod.evaluate();
  const price = mod.namespace.calcSupplyPrice;
  assert.equal(price('spice', 1), 100);
  assert.equal(price('spice', 10), 400);
  assert.equal(price('spice', 99), 400);
  assert.equal(price('spice', 0), 100);
  const opts = {factionId: 'b', settlementId: 'town'};
  assert.equal(price('spice', 10, opts), 456);
  assert.equal(price('spice', 10, {...opts, mode: 'reference'}), 480);
  assert.equal(price('spice', 10, {...opts, mode: 'sell'}), 432);
  support = 'low';
  assert.equal(price('spice', 10, opts), 504);
  assert.equal(price('spice', 10, {...opts, mode: 'sell'}), 432);
  war = 'winning';
  assert.equal(price('spice', 10, {...opts, mode: 'sell'}), 288);
  const foodSell = price('food', 1, {mode: 'sell'});
  assert.equal(foodSell, 4);
  assert.equal(foodSell * 100, foodSell * 37 + foodSell * 63);
  dependencies['./state.js'].state.faith=500;
  support='high';war='even';
  assert.equal(price('spice',10,{...opts,mode:'sell'}),378);
  faith.namespace.activateAfterglow(dependencies['./state.js'].state);
  assert.equal(price('spice',10,{...opts,mode:'sell'}),price('spice',10,opts));
  console.log('交易価格の上下限・補正・端数: 全項目成功');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
