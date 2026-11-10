// 실제 방이나 기기를 쓰지 않고, 누르는 순간 재생을 시작하는지와 같은 방을 넘기는지 확인한다.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const livekit = require('livekit-client');

function load(file, imports, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {}, process: { env: { NODE_ENV: 'test' } }, ...globals,
    require: (name) => imports[name] ?? (name === 'react/jsx-runtime' ? require(name) : {}),
  };
  vm.runInNewContext(code, context, { filename: file });
  return context.exports;
}

function setup() {
  const rooms = [], order = [];
  let gesture = false;
  class Room extends EventEmitter {
    constructor(options) { super(); this.options = options; this.canPlaybackAudio = true; this.plays = 0; rooms.push(this); }
    startAudio() {
      this.plays++;
      order.push('소리 준비');
      // 실제 브라우저 시험 대신, 손을 뗀 순간에만 허용하는 엄격한 재생 규칙을 흉내 낸다.
      this.canPlaybackAudio = gesture && !this.reject;
      return this.canPlaybackAudio ? Promise.resolve() : Promise.reject(new Error('재생 차단'));
    }
    connect() { throw new Error('입장권 없이 연결하면 안 됨'); }
  }
  const audio = load('lib/roomAudio.ts', { 'livekit-client': { ...livekit, Room } });
  const act = (fn) => { gesture = true; try { return fn(); } finally { gesture = false; } };
  return { audio, rooms, order, act };
}

test('이미 재생 가능으로 표시되어도 입장 클릭에서 즉시 준비하며, 지연 뒤에도 같은 방을 쓴다', async () => {
  const s = setup();
  const room = s.audio.getEntryRoom();
  s.act(() => s.audio.prepareRoomAudio());
  assert.equal(room.plays, 1);
  assert.equal(room.canPlaybackAudio, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.audio.getEntryRoom(), room);
  assert.equal(s.rooms.length, 1);
  // 소리 수정 때문에 기존 영상·연결 설정이 달라지지 않는다.
  assert.equal(room.options.adaptiveStream.pauseVideoInBackground, false);
  assert.equal(room.options.dynacast, true);
  assert.deepEqual(JSON.parse(JSON.stringify(room.options.videoCaptureDefaults.resolution)), { width: 640, height: 360, frameRate: 20 });
  assert.equal(room.options.publishDefaults.videoEncoding, livekit.VideoPresets.h360.encoding);
  assert.equal(room.options.publishDefaults.videoSimulcastLayers[0], livekit.VideoPresets.h180);
  assert.equal(room.options.singlePeerConnection, true);
  room.emit(livekit.RoomEvent.Disconnected);
  assert.notEqual(s.audio.getEntryRoom(), room);
});

test('휴대폰의 손 떼기·클릭·Enter와 PC 누르기로 복구하고, 실패 후 다시 누를 수 있다', async () => {
  const s = setup(), room = s.audio.getEntryRoom();
  const listeners = new Map();
  const target = {
    addEventListener(type, fn, capture) { assert.equal(capture, true); listeners.set(type, fn); },
    removeEventListener(type, fn, capture) { assert.equal(listeners.get(type), fn); assert.equal(capture, true); listeners.delete(type); },
  };
  const cleanup = s.audio.watchAudioUnlock(room, target);
  const fire = (type, data = {}) => listeners.get(type)?.({ type, ...data });
  room.canPlaybackAudio = false;
  fire('pointerdown', { pointerType: 'touch' });
  assert.equal(room.plays, 0);
  s.act(() => fire('pointerup', { pointerType: 'touch' }));
  assert.equal(room.canPlaybackAudio, true);
  s.act(() => fire('click'));
  assert.equal(room.plays, 1); // 이미 재생 중이면 다시 건드리지 않는다.
  for (const [type, data] of [['touchend', {}], ['click', {}], ['keydown', { key: 'Enter' }], ['pointerup', { pointerType: 'pen' }], ['pointerdown', { pointerType: 'mouse' }]]) {
    room.canPlaybackAudio = false;
    s.act(() => fire(type, data));
    assert.equal(room.canPlaybackAudio, true, type);
  }
  room.canPlaybackAudio = false;
  const before = room.plays;
  s.act(() => { fire('keydown', { key: 'Escape' }); fire('keydown', { key: 'Enter', repeat: true }); fire('pointerup', { pointerType: 'mouse' }); });
  assert.equal(room.plays, before);
  room.reject = true;
  s.act(() => fire('touchend'));
  await new Promise((resolve) => setImmediate(resolve)); // 거절을 처리하지 않으면 node --test가 실패한다.
  room.reject = false;
  s.act(() => fire('touchend'));
  assert.equal(room.canPlaybackAudio, true);
  cleanup();
  assert.equal(listeners.size, 0);
});

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function textOf(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(textOf).join('');
  return typeof tree === 'object' ? textOf(tree.props?.children) : String(tree);
}
function component(file, s, overrides = {}, fetch = () => new Promise(() => {})) {
  const states = [], refs = [], effects = [];
  let stateIndex = 0, refIndex = 0;
  const values = new Map([['name', '시험 회원'], ['dolive-room-active', '1']]);
  const document = new EventTarget();
  document.documentElement = { toggleAttribute() {}, removeAttribute() {} };
  const window = new EventTarget();
  const react = {
    useState(initial) {
      const i = stateIndex++;
      if (!(i in states)) states[i] = i in overrides ? overrides[i] : typeof initial === 'function' ? initial() : initial;
      return [states[i], (value) => { s.order.push('화면 변경'); states[i] = typeof value === 'function' ? value(states[i]) : value; }];
    },
    useRef(current) { const i = refIndex++; return refs[i] ??= { current }; },
    useEffect(effect) { effects.push(effect); },
    useCallback: (fn) => fn,
  };
  const imports = {
    react,
    'livekit-client': livekit,
    '@livekit/components-react': { LiveKitRoom: '시험 방', RoomAudioRenderer: '시험 소리' },
    'next/dynamic': { default: () => '나중에 받는 방' },
    'next/navigation': { useRouter: () => ({ push: () => s.order.push('주소 이동'), replace() {} }) },
    '@/lib/dolive': { AVATARS: ['1'], CUSTOM: 'custom', DORMS: 'dorms', savedAvatar: () => '1', isPhone: () => true },
    '@/lib/roomHistory': { ROOM_ENTRY_KEY: 'dolive-room-active' },
    '@/lib/roomAudio': s.audio,
  };
  const exports = load(file, imports, {
    fetch, window, document, screen: {}, matchMedia: () => ({ matches: false }),
    sessionStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) },
  });
  return {
    render(props) { stateIndex = 0; refIndex = 0; return (exports.default ?? exports.EnterYeonsu)(props); },
    effects,
  };
}

test('연수 입장 버튼과 Enter는 화면을 바꾸기 전에 준비하고, 실제 방도 그 객체를 받는다', () => {
  for (const keyboard of [false, true]) {
    const s = setup();
    const c = component('app/yeonsu/enter.tsx', s);
    const tree = c.render({ room: '시험 연수', name: '시험 회원', picture: null, dormsHref: 'https://example.test' });
    s.act(() => {
      if (keyboard) nodes(tree).find((n) => n.type === 'input').props.onKeyDown({ key: 'Enter' });
      else nodes(tree).find((n) => n.type === 'button' && textOf(n) === '입장하기').props.onClick();
    });
    assert.deepEqual(s.order, ['소리 준비', '화면 변경']);
    const r = component('app/room/page.tsx', s, { 0: { url: '시험 주소', token: '시험 입장권' } });
    const roomTree = r.render();
    assert.equal(roomTree.props.room, s.rooms[0]);
    assert.equal(roomTree.props.audio, false);
    assert.equal(roomTree.props.options, undefined); // 전달한 방의 설정을 덮어쓰지 않는다.
  }
});

test('일반 입장은 주소 이동보다 먼저, 비밀번호 입장은 서버 응답보다 먼저 준비한다', async () => {
  for (const password of [false, true]) {
    const s = setup();
    let resolvePassword;
    const c = component('app/page.tsx', s, {
      0: '시험 회원', 4: '시험 암호', 6: [{ name: '시험 방', locked: password, guest: true }], 7: '시험 방',
    }, () => { s.order.push('비밀번호 요청'); return new Promise((resolve) => { resolvePassword = resolve; }); });
    const tree = c.render();
    s.act(() => {
      if (password) {
        const form = nodes(tree).find((n) => n.type === 'form' && nodes(n).some((child) => child.props?.placeholder === '비밀번호'));
        form.props.onSubmit({ preventDefault() {} });
      } else nodes(tree).find((n) => n.type === 'button' && nodes(n).some((child) => child.props?.['aria-label'] === 'LIVE 입장')).props.onClick();
    });
    assert.equal(s.order[0], '소리 준비');
    if (password) {
      assert.deepEqual(s.order, ['소리 준비', '비밀번호 요청']);
      resolvePassword({ ok: true });
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(s.order.at(-1), '주소 이동');
    assert.equal(s.rooms.length, 1);
    assert.equal(s.rooms[0].plays, 1); // 비밀번호 응답 뒤에는 사용자 동작 없이 재생 준비를 되풀이하지 않는다.
    assert.equal(s.rooms[0].canPlaybackAudio, true);
    const r = component('app/room/page.tsx', s, { 0: { url: '시험 주소', token: '시험 입장권' } });
    assert.equal(r.render().props.room, s.rooms[0]);
  }
});

test('입장 준비가 거절되어도 입장을 막지 않고 다음 사용자 동작으로 재시도한다', async () => {
  const s = setup();
  s.audio.prepareRoomAudio();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.rooms[0].canPlaybackAudio, false);
  s.act(() => s.audio.prepareRoomAudio());
  assert.equal(s.rooms[0].canPlaybackAudio, true);
  assert.equal(s.rooms.length, 1);
});
