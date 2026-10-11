// 실행: node tests/donation-return.cjs. 실제 서버나 회원은 쓰지 않는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { DisconnectReason } = require('livekit-client');
const code = ts.transpileModule(fs.readFileSync('app/room/page.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function setup() {
  const window = new EventTarget();
  const values = new Map([['name', '시험 회원'], ['dolive-room-active', '1']]);
  const effects = [], ended = [], requests = [];
  let stateIndex = 0;
  const react = {
    useRef: (current) => ({ current }),
    useState: () => [stateIndex++ === 0 ? { token: '시험 입장권', url: '시험 주소' } : '', (value) => ended.push(value)],
    useEffect: (effect) => effects.push(effect),
  };
  const context = {
    exports: {}, process: { env: { NODE_ENV: 'test' } }, window, screen: {}, matchMedia: () => ({ matches: false }),
    document: { documentElement: { toggleAttribute() {}, removeAttribute() {} } },
    sessionStorage: { getItem: (key) => values.get(key) ?? null, removeItem: (key) => values.delete(key) },
    fetch: (url) => { requests.push(url); return new Promise(() => {}); },
    AbortSignal,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'livekit-client') return require(name);
      if (name === '@livekit/components-react') return { LiveKitRoom: '시험 방', RoomAudioRenderer: '시험 소리' };
      if (name === 'next/navigation') return { useRouter: () => ({ replace() { throw new Error('허용 중 첫 화면 이동'); } }) };
      if (name === '@/lib/dolive') return { isPhone: () => false, savedAvatar: () => '1' };
      if (name === '@/lib/roomHistory') return { ROOM_ENTRY_KEY: 'dolive-room-active' };
      return {};
    },
  };
  vm.runInNewContext(code, context);
  const room = context.exports.default();
  const cleanups = effects.map((effect) => effect());
  return { window, values, ended, requests, disconnect: room.props.onDisconnected, cleanup: () => cleanups.forEach((fn) => fn?.()) };
}

for (const event of ['beforeunload', 'pagehide']) {
  const s = setup();
  s.window.dispatchEvent(new Event(event));
  s.disconnect(DisconnectReason.CLIENT_INITIATED);
  assert.equal(s.values.get('dolive-room-active'), '1');
  assert.equal(s.requests.includes('/'), false);
  // 돌아온 뒤 일반 연결 끊김은 지금처럼 처리한다.
  s.window.dispatchEvent(new Event('pageshow'));
  s.disconnect(DisconnectReason.CLIENT_INITIATED);
  assert.equal(s.values.has('dolive-room-active'), false);
  assert.equal(s.requests.includes('/'), true);
  s.cleanup();
}
for (const [reason, expected] of [[DisconnectReason.ROOM_DELETED, 'end'], [DisconnectReason.PARTICIPANT_REMOVED, 'kick']]) {
  const s = setup();
  s.window.dispatchEvent(new Event('beforeunload'));
  s.disconnect(reason);
  assert.equal(s.values.has('dolive-room-active'), false);
  assert.equal(s.ended.at(-1), expected);
  s.cleanup();
}
console.log('통과: 허용 이동 중 입장 표시 유지, 첫 화면 이동 방지, 복귀 뒤 퇴장, 방송 종료와 강퇴');
