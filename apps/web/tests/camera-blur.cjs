// 실행: apps/web에서 node tests/camera-blur.cjs
// 첫 영상 시간 0, 실패 뒤 자원 정리, 빠른 켜기·끄기를 확인한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

let resultClosed = 0;
let maskOptions;
let initRelease;
let wrappersDestroyed = 0;
class Frame {
  constructor(_canvas, { timestamp }) { this.timestamp = timestamp; }
}
class Transformer {
  constructor(options) { this.options = options; }
  async init({ outputCanvas }) {
    this.canvas = outputCanvas;
    this.gl = { updateMask: texture => assert.equal(texture, '배경 확률'), renderFrame() {} };
    this.imageSegmenter = {
      async setOptions(options) { maskOptions = options; },
      segmentForVideo(_frame, _time, callback) {
        callback({ confidenceMasks: [{ width: 640, height: 360, getAsWebGLTexture: () => '사람 확률' }],
          close: () => resultClosed++ });
      },
    };
  }
}
class Wrapper {
  constructor(transformer) { this.transformer = transformer; }
  async destroy() { wrappersDestroyed++; }
}
const compiled = ts.transpileModule(fs.readFileSync('lib/cameraBlur.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(compiled, {
  exports: exportsObject, VideoFrame: Frame, performance,
  require: name => {
    assert.equal(name, '@livekit/track-processors');
    return { BackgroundTransformer: Transformer, ProcessorWrapper: Wrapper, supportsBackgroundProcessors: () => true };
  },
});

(async () => {
  const processor = await exportsObject.createCameraBlur();
  const graphics = new Proxy({}, { get: (_object, name) => {
    if (name === 'createTexture') return () => '배경 확률';
    if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
    if (/^[A-Z_0-9]+$/.test(name)) return 0;
    return () => ({});
  } });
  await processor.transformer.init({ outputCanvas: { width: 640, height: 360, getContext: () => graphics } });
  assert.equal(maskOptions.outputCategoryMask, false);
  assert.equal(maskOptions.outputConfidenceMasks, true);
  const stamps = [];
  let framesClosed = 0;
  const source = timestamp => ({ timestamp, displayWidth: 640, displayHeight: 360, close: () => framesClosed++ });
  for (const timestamp of [0, 50000, 100000]) {
    await processor.transformer.transform(source(timestamp), { enqueue: f => stamps.push(f.timestamp) });
  }
  assert.deepEqual(stamps, [0, 50000, 100000]);
  processor.transformer.gl.renderFrame = () => { throw new Error('그리기 실패'); };
  await assert.rejects(() => processor.transformer.transform(source(150000), { enqueue() {} }), /그리기 실패/);
  assert.equal(framesClosed, 4);
  assert.equal(resultClosed, 4);

  const events = [];
  let current;
  const track = {
    mediaStreamTrack: { readyState: 'live' }, getProcessor: () => current,
    async setProcessor(p) {
      events.push('준비');
      await new Promise(resolve => { initRelease = resolve; });
      current = p;
      events.push('켜짐');
    },
    async stopProcessor() { current = undefined; events.push('꺼짐'); },
  };
  const on = exportsObject.applyBlur(track, true);
  const off = exportsObject.applyBlur(track, false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['준비']);
  initRelease();
  await Promise.all([on, off]);
  assert.deepEqual(events, ['준비', '켜짐', '꺼짐']);
  assert.equal(current, undefined);
  const failed = { mediaStreamTrack: { readyState: 'live' }, getProcessor: () => undefined,
    async setProcessor() { throw new Error('준비 실패'); } };
  await assert.rejects(() => exportsObject.applyBlur(failed, true), /준비 실패/);
  assert.equal(wrappersDestroyed, 1);
  await exportsObject.applyBlur(failed, false);
  console.log('카메라 블러 확인 통과');
})().catch(error => { console.error(error); process.exitCode = 1; });
