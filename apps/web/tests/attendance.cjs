// 실행: node tests/attendance.cjs (파일·통화 서버는 가짜로 바꿔 끼운다. 실제 참석 기록은 바꾸지 않는다)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(name, replacements, extra = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", name), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: (n) => (n in replacements ? replacements[n] : require(n)), process: { cwd: process.cwd, env: {}, pid: 1 }, JSON, Date, console, ...extra };
  vm.runInNewContext(code, context, { filename: name });
  return module.exports;
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const C = load("lib/attendanceCore.ts", {});
const MIN = 60_000;
const T0 = Date.parse("2026-11-12T10:00:00Z"); // 한국 19:00

const HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STAFF = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SESSION = "11111111-1111-4111-8111-111111111111";
const ROOM = `yeonsu-${SESSION}`;
const seen = (sid, dorms, name, joinedAt) => ({ sid, identity: `${name}#${sid}`, name, dorms, joinedAt });

// ── 계산 ──
{
  const a = C.emptyAttendance(ROOM, { title: "수업 나눔", host: HOST, endsAt: "2026-11-12T12:00:00Z" });
  C.notePresent(a, seen("PA_h", HOST, "여는쌤", T0), T0);
  C.notePresent(a, seen("PA_a1", A, "가나", T0 + 5 * MIN), T0 + 5 * MIN);
  // 같은 입장 알림이 두 번 와도 한 번이다
  C.notePresent(a, seen("PA_a1", A, "가나", T0 + 5 * MIN), T0 + 6 * MIN);
  C.noteLeft(a, seen("PA_a1", A, "가나"), T0 + 35 * MIN);
  C.noteLeft(a, seen("PA_a1", A, "가나"), T0 + 50 * MIN); // 두 번째 퇴장 알림은 무시
  // 다시 들어와서, 탭을 하나 더 열었다 (겹친 시간은 한 번만)
  C.notePresent(a, seen("PA_a2", A, "가나", T0 + 40 * MIN), T0 + 40 * MIN);
  C.notePresent(a, seen("PA_a3", A, "가나", T0 + 45 * MIN), T0 + 45 * MIN);
  C.noteLeft(a, seen("PA_a3", A, "가나"), T0 + 55 * MIN);
  C.noteLeft(a, seen("PA_a2", A, "가나"), T0 + 60 * MIN);
  // 입장 알림을 놓친 사람: 퇴장 알림의 들어온 시각으로 만든다
  C.noteLeft(a, seen("PA_b1", B, "다라", T0 + 10 * MIN), T0 + 20 * MIN);
  // 연결이 처음부터 안 된 사람은 적지 않는다
  C.noteLeft(a, seen("PA_x", STAFF, "운영", T0), T0 + MIN, false);

  const s = C.summarize(a, T0 + 61 * MIN);
  assert.equal(s.count, 2, "여는 선생님은 인원에서 뺀다");
  assert.equal(s.here, 0);
  assert.deepEqual(plain(s.rows.map((r) => r.name)), ["여는쌤", "가나", "다라"], "여는 선생님이 맨 위, 나머지는 들어온 순서");
  const ga = s.rows[1];
  assert.equal(ga.ms, 50 * MIN, "5~35분 30분 + 40~60분 20분 (겹친 탭은 한 번)");
  assert.equal(ga.visits, 3);
  assert.equal(C.kstClock(ga.first), "19:05");
  assert.equal(C.kstClock(ga.last), "20:00");
  assert.equal(s.rows[2].ms, 10 * MIN);
  assert.ok(s.rows[0].host && s.rows[0].here === false);

  // 1분 점검: 방에 실제로 없는데 열린 기록(여는 선생님)은 마지막으로 확인한 때 닫는다
  C.reconcile(a, [], T0 + 62 * MIN);
  assert.equal(C.hasOpenVisit(a), false);
  assert.equal(C.summarize(a, T0 + 62 * MIN).rows[0].ms, 0);
}
{
  // 열린 기록은 최근에 확인했으면 지금까지, 확인이 끊겼으면 마지막 확인까지만 센다
  const a = C.emptyAttendance(ROOM, { title: "t", host: HOST, endsAt: "" });
  C.notePresent(a, seen("PA_a", A, "가나", T0), T0);
  C.reconcile(a, [seen("PA_a", A, "가나", T0)], T0 + 10 * MIN);
  assert.equal(C.summarize(a, T0 + 11 * MIN).rows[0].ms, 11 * MIN);
  assert.equal(C.summarize(a, T0 + 11 * MIN).here, 1);
  assert.equal(C.summarize(a, T0 + 60 * MIN).rows[0].ms, 10 * MIN);
  assert.equal(C.summarize(a, T0 + 60 * MIN).here, 0);
  // 잘못 닫혔어도 방에 다시 보이면 이어서 센다
  C.reconcile(a, [], T0 + 11 * MIN);
  C.reconcile(a, [seen("PA_a", A, "가나", T0)], T0 + 12 * MIN);
  assert.equal(C.summarize(a, T0 + 12 * MIN).rows[0].ms, 12 * MIN);
}
// 겹친 구간 합치기와 머문 시간 글자
assert.equal(C.unionMs([[0, 10], [5, 20], [30, 40], [40, 45], [50, 50]]), 35);
assert.equal(C.duration(30_000), "1분 안 됨");
assert.equal(C.duration(59 * MIN), "59분");
assert.equal(C.duration(125 * MIN), "2시간 5분");
// 내려받는 표: BOM, 따옴표, 엑셀 수식처럼 보이는 이름 막기
{
  const a = C.emptyAttendance(ROOM, { title: "t", host: HOST, endsAt: "" });
  C.noteLeft(a, seen("PA_1", A, '=HYPERLINK("x")', T0), T0 + 30 * MIN);
  C.noteLeft(a, seen("PA_2", B, "가,나", T0), T0 + 90 * MIN);
  const csv = C.toCsv(C.summarize(a, T0 + 100 * MIN));
  assert.ok(csv.startsWith("﻿입장 이름,"));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('"가,나"'));
  assert.ok(csv.includes("2026-11-12 19:00,2026-11-12 20:30,90,1,"));
}

// ── 저장과 권한 ──
let files = {};
let roomInfo = { [ROOM]: { title: "수업 나눔", owner: HOST, endsAt: "2026-11-12T12:00:00Z" } };
let live = []; // 통화 서버에 지금 있는 방 [{ name, people }]
let roomsDown = false;
const base = (f) => path.basename(f);
const fakeFs = {
  readFileSync: (f) => { if (!(base(f) in files)) throw new Error("없음"); return files[base(f)]; },
  writeFileSync: (f, t) => void (files[base(f)] = t),
  renameSync: (from, to) => { files[base(to)] = files[base(from)]; delete files[base(from)]; },
  mkdirSync: () => {},
  readdirSync: () => Object.keys(files),
  unlinkSync: (f) => void delete files[base(f)],
};
const fakeRooms = {
  listRooms: async () => { if (roomsDown) throw new Error("down"); return live.map((r) => ({ name: r.name })); },
  listParticipants: async (n) => live.find((r) => r.name === n)?.people ?? [],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fakeYeonsu = {
  isYeonsuId: (s) => typeof s === "string" && UUID.test(s),
  isYeonsuSlug: (s) => typeof s === "string" && /^[0-9a-f]{8}$/i.test(s),
  yeonsuIdOf: (r) => (typeof r === "string" && r.startsWith("yeonsu-") && UUID.test(r.slice(7)) ? r.slice(7).toLowerCase() : null),
  yeonsuRoomName: (id) => `yeonsu-${id.toLowerCase()}`,
  yeonsuRoomInfo: (r) => roomInfo[r],
};
const M = load("lib/attendance.ts", {
  "server-only": {},
  "node:fs": fakeFs,
  "livekit-server-sdk": { ParticipantInfo_State: { ACTIVE: 2 } },
  "@/lib/dolive": { VOICE_BOT: "읽어주기" },
  "@/lib/server": { rooms: fakeRooms },
  "@/lib/yeonsu": fakeYeonsu,
  "@/lib/attendanceCore": C,
}, { setInterval, clearInterval });
const P = (sid, identity, name, dorms, ms) => ({ sid, identity, name, attributes: { dorms }, joinedAtMs: BigInt(ms), joinedAt: BigInt(Math.floor(ms / 1000)), state: 2 });

(async () => {
  const now = Date.now();
  // 도름스 이름은 입장권을 줄 때 기억했다가 입장 알림 때 적는다. 읽어 주는 참여자와 연수 방이 아닌 방은 적지 않는다
  M.noteYeonsuEntrant(ROOM, "쌤#1", "김여는", "2026-11-12T10:00:00Z");
  M.noteYeonsuEntrant(ROOM, "가나#2", "이가나", "");
  M.attendJoined(ROOM, P("PA_h", "쌤#1", "쌤", HOST, now - 30 * MIN));
  M.attendJoined(ROOM, P("PA_a", "가나#2", "가나", A, now - 20 * MIN));
  M.attendJoined(ROOM, P("PA_bot", "읽어주기", "읽어주기", "", now));
  M.attendJoined("DOLIVE", P("PA_z", "z#1", "z", B, now));
  const saved = JSON.parse(files[`${SESSION}.json`]);
  assert.equal(saved.host, HOST);
  assert.equal(saved.startsAt, "2026-11-12T10:00:00Z");
  assert.deepEqual(plain(Object.keys(saved.people).sort()), [A, HOST].sort());
  assert.equal(saved.people[A].dormsName, "이가나");
  assert.equal(Object.keys(files).length, 1);

  // 여는 선생님만 본다. 다른 참석자·운영진·모르는 연수는 null (어느 쪽인지 알려 주지 않는다). 짧은 번호로도 찾는다
  const mine = M.attendanceFor(SESSION, HOST);
  assert.equal(mine.count, 1);
  assert.equal(mine.here, 1);
  assert.equal(plain(M.attendanceFor(SESSION.slice(0, 8), HOST.toUpperCase())).count, 1);
  assert.equal(M.attendanceFor(SESSION, A), null);
  assert.equal(M.attendanceFor(SESSION, STAFF), null);
  assert.equal(M.attendanceFor("22222222-2222-4222-8222-222222222222", HOST), null);
  assert.equal(M.attendanceFor("../etc", HOST), null);

  // 퇴장 알림을 놓쳐도 1분 점검이 닫는다. 통화 서버에 묻지 못하면 아무것도 닫지 않는다
  live = [{ name: ROOM, people: [P("PA_h", "쌤#1", "쌤", HOST, now - 30 * MIN), { ...P("PA_j", "늦게#3", "늦게", B, now), state: 0 }] }];
  roomsDown = true;
  await M.tickAttendance();
  assert.equal(M.attendanceFor(SESSION, HOST).here, 1);
  roomsDown = false;
  await M.tickAttendance();
  const after = M.attendanceFor(SESSION, HOST);
  assert.equal(after.here, 0, "가나는 방에 없어서 닫혔다");
  assert.equal(after.count, 1, "아직 연결 중(JOINING)인 사람은 세지 않는다");
  assert.ok(after.rows[0].here, "여는 선생님은 아직 방에 있다");

  // 정상 퇴장 알림
  M.attendLeft(ROOM, P("PA_h", "쌤#1", "쌤", HOST, now - 30 * MIN), Date.now(), false);
  live = [];
  await M.tickAttendance();
  assert.equal(M.attendanceFor(SESSION, HOST).rows[0].here, false);

  // 서버를 다시 켜도(메모리 없이) 파일에서 읽는다. 방 기록이 지워진 뒤에도 30일 동안 연 선생님은 본다
  roomInfo = {};
  assert.equal(M.attendanceFor(SESSION.slice(0, 8), HOST).count, 1);
  console.log("attendance ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
