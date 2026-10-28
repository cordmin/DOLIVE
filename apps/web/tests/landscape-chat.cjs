const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

(async () => {
const states = [], timers = new Map(), cleanups = [];
const fullscreenCalls = [];
let cursor = 0, nextTimer = 0, landscape = true, videoFull = false, roomFullscreen = 0;
const document = {
  documentElement: { hasAttribute: () => landscape, requestFullscreen: async () => { fullscreenCalls.push('room'); roomFullscreen++; } },
  exitFullscreen: async () => { fullscreenCalls.push('exit-video'); videoFull = false; },
  get fullscreenElement() { return videoFull ? { hasAttribute: () => true } : null; },
};
const hooks = {
  useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], v => { states[i] = v; }]; },
  useRef: () => { const i = cursor++; return states[i] ??= { current: undefined }; },
  useEffect: f => { if (!cleanups.length) cleanups.push(f()); },
};
const context = { exports: {}, require: () => hooks, document,
  setTimeout: f => { timers.set(++nextTimer, f); return nextTimer; }, clearTimeout: id => timers.delete(id) };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/room/landscape-chat.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const render = () => { cursor = 0; return context.exports.useLandscapeChat(); };
let chat = render();
chat.wake(); assert.equal(render().buttonVisible, false, '채팅이 열려 있으면 영상 누르기로 별도 버튼을 띄우지 않음');
chat.hide(); chat = render(); assert.equal(chat.hidden, true);
chat.wake(); chat = render(); assert.equal(chat.buttonVisible, true);
chat.wake(); assert.equal(timers.size, 1, '여러 번 눌러도 숨김 타이머는 하나');
timers.values().next().value(); assert.equal(render().buttonVisible, false, '잠시 뒤 아이콘만 숨기고 영상 유지');
await chat.open(); chat = render(); assert.equal(chat.hidden, false); assert.equal(chat.buttonVisible, false);
chat.hide(); landscape = false; chat = render(); chat.wake(); assert.equal(render().buttonVisible, false, '세로에서는 적용하지 않음');
landscape = true; videoFull = true; await chat.open(); assert.equal(roomFullscreen, 1, '영상만 네이티브 전체화면이면 방 전체화면으로 전환');
assert.deepEqual(fullscreenCalls, ['exit-video', 'room'], '이전 영상 전체화면을 먼저 끝내 채팅을 덮지 않게 한다');
videoFull = true; chat = render(); chat.wake(); assert.equal(render().buttonVisible, true, '영상만 네이티브 전체화면이어도 아이콘 표시');
cleanups.forEach(f => f()); assert.equal(timers.size, 0, '방을 나가면 타이머 해제');

// 실제 너비 조절 함수를 실행해 드래그 중 React 갱신 없이 CSS 너비만 바꾸는지 확인.
const source = ts.createSourceFile('page.tsx', fs.readFileSync('app/room/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const room = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'RoomView');
const drag = room.body.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'dragChat');
const listeners = new Map(), widths = new Map(), saved = [];
const layout = { getBoundingClientRect: () => ({ right: 844, width: 844 }), querySelector: () => ({ getBoundingClientRect: () => ({ width: landscape ? 294 : 330 }) }), style: { setProperty: (k,v) => widths.set(k,v) } };
const grid = { current: { closest: () => layout, getBoundingClientRect: () => ({ right: 1280, width: 1280 }) } };
const resize = { document, grid, chatW: null, saveChatW: v => saved.push(v), Math };
vm.runInNewContext(ts.transpileModule(drag.getText(source), {}).outputText, resize);
const handle = { setPointerCapture() {}, addEventListener: (k,v) => listeners.set(k,v), removeEventListener: k => listeners.delete(k) };
const start = () => resize.dragChat({ preventDefault() {}, currentTarget: handle, pointerId: 1, clientX: landscape ? 550 : 950 });
start(); listeners.get('pointermove')({ clientX: 420 }); listeners.get('pointermove')({ clientX: 400 });
assert.equal(widths.get('--phone-chat-width'), '444px'); assert.deepEqual(saved, [], '드래그 중 전체 방 상태를 갱신하지 않음');
listeners.get('pointercancel')(); assert.equal(listeners.size, 0, '손가락 입력이 취소돼도 이벤트 정리');
landscape = false; start(); listeners.get('pointermove')({ clientX: 900 }); listeners.get('pointerup')();
assert.equal(widths.get('--chat-width'), '380px'); assert.deepEqual(saved, [380], 'PC 너비는 손을 뗄 때 한 번만 저장');
console.log('통과: 채팅 숨김·한 번 눌러 아이콘 표시·다시 열기·타이머 정리·전체화면 복귀·모바일 경계 드래그·PC 너비 저장');
})().catch(e => { console.error(e); process.exitCode = 1; });
