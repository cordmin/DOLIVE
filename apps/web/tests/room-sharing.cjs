// 실행: node tests/room-sharing.cjs (실제 방 목록과 서버는 바꾸지 않는다)
// 켜진 통화 서버에 화면 보내기까지 확인: node tests/room-sharing.cjs --live
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
  assert.deepEqual(Array.from(server.roomList(), (r) => r.shareEveryone), [false, false, true, false]);
  config = null;
  assert.equal(server.roomList()[0].shareEveryone, false);
  config = "옛 방\t\n관리자 방\t암호\tstaff\n열린 방\t암호\teveryone";
  for (const name of ["옛 방", "관리자 방"]) {
    const { payload } = await claims(await ticket(name));
    assert.deepEqual(payload.video.canPublishSources, ["microphone"]);
    assert.equal(payload.attributes.admin, "");
  }
  const { body, payload } = await claims(await ticket("열린 방"));
  assert.equal(body.isAdmin, false);
  assert.equal(payload.attributes.admin, "");
  assert.equal(payload.attributes.shareEveryone, "1");
  assert.deepEqual(payload.video.canPublishSources, ["microphone", "screen_share", "screen_share_audio"]);
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
  console.log("통과: 방별 화면공유 권한, 옛 설정 유지, 비밀번호·로그인·방장 권한 유지, 방송 표시");
  if (live) {
    const rtc = require("@livekit/rtc-node");
    const roomName = `화면공유 확인 ${Date.now()}`;
    const connection = new rtc.Room();
    const service = new sdk.RoomServiceClient("http://localhost:7880", credentials.LIVEKIT_API_KEY, credentials.LIVEKIT_API_SECRET);
    const source = new rtc.VideoSource(32, 32);
    let track;
    try {
      config = `${roomName}\t\teveryone`;
      user = { id: "member", name: "일반 회원" };
      const { body: normal } = await claims(await ticket(roomName, ""));
      assert.equal(normal.isAdmin, false);
      await connection.connect("ws://localhost:7880", normal.token);
      const options = new rtc.TrackPublishOptions({ source: rtc.TrackSource.SOURCE_SCREENSHARE });
      for (let i = 0; i < 2; i++) {
        track = rtc.LocalVideoTrack.createVideoTrack("확인 화면", source);
        const publication = await connection.localParticipant.publishTrack(track, options);
        source.captureFrame(new rtc.VideoFrame(new Uint8Array(32 * 32 * 4), 32, 32, rtc.VideoBufferType.RGBA));
        let participant;
        for (let attempt = 0; attempt < 30; attempt++) {
          participant = (await service.listParticipants(roomName))[0];
          if (participant.tracks.some((t) => t.sid === publication.sid)) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.equal(participant.attributes.admin, "");
        assert.ok(participant.tracks.some((t) => t.sid === publication.sid && t.source === sdk.TrackSource.SCREEN_SHARE));
        await connection.localParticipant.unpublishTrack(publication.sid);
        await track.close(false); track = undefined;
      }
      console.log("통과: 일반 회원 입장권으로 실제 통화 서버에 화면공유 시작·종료·다시 시작");
    } finally {
      await connection.disconnect();
      await track?.close(false);
      await source.close();
      await service.deleteRoom(roomName).catch(() => {});
      await rtc.dispose();
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
