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

  // 방 기록: 들여보낸 방만 남는다. 끝난 지 하루 지난 기록은 다음에 쓸 때 지운다
  const room = yeonsu.yeonsuRoomName(SESSION);
  assert.equal(yeonsu.yeonsuRoomDef(room), undefined);
  files = { "yeonsu-rooms.json": JSON.stringify({ "yeonsu-old": { title: "옛 연수", owner: USER, endsAt: "2026-01-01T00:00:00.000Z" } }) };
  yeonsu.registerYeonsuRoom(room, { title: ok.title, owner: ok.hostId, endsAt: ok.endsAt });
  assert.deepEqual(Object.keys(JSON.parse(files["yeonsu-rooms.json"])), [room]);
  assert.deepEqual(plain(yeonsu.yeonsuRoomDef(room)), { name: room, password: "", guest: false, owner: USER, title: "수업 나눔" });
  assert.equal(yeonsu.yeonsuRoomDef("DOLIVE"), undefined);
  // 끝 시각이 지나도 방은 그대로다: 연수가 길어져도 라이브가 끊기지 않는다 (2026-10-20 사용자 지시)
  files["yeonsu-rooms.json"] = JSON.stringify({ [room]: { title: ok.title, owner: USER, endsAt: "2026-01-01T00:00:00.000Z" } });
  assert.deepEqual(plain(yeonsu.yeonsuRoomDef(room)), { name: room, password: "", guest: false, owner: USER, title: ok.title });
  files["yeonsu-rooms.json"] = "{깨진";
  assert.equal(yeonsu.yeonsuRoomDef(room), undefined);

  // 끝나는 시각이 지나도 방을 닫지 않는다 (모두 나가면 통화 서버가 빈 방을 저절로 지운다)
  const soon = yeonsu.yeonsuRoomName("33333333-3333-4333-8333-333333333333");
  yeonsu.registerYeonsuRoom(soon, { title: "곧 끝남", owner: USER, endsAt: new Date(Date.now() + 30).toISOString() });
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(ended, []);
  assert.deepEqual(plain(yeonsu.yeonsuRoomDef(soon)), { name: soon, password: "", guest: false, owner: USER, title: "곧 끝남" });

  // 지금 열린 연수 목록(liveYeonsuRooms): 비밀 값이 없으면 묻지 않고, 받은 목록은 모양만 걸러 내고 방 기록에 미리 남긴다.
  // 끝 시각이 지난 연수도 그대로 둔다 (연수가 길어질 수 있다. 방송 목록에 보일지는 app/api/rooms 가 '사람이 남아 있나'로 가린다)
  const LIVE = "44444444-4444-4444-8444-444444444444";
  const PAST = "66666666-6666-4666-8666-666666666666";
  const liveRoom = { id: LIVE, title: "노트북 LM 연수", startsAt: "2026-10-20T11:50:00.000Z", endsAt: "2099-10-20T13:00:00.000Z", hostId: USER, hostName: "고타열", access: "teacher" };
  const past = { id: PAST, title: "어제 연수", startsAt: "2026-10-19T11:50:00.000Z", endsAt: "2026-10-19T13:00:00.000Z", hostId: USER, hostName: "고타열", access: "teacher" };
  env.DORMS_YEONSU_SECRET = "짧은값";
  calls = [];
  assert.deepEqual(plain(await yeonsu.liveYeonsuRooms()), []);
  assert.equal(calls.length, 0);
  env.DORMS_YEONSU_SECRET = SECRET;
  files = { "yeonsu-rooms.json": "{}" };
  answer = { status: 200, body: { ok: true, rooms: [
    liveRoom,
    { ...liveRoom, id: "a" },                                       // 연수 id 모양이 아님
    { ...liveRoom, id: "55555555-5555-4555-8555-555555555555", title: "" }, // 제목 없음
    past, // 끝 시각이 지난 연수도 그대로 (이어 하는 중일 수 있다)
  ] } };
  assert.deepEqual(plain(await yeonsu.liveYeonsuRooms()), [liveRoom, past]);
  const asked = calls.pop();
  assert.equal(asked.url, "https://dorms.school/api/yeonsu/dolive/rooms");
  assert.equal(asked.body, "{}");
  const [, lt, lv1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(asked.headers["x-dolive-signature"]);
  assert.equal(lv1, crypto.createHmac("sha256", SECRET).update(`${lt}.{}`).digest("hex"));
  // 아직 아무도 안 들어온 연수 방도 채팅·방장 확인이 알아보게 미리 남는다
  assert.deepEqual(plain(yeonsu.yeonsuRoomDef(yeonsu.yeonsuRoomName(LIVE))), { name: yeonsu.yeonsuRoomName(LIVE), password: "", guest: false, owner: USER, title: liveRoom.title });
  // 입장 화면이 10초마다 물어도 도름스에는 8초에 한 번만 묻는다 (그사이 답이 이상해져도 방이 목록에서 사라지지 않는다)
  calls = [];
  answer = { status: 500, body: null };
  assert.deepEqual(plain(await yeonsu.liveYeonsuRooms()), [liveRoom, past]);
  assert.equal(calls.length, 0);

  // 주소에 쓰는 짧은 연수 번호(연수 id 앞 8자). 도름스도 같은 규칙으로 링크를 만든다
  assert.equal(yeonsu.yeonsuSlug(LIVE.toUpperCase()), "44444444");
  assert.equal(yeonsu.yeonsuRefKind(SESSION), "id");
  assert.equal(yeonsu.yeonsuRefKind("44444444"), "slug");
  for (const bad of ["4444444", "444444444", "zzzzzzzz", ""]) assert.equal(yeonsu.yeonsuRefKind(bad), null);
  assert.equal(yeonsu.isYeonsuSlug("44444444"), true);
  assert.equal(yeonsu.isYeonsuSlug("4444444g"), false);

  // 짧은 번호로도 도름스에 묻는다. 들여보낼 때 도름스가 알려 준 연수 id 로 방 이름을 짓는다
  calls = [];
  const okShort = { ...ok, id: LIVE, role: "guest" };
  answer = { status: 200, body: okShort };
  assert.deepEqual(plain(await yeonsu.askDorms("44444444", USER)), okShort);
  assert.equal(JSON.parse(calls.pop().body).session, "44444444");
  assert.equal(await yeonsu.yeonsuIdOfRef("44444444", okShort), LIVE);
  // 연수 id 모양이 아닌 id 를 알려 주면 들이지 않는다
  answer = { status: 200, body: { ...ok, id: "a" } };
  assert.equal((await yeonsu.askDorms("44444444", USER)).reason, "unavailable");
  // 주소 모양이 아니면 묻지 않는다
  calls = [];
  assert.equal((await yeonsu.askDorms("4444", USER)).reason, "unavailable");
  assert.equal(calls.length, 0);
  // 도름스가 id 를 알려 주지 않아도, 옛 주소(연수 id)나 지금 열린 목록에서 찾는다
  assert.equal(await yeonsu.yeonsuIdOfRef(SESSION.toUpperCase(), ok), SESSION);
  assert.equal(await yeonsu.yeonsuIdOfRef("44444444", ok), LIVE);
  assert.equal(await yeonsu.yeonsuIdOfRef("99999999", ok), null);
  assert.equal(await yeonsu.yeonsuIdOfRef("44444444", { ok: false, reason: "ended" }), null);

  // 신청하지 않은 선생님도 지금 열린 연수면 들어온다 (askYeonsuEntry, 2026-10-20 사용자 지시)
  answer = { status: 200, body: { ok: false, reason: "not_applied", title: liveRoom.title } };
  assert.deepEqual(plain(await yeonsu.askYeonsuEntry("44444444", USER)), {
    ok: true, role: "guest", id: LIVE, title: liveRoom.title, startsAt: liveRoom.startsAt, endsAt: liveRoom.endsAt, hostId: USER, hostName: liveRoom.hostName,
  });
  assert.equal((await yeonsu.askYeonsuEntry(LIVE, USER)).role, "guest");
  // 확정 안 됨도 같다. 지금 열린 목록에 없는 연수는 그대로 막는다
  answer = { status: 200, body: { ok: false, reason: "not_confirmed" } };
  assert.equal((await yeonsu.askYeonsuEntry(LIVE, USER)).ok, true);
  assert.equal((await yeonsu.askYeonsuEntry(SESSION, USER)).reason, "not_confirmed");
  // 신청과 상관없는 까닭은 그대로 막는다
  for (const reason of ["not_found", "blocked", "too_early", "ended", "unavailable"]) {
    answer = { status: 200, body: { ok: false, reason } };
    assert.equal((await yeonsu.askYeonsuEntry(LIVE, USER)).reason, reason);
  }
  // 도름스가 들여보내면 그 답을 그대로 쓴다 (여는 선생님은 방장 그대로)
  answer = { status: 200, body: ok };
  assert.deepEqual(plain(await yeonsu.askYeonsuEntry(SESSION, USER)), ok);

  // 화면에 보이는 한국 시각
  assert.equal(yeonsu.kstTime("2026-10-14T10:05:00.000Z"), "19:05");
  assert.equal(yeonsu.kstTime(undefined), "");
  console.log("통과: 연수 방 서명·확인·기록·끝 시각 뒤에도 유지·열린 목록·짧은 주소·신청 없이 들어가기");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
