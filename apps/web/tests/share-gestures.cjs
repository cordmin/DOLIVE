// 실제 ScreenView의 손가락 이벤트로 전체화면 주체별 아래 쓸기를 검사한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const source = ts.createSourceFile('stage.tsx', fs.readFileSync('app/room/stage.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'ScreenView');
const code = ts.transpileModule(fn.getText(source), { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText;
function view({ land = true, mode = 'room', phoneEnter = false, fullscreenEnabled = true } = {}) {
  let stateIndex = 0, refIndex = 0, exits = 0, enters = 0, unlocks = 0, phoneEnters = 0, nativeEnters = 0;
  const effects = [], listeners = new Map();
  const box = { querySelector: () => ({ webkitEnterFullscreen: () => nativeEnters++ }), requestFullscreen: async () => { enters++; } };
  const document = {
    fullscreenEnabled,
    documentElement: { hasAttribute: () => land, requestFullscreen: async () => {} },
    fullscreenElement: mode === 'video' ? box : mode === 'room' ? {} : null,
    addEventListener: (name, f) => listeners.set(name, f), removeEventListener() {},
    exitFullscreen: async () => { exits++; document.fullscreenElement = null; listeners.get('fullscreenchange')?.(); },
  };
  const bindings = { React, document, window: { screen: { orientation: { unlock: () => unlocks++, lock: async () => {} } } },
    useState: initial => [stateIndex++ === 0 ? mode === 'video' : initial, () => {}],
    useRef: initial => ({ current: refIndex++ === 0 ? box : initial }), useEffect: f => effects.push(f),
    useSlowNotice: () => null, Floats: () => null, VideoTrack: 'video', FaceOverlay: () => null, isPhone: () => true,
    clearTimeout() {}, setTimeout: () => 1,
  };
  const ScreenView = new Function(...Object.keys(bindings), code + '\nreturn ScreenView;')(...Object.values(bindings));
  const tree = ScreenView({ screen: {}, floats: [], onPhoneFullscreen: phoneEnter ? async () => { phoneEnters++; } : undefined });
  effects[0]();
  function swipe(dx, dy, pointerType = 'touch') {
    tree.props.onPointerDown({ clientX: 100, clientY: 100, pointerType });
    tree.props.onPointerUp({ clientX: 100 + dx, clientY: 100 + dy, pointerType });
  }
  return { swipe, change: () => listeners.get('fullscreenchange')?.(), get exits() { return exits; }, get enters() { return enters; }, get unlocks() { return unlocks; }, get phoneEnters() { return phoneEnters; }, get nativeEnters() { return nativeEnters; } };
}
for (const mode of ['room', 'video']) {
  const v = view({ mode }); v.swipe(0, 90);
  assert.equal(v.exits, 1, `${mode}: 아래로 쓸면 현재 전체화면 해제`);
  assert.equal(v.enters, 0, '아래 쓸기로 영상 전체화면을 새로 열지 않음');
  assert.equal(v.unlocks, 1, '가로 잠금을 풀어 원래 기기 방향으로 복귀');
}
for (const [dx, dy, pointer] of [[0, 20, 'touch'], [100, 60, 'touch'], [0, 90, 'mouse']]) {
  const v = view(); v.swipe(dx, dy, pointer); assert.equal(v.exits, 0, '짧은 쓸기·가로 쓸기·마우스는 종료하지 않음');
}
const portrait = view({ land: false }); portrait.swipe(0, 90); assert.equal(portrait.exits, 0, '세로 방 화면에서 아래 쓸기는 기존처럼 유지');
const up = view({ land: false }); up.swipe(0, -90); assert.equal(up.enters, 1, '위로 쓸어 영상 전체화면 켜기는 유지');
const mobile = view({ land: false, phoneEnter: true }); mobile.swipe(0, -90);
assert.equal(mobile.phoneEnters, 1, '휴대폰 위 쓸기는 방 전체화면과 가로 잠금으로 연결');
assert.equal(mobile.enters, 0, '별도 영상 요소 전체화면을 만들지 않음');
mobile.change(); assert.equal(mobile.unlocks, 0, '방 전체화면으로 바뀔 때 가로 잠금을 해제하지 않음');
const normal = view({ mode: 'none' }); normal.swipe(0, 90); assert.equal(normal.exits, 0); assert.equal(normal.enters, 0);
const unsupported = view({ mode: 'none', phoneEnter: true, fullscreenEnabled: false });
assert.equal(unsupported.nativeEnters, 0, '입장만으로 전체화면을 열지 않음');
unsupported.swipe(0, -90);
assert.equal(unsupported.phoneEnters, 0, '문서 전체화면 미지원이면 방 전체화면 요청을 하지 않음');
assert.equal(unsupported.nativeEnters, 1, '사용자의 위 쓸기는 지원되는 기본 영상 전체화면으로 연결');
console.log('통과: 방/영상 전체화면 아래 쓸기 해제·방향 잠금 해제·세로 위 쓸기·오입력 방지');
