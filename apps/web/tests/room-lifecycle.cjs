// 켜진 서버에서 실행: node tests/room-lifecycle.cjs
// 확인용 방만 만들고 끝나면 목록과 참여자를 원래대로 치운다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { RoomServiceClient } = require("livekit-server-sdk");
const { Room, dispose } = require("@livekit/rtc-node");
const root = path.resolve(__dirname, "..");
process.loadEnvFile(path.join(root, ".env.local"));
const config = path.resolve(root, "../../server/config/rooms.txt");
const original = fs.existsSync(config) ? fs.readFileSync(config) : null;
const key = process.env.LIVEKIT_API_KEY;
const secret = process.env.LIVEKIT_API_SECRET;
const service = new RoomServiceClient("http://localhost:7880", key, secret);
const roomName = `채팅 기록 확인 ${Date.now()}`;
const connected = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check, label) {
  for (let i = 0; i < 50; i++) { if (await check()) return; await sleep(100); }
  throw new Error(label);
}
async function request(url, token, body, type = "application/json", method) {
  return fetch(`http://localhost:3000${url}`, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { Host: "localhost", ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": type }, body: body === undefined ? undefined : type === "application/json" ? JSON.stringify(body) : body });
}
async function ticket(name, room = roomName) {
  const r = await request("/api/token", null, { name, room, password: "", avatar: "1" });
  assert.equal(r.status, 200);
  return r.json();
}
async function join(token) {
  const room = new Room();
  connected.push(room);
  await room.connect("ws://localhost:7880", token, { autoSubscribe: true });
  return room;
}

(async () => {
  try {
    fs.writeFileSync(config, Buffer.concat([original ?? Buffer.from("DOLIVE\t\n"), Buffer.from(`\n${roomName}\t\n`)]));
    const first = await ticket("확인 한 명");
    const second = await ticket("확인 두 명");
    const a = await join(first.token);
    const b = await join(second.token);

    const sent = await request("/api/chat", first.token, { message: "남아 있는 동안 보이는 글", mode: "off" });
    assert.equal(sent.status, 200);
    const msg = await sent.json();
    const picture = await request("/api/chat", first.token, new Uint8Array([1, 2, 3]), "image/png");
    assert.equal(picture.status, 200);
    const pic = await picture.json();
    assert.equal((await request(pic.image)).status, 200);
    assert.equal((await (await request("/api/chat", second.token)).json()).length, 2);
    assert.equal((await request("/api/chat", first.token, { message: "/확인", mode: "slash", voice: "F1" })).status, 200);
    await waitFor(async () => (await service.listParticipants(roomName)).some((p) => p.identity === "dolive-voice"), "글 읽기 참여자가 들어오지 못했어요");
    await a.disconnect();
    await sleep(300);
    assert.ok((await (await request("/api/chat", second.token)).json()).some((m) => m.id === msg.id));
    await b.disconnect();
    await waitFor(async () => (await service.listParticipants(roomName)).length === 0, "빈 방에 읽어 주는 참여자가 남았어요");
    assert.equal((await request("/api/chat", second.token)).status, 403);
    assert.equal((await request(pic.image)).status, 404);
    const fresh = await ticket("다시 입장");
    await join(fresh.token);
    assert.deepEqual(await (await request("/api/chat", fresh.token)).json(), []);
    assert.equal((await request("/api/livekit", null, { event: "participant_left", room: { name: roomName } })).status, 401);
    console.log("통과: 한 명 남으면 기록 유지, 마지막 퇴장 때 글·사진 삭제, 음성 참여자 정리, 옛 입장권 차단");
  } finally {
    await Promise.all(connected.map((r) => r.disconnect().catch(() => {})));
    await service.deleteRoom(roomName).catch(() => {});
    // 확인 중 운영자가 목록을 고쳤어도 그 변경은 보존한다.
    const current = fs.readFileSync(config, "utf8");
    const cleaned = current.split(/\r?\n/).filter((line) => line.split("\t")[0] !== roomName).join("\n");
    if (original) fs.writeFileSync(config, cleaned); else if (cleaned.trim() === "DOLIVE") fs.unlinkSync(config); else fs.writeFileSync(config, cleaned);
    await dispose();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
