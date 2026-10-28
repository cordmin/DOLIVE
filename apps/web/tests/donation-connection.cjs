const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

async function widget(reason) {
  const states = [], effects = []; let index = 0;
  const jsx = (type, props) => ({ type, props });
  const context = { exports: {}, process: { env: { NODE_ENV: 'production' } },
    sessionStorage: { getItem: () => null },
    window: { location: { assign() { throw new Error('방송 중 페이지 이동'); } } },
    fetch: async url => url.endsWith('/targets') ? Response.json([]) : reason ? Response.json({ reason }, { status: 403 }) : Response.json({ subject: '회원', availableBalance: 3, dailyRemaining: 3, resetsAt: '2026-10-28T00:00:00+09:00' }),
    require(name) {
      if (name === 'react') return { useRef: v => ({ current: { ...v, showModal() {} } }), useState: v => { const i = index++; if (!(i in states)) states[i] = v; return [states[i], next => states[i] = typeof next === 'function' ? next(states[i]) : next]; }, useEffect: fn => effects.push(fn) };
      if (name === 'react-dom') return { createPortal: v => v };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      throw new Error(name);
    }, document: { body: {} }, Response, setTimeout };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/room/donation.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  const render = () => { index = 0; return context.exports.DonationDialog({ token: '시험 입장권', room: '시험 방', close() {}, success() { throw new Error('권한 확인으로 보내면 안 됨'); } }); };
  render(); const cleanup = effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  const tree = render(); cleanup(); return { tree, states };
}
function nodes(n) { return !n || typeof n !== 'object' ? [] : [n, ...[n.props?.children].flat(2).flatMap(nodes)]; }
(async () => {
  for (const reason of ['consent_required', 'connection_required', 'permission_expired', 'invalid_token', 'authentication_required', 'access_denied', 'approval_pending', 'approval_suspended', 'temporarily_unavailable']) {
    const { tree } = await widget(reason);
    const links = nodes(tree).filter(n => n.type === 'a');
    for (const a of links) {
      assert.equal(a.props.target, '_blank', `${reason}: 방송 중인 창은 유지`);
      assert.ok(a.props.rel.includes('noopener'));
      if (a.props.href.startsWith('/api/auth/')) assert.equal(new URL(a.props.href, 'https://test.example').searchParams.get('next'), '/dorms-donation-allowed', '허용 후 방송방을 중복으로 열지 않음');
    }
    if (['consent_required', 'connection_required', 'permission_expired', 'invalid_token', 'authentication_required'].includes(reason)) assert.equal(links.length, 1);
    if (['approval_pending', 'approval_suspended', 'temporarily_unavailable'].includes(reason)) assert.equal(links.length, 0, '승인 대기·장애는 재로그인 반복 없이 안내');
  }
  const { states } = await widget('');
  assert.equal(states[0].dailyRemaining, 3);
  assert.equal(states[4], '', '권한 확인 성공');
  console.log('통과: 실제 도름네이션 창의 권한 유실·만료·최초 동의·로그인 만료에도 방송 페이지 유지, 새 창 복귀 경로, 승인·장애 안내');
})().catch(e => { console.error(e); process.exitCode = 1; });
