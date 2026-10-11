const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync('app/room/phone-audio.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function setup(phone, microphone, supported = true) {
  const document = new EventTarget(); document.visibilityState = 'visible';
  const window = new EventTarget();
  const navigator = supported ? { audioSession: { type: 'auto' }, mediaSession: { metadata: { title: '이전 소리' } } } : {};
  let cleanup, plays = 0;
  const context = { exports: {}, navigator, document, window, MediaMetadata: class { constructor(value) { Object.assign(this, value); } }, require(name) {
    if (name === 'react') return { useEffect(effect) { cleanup = effect(); } };
    if (name === '@/lib/dolive') return { isPhone: () => phone };
    throw new Error(name);
  } };
  vm.runInNewContext(code, context);
  context.exports.usePhoneAudio({ name: '시험 방송', startAudio() { plays++; return Promise.resolve(); } }, microphone);
  return { navigator, document, window, cleanup, plays: () => plays };
}
for (const microphone of [false, true]) {
  const s = setup(true, microphone);
  assert.equal(s.navigator.audioSession.type, microphone ? 'play-and-record' : 'playback');
  assert.equal(s.navigator.mediaSession.metadata.artist, '시험 방송');
  s.document.visibilityState = 'hidden'; s.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(s.plays(), 0);
  s.document.visibilityState = 'visible'; s.document.dispatchEvent(new Event('visibilitychange'));
  s.window.dispatchEvent(new Event('pageshow'));
  assert.equal(s.plays(), 2);
  s.cleanup();
  assert.equal(s.navigator.audioSession.type, 'auto');
  assert.equal(s.navigator.mediaSession.metadata.title, '이전 소리');
  s.window.dispatchEvent(new Event('pageshow'));
  assert.equal(s.plays(), 2);
}
const pc = setup(false, false);
assert.equal(pc.navigator.audioSession.type, 'auto');
assert.equal(pc.cleanup, undefined);
setup(true, false, false).cleanup();
console.log('통과: 휴대폰 재생 설정, 마이크 사용 설정, 화면 복귀, 퇴장 정리, 미지원 브라우저와 PC');
