// 실행: node tests/face-order.cjs (얼굴 순서. 말해도 자리가 바뀌지 않는지. 서버 없이)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const stage = ts.createSourceFile("stage.tsx", fs.readFileSync(path.join(__dirname, "..", "app", "room", "stage.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = stage.statements.filter((s) => ts.isFunctionDeclaration(s) && s.name?.text === "useCams").map((s) => s.getText(stage)).join("\n");
const js = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
let tracks = [];
const useCams = new Function("useRoomTick", "useTracks", "Track", `${js}\nreturn useCams;`)(
  () => {},
  (sources, options) => {
    assert.deepEqual(sources, ["camera"]);
    assert.deepEqual(options.updateOnlyOn, []); // 말하는 사람이 바뀌어도 다시 줄 세우지 않는다
    return tracks;
  },
  { Source: { Camera: "camera" } },
);
const cam = (identity, options = {}) => ({ participant: { identity, isLocal: false, isMicrophoneEnabled: false, isSpeaking: false, ...options }, publication: { isMuted: false } });
const mine = cam("나", { isLocal: true });
const muted = cam("캠 끔", { isSpeaking: true });
muted.publication.isMuted = true;
tracks = [cam("조용한 사람"), cam("마이크 1", { isMicrophoneEnabled: true }), cam("마이크 2", { isMicrophoneEnabled: true }), mine, muted];
const original = [...tracks];
const order = () => useCams().map((c) => c.participant.identity);
const before = order();
assert.deepEqual(before, ["나", "마이크 1", "마이크 2", "조용한 사람"]);
assert.deepEqual(tracks, original); // 받은 목록은 바꾸지 않는다
tracks[2].participant.isSpeaking = true;
assert.deepEqual(order(), before); // 뒤에 있는 사람이 말해도 자리는 그대로
tracks[1].participant.isSpeaking = true;
assert.deepEqual(order(), before); // 여러 명이 동시에 말해도 그대로
console.log("통과: 나·마이크 순서, 말해도 자리가 바뀌지 않는다");
