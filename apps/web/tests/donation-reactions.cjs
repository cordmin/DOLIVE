const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
let floats = [];
const styles = { exports: {} };
function compile(file, output, requireModule) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: output.exports, module: output, require: requireModule, setTimeout() {}, TextEncoder, TextDecoder });
}
compile('components/DonationMascot.tsx', styles, require);
const reactions = { exports: {} };
compile('app/room/reactions.tsx', reactions, (name) => {
  if (name === 'react') return { useState: () => [floats, (update) => { floats = update(floats); }], useRef: (value) => ({ current: value }) };
  if (name === '@livekit/components-react') return { useDataChannel: () => ({ send() {} }) };
  if (name === '@/components/DonationMascot') return styles.exports;
  return require(name);
});
for (const amount of [1, 2, 3]) {
  floats = [];
  const { donation } = reactions.exports.useReactions();
  const transferId = randomUUID();
  donation({ transferId, amount });
  assert.equal(floats.length, amount);
  assert.equal(new Set(floats.map((item) => item.id)).size, amount);
  assert.ok(floats.every((item) => styles.exports.DONATION_STYLES.some((style) => style.id === item.variant)));
  donation({ transferId, amount });
  assert.equal(floats.length, amount);
  donation({ transferId: randomUUID(), amount: 0 });
  assert.equal(floats.length, amount);
}
console.log('1·2·3도름의 마릿수와 중복 알림 확인 통과');
