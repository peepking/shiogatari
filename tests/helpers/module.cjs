const vm = require("node:vm");
const { readSource } = require("./source.cjs");

/** 同期のモジュールキャッシュで共有依存を一度だけ生成する。 @param {string} name ファイル名。 @param {object} context VM文脈。 @returns {Promise<vm.Module>} 評価済みモジュール。 */
async function loadTestModule(name, context) {
  const cache = new Map();
  /** モジュールを作り、依存の接続はVMへ任せる。 @param {string} specifier 依存名。 @returns {vm.Module} モジュール。 */
  function get(specifier) {
    const key = specifier.replace(/^\.\//, "");
    if (!cache.has(key)) cache.set(key, new vm.SourceTextModule(readSource(key), { context, identifier: key }));
    return cache.get(key);
  }
  const module = get(name);
  await module.link(get);
  await module.evaluate();
  return module;
}

module.exports = { loadTestModule };
