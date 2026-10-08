// 실행: node tests/room-sharing.cjs (실제 방 목록과 서버는 바꾸지 않는다)
// 켜진 서버에서 "누구나" 방 운영 권한 넘겨주기까지 확인: node tests/room-sharing.cjs --live (확인용 방을 잠깐 목록에 넣었다가 원래 파일 그대로 되돌린다)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const sdk = require("livekit-server-sdk");
const live = process.argv.includes("--live");
if (live) process.loadEnvFile(path.join(__dirname, "..", ".env.local"));
const credentials = { LIVEKIT_API_KEY: live ? process.env.LIVEKIT_API_KEY : "test", LIVEKIT_API_SECRET: live ? process.env.LIVEKIT_API_SECRET : "test-secret" };
let config = "옛 방\t\n관리자 방\t암호\tstaff\n열린 방\t암호\teveryone\n잘못된 값\t\tother";
let user = { id: "member", name: "일반 회원", handle: "member" };
let people = [];
function load(file, replacements) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => replacements[name] ?? require(name), process: { cwd: process.cwd, env: credentials }, Request, Response, Headers, URL, Buffer, crypto }, { filename: file });
  return module.exports;
}
const server = load("lib/server.ts", {
  "node:fs": { readFileSync: (file) => {
    if (file.endsWith("staff.txt")) return "운영진";
    if (config === null) throw new Error("파일 없음");
    return config;
  } },
  "@/lib/dormsLogin": { DormsAuthError: class extends Error {}, getDormsUser: async () => user },
  "livekit-server-sdk": { ...sdk, RoomServiceClient: class { async listParticipants() { return people; } } },
});
const token = load("app/api/token/route.ts", {
  "@/lib/server": server,
  "@/lib/chat": { clearEmptyRoom: async () => {}, keepImage: () => {} },
  "@/lib/dolive": load("lib/dolive.ts", {}),
});
const listing = load("app/api/rooms/route.ts", { "@/lib/server": server });
async function ticket(room, password = "암호", host = "dolive.duckdns.org") {
  return token.POST(new Request(`http://${host}/api/token`, { method: "POST", headers: { host }, body: JSON.stringify({ room, password, name: "확인", avatar: "1" }) }));
}
async function claims(response) {
  assert.equal(response.status, 200);
  const body = await response.json();
  return { body, payload: JSON.parse(Buffer.from(body.token.split(".")[1], "base64url")) };
}
(async () => {
  assert.deepEqual(Array.from(server.roomList(), (r) => r.adminEveryone), [false, false, true, false]);
  config = null;
  assert.equal(server.roomList()[0].adminEveryone, false);
  config = "옛 방\t\n관리자 방\t암호\tstaff\n열린 방\t암호\teveryone";
  for (const name of ["옛 방", "관리자 방"]) {
    const { payload } = await claims(await ticket(name));
    assert.deepEqual(payload.video.canPublishSources, ["microphone"]);
    assert.equal(payload.attributes.admin, "");
  }
  // "누구나" 방도 입장권은 마이크만. 운영 권한은 들어온 뒤 서버가 가장 먼저 온 사람에게 붙인다 (아래 --live)
  const { body, payload } = await claims(await ticket("열린 방"));
  assert.equal(body.isAdmin, false);
  assert.equal(payload.attributes.roomAdmin, "");
  assert.deepEqual(payload.video.canPublishSources, ["microphone"]);
  assert.equal((await ticket("열린 방", "틀린 암호")).status, 403);
  assert.equal((await server.adminDeny(new Request("http://dolive.duckdns.org/api/kick", { headers: { host: "dolive.duckdns.org" } }))).status, 403);
  assert.equal((await ticket("없는 방")).status, 404);
  user = undefined;
  assert.equal((await ticket("열린 방")).status, 401);
  user = { id: "staff", name: "운영진" };
  assert.equal((await claims(await ticket("관리자 방", ""))).body.isAdmin, true);
  assert.equal((await claims(await ticket("관리자 방", "", "localhost"))).body.isAdmin, true);
  people = [{ attributes: { admin: "" }, tracks: [{ source: sdk.TrackSource.SCREEN_SHARE, muted: false }] }];
  assert.equal((await (await listing.GET()).json())[0].onAir, true);
  people[0].tracks[0].muted = true;
  assert.equal((await (await listing.GET()).json())[0].onAir, false);
  console.log("통과: 방별 운영 권한 설정, 옛 설정 유지, 비밀번호·로그인·방장 권한 유지, 방송 표시");
  if (live) {
    const rtc = require("@livekit/rtc-node");
    const roomName = `운영 권한 확인 ${Date.now()}`;
    const file = path.join(__dirname, "..", "..", "..", "server", "config", "rooms.txt");
    const original = fs.existsSync(file) ? fs.readFileSync(file) : null;
    const service = new sdk.RoomServiceClient("http://localhost:7880", credentials.LIVEKIT_API_KEY, credentials.LIVEKIT_API_SECRET);
    const joined = [];
    const join = async () => {
      const { body } = await claims(await ticket(roomName, ""));
      const r = new rtc.Room();
      joined.push(r);
      await r.connect("ws://localhost:7880", body.token);
      await new Promise((resolve) => setTimeout(resolve, 1100)); // 들어온 순서가 확실히 갈리게
      return r;
    };
    const hostOf = async () => (await service.listParticipants(roomName)).filter((p) => p.attributes.roomAdmin === "1").map((p) => p.identity);
    const waitHost = async (identity) => {
      for (let i = 0; i < 50; i++) { if ((await hostOf()).join() === identity) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
      throw new Error(`운영 권한이 ${identity} 에게 가지 않았어요: ${await hostOf()}`);
    };
    try {
      fs.writeFileSync(file, Buffer.concat([original ?? Buffer.from(""), Buffer.from(`
${roomName}		everyone`)]));
      config = `${roomName}		everyone`;
      user = { id: "member", name: "일반 회원" };
      const a = await join();
      const b = await join();
      const c = await join();
      await waitHost(a.localParticipant.identity); // 처음 들어온 사람
      const first = (await service.listParticipants(roomName)).find((p) => p.identity === a.localParticipant.identity);
      assert.deepEqual(first.permission.canPublishSources, [sdk.TrackSource.MICROPHONE, sdk.TrackSource.SCREEN_SHARE, sdk.TrackSource.SCREEN_SHARE_AUDIO]);
      await a.disconnect();
      await waitHost(b.localParticipant.identity); // 처음 사람이 나가면 그다음 들어온 사람
      await service.removeParticipant(roomName, b.localParticipant.identity); // 강퇴돼도 넘어간다
      await waitHost(c.localParticipant.identity);
      console.log("통과: 누구나 방에서 가장 먼저 온 사람이 운영 권한, 나가거나 강퇴되면 다음 사람에게");
    } finally {
      await Promise.all(joined.map((r) => r.disconnect().catch(() => {})));
      await service.deleteRoom(roomName).catch(() => {});
      if (original) fs.writeFileSync(file, original); else fs.unlinkSync(file);
      await rtc.dispose();
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
