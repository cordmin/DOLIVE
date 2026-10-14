// 켜진 서버에서 실행: 참가자와 같은 바깥 주소(wss://도메인 → Caddy → LiveKit)로 통화 신호가 이어지는지 본다.
//   node tests/public-rtc.cjs   (주소: DOLIVE_RTC_URL, 없으면 설정의 LIVEKIT_PUBLIC_URL)
// Linux 서버는 sudo dolivectl selftest 가 DOLIVE_ENV_FILE=/etc/dolive/dolive.env 와 함께 실행한다.
// 인증서는 검증한다 (끄지 않는다). 확인용 방은 끝나면 지운다.
const assert = require("node:assert/strict");
const path = require("node:path");
const { AccessToken, RoomServiceClient } = require("livekit-server-sdk");
const { Room, dispose } = require("@livekit/rtc-node");
const root = path.resolve(__dirname, "..");
process.loadEnvFile(process.env.DOLIVE_ENV_FILE || path.join(root, ".env.local"));
const url = (process.env.DOLIVE_RTC_URL || process.env.LIVEKIT_PUBLIC_URL || "").replace(/\/+$/, "");
const key = process.env.LIVEKIT_API_KEY;
const secret = process.env.LIVEKIT_API_SECRET;
const service = new RoomServiceClient("http://localhost:7880", key, secret);
const roomName = `바깥 경로 확인 ${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check, label) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await sleep(100); }
  throw new Error(label);
}
async function token(identity) {
  const at = new AccessToken(key, secret, { identity, ttl: "5m" });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: false, canSubscribe: true });
  return at.toJwt();
}
const present = async (identity) => (await service.listParticipants(roomName).catch(() => [])).some((p) => p.identity === identity);

(async () => {
  let room;
  try {
    assert.match(url, /^wss:\/\//, "바깥 주소는 wss:// 로 시작해야 해요");
    // 1) 유효한 입장권으로 WebSocket 업그레이드가 되고, LiveKit 이 참여자로 받는지
    const raw = await token("dolive-public-check-ws");
    const socket = new WebSocket(`${url}/rtc?access_token=${encodeURIComponent(raw)}&auto_subscribe=1&protocol=16`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket 연결 시간 초과")), 15000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); });
      socket.addEventListener("error", (e) => { clearTimeout(timer); reject(new Error(`WebSocket 연결 실패: ${e.message ?? e.type}`)); });
    });
    await waitFor(() => present("dolive-public-check-ws"), "WebSocket 으로 연결했지만 LiveKit 참여자로 보이지 않아요");
    socket.close();
    console.log(`통과: ${url} WebSocket 업그레이드와 LiveKit 참여자 연결`);

    // 2) 실제 참가자와 같은 SDK 로 입장하고 나가기
    room = new Room();
    await room.connect(url, await token("dolive-public-check-sdk"), { autoSubscribe: true });
    await waitFor(() => present("dolive-public-check-sdk"), "SDK 로 입장했지만 참여자 목록에 없어요");
    await room.disconnect();
    room = undefined;
    await waitFor(async () => !(await present("dolive-public-check-sdk")), "나간 뒤에도 참여자로 남아 있어요");
    console.log(`통과: ${url} SDK 입장·퇴장`);
  } finally {
    if (room) await room.disconnect().catch(() => {});
    await service.deleteRoom(roomName).catch(() => {});
    await dispose();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
