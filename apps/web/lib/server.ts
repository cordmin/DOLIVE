import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { RoomServiceClient, TokenVerifier, TrackSource } from "livekit-server-sdk";
import { DormsAuthError, getDormsUser, type DormsUser } from "@/lib/dormsLogin";
import { yeonsuRoomDef } from "@/lib/yeonsu";

// 서버에서만 쓰는 것들 (방장·운영진 확인, 도름스 확인, 통화 서버에 시키기, 화면공유 권한)

// 이 PC의 통화 서버(LiveKit)에 일을 시키는 창구. 채팅 보내기·마이크 끄기·화면공유 허락에 같이 쓴다
export const rooms = new RoomServiceClient("http://localhost:7880", process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);

// 일반 참여자는 마이크와 카메라(얼굴)만. 방을 만든 사람이나 방장이 허락한 사람은 화면공유(+공유 소리)도 보낼 수 있다.
export const MIC_CAM = [TrackSource.MICROPHONE, TrackSource.CAMERA];
export const WITH_SCREEN = [...MIC_CAM, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];

// 권한을 바꿀 때는 나머지 허용도 함께 적는다. 공유 허락과 방장 넘기기에 같이 쓴다.
export const publishPermission = (screen: boolean) => ({
  canSubscribe: true,
  canPublish: true,
  canPublishData: true,
  canPublishSources: screen ? WITH_SCREEN : MIC_CAM,
});

// 채팅과 비회원 쿠키의 입장권 모두 같은 서명 확인을 거친다. 확인 실패는 입장권 없음으로 본다.
export const verifyRoomToken = (token?: string) => token
  ? new TokenVerifier(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!).verify(token).catch(() => null)
  : Promise.resolve(null);

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

// 운영진 = 서버의 server/config/staff.txt에 등록한 도름스 닉네임들 (한 줄에 한 명, SSH로 관리).
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

// 방송 목록 = 마스터가 만든 고정 방 + 도름스 회원이 만든 방 (한 사람에 하나). 모두 server/config/rooms.txt 에 남아서,
// 지우기 전까지는 모두 나가도, 서버를 껐다 켜도 그대로다 (지우기: 만든 사람·관리자·마스터, api/rooms).
// 방 이름이 통화 서버(LiveKit)의 방 이름이고, 채팅 기록·음성도 방마다 따로다 (채팅 기록은 파일에 안 남긴다).
// guest = 비회원(도름스 로그인 안 한 사람)도 들어올 수 있음. owner = 만든 도름스 회원 id (그 방의 방장. 빈칸이면 마스터가 만든 고정 방)
export type RoomDef = { name: string; password: string; guest: boolean; owner: string };

// 파일 한 줄은 "방 이름<탭>비밀번호<탭>guest 또는 members<탭>만든 사람 id". 요청마다 다시 읽는다.
// 파일이 아직 없으면(처음 켠 때) 비밀번호 없는 DOLIVE 방 하나
const ROOMS_FILE = path.join(process.cwd(), "..", "..", "server", "config", "rooms.txt");
export function roomList(): RoomDef[] {
  let text: string;
  try {
    text = readFileSync(ROOMS_FILE, "utf8");
  } catch {
    return [{ name: "DOLIVE", password: "", guest: false, owner: "" }];
  }
  return text
    .split(/\r?\n/)
    .map((line) => {
      const [name, password = "", who = "", owner = ""] = line.split("\t");
      return { name: name.trim(), password, guest: who.trim() === "guest", owner: owner.trim() };
    })
    .filter((r) => r.name);
}
export function saveRooms(list: RoomDef[]) {
  writeFileSync(ROOMS_FILE, list.map((r) => [r.name, r.password, r.guest ? "guest" : "members", r.owner].join("\t")).join("\r\n") + "\r\n");
}
// 도름스 연수 방(lib/yeonsu.ts)도 같은 모양으로 찾는다. 방송 목록에는 없고, 도름스가 들여보낸 뒤에만 있다
export const findRoom = (name: unknown): RoomDef | undefined => roomList().find((r) => r.name === name) ?? yeonsuRoomDef(name);

// 그 방의 방장 노릇(강퇴·마이크 끄기·화면공유 허락)을 하는 사람: 마스터(서버 PC), 관리자(운영진), 그 방을 만든 사람
export const isRoomAdmin = (req: Request, user: DormsUser | undefined, room: RoomDef | undefined) =>
  isLocal(req) || isStaff(user) || (!!user && !!room?.owner && room.owner === user.id);
// 방 설정 바꾸기·지우기: 마스터·관리자는 모든 방, 만든 사람은 자기 방만
export const canEditRoom = (req: Request, user: DormsUser | undefined, room: RoomDef) =>
  isLocal(req) || isStaff(user) || (!!user && room.owner === user.id);

// 그 방에 들어가도 되는지: 목록에 있는 방이고, 비밀번호 방이면 비밀번호가 맞아야 한다 (방장 노릇 하는 사람은 안 묻는다). 안 되면 거절 응답
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

// 비회원: "비회원도" 방에 들어갈 때 입장권을 쿠키(GUEST_COOKIE)로도 받는다. 채팅 사진·다시 듣기·목소리 미리 듣기·링크 미리보기처럼
// 입장권을 같이 못 보내는 요청에서, 도름스 로그인이 없으면 이 쿠키로 "지금 비회원 방에 들어가 있는 사람"인지 본다
export const GUEST_COOKIE = "dolive_guest";
export async function accessCheck(req: Request) {
  const checked = await dormsCheck(req);
  if (checked.deny?.status !== 401) return checked;
  const token = (await cookies()).get(GUEST_COOKIE)?.value;
  const c = await verifyRoomToken(token);
  const room = c?.video?.room;
  if (c?.sub && room && findRoom(room)?.guest && (await rooms.getParticipant(room, c.sub).catch(() => null))) return {};
  return checked;
}

// Caddy 뒤의 실제 서버(next start -H 127.0.0.1)는 request.url 을 https://localhost:3000/... 으로 안다 (Next 가 들어온 주소를 보지 않아서).
// 도름스 로그인 경로들(app/api/auth/dorms)이 되돌려 보낼 주소와 "같은 사이트에서 왔나" 확인에 바깥 주소(DORMS_SITE_URL)를 쓰게 한다. 개발 서버는 그대로
export function publicUrl(req: Request) {
  const site = process.env.DORMS_SITE_URL;
  if (process.env.NODE_ENV !== "production" || !site) return req.url;
  const u = new URL(req.url);
  return new URL(u.pathname + u.search, site).href;
}
