// node tests/recording.cjs: 저장 형식, 영상 크기, 방장 확인을 시험한다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const exportsOf = {};
const code = ts.transpileModule(fs.readFileSync("lib/recording.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
new Function("exports", "require", code)(exportsOf, (name) => name === "./dolive" ? {} : require(name));
const { recordFormat, recordSize, startRecording } = exportsOf;
assert.deepEqual(recordFormat(() => true), { type: "video/mp4;codecs=avc1,mp4a.40.2", extension: "mp4" });
assert.deepEqual(recordFormat((type) => type.includes("vp8")), { type: "video/webm;codecs=vp8,opus", extension: "webm" });
assert.throws(() => recordFormat(() => false), /크롬/);
assert.deepEqual(recordSize(1920, 1080, "basic"), { width: 1280, height: 720 });
assert.deepEqual(recordSize(1920, 1080, "clear"), { width: 1920, height: 1080 });
assert.deepEqual(recordSize(640, 360, "clear"), { width: 640, height: 360 });
assert.deepEqual(recordSize(720, 1280, "basic"), { width: 406, height: 720 });
assert.deepEqual(recordSize(0, 0, "basic"), { width: 1280, height: 720 });
(async () => {
  await assert.rejects(startRecording({ localParticipant: { attributes: {} } }, {}, {}, "basic", false, () => {}), /방장만/);
  await assert.rejects(startRecording({ localParticipant: { attributes: { roomAdmin: "1" } } }, { getTrackPublication: () => undefined }, {}, "basic", false, () => {}), /화면공유/);
  console.log("통과: 녹화 형식·화질·원본 크기·방장 확인·공유 전 확인");
})().catch((e) => { console.error(e); process.exitCode = 1; });
