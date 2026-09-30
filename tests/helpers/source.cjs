const fs = require("node:fs");
const path = require("node:path");

const sourceRoot = path.resolve(__dirname, "../../src");
const sourceFiles = new Map();

/**
 * 機能別フォルダの実ファイルを収集し、検証用のモジュール名の重複を拒否する。
 * @param {string} directory 検索するディレクトリ。
 * @returns {void}
 */
function collectSources(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collectSources(file);
    else if (entry.name.endsWith(".js")) {
      if (sourceFiles.has(entry.name)) throw new Error(`検証用モジュール名が重複しています: ${entry.name}`);
      sourceFiles.set(entry.name, file);
    }
  }
}

collectSources(sourceRoot);

/**
 * 実際の読み込み先の存在を確認し、既存のVM検証で使う論理名へ変換する。
 * フォルダの相対パスをモックのキーへ持ち込まず、従来の依存差し替えを維持する。
 * @param {string} source 読み込んだソース。
 * @param {string} file 実ファイルの絶対パス。
 * @returns {string} 検証用の依存名へ変換したソース。
 */
function normalizeImports(source, file) {
  return source.replace(/(\bfrom\s*|\bimport\s*)(["'])(\.{1,2}\/[^"']+\.js)\2/g,
    /** @param {string} match 一致。 @param {string} prefix 接頭辞。 @param {string} quote 引用符。 @param {string} specifier 依存先。 @returns {string} 検証用の読み込み指定。 */
    (match, prefix, quote, specifier) => {
      const dependency = path.resolve(path.dirname(file), specifier);
      const name = path.basename(dependency);
      if (sourceFiles.get(name) !== dependency || !fs.existsSync(dependency)) {
        throw new Error(`読み込み先が不正です: ${file} → ${specifier}`);
      }
      return `${prefix}${quote}./${name}${quote}`;
    });
}

/**
 * 機能別配置からソースを読み、既存のVMテストのモジュール名を維持する。
 * 同期・非同期の既存呼び出しで利用でき、必ずUTF-8として読む。
 * @param {string} file 検証対象のファイル名または従来の絶対パス。
 * @returns {string} 検証対象のソース。
 */
function readSource(file) {
  const actual = sourceFiles.get(path.basename(file));
  if (!actual) throw new Error(`検証対象が見つかりません: ${file}`);
  return normalizeImports(fs.readFileSync(actual, "utf8"), actual);
}

module.exports = { readSource };
