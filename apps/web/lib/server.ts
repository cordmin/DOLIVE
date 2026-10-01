import { RoomServiceClient, TrackSource } from "livekit-server-sdk";

// 서버에서만 쓰는 것들 (방장 확인, 통화 서버에 시키기, 화면공유 권한)

// 이 PC의 통화 서버(LiveKit)에 일을 시키는 창구. 채팅 보내기·마이크 끄기·화면공유 허락에 같이 쓴다
export const rooms = new RoomServiceClient("http://localhost:7880", process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);

// 방장이 아닌 사람은 처음엔 마이크만 보낼 수 있다. 방장이 허락하면 화면공유(+공유 소리)도 보낼 수 있다.
export const MIC_ONLY = [TrackSource.MICROPHONE];
export const WITH_SCREEN = [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1", "::ffff:127.0.0.1"];

// 방장 = 서버 PC에서 localhost로 직접 들어온 사람.
// Caddy를 거치면 X-Forwarded-For에 들어온 사람 IP가 붙어서, 바깥·공유기 안 다른 기기는 걸러진다.
export function isAdmin(req: Request) {
  const host = new URL(`http://${req.headers.get("host")}`).hostname;
  const forwarded = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  return LOOPBACK.includes(host) && forwarded.every((ip) => LOOPBACK.includes(ip));
}
