// node tests/camera-size.cjs: 예전 저장값, 세 가지 크기, 잘못된 요청, 방향키와 돌리기를 확인한다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const React = require("react");
function load(file, imports = {}, extra = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("exports", "require", ...Object.keys(extra), code)(exports, name => imports[name] ?? require(name), ...Object.values(extra));
  return exports;
}
let saved = "{}";
const lib = load("lib/dolive.ts", {}, { localStorage: { getItem: () => saved, setItem: (_, value) => saved = value } });
assert.equal(lib.savedCam().size, 3);
for (const size of lib.CAM_SIZES) {
  lib.saveCam({ ...lib.savedCam(), size });
  assert.equal(lib.savedCam().size, size);
}
for (const size of [undefined, 0, 6, 2.5, "5", NaN]) assert.equal(lib.camSize(size), 3);
assert.equal(lib.camSize(1), 2);
assert.equal(lib.camSize(5), 4);
assert.deepEqual(lib.CAM_SIZES.map(n => lib.camWidth(n, false)), [18, 22, 26]);
assert.deepEqual(lib.CAM_SIZES.map(n => lib.camWidth(n, true)), [13, 16, 19]);
const { CameraSize } = load("app/room/camera-size.tsx", { "@/lib/dolive": lib });
let changed;
const slider = disabled => React.Children.toArray(CameraSize({ value: 3, disabled, change: n => changed = n }).props.children)[0];
slider(false).props.onKeyDown({ key: "End", preventDefault() {} });
assert.equal(changed, 4);
slider(true).props.onKeyDown({ key: "Home", preventDefault() {} });
assert.equal(changed, 4);
slider(false).props.onKeyDown({ key: "Home", preventDefault() {} });
assert.equal(changed, 2);
const target = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 64, height: 64 }), focus() {}, setPointerCapture() {} };
slider(false).props.onPointerDown({ button: 0, pointerId: 1, clientX: 32, clientY: 3, currentTarget: target, preventDefault() {} });
assert.equal(changed, 3);
let updates = [];
const route = load("app/api/cam/route.ts", { "@/lib/dolive": lib, "@/lib/chat": { whoSent: async () => ({ room: "방", who: { identity: "나" } }) }, "@/lib/server": { rooms: { updateParticipant: async (...args) => updates.push(args) } } });
(async () => {
  const send = values => route.POST({ json: async () => ({ pos: "bl", shape: "rect", mirror: false, ...values }) });
  assert.equal((await send({})).status, 204);
  assert.equal(updates[0][2].attributes.camSize, "3");
  assert.equal((await send({ size: 4 })).status, 204);
  assert.equal(updates[1][2].attributes.camSize, "4");
  for (const size of [0, 1, 5, 6, 1.5, "5", null]) assert.equal((await send({ size })).status, 400);
  assert.equal(updates.length, 2);
  console.log("캠 크기 세 가지·예전 값 이동·잘못된 요청·다이얼 확인 완료");
})().catch(error => { console.error(error); process.exitCode = 1; });
