const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
let floats = [];
let sounds = [], cleanups = [];
class Audio {
  static blocked = false;
  constructor(src) { this.src = src; this.paused = false; sounds.push(this); }
  play() { return Audio.blocked ? Promise.reject(new Error('자동 재생 제한')) : Promise.resolve(); }
  pause() { this.paused = true; }
}
const styles = { exports: {} };
function compile(file, output, requireModule) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: output.exports, module: output, require: requireModule, setTimeout() {}, TextEncoder, TextDecoder, Audio });
}
compile('components/DonationMascot.tsx', styles, require);
const reactions = { exports: {} };
compile('app/room/reactions.tsx', reactions, (name) => {
  if (name === 'react') return { useState: () => [floats, (update) => { floats = update(floats); }], useRef: (value) => ({ current: value }), useEffect: (effect) => { cleanups.push(effect()); } };
  if (name === '@livekit/components-react') return { useDataChannel: () => ({ send() {} }) };
  if (name === '@/components/DonationMascot') return styles.exports;
  return require(name);
});
for (const amount of [1, 2, 3]) {
  floats = [];
  sounds = [];
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
  assert.equal(sounds.length, 1);
}

(async () => {
  sounds = []; cleanups = []; floats = [];
  const { donation } = reactions.exports.useReactions();
  const give = () => donation({ transferId: randomUUID(), amount: 3 });
  donation({ transferId: '잘못된 알림', amount: 1 });
  assert.equal(sounds.length, 0);
  give(); give(); give();
  assert.equal(floats.length, 9); // 그림은 모두 표시한다.
  assert.equal(sounds.length, 1); // 재생 요청 중에도 소리는 겹치지 않는다.
  assert.equal(sounds[0].src, '/donation-bubbles.mp3');
  await Promise.resolve();
  give();
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0].paused, false);
  sounds[0].onended();
  give();
  assert.equal(sounds.length, 2); // 끝난 다음 새 알림은 다시 재생한다.
  sounds[0].onended();
  give();
  assert.equal(sounds.length, 2); // 옛 소리의 알림이 현재 소리를 풀지 않는다.
  sounds[1].onerror();
  Audio.blocked = true;
  give();
  await Promise.resolve();
  Audio.blocked = false;
  give();
  assert.equal(sounds.length, 4); // 재생 실패 후 다음 알림에서 다시 시도한다.
  cleanups[0]();
  assert.equal(sounds[3].paused, true); // 방에서 나오면 소리도 멈춘다.
  console.log('통과: 도름이 마릿수, 중복 알림, 소리 겹침 방지, 끝난 뒤 재생, 실패 후 재시도, 퇴장 시 멈춤');
})().catch((error) => { console.error(error); process.exitCode = 1; });
