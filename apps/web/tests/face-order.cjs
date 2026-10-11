// 실행: node tests/face-order.cjs (얼굴 순서와 말하는 사람 우선 보기. 서버 없이)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const stage = ts.createSourceFile("stage.tsx", fs.readFileSync(path.join(__dirname, "..", "app", "room", "stage.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = stage.statements.filter((s) => ts.isFunctionDeclaration(s) && ["useCams", "useFacePage"].includes(s.name?.text)).map((s) => s.getText(stage)).join("\n");
const js = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
let tracks = [];
let state;
let changed = false;
const hooks = new Function("useRoomTick", "useTracks", "Track", "RoomEvent", "useState", `${js}\nreturn { useCams, useFacePage };`)(
  () => {},
  (sources, options) => {
    assert.deepEqual(sources, ["camera"]);
    assert.deepEqual(options.updateOnlyOn, ["activeSpeakersChanged"]);
    return tracks;
  },
  { Source: { Camera: "camera" } },
  { ActiveSpeakersChanged: "activeSpeakersChanged" },
  (initial) => {
    state ??= initial;
    return [state, (value) => { state = value; changed = true; }];
  },
);
const cam = (identity, options = {}) => ({ participant: { identity, isLocal: false, isMicrophoneEnabled: false, isSpeaking: false, ...options }, publication: { isMuted: false } });
const mine = cam("나", { isLocal: true });
const muted = cam("캠 끔", { isSpeaking: true });
muted.publication.isMuted = true;
tracks = [cam("조용한 사람"), cam("마이크 1", { isMicrophoneEnabled: true }), cam("마이크 2", { isMicrophoneEnabled: true }), cam("말하는 사람", { isMicrophoneEnabled: true, isSpeaking: true }), mine, muted];
const original = [...tracks];
let cams = hooks.useCams();
assert.deepEqual(cams.map((c) => c.participant.identity), ["나", "말하는 사람", "마이크 1", "마이크 2", "조용한 사람"]);
assert.deepEqual(tracks, original); // 받은 목록은 바꾸지 않는다
function renderPage() {
  let result;
  for (let i = 0; i < 5; i++) {
    changed = false;
    result = hooks.useFacePage(cams);
    if (!changed) return result;
  }
  throw new Error("얼굴 묶음이 끝없이 다시 그려짐");
}
assert.equal(renderPage()[0], 0);
renderPage()[1]();
assert.equal(renderPage()[0], 1);
tracks[3].participant.audioLevel = 0.9;
cams = hooks.useCams();
assert.equal(renderPage()[0], 1); // 같은 사람이 계속 말할 때는 넘긴 묶음 유지
tracks[3].participant.isSpeaking = false;
cams = hooks.useCams();
assert.equal(renderPage()[0], 1); // 말이 끝났다고 묶음을 바꾸지 않는다
tracks[0].participant.isSpeaking = true;
tracks[0].participant.isMicrophoneEnabled = true;
cams = hooks.useCams();
assert.equal(renderPage()[0], 0); // 뒤에 있던 사람이 말하기 시작하면 앞으로
assert.deepEqual(cams.slice(0, 2).map((c) => c.participant.identity), ["나", "조용한 사람"]);
tracks[1].participant.isSpeaking = true;
cams = hooks.useCams();
renderPage()[1]();
assert.equal(renderPage()[0], 1);
cams = [...cams].reverse();
assert.equal(renderPage()[0], 1); // 같은 두 사람이 말하면 목록 순서만 바뀌어도 유지
tracks.forEach((c) => { c.participant.isSpeaking = false; });
cams = hooks.useCams();
assert.deepEqual(cams.map((c) => c.participant.identity), ["나", "조용한 사람", "마이크 1", "마이크 2", "말하는 사람"]);
const faces = { exports: {} };
new Function("module", "exports", ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", "lib", "faces.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(faces, faces.exports);
tracks[3].participant.isSpeaking = true;
cams = hooks.useCams();
const visible = faces.exports.pageOf(cams, 4, renderPage()[0]);
assert.deepEqual(visible.faces.slice(0, 2).map((c) => c.participant.identity), ["나", "말하는 사람"]);
assert.equal(visible.more, 2);
console.log("통과: 본인·말하는 사람·마이크 순서, 새 발언자의 얼굴 보기, 같은 발언자일 때 묶음 유지");
