// 실행: node tests/yeonsu.cjs (도름스·파일은 가짜로 바꿔 끼운다. 실제 연수 방 기록은 바꾸지 않는다)
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const env = {};
let files = {}; // 가짜 파일 (경로 끝 이름 → 내용)
let calls = []; // 도름스에 보낸 요청
let answer; // 도름스의 답 { status, body }
const ended = [];
function load(name, replacements, extra = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", name), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: (n) => replacements[n] ?? require(n), process: { cwd: process.cwd, env, pid: 1 }, JSON, Date, AbortSignal, setTimeout, clearTimeout, ...extra };
  vm.runInNewContext(code, context, { filename: name });
  return module.exports;
}
const base = (f) => path.basename(f);
const fakeFs = {
  readFileSync: (f) => {
    if (!(base(f) in files)) throw new Error("없음");
    return files[base(f)];
  },
  writeFileSync: (f, t) => void (files[base(f)] = t),
  renameSync: (from, to) => {
    files[base(to)] = files[base(from)];
    delete files[base(from)];
  },
};
const fetch = async (url, init) => {
  calls.push({ url, ...init });
  return { ok: answer.status === 200, json: async () => answer.body };
};
const yeonsu = load(
  "lib/yeonsu.ts",
  { "node:fs": fakeFs, "@/lib/dormsLogin": { DORMS_ISSUER: "https://dorms.school" }, "@/lib/chat": { endRoom: async (n) => void ended.push(n) } },
  { fetch },
);
const plain = (v) => JSON.parse(JSON.stringify(v));

const SESSION = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const SECRET = "dorms-yeonsu-test-secret-0123456789abcdef";

(async () => {
  // 서명: 도름스 tests/yeonsuDoliveSign.test.mts 와 같은 고정값 (둘 중 하나를 바꾸면 둘 다 바꾼다)
  const body = JSON.stringify({ session: SESSION, user: USER });
  assert.equal(body, '{"session":"11111111-1111-4111-8111-111111111111","user":"22222222-2222-4222-8222-222222222222"}');
  assert.equal(yeonsu.signYeonsuRequest(SECRET, 1760000000, body), "t=1760000000,v1=78a27c05ab91c72f044c0396edccb91178cd79f5336807118c8d7fe855e4d22f");

  // 방 이름: yeonsu-<연수 id> 만 연수 방이다 (대문자 id 는 소문자로 맞춘다)
  assert.equal(yeonsu.yeonsuIdOf(`yeonsu-${SESSION}`), SESSION);
  assert.equal(yeonsu.yeonsuIdOf(`yeonsu-${SESSION.toUpperCase()}`), SESSION);
  assert.equal(yeonsu.yeonsuRoomName(SESSION.toUpperCase()), `yeonsu-${SESSION}`);
  for (const bad of ["DOLIVE", "yeonsu-", "yeonsu-123", `yeonsu-${SESSION}x`, `x-${SESSION}`, null, 1]) assert.equal(yeonsu.yeonsuIdOf(bad), null);

  // 비밀 값이 없거나 짧으면 도름스에 묻지 않고 들이지 않는다
  answer = { status: 200, body: { ok: true } };
  assert.deepEqual(plain(await yeonsu.askDorms(SESSION, USER)), { ok: false, reason: "unavailable" });
  env.DORMS_YEONSU_SECRET = "짧은값";
  assert.deepEqual(plain(await yeonsu.askDorms(SESSION, USER)), { ok: false, reason: "unavailable" });
  assert.equal(calls.length, 0);
  env.DORMS_YEONSU_SECRET = SECRET;

  // 서명한 요청을 도름스 운영 주소로 보내고, 서명은 보낸 본문과 시각으로 다시 맞춰 볼 수 있다
  const ok = { ok: true, role: "host", title: "수업 나눔", startsAt: "2026-10-14T10:00:00.000Z", endsAt: "2099-10-14T11:00:00.000Z", hostId: USER, hostName: "가나" };
  answer = { status: 200, body: ok };
  assert.deepEqual(plain(await yeonsu.askDorms(SESSION.toUpperCase(), USER)), ok);
  const sent = calls.pop();
  assert.equal(sent.url, "https://dorms.school/api/yeonsu/dolive/access");
  assert.equal(sent.body, body);
  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sent.headers["x-dolive-signature"]);
  assert.equal(v1, crypto.createHmac("sha256", SECRET).update(`${t}.${sent.body}`).digest("hex"));
  assert.ok(Math.abs(Number(t) - Date.now() / 1000) < 5);

  // 이상한 답은 '확인하지 못함': 오류 상태, 모양이 틀린 답, 모르는 역할, 방장 id 가 없음
  for (const a of [
    { status: 500, body: ok },
    { status: 200, body: null },
    { status: 200, body: { ...ok, role: "admin" } },
    { status: 200, body: { ...ok, hostId: "a" } },
  ]) {
    answer = a;
    assert.deepEqual(plain(await yeonsu.askDorms(SESSION, USER)), { ok: false, reason: "unavailable" });
  }
  // 거절 까닭은 그대로 전한다. 회원 id 가 연수 id 모양이 아니면 묻지 않는다
  answer = { status: 200, body: { ok: false, reason: "not_confirmed", title: "수업 나눔" } };
  assert.equal((await yeonsu.askDorms(SESSION, USER)).reason, "not_confirmed");
  calls = [];
  assert.equal((await yeonsu.askDorms(SESSION, "a")).reason, "unavailable");
  assert.equal(calls.length, 0);

  // 방 기록: 들여보낸 방만 남고, 끝난 방은 없는 방이다. 끝난 지 하루 지난 기록은 다음에 쓸 때 지운다
  const room = yeonsu.yeonsuRoomName(SESSION);
  assert.equal(yeonsu.yeonsuRoomDef(room), undefined);
  files = { "yeonsu-rooms.json": JSON.stringify({ "yeonsu-old": { title: "옛 연수", owner: USER, endsAt: "2026-01-01T00:00:00.000Z" } }) };
  yeonsu.registerYeonsuRoom(room, { title: ok.title, owner: ok.hostId, endsAt: ok.endsAt });
  assert.deepEqual(Object.keys(JSON.parse(files["yeonsu-rooms.json"])), [room]);
  assert.deepEqual(plain(yeonsu.yeonsuRoomDef(room)), { name: room, password: "", guest: false, owner: USER, title: "수업 나눔" });
  assert.equal(yeonsu.yeonsuRoomDef("DOLIVE"), undefined);
  files["yeonsu-rooms.json"] = JSON.stringify({ [room]: { title: ok.title, owner: USER, endsAt: "2026-01-01T00:00:00.000Z" } });
  assert.equal(yeonsu.yeonsuRoomDef(room), undefined);
  files["yeonsu-rooms.json"] = "{깨진";
  assert.equal(yeonsu.yeonsuRoomDef(room), undefined);

  // 끝나는 시간이 되면 방을 닫는다
  const soon = yeonsu.yeonsuRoomName("33333333-3333-4333-8333-333333333333");
  yeonsu.registerYeonsuRoom(soon, { title: "곧 끝남", owner: USER, endsAt: new Date(Date.now() + 30).toISOString() });
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(ended, [soon]);

  // 화면에 보이는 한국 시각
  assert.equal(yeonsu.kstTime("2026-10-14T10:05:00.000Z"), "19:05");
  assert.equal(yeonsu.kstTime(undefined), "");
  console.log("통과: 연수 방 서명·확인·기록·닫기");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
