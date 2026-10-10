// 실행: node tests/faces.cjs (얼굴 칸 크기 계산 lib/faces.ts 확인. 서버 없이)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const src = fs.readFileSync(path.join(__dirname, "..", "lib", "faces.ts"), "utf8");
const m = { exports: {} };
new Function("module", "exports", ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(m, m.exports);
const { gridFit, rowFit, pageOf } = m.exports;

// 바둑판 (공유 없을 때, PC 왼쪽 칸 약 900x640)
assert.equal(gridFit(1, 900, 640, 8).cols, 1);
assert.deepEqual(gridFit(2, 900, 640, 8), { cols: 2, tw: 446, th: 594 }); // 둘은 나란히, 세로로 긴 칸 (위아래 여백 거의 없음)
assert.equal(gridFit(3, 900, 640, 8).cols, 2); // 2 + 1 (아래 줄 가운데)
assert.equal(gridFit(4, 900, 640, 8).cols, 2); // 2x2
assert.equal(gridFit(6, 900, 640, 8).cols, 3); // 3x2
assert.equal(gridFit(9, 900, 640, 8).cols, 3); // 3x3
for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
  const g = gridFit(n, 900, 640, 8);
  const rows = Math.ceil(n / g.cols);
  assert.ok(g.cols * g.tw + (g.cols - 1) * 8 <= 900 && rows * g.th + (rows - 1) * 8 <= 640, `${n}명 바둑판이 넘침`);
  assert.ok(g.tw / g.th <= 16 / 9 + 0.01 && g.tw / g.th >= 3 / 4 - 0.01, `${n}명 칸 비율`);
}
// 휴대폰 16:9 칸 (374x210) 에 4명 = 2x2
assert.equal(gridFit(4, 374, 210, 6).cols, 2);
assert.deepEqual(gridFit(0, 900, 640, 8), { cols: 1, tw: 0, th: 0 });

// 한 줄: 높이 128 에 2명은 16:9 로 멈춤, 5명은 줄 폭을 꽉 채움, 너무 많으면 들어가는 만큼
assert.deepEqual(rowFit(2, 900, 128, 8), { shown: 2, tw: 227 });
assert.deepEqual(rowFit(5, 900, 128, 8), { shown: 5, tw: 173 });
assert.equal(rowFit(20, 900, 128, 8).shown, 8);
assert.equal(rowFit(3, 0, 128, 8).shown, 1);

// "+N명": 7명을 4칸에 = 3명 + "+4명", 누를 때마다 다음 3명, 끝나면 처음으로
const list = [1, 2, 3, 4, 5, 6, 7];
assert.deepEqual(pageOf(list, 4, 0), { faces: [1, 2, 3], more: 4 });
assert.deepEqual(pageOf(list, 4, 1), { faces: [4, 5, 6], more: 4 });
assert.deepEqual(pageOf(list, 4, 2), { faces: [7], more: 6 });
assert.deepEqual(pageOf(list, 4, 3), { faces: [1, 2, 3], more: 4 });
assert.deepEqual(pageOf(list, 9, 0), { faces: list, more: 0 });
console.log("통과: 얼굴 바둑판·한 줄 칸 크기, +N명 넘기기");
