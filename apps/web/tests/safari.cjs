// 실행: node tests/safari.cjs (사파리만 골라내는지. 서버 없이)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const safari = { exports: {} };
new Function("module", "exports", ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", "lib", "safari.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(safari, safari.exports);
const { isSafari } = safari.exports;
const WK = "AppleWebKit/605.1.15 (KHTML, like Gecko)";
assert.equal(isSafari(`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${WK} Version/18.5 Safari/605.1.15`), true);
assert.equal(isSafari(`Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) ${WK} Version/18.5 Mobile/15E148 Safari/604.1`), true);
for (const other of [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  `Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) ${WK} CriOS/131.0.0.0 Mobile/15E148 Safari/604.1`,
  `Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) ${WK} FxiOS/133.0 Mobile/15E148 Safari/605.1.15`,
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; rv:133.0) Gecko/20100101 Firefox/133.0",
]) assert.equal(isSafari(other), false, other);
console.log("통과: 사파리만 골라낸다");
