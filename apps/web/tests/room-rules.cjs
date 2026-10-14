// 실행: node tests/room-rules.cjs (실제 방 목록·서버는 바꾸지 않는다. 도름스·통화 서버는 가짜로 바꿔 끼운다)
// 켜진 서버에서 비회원 입장까지 확인: node tests/room-rules.cjs --live (바깥 주소로 들어오는 비회원 + 이 PC 마스터. 확인용 방만 만들고 지운다)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const sdk = require("livekit-server-sdk");
const env = { LIVEKIT_API_KEY: "test", LIVEKIT_API_SECRET: "test-secret-test-secret-test-secret" };

let file = "비회원 방\t\tguest\n옛 방\t암호\tstaff"; // 마지막 줄 = 예전 형식(운영 권한 칸)도 회원만으로 읽힌다
let written = null;
let user; // 지금 로그인한 도름스 회원 (없으면 비회원)
let guestToken;
const people = new Map(); // 방 이름 → 통화 서버에 있는 사람들
const updated = [];
const ended = [];
const lk = class {
  async listParticipants(room) {
    return people.get(room) ?? [];
  }
  async getParticipant(room, id) {
    const p = (people.get(room) ?? []).find((x) => x.identity === id);
    if (!p) throw new Error("없음");
    return p;
  }
  async updateParticipant(room, id, opts) {
    updated.push({ room, id, ...opts });
  }
};
function load(name, replacements) {
  const source = fs.readFileSync(path.join(__dirname, "..", name), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: (n) => replacements[n] ?? require(n), process: { cwd: process.cwd, env }, Request, Response, Headers, URL, Buffer, crypto, TextEncoder, setTimeout };
  vm.runInNewContext(code, context, { filename: name });
  return module.exports;
}
class DormsAuthError extends Error {}
const fakeFs = {
  readFileSync: (f) => {
    if (f.endsWith("staff.txt")) return "운영진";
    if (file === null) throw new Error("없음");
    return file;
  },
  writeFileSync: (f, t) => {
    written = t;
    file = t;
  },
};
const server = load("lib/server.ts", {
  "node:fs": fakeFs,
  "next/headers": { cookies: async () => ({ get: () => guestToken ? { value: guestToken } : undefined }) },
  "@/lib/dormsLogin": { DormsAuthError, getDormsUser: async () => user },
  "livekit-server-sdk": { ...sdk, RoomServiceClient: lk },
});
let sender = {};
const chat = { clearEmptyRoom: async () => false, keepImage: () => {}, endRoom: async (n) => void ended.push(n), whoSent: async () => sender };
const dolive = load("lib/dolive.ts", {});
const chatAuth = load("lib/chat.ts", { "@/lib/server": server, "@/lib/dolive": dolive, "./donationTargets": { clearDonationTargets: () => {} } });
const token = load("app/api/token/route.ts", { "@/lib/server": server, "@/lib/chat": chat, "@/lib/dolive": dolive });
const roomsApi = load("app/api/rooms/route.ts", { "@/lib/server": server, "@/lib/chat": chat, "@/lib/dolive": dolive });
const ownerApi = load("app/api/owner/route.ts", { "@/lib/server": server, "@/lib/chat": chat });

const OUT = "dolive.site";
const req = (url, method, body, host = OUT) =>
  new Request(`http://${host}${encodeURI(url)}`, { method, headers: { host }, body: body === undefined ? undefined : JSON.stringify(body) });
const ticket = (room, password = "", host) => token.POST(req("/api/token", "POST", { room, password, name: "확인", avatar: "1" }, host));
async function claims(res) {
  assert.equal(res.status, 200);
  const body = await res.json();
  return { body, res, c: JSON.parse(Buffer.from(body.token.split(".")[1], "base64url")) };
}
const plain = (x) => JSON.parse(JSON.stringify(x)); // 가짜 상자(vm) 안에서 만든 배열은 바로 비교가 안 돼서
const list = async () => (await roomsApi.GET(req("/api/rooms", "GET"))).json();
const find = async (name) => (await list()).find((r) => r.name === name);
const A = { id: "a", name: "가나" };
const B = { id: "b", name: "다라" };

(async () => {
  // 방 목록: 파일의 고정 방, 파일이 없으면 DOLIVE 하나
  assert.deepEqual(plain(server.roomList().map((r) => [r.name, r.guest])), [["비회원 방", true], ["옛 방", false]]);
  const keep = file;
  file = null;
  assert.deepEqual(plain(server.roomList().map((r) => r.name)), ["DOLIVE"]);
  file = keep;

  // 비회원: "비회원도" 방만, 입장권 쿠키를 받는다. 방은 못 만든다
  user = undefined;
  assert.equal((await ticket("옛 방")).status, 401);
  const g = await claims(await ticket("비회원 방"));
  assert.equal(g.c.attributes.dorms, "");
  assert.match(g.res.headers.get("set-cookie"), /^dolive_guest=/);
  // 공통 입장권 확인: 서명이 틀리거나 입장권이 없으면 거절. 옛 입장권도 퇴장 뒤에는 쓸 수 없다.
  assert.equal(await server.verifyRoomToken(), null);
  assert.equal(await server.verifyRoomToken("가짜 입장권"), null);
  assert.equal((await server.verifyRoomToken(g.body.token)).sub, g.c.sub);
  const parts = g.body.token.split(".");
  parts[2] = (parts[2][0] === "a" ? "b" : "a") + parts[2].slice(1);
  assert.equal(await server.verifyRoomToken(parts.join(".")), null);
  const guestRequest = req("/api/chat", "GET");
  guestRequest.headers.set("authorization", `Bearer ${g.body.token}`);
  assert.equal((await chatAuth.whoSent(guestRequest)).deny.status, 403);
  people.set("비회원 방", [{ identity: g.c.sub }]);
  assert.equal((await chatAuth.whoSent(guestRequest)).room, "비회원 방");
  guestToken = g.body.token;
  assert.equal((await server.accessCheck(guestRequest)).deny, undefined);
  people.delete("비회원 방");
  assert.equal((await chatAuth.whoSent(guestRequest)).deny.status, 403);
  assert.equal((await server.accessCheck(guestRequest)).deny.status, 401);
  guestToken = undefined;
  // 전체 권한을 갱신해도 마이크·카메라·채팅 허용은 그대로다.
  assert.deepEqual(plain(server.publishPermission(false)), { canSubscribe: true, canPublish: true, canPublishData: true, canPublishSources: [sdk.TrackSource.MICROPHONE, sdk.TrackSource.CAMERA] });
  assert.deepEqual(plain(server.publishPermission(true).canPublishSources), [sdk.TrackSource.MICROPHONE, sdk.TrackSource.CAMERA, sdk.TrackSource.SCREEN_SHARE, sdk.TrackSource.SCREEN_SHARE_AUDIO]);
  assert.equal((await roomsApi.PUT(req("/api/rooms", "PUT", { name: "비회원이 만든 방" }))).status, 401);

  // 일반 회원: 마이크만, 방장 아님. 비밀번호 방은 비밀번호가 맞아야
  user = A;
  let t = await claims(await ticket("옛 방", "암호"));
  assert.deepEqual(t.c.video.canPublishSources, ["microphone", "camera"]);
  assert.equal(t.c.attributes.roomAdmin, "");
  assert.equal(t.res.headers.get("set-cookie"), null);
  assert.equal((await ticket("옛 방", "틀림")).status, 403);

  // 회원이 방 만들기: 한 사람에 하나, 이름은 겹치지 않게. 만든 사람은 방장(+화면공유, 비밀번호 안 물음), 다른 사람은 비밀번호를 물음
  assert.equal((await roomsApi.PUT(req("/api/rooms", "PUT", { name: "가나의 방", password: "1234", guest: false }))).status, 201);
  const second = await roomsApi.PUT(req("/api/rooms", "PUT", { name: "가나의 둘째 방" }));
  assert.equal((await second.json()).reason, "limit");
  user = B;
  assert.equal((await (await roomsApi.PUT(req("/api/rooms", "PUT", { name: "옛 방" }))).json()).reason, "taken");
  assert.match(written, /가나의 방\t1234\tmembers\ta\r\n$/); // 회원 방도 파일에 남는다 (지우기 전까지, 서버를 껐다 켜도)
  user = A;
  t = await claims(await ticket("가나의 방"));
  assert.equal(t.c.attributes.roomAdmin, "1");
  assert.equal(t.c.attributes.owner, "1");
  assert.deepEqual(t.c.video.canPublishSources, ["microphone", "camera", "screen_share", "screen_share_audio"]);
  user = B;
  assert.equal((await ticket("가나의 방")).status, 403);
  assert.equal((await claims(await ticket("가나의 방", "1234"))).c.attributes.roomAdmin, "");

  // 목록: 고칠 수 있는 방(내 방, 관리자·마스터는 모든 방)만 canEdit 과 비밀번호. 다른 회원이 고치거나 지우면 막힌다
  let mine = await find("가나의 방");
  assert.equal(mine.canEdit, false);
  assert.equal(mine.password, undefined);
  assert.equal(mine.locked, true);
  assert.equal((await roomsApi.PATCH(req("/api/rooms?room=가나의 방", "PATCH", { name: "뺏은 방" }))).status, 403);
  assert.equal((await roomsApi.DELETE(req("/api/rooms?room=가나의 방", "DELETE"))).status, 403);
  user = { id: "s", name: "운영진" }; // 관리자는 남의 방·고정 방도 고칠 수 있고, 방 안에서는 방장 노릇
  assert.equal((await find("가나의 방")).canEdit, true);
  assert.equal((await find("옛 방")).canEdit, true);
  assert.equal((await claims(await ticket("가나의 방"))).c.attributes.roomAdmin, "1");
  user = A;
  mine = await find("가나의 방");
  assert.equal(mine.canEdit, true);
  assert.equal(mine.password, "1234");

  // ON AIR: 방장(roomAdmin)이 있거나 화면공유 중일 때만
  people.set("가나의 방", [{ identity: "b#1", attributes: { roomAdmin: "", dorms: "b" }, tracks: [] }]);
  assert.equal((await find("가나의 방")).onAir, false);
  people.get("가나의 방")[0].tracks.push({ source: sdk.TrackSource.SCREEN_SHARE, muted: false });
  assert.equal((await find("가나의 방")).onAir, true);
  people.get("가나의 방")[0].tracks.length = 0;
  people.get("가나의 방").push({ identity: "a#1", attributes: { roomAdmin: "1", owner: "1", dorms: "a" }, tracks: [] });
  assert.equal((await find("가나의 방")).onAir, true);

  // 방장 넘기기: 주인만, 도름스 회원에게만. 넘기면 옛 주인은 마이크만, 새 주인은 방장
  people.get("가나의 방").push({ identity: "손님#1", attributes: { dorms: "" }, tracks: [] });
  sender = { room: "가나의 방", user: B };
  assert.equal((await ownerApi.POST(req("/api/owner", "POST", { room: "가나의 방", identity: "a#1" }))).status, 403);
  sender = { room: "가나의 방", user: A };
  assert.equal((await ownerApi.POST(req("/api/owner", "POST", { room: "가나의 방", identity: "손님#1" }))).status, 400);
  assert.equal((await ownerApi.POST(req("/api/owner", "POST", { room: "가나의 방", identity: "b#1" }))).status, 204);
  assert.equal(server.findRoom("가나의 방").owner, "b");
  const changed = updated.map((u) => [u.id, u.attributes.roomAdmin, u.attributes.owner, u.permission.canPublishSources.length]).sort();
  assert.deepEqual(changed, [["a#1", "", "", 2], ["b#1", "1", "1", 4]]);

  // 고치기·지우기: 새 주인(B)이 할 수 있다. 이름을 바꾸면 옛 방은 닫는다. 방은 지워야 없어진다
  user = B;
  assert.equal((await roomsApi.PATCH(req("/api/rooms?room=가나의 방", "PATCH", { name: "다라의 방", password: "", guest: true }))).status, 204);
  assert.deepEqual(ended, ["가나의 방"]);
  assert.equal(server.findRoom("다라의 방").guest, true);
  assert.equal((await roomsApi.DELETE(req("/api/rooms?room=다라의 방", "DELETE"))).status, 204);
  assert.equal(server.findRoom("다라의 방"), undefined);
  assert.equal((await roomsApi.PUT(req("/api/rooms", "PUT", { name: "다라의 새 방" }))).status, 201); // 지웠으니 다시 만들 수 있다

  // 마스터(이 PC): 고정 방을 만들고 모든 방을 고친다. 방송은 마스터 것까지 모두 합쳐 4개까지
  user = { id: "s", name: "운영진" };
  assert.equal((await roomsApi.DELETE(req("/api/rooms?room=다라의 새 방", "DELETE"))).status, 204); // 관리자는 남의 방도 지운다
  user = B;
  assert.equal((await roomsApi.PUT(req("/api/rooms", "PUT", { name: "다라의 새 방 2" }))).status, 201);
  user = undefined;
  assert.equal((await roomsApi.PUT(req("/api/rooms", "PUT", { name: "새 고정 방", guest: true }, "localhost"))).status, 201);
  const fifth = await roomsApi.PUT(req("/api/rooms", "PUT", { name: "새 고정 방 2" }, "localhost"));
  assert.equal(fifth.status, 409);
  assert.equal((await fifth.json()).reason, "full");
  assert.match(written, /새 고정 방\t\tguest\t\r\n$/);
  assert.equal((await find("다라의 새 방 2")).canEdit, false); // 바깥에서 보면 남의 방
  assert.equal((await roomsApi.DELETE(req("/api/rooms?room=다라의 새 방 2", "DELETE", undefined, "localhost"))).status, 204);
  assert.equal(server.findRoom("다라의 새 방 2"), undefined);
  assert.equal((await roomsApi.PATCH(req("/api/rooms?room=옛 방", "PATCH", { name: "옛 방", password: "새암호", guest: false }, "localhost"))).status, 204);
  assert.match(written, /옛 방\t새암호\tmembers/);
  console.log("통과: 비회원 입장, 방 만들기·고치기·지우기 권한(만든 사람·관리자·마스터), 만든 사람 방장, 방장 넘기기, ON AIR, 방 목록 파일 저장, 최대 4개");

  if (process.argv.includes("--live")) await live();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// 실제 서버: 이 PC(마스터)가 확인용 비회원 방을 만들고, 바깥 주소(비회원으로 보인다)로 입장권을 받아 본다. 끝나면 지운다
async function live() {
  const name = `비회원 확인 ${Date.now()}`;
  const local = (url, method, body) => fetch(`http://localhost:3000${url}`, { method, headers: { Host: "localhost" }, body: body && JSON.stringify(body) });
  const outside = (room) =>
    fetch(`${process.env.DORMS_SITE_URL || "https://dolive.site"}/api/token`, { method: "POST", body: JSON.stringify({ room, password: "", name: "비회원", avatar: "1" }) });
  try {
    assert.equal((await local("/api/rooms", "PUT", { name, password: "", guest: true })).status, 201);
    const ok = await outside(name);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("set-cookie") ?? "", /dolive_guest=/);
    const members = (await (await local("/api/rooms", "GET")).json()).find((r) => !r.guest);
    assert.equal((await outside(members.name)).status, 401);
    console.log("통과: 실제 서버에서 비회원은 비회원 방만 들어간다");
  } finally {
    await local(`/api/rooms?room=${encodeURIComponent(name)}`, "DELETE");
  }
}
