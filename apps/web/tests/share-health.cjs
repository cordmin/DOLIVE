// 실행: node tests/share-health.cjs (약한 컴퓨터 판단, 자동 프레임 줄이기가 오르락내리락하지 않는지, 한 줄 진단. 서버 없이)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const m = { exports: {} };
new Function("module", "exports", ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", "lib", "shareHealth.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(m, m.exports);
const { isLowSpec, startGovernor, stepGovernor, diagnose } = m.exports;

assert.equal(isLowSpec(4, 8), true);
assert.equal(isLowSpec(8, 4), true);
assert.equal(isLowSpec(8, 8), false);
assert.equal(isLowSpec(undefined, undefined), false); // 모르면 지금처럼 1080p

// 2초마다 넣어 본다
let g = startGovernor(0), t = 0;
const run = (limited, ms) => { for (const end = t + ms; t < end; ) { t += 2000; g = stepGovernor(g, limited, t); } return g.low; };
assert.equal(run(true, 8000), false, "8초 막힘은 아직 그대로");
assert.equal(run(false, 2000), false);
assert.equal(run(true, 12000), true, "10초 넘게 막히면 내린다");
assert.equal(run(false, 58000), true, "1분이 안 되면 안 올린다");
assert.equal(run(false, 4000), false, "1분 괜찮으면 올린다");
assert.equal(run(true, 12000), true);
assert.equal(run(false, 120000), true, "두 번째는 3분 기다린다");
assert.equal(run(false, 62000), false);
assert.equal(run(true, 12000), true);
assert.equal(run(false, 240000), true, "세 번째는 5분 기다린다");
assert.equal(run(false, 62000), false);
assert.equal(run(true, 12000), true);
assert.equal(run(false, 3600000), true, "세 번 되돌린 뒤엔 계속 15프레임");

assert.equal(diagnose({ sharing: true, recent: { cpu: 0.6, bandwidth: 0.1 }, serverCpu: 30, poorViewers: 0 }).head, "송출자 컴퓨터가 바빠서");
assert.equal(diagnose({ sharing: true, recent: { cpu: 0, bandwidth: 0.5 }, poorViewers: 0 }).head, "송출자 인터넷이 느려서");
assert.equal(diagnose({ sharing: true, recent: { cpu: 0.9, bandwidth: 0 }, serverCpu: 95, poorViewers: 0 }).level, "r");
assert.equal(diagnose({ sharing: false, poorViewers: 2 }).head, "보는 사람 2명의 인터넷이 느려서");
assert.equal(diagnose({ sharing: false, poorViewers: 0 }).level, "g");
console.log("통과: 약한 컴퓨터 판단, 자동 프레임 줄이기, 한 줄 진단");
