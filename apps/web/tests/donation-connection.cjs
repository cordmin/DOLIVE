const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync('app/room/donation-connection.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const storage = new Map(); const moves = [];
const context = { exports: {}, sessionStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) }, window: { location: { origin: 'https://test.example', assign: (url) => moves.push(url) } }, Date, URL };
vm.runInNewContext(code, context);
const api = context.exports;
assert.equal(api.restoreDonationConnection('connection_required', '시험 방'), true);
assert.equal(moves[0], 'https://test.example/api/auth/dorms/donation/start?next=%2Froom');
assert.equal(api.donationReturning('시험 방'), true);
assert.equal(api.donationReturning('다른 방'), false);
assert.equal(api.restoreDonationConnection('connection_required', '시험 방'), false, '쿠키 저장 실패 때 반복 이동하지 않음');
for (const reason of ['access_denied', 'temporarily_unavailable', 'authentication_required', 'consent_required', 'approval_suspended']) {
  assert.equal(api.restoreDonationConnection(reason, '다른 방'), false, '철회·장애·승인 대기에는 자동 재허용하지 않음');
}
api.finishDonationConnection('시험 방');
assert.equal(api.donationReturning('시험 방'), false);
assert.equal(api.restoreDonationConnection('permission_expired', '시험 방'), true);
api.finishDonationConnection('시험 방');
assert.equal(api.restoreDonationConnection('invalid_token', '시험 방'), true);
api.finishDonationConnection('시험 방');
api.rememberDonationReturn('시험 방');
assert.equal(api.donationReturning('시험 방'), true, '직접 재연결도 돌아오면 창을 이어서 열기');
assert.equal(api.restoreDonationConnection('connection_required', '시험 방'), false);
const deniedStorage = { exports: {}, sessionStorage: { getItem() { throw new Error('저장 거부'); } }, window: { location: { assign() { throw new Error('반복 이동'); } } }, Date };
vm.runInNewContext(code, deniedStorage);
assert.equal(deniedStorage.exports.restoreDonationConnection('connection_required', '시험 방'), false);
assert.equal(deniedStorage.exports.donationReturning('시험 방'), false);
console.log('통과: 허용증 유실·만료 재연결, 방으로 복귀, 창 이어 열기, 반복 왕복 방지, 철회·장애·최초 동의 존중, 저장 거부');

async function widget(reason) {
  const effects = []; const values = []; let index = 0;
  const jsx = (type, props) => { if (type === 'dialog') props.ref.current = { showModal() {} }; return { type, props }; };
  const module = { exports: {}, process: { env: { NODE_ENV: 'production' } }, sessionStorage: context.sessionStorage,
    fetch: async (url) => url.endsWith('/targets') ? Response.json([]) : reason ? Response.json({ reason }, { status: 403 }) : Response.json({ subject: '회원', availableBalance: 3, dailyRemaining: 3, resetsAt: '2026-10-13T00:00:00+09:00' }),
    require(name) {
      if (name === 'react') return { useRef: (v) => ({ current: v }), useState: (v) => { const i = index++; values[i] = v; return [v, (next) => values[i] = next]; }, useEffect: (fn) => effects.push(fn) };
      if (name === 'react-dom') return { createPortal: (v) => v };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === './donation-connection') return api;
      throw new Error(name);
    }, document: { body: {} }, Response, setTimeout };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/room/donation.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, module);
  module.exports.DonationDialog({ token: '가짜 방 입장권', room: '창 시험', close() {}, success() { throw new Error('연결 확인으로 도름을 보내면 안 됨'); } });
  const cleanup = effects[0]();
  await new Promise((resolve) => setImmediate(resolve)); cleanup();
  return values;
}
(async () => {
  storage.clear(); const before = moves.length;
  const lost = await widget('connection_required');
  assert.equal(moves.length, before + 1, '실제 도름네이션 창에서도 최초 허용 창 대신 재연결');
  assert.equal(lost[4], '', '최초 허용 상태를 잘못 표시하지 않음');
  assert.equal(api.donationReturning('창 시험'), true);
  const blocked = await widget('connection_required');
  assert.equal(moves.length, before + 1);
  assert.equal(blocked[4], 'connection_required', '반복 연결 실패는 안내만 표시');
  await widget('');
  assert.equal(api.donationReturning('창 시험'), false);
  const revoked = await widget('access_denied');
  assert.equal(moves.length, before + 1);
  assert.equal(revoked[4], 'access_denied');
  console.log('통과: 실제 도름네이션 창의 재연결, 반복 실패 안내, 연결 완료 정리, 철회 차단');
})().catch((e) => { console.error(e); process.exitCode = 1; });
