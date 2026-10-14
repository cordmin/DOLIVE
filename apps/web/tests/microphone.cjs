const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');
const compile = (path) => ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const device = (id, kind = 'audioinput') => ({ deviceId: id, label: id, kind });
function track(id = 'phone') {
  const t = new EventEmitter();
  t.mediaStreamTrack = { getSettings: () => ({ deviceId: id }) };
  t.stop = () => { t.stopped = true; };
  t.restartTrack = async (options) => { t.restarts = (t.restarts || 0) + 1; t.requested = options; };
  t.mute = async () => { t.isMuted = true; t.onMute?.(); };
  return t;
}
const tick = () => new Promise((r) => setImmediate(r));
async function run() {
  const calls = []; let captured = track();
  const helper = { exports: {}, require: () => ({ createLocalAudioTrack: async (o) => { calls.push(o); return captured; } }) };
  vm.runInNewContext(compile('lib/microphone.ts'), helper);
  const { microphoneChoices, captureMicrophone, microphoneLabel } = helper.exports;
  assert.equal(microphoneLabel('Speakerphone', 0), '스피커 폰');
  assert.equal(microphoneLabel('Headset earpiece', 1), '휴대폰 수화부');
  assert.equal(microphoneLabel('Default - Bluetooth headset', 0), '기본 - 블루투스 헤드셋');
  assert.equal(microphoneLabel('Wired headset', 0), '유선 헤드셋');
  assert.equal(microphoneLabel('USB audio', 0), 'USB 소리 장치');
  assert.equal(microphoneLabel('제품 이름 ABC', 0), '제품 이름 ABC');
  assert.equal(microphoneLabel('', 2), '마이크 3');
  assert.deepEqual(Array.from(microphoneChoices([device('default'), device('communications'), device('phone'), device('phone'), device('car'), device('camera', 'videoinput')]), (d) => d.deviceId), ['phone', 'car']);
  assert.equal(microphoneChoices([device('default'), device('communications')]).length, 1);
  captured = track('car'); await captureMicrophone('car');
  assert.equal(calls.at(-1).deviceId.exact, 'car');
  captured = track('phone'); await assert.rejects(() => captureMicrophone('car'), /고른 마이크/);
  assert.equal(captured.stopped, true);

  function mount(list) {
    const room = new EventEmitter(); const nav = { mediaDevices: new EventTarget() };
    const states = []; const effects = []; let index = 0, tree, pending, pub;
    const logs = []; const created = []; const timers = [];
    const dialog = { open: false, showModal() { this.open = true; }, close() { if (this.open) { this.open = false; find('dialog').props.onClose(); } } };
    const me = {
      get isMicrophoneEnabled() { return !!pub && !pub.track.isMuted; },
      getTrackPublication() { return pub; },
      async publishTrack(t) { logs.push('publish'); pub = { source: 'microphone', track: t }; t.onMute = () => room.emit('muted', pub, me); room.emit('published', pub); },
      async unpublishTrack(t) { if (pub?.track === t) pub = undefined; t.stop(); },
      async setMicrophoneEnabled() { if (pub) await pub.track.mute(); },
    };
    const react = {
      useCallback(fn) { return fn; },
      useRef(value) { const i = index++; return states[i] ||= { current: value }; },
      useState(value) { const i = index++; if (!(i in states)) states[i] = value; return [states[i], (v) => states[i] = v]; },
      useEffect(fn) { if (!effects.length) effects.push(fn); },
    };
    const jsx = (type, props) => { if (type === 'dialog') props.ref.current = dialog; return { type, props }; };
    const context = { exports: {}, navigator: nav, alert: (s) => logs.push(s), Date,
      setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {},
      require(name) {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
        if (name === '@livekit/components-react') return { useRoomContext: () => room, useLocalParticipant: () => ({ localParticipant: me, isMicrophoneEnabled: me.isMicrophoneEnabled }) };
        if (name === 'livekit-client') return { Room: { getLocalDevices: async () => list }, RoomEvent: { LocalTrackPublished: 'published', LocalTrackUnpublished: 'unpublished', TrackMuted: 'muted' }, Track: { Source: { Microphone: 'microphone' } }, TrackEvent: { Restarted: 'restarted' } };
        if (name === '@/components/Knob') return { Knob: 'knob' };
        if (name === './menu') return { useHoldMenu: () => (open) => ({ onContextMenu: open }) };
        if (name === './phone-audio') return { preparePhoneMicrophone: (on) => logs.push(on ? 'prepare' : 'playback') };
        if (name === '@/lib/microphone') return { microphoneChoices, microphoneLabel, checkMicrophone: helper.exports.checkMicrophone,
          captureMicrophone: async (id) => { logs.push('capture'); if (pending) return pending; const t = track(id || 'phone'); created.push(t); return t; } };
        throw new Error(name);
      },
    };
    vm.runInNewContext(compile('app/room/microphone.tsx'), context);
    function render() { index = 0; tree = context.exports.MicrophoneKnob(); }
    function find(type, node = tree) {
      if (node?.type === type) return node;
      for (const c of [node?.props?.children].flat(Infinity)) { const match = c && typeof c === 'object' && find(type, c); if (match) return match; }
    }
    render(); const cleanup = effects[0]();
    return { logs, created, dialog, me, room, find, render, cleanup, nav, timers, pending(value) { pending = value; } };
  }

  const one = mount([device('phone')]);
  one.find('knob').props.onClick(); await tick();
  assert.deepEqual(one.logs.slice(0, 3), ['prepare', 'capture', 'publish']);
  assert.equal(one.dialog.open, false);
  const live = one.created[0];
  one.nav.mediaDevices.dispatchEvent(new Event('devicechange')); await one.timers.pop()();
  assert.equal(live.restarts, 1);
  one.render(); one.find('knob').props.onClick(); await tick();
  one.nav.mediaDevices.dispatchEvent(new Event('devicechange')); await one.timers.pop()();
  assert.equal(live.restarts, 1, '꺼진 마이크는 다시 잡지 않음');
  one.cleanup();

  const two = mount([device('phone'), device('car')]);
  two.find('knob').props.onClick(); await tick(); two.render();
  assert.equal(two.dialog.open, true);
  assert.equal(two.logs.includes('publish'), false, '고르기 전에는 소리를 보내지 않음');
  two.find('select').props.onChange({ target: { value: 'car' } }); two.render();
  two.find('form').props.onSubmit({ preventDefault() {} }); await tick();
  assert.equal(two.me.isMicrophoneEnabled, true);
  assert.equal(two.created.at(-1).mediaStreamTrack.getSettings().deviceId, 'car');
  const switched = two.created.at(-1);
  switched.mediaStreamTrack.getSettings = () => ({ deviceId: 'phone' });
  switched.emit('restarted', switched); await tick();
  assert.equal(switched.isMuted, true, '통화 도구가 다른 마이크로 복구하면 중지');
  assert.equal(two.logs.some((l) => l.startsWith('고른 마이크로 연결되지')), true);
  two.nav.mediaDevices.dispatchEvent(new Event('devicechange')); await two.timers.pop()();
  assert.equal(two.created.at(-1).restarts, undefined, '방장이 끈 마이크도 다시 잡지 않음');
  two.cleanup();

  const canceled = mount([device('phone')]);
  let resolve; canceled.pending(new Promise((r) => resolve = r));
  canceled.find('knob').props.onClick(); await tick();
  canceled.find('knob').props.onClick();
  const late = track(); resolve(late); await tick();
  assert.equal(late.stopped, true);
  assert.equal(canceled.logs.includes('publish'), false, '취소 뒤 늦게 받은 마이크는 보내지 않음');
  canceled.cleanup();

  const during = mount([device('phone')]);
  during.find('knob').props.onClick(); await tick();
  const recovering = during.created[0]; let finish;
  recovering.restartTrack = () => new Promise((r) => finish = r);
  during.nav.mediaDevices.dispatchEvent(new Event('devicechange'));
  const recovery = during.timers.pop()();
  await recovering.mute(); finish(); await recovery;
  assert.equal(during.me.isMicrophoneEnabled, false, '복구 중 방장이 꺼도 꺼짐 유지');
  assert.equal(during.logs.filter((l) => l === 'publish').length, 1);
  during.cleanup();

  const denied = mount([device('phone')]);
  const failure = Object.assign(new Error('거부'), { name: 'NotAllowedError' });
  denied.pending(Promise.reject(failure));
  denied.find('knob').props.onClick(); await tick();
  assert.equal(denied.me.isMicrophoneEnabled, false);
  assert.equal(denied.logs.at(-1), '마이크 사용을 허용해 주세요.');
  assert.equal(denied.logs.includes('playback'), true);
  denied.cleanup();
  console.log('통과: 중복 장치 제거, 정확한 마이크 요청, 잘못 연결된 장치 중지, 준비 순서, 한 마이크 바로 켜기, 여러 마이크 선택, 연결 변경 복구, 사용자·방장 끄기, 늦은 허용 취소');
}
run().catch((e) => { console.error(e); process.exitCode = 1; });
