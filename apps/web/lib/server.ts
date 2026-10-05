import { readFileSync } from "node:fs";
import path from "node:path";
import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { DormsAuthError, getDormsUser, type DormsUser } from "@/lib/dormsLogin";

// 서버에서만 쓰는 것들 (방장·운영진 확인, 도름스 확인, 통화 서버에 시키기, 화면공유 권한)

// 이 PC의 통화 서버(LiveKit)에 일을 시키는 창구. 채팅 보내기·마이크 끄기·화면공유 허락에 같이 쓴다
export const rooms = new RoomServiceClient("http://localhost:7880", process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);

// 방장이 아닌 사람은 처음엔 마이크만 보낼 수 있다. 방장이 허락하면 화면공유(+공유 소리)도 보낼 수 있다.
export const MIC_ONLY = [TrackSource.MICROPHONE];
export const WITH_SCREEN = [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1", "::ffff:127.0.0.1"];

// 서버 PC에서 localhost로 직접 들어온 사람.
// Caddy를 거치면 X-Forwarded-For에 들어온 사람 IP가 붙어서, 바깥·공유기 안 다른 기기는 걸러진다.
// (페이지에서는 headers() 를 { headers } 로 넘긴다)
export function isLocal(req: { headers: Headers }) {
  const host = new URL(`http://${req.headers.get("host")}`).hostname;
  const forwarded = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  return LOOPBACK.includes(host) && forwarded.every((ip) => LOOPBACK.includes(ip));
}

// 운영진 = 서버 켜기 창(scripts/dolive_panel.ps1)의 톱니바퀴에서 적은 도름스 닉네임들 (server/config/staff.txt, 한 줄에 한 명).
// 요청마다 파일을 다시 읽어서 고치면 바로 반영된다. 닉네임(name)이나 도름스 아이디(handle) 어느 쪽이 같아도 되고, 대소문자·앞의 @ 는 안 본다.
// ponytail: 닉네임은 바뀔 수 있어서 바뀌면 목록도 고쳐야 한다 (운영자 결정: 중요한 권한이 아니라 그걸로 충분)
const STAFF_FILE = path.join(process.cwd(), "..", "..", "server", "config", "staff.txt");
const norm = (s: string) => s.trim().replace(/^@/, "").toLowerCase(); // trim 은 메모장이 붙이는 BOM 도 지운다
export function isStaff(user?: DormsUser) {
  if (!user) return false;
  let names: string[];
  try {
    names = readFileSync(STAFF_FILE, "utf8").split(/\r?\n/).map(norm).filter(Boolean);
  } catch {
    return false; // 목록 파일이 아직 없으면 운영진도 없다
  }
  return [user.name, user.handle].some((n) => n && names.includes(norm(n)));
}

// 방송 목록 = 서버 켜기 창 톱니바퀴 [채팅방 관리]에서 만든 방들 (server/config/rooms.txt, 한 줄에 "방 이름<탭>비밀번호". 비밀번호는 비워도 된다).
// 운영진 목록처럼 요청마다 다시 읽는다. 방 이름이 통화 서버(LiveKit)의 방 이름이고, 채팅 기록·음성도 방마다 따로다.
// 파일이 아직 없으면(처음 켠 때) 예전처럼 비밀번호 없는 DOLIVE 방 하나
const ROOMS_FILE = path.join(process.cwd(), "..", "..", "server", "config", "rooms.txt");
export type RoomDef = { name: string; password: string };
export function roomList(): RoomDef[] {
  let text: string;
  try {
    text = readFileSync(ROOMS_FILE, "utf8");
  } catch {
    return [{ name: "DOLIVE", password: "" }];
  }
  return text
    .split(/\r?\n/)
    .map((line) => {
      const [name, password = ""] = line.split("\t");
      return { name: name.trim(), password };
    })
    .filter((r) => r.name);
}
export const findRoom = (name: unknown) => roomList().find((r) => r.name === name);

// 그 방에 들어가도 되는지: 목록에 있는 방이고, 비밀번호 방이면 비밀번호가 맞아야 한다 (방장·운영진은 안 묻는다). 안 되면 거절 응답
export function roomDeny(name: unknown, password: unknown, admin: boolean) {
  const r = findRoom(name);
  if (!r) return Response.json({ error: "없는 방송이에요", reason: "no_room" }, { status: 404 });
  if (r.password && !admin && password !== r.password)
    return Response.json({ error: "비밀번호가 틀렸어요", reason: "password" }, { status: 403 });
  return null;
}

// 방장 기능(마이크 끄기·화면공유 허락·방 닫기)을 써도 되는지: 서버 PC, 또는 운영진 도름스 회원. 안 되면 거절 응답을 준다
export async function adminDeny(req: Request) {
  const { user, deny } = await dormsCheck(req);
  if (deny) return deny;
  return isLocal(req) || isStaff(user) ? null : Response.json({ error: "방장만 할 수 있어요" }, { status: 403 });
}

// 도름스 회원 확인. 자료를 읽고 쓰는 서버 요청마다 처음에 부른다 (도름스에 매번 새로 물어본다. 지난 결과를 기억해 두지 않는다).
// 서버 PC는 늘 통과(user 없음). 막히면 deny 를 그대로 돌려준다: 401 로그인 필요, 403 허용 안 됨(연결 끊김·조건 안 맞음), 503 도름스 연결 안 됨.
// 방 안 사람(kick: 방 이름 + identity)이 허용 끊김으로 막히면 통화 방에서도 내보낸다 (이미 받은 입장권으로 계속 듣고 말하지 못하게)
export async function dormsCheck(req: Request, kick?: { room: string; identity: string }): Promise<{ user?: DormsUser; deny?: Response }> {
  if (isLocal(req)) return {};
  let deny: Response;
  try {
    const user = await getDormsUser();
    if (user) return { user };
    deny = Response.json({ error: "도름스 로그인이 필요해요.", reason: "authentication_required" }, { status: 401 });
  } catch (e) {
    if (!(e instanceof DormsAuthError)) throw e;
    deny = Response.json({ error: e.message, reason: e.reason }, { status: e.status });
  }
  // 허용이 끊긴 사람(403)만 내보낸다. 로그인 시간이 지난 사람(401)은 방 화면이 다시 로그인시키고,
  // 도름스가 잠깐 안 될 때(503)는 그동안 자료만 막혀 있다가 되살아나면 다시 쓸 수 있다
  if (kick && deny.status === 403) await rooms.removeParticipant(kick.room, kick.identity).catch(() => {});
  return { deny };
}

// Caddy 뒤의 실제 서버(next start -H 127.0.0.1)는 request.url 을 https://localhost:3000/... 으로 안다 (Next 가 들어온 주소를 보지 않아서).
// 도름스 로그인 경로들(app/api/auth/dorms)이 되돌려 보낼 주소와 "같은 사이트에서 왔나" 확인에 바깥 주소(DORMS_SITE_URL)를 쓰게 한다. 개발 서버는 그대로
export function publicUrl(req: Request) {
  const site = process.env.DORMS_SITE_URL;
  if (process.env.NODE_ENV !== "production" || !site) return req.url;
  const u = new URL(req.url);
  return new URL(u.pathname + u.search, site).href;
}
