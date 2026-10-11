const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync('lib/roomHistory.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function setup() {
  const window = new EventTarget();
  const values = new Map([['dolive-room-active', '1'], ['name', '시험 이름']]);
  const sessionStorage = { getItem: (key) => values.get(key) ?? null, removeItem: (key) => values.delete(key) };
  const entries = [{ url: '/', state: {} }, { url: '/room', state: { __NA: true } }];
  let index = 1, opens = 0, closes = 0;
  const history = {
    get state() { return entries[index].state; },
    pushState(state) { entries.splice(index + 1); entries.push({ url: '/room', state }); index++; },
    back() { if (index > 0) { index--; window.dispatchEvent(new Event('popstate')); } },
    forward() { if (index < entries.length - 1) { index++; window.dispatchEvent(new Event('popstate')); } },
  };
  const context = { exports: {}, history, window, sessionStorage };
  vm.runInNewContext(code, context);
  const guard = () => context.exports.watchRoomBack(() => opens++, () => closes++);
  const leave = () => context.exports.leaveRoomHistory(() => { entries[index] = { url: '/', state: {} }; });
  return { entries, history, guard, leave, values, index: () => index, opens: () => opens, closes: () => closes };
}
for (const backFirst of [false, true]) {
  const s = setup();
  s.guard();
  assert.equal(s.entries.length, 3);
  if (backFirst) { s.history.back(); assert.equal(s.opens(), 1); }
  s.leave();
  assert.equal(s.index(), 1);
  assert.equal(s.entries[1].url, '/');
  assert.equal(s.values.has('dolive-room-active'), false);
  assert.equal(s.values.get('name'), '시험 이름');
  s.history.back();
  assert.equal(s.entries[s.index()].url, '/');
  assert.equal(s.opens(), backFirst ? 1 : 0); // 퇴장 정리 중 확인창이 다시 뜨지 않는다.
}
const s = setup();
let guard = s.guard(); guard.dispose(); guard = s.guard();
assert.equal(s.entries.length, 3); // 다시 실행되어도 한 칸만 추가한다.
for (let i = 0; i < 3; i++) { s.history.back(); guard.stay(); assert.equal(s.entries.length, 3); }
s.history.back(); s.history.forward();
assert.equal(s.closes(), 4); // 앞으로가기는 열린 확인창을 닫고 방에 남는다.
guard.dispose(); s.history.back();
assert.equal(s.opens(), 4);
console.log('통과: 뒤로가기 확인, 취소, 로고 퇴장, 방 기록 바꾸기, 재입장 표시 삭제, 중복 기록 방지');
