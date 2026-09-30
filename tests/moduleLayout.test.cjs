const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.join(root, "src");
const files = [];

/** @param {string} directory 検索先。 @returns {void} 本体のモジュールを収集する。 */
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (entry.name.endsWith(".js")) files.push(file);
  }
}

collect(sourceRoot);
assert.ok(files.length > 0, "本体はsrcへ配置する");
for (const name of fs.readdirSync(root)) {
  assert.ok(!name.endsWith(".js"), "ルートへ本体JSを残さない");
}
let references = 0;
for (const file of [...files, path.join(__dirname, "pirateIntegration.js")]) {
  const bytes = fs.readFileSync(file);
  assert.notEqual(bytes.subarray(0, 3).toString("hex"), "efbbbf", `${file}: BOMを付けない`);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const module = new vm.SourceTextModule(source, { identifier: file });
  for (const specifier of module.dependencySpecifiers) {
    assert.ok(specifier.startsWith("."), `${file}: ブラウザで解決可能な相対パスを使う`);
    const target = path.resolve(path.dirname(file), specifier);
    assert.ok(target.startsWith(sourceRoot + path.sep), `${file}: 本体はsrc内を参照する`);
    assert.ok(fs.existsSync(target), `${file}: ${specifier}が存在する`);
    assert.equal(fs.realpathSync(target), target, `${file}: ファイル名の大文字・小文字も一致する`);
    references += 1;
  }
}
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.match(html, /<script\s+type="module"\s+src="\.\/src\/main\.js"><\/script>/);
assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).main, "src/main.js");
console.log(`moduleLayout: ${files.length}本・${references}参照の構文とパスを確認`);
