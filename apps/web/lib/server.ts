import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { ROOM } from "@/lib/dolive";

// 서버에서만 쓰는 것들 (방장 확인·로그인, 통화 서버에 시키기, 화면공유 권한)

// 이 PC의 통화 서버(LiveKit)에 일을 시키는 창구. 채팅 보내기·마이크 끄기·화면공유 허락에 같이 쓴다
export const rooms = new RoomServiceClient("http://localhost:7880", process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);

// 방장이 아닌 사람은 처음엔 마이크만 보낼 수 있다. 방장이 허락하면 화면공유(+공유 소리)도 보낼 수 있다.
export const MIC_ONLY = [TrackSource.MICROPHONE];
export const WITH_SCREEN = [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1", "::ffff:127.0.0.1"];

// 서버 PC에서 localhost로 직접 들어온 사람.
// Caddy를 거치면 X-Forwarded-For에 들어온 사람 IP가 붙어서, 바깥·공유기 안 다른 기기는 걸러진다.
export function isLocal(req: Request) {
  const host = new URL(`http://${req.headers.get("host")}`).hostname;
  const forwarded = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  return LOOPBACK.includes(host) && forwarded.every((ip) => LOOPBACK.includes(ip));
}

// 다른 컴퓨터의 입장 화면 [관리자 로그인]에 비밀번호(.env.local 의 DOLIVE_ADMIN_PASSWORD)를 넣고 로그인한 곳들.
// 열쇠 = 그 브라우저 쿠키 값. 서버 메모리에만 둬서 서버를 끄면 모두 로그아웃된다.
// identities: 이 로그인으로 방에 들어간 이름표 (로그아웃시키면 방에서도 내보낸다)
export type Login = { since: number; identities: string[] };
const g = globalThis as unknown as { doliveLogins?: Map<string, Login> };
export const logins = (g.doliveLogins ??= new Map<string, Login>());
export const LOGIN_COOKIE = "dolive-admin";
export const LOGIN_SECONDS = 12 * 60 * 60; // 12시간 지나면 저절로 로그아웃

// 이 요청의 로그인 열쇠 (없거나 12시간이 지났으면 undefined)
export function loginKey(req: Request) {
  const key = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${LOGIN_COOKIE}=([^;]+)`))?.[1];
  const login = key ? logins.get(key) : undefined;
  if (!key || !login) return;
  if (Date.now() - login.since > LOGIN_SECONDS * 1000) return void logins.delete(key);
  return key;
}

// 로그아웃: 방장 표시를 지우고, 그 로그인으로 방에 있던 사람도 내보낸다 (이미 받은 방장 입장권으로 계속 방장 노릇을 못 하게)
export async function logout(key: string) {
  const login = logins.get(key);
  logins.delete(key);
  await Promise.all((login?.identities ?? []).map((id) => rooms.removeParticipant(ROOM, id).catch(() => {})));
}

// 방장 = 서버 PC의 localhost 접속자, 또는 다른 컴퓨터에서 비밀번호로 로그인한 사람
export const isAdmin = (req: Request) => isLocal(req) || !!loginKey(req);
