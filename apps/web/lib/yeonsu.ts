import { createHmac } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DORMS_ISSUER } from "@/lib/dormsLogin";

// 도름스 연수 방 (2026-10-14)
// 도름스(dorms.school)에서 연수를 열고 장소로 DoLive 를 고르면, 연수마다 방 하나가 저절로 생긴다. 방 주소는 /yeonsu/<연수 id>.
// - 방 만들기 목록(rooms.txt, 최대 4개)을 쓰지 않는다. 대신 입장 화면 목록에 도름스에 실시간으로 물어본 '지금 열린 연수'를 함께 보여 준다
//   (liveYeonsuRooms, 아래). 그래서 연수 링크를 못 받은 선생님도 목록에서 찾아 들어온다.
// - 들어올 수 있는지는 도름스가 정한다: 여는 선생님과 신청이 확정된 선생님만, 시작 10분 전부터 끝날 때까지.
//   입장 화면과 입장권(api/token)이 그때마다 도름스에 서명한 요청으로 다시 묻는다 (아래 askDorms). 비회원은 들어오지 못한다.
// - 여는 선생님은 그 방의 방장이다 (방장 넘기기는 없다). 끝나는 시간이 되면 방을 닫는다.
// 서명 규칙은 도름스 저장소의 src/lib/yeonsuDoliveSign.ts 와 같다. 바꾸면 둘을 함께 바꾼다.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const YEONSU_PREFIX = "yeonsu-";
export const yeonsuRoomName = (id: string) => `${YEONSU_PREFIX}${id.toLowerCase()}`;
export function yeonsuIdOf(room: unknown): string | null {
  if (typeof room !== "string" || !room.startsWith(YEONSU_PREFIX)) return null;
  const id = room.slice(YEONSU_PREFIX.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}
export const isYeonsuId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

// 도름스가 돌려주는 답 (도름스 lib/yeonsuServer.ts 의 YeonsuDoliveVerdict 와 같은 모양)
export type YeonsuVerdict =
  | { ok: true; role: "host" | "guest"; title: string; startsAt: string; endsAt: string; hostId: string; hostName: string }
  | { ok: false; reason: "not_found" | "not_applied" | "not_confirmed" | "blocked" | "too_early" | "ended" | "unavailable"; title?: string; startsAt?: string; endsAt?: string; opensAt?: string };

// 도름스 주소: 운영은 dorms.school, 개발 서버만 DORMS_API_ORIGIN_DEV(localhost) 를 쓴다 (lib/dormsLogin.ts 와 같은 규칙)
const API_ORIGIN = process.env.NODE_ENV !== "production" && /^https?:\/\/localhost(:\d+)?$/.test(process.env.DORMS_API_ORIGIN_DEV ?? "") ? process.env.DORMS_API_ORIGIN_DEV! : DORMS_ISSUER;
const SECRET_MIN = 32;

export function signYeonsuRequest(secret: string, timestampSec: number, body: string) {
  const v1 = createHmac("sha256", secret).update(`${timestampSec}.`, "utf8").update(body, "utf8").digest("hex");
  return `t=${timestampSec},v1=${v1}`;
}

// 이 회원이 이 연수 방에 지금 들어와도 되는지 도름스에 묻는다. 비밀 값이 없거나 도름스가 답하지 않으면 '확인하지 못함'(들이지 않는다)
export async function askDorms(sessionId: string, dormsUserId: string): Promise<YeonsuVerdict> {
  const secret = process.env.DORMS_YEONSU_SECRET?.trim() ?? "";
  if (secret.length < SECRET_MIN || !isYeonsuId(sessionId) || !isYeonsuId(dormsUserId)) return { ok: false, reason: "unavailable" };
  const body = JSON.stringify({ session: sessionId.toLowerCase(), user: dormsUserId.toLowerCase() });
  try {
    const res = await fetch(`${API_ORIGIN}/api/yeonsu/dolive/access`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dolive-signature": signYeonsuRequest(secret, Math.floor(Date.now() / 1000), body) },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json().catch(() => null)) as YeonsuVerdict | null;
    if (!res.ok || !data || typeof data.ok !== "boolean") return { ok: false, reason: "unavailable" };
    if (data.ok && (data.role !== "host" && data.role !== "guest" || !isYeonsuId(data.hostId))) return { ok: false, reason: "unavailable" };
    return data;
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

// 지금 열린 DoLive 연수 전부를 도름스에 묻는다 (도름스 /api/yeonsu/dolive/rooms, 0606).
// 입장 화면 목록이 10초마다 다시 묻기 때문에 서버에서 8초만 기억해 두고, 도름스가 답하지 않으면 마지막으로 받은 목록을 30초까지 쓴다
// (연수 중에 도름스가 잠깐 끊겨도 목록에서 방이 사라지지 않게). 들어올 수 있는지는 사람마다 askDorms 가 다시 판정한다.
export type YeonsuLiveRoom = { id: string; title: string; startsAt: string; endsAt: string; hostId: string; hostName: string; access: "teacher" | "member" };
const LIVE_TTL = 8_000;
const LIVE_STALE = 30_000;
const live = globalThis as unknown as { doliveYeonsuLive?: { at: number; rooms: YeonsuLiveRoom[] } };

function isLiveRoom(r: unknown): r is YeonsuLiveRoom {
  const x = r as YeonsuLiveRoom | null;
  return !!x && isYeonsuId(x.id) && typeof x.title === "string" && !!x.title && isYeonsuId(x.hostId)
    && typeof x.hostName === "string" && Number.isFinite(Date.parse(x.startsAt)) && Number.isFinite(Date.parse(x.endsAt));
}

export async function liveYeonsuRooms(): Promise<YeonsuLiveRoom[]> {
  const had = live.doliveYeonsuLive;
  if (had && Date.now() - had.at < LIVE_TTL) return had.rooms;
  const secret = process.env.DORMS_YEONSU_SECRET?.trim() ?? "";
  if (secret.length < SECRET_MIN) return [];
  const body = "{}";
  try {
    const res = await fetch(`${API_ORIGIN}/api/yeonsu/dolive/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dolive-signature": signYeonsuRequest(secret, Math.floor(Date.now() / 1000), body) },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; rooms?: unknown } | null;
    if (!res.ok || data?.ok !== true || !Array.isArray(data.rooms)) throw new Error("bad_answer");
    const rooms = data.rooms.filter(isLiveRoom).filter((r) => Date.parse(r.endsAt) > Date.now()).slice(0, 50);
    // 채팅·방장 확인(findRoom)이 아직 아무도 안 들어온 연수 방도 알아보게 미리 남긴다
    for (const r of rooms) registerYeonsuRoom(yeonsuRoomName(r.id), { title: r.title, owner: r.hostId, endsAt: r.endsAt });
    live.doliveYeonsuLive = { at: Date.now(), rooms };
    return rooms;
  } catch {
    if (had && Date.now() - had.at < LIVE_STALE) return had.rooms.filter((r) => Date.parse(r.endsAt) > Date.now());
    return [];
  }
}

// 연 연수 방 기록: server/config/yeonsu-rooms.json { "yeonsu-<id>": { title, owner, endsAt } }.
// 채팅·방장 확인(lib/chat.ts, lib/server.ts findRoom)이 이 방을 알아보게 남긴다. 서버를 다시 켜도 남고, 끝난 지 하루 지난 기록은 지운다.
type YeonsuRoom = { title: string; owner: string; endsAt: string };
const FILE = path.join(process.cwd(), "..", "..", "server", "config", "yeonsu-rooms.json");
const KEEP_AFTER_END = 24 * 3600_000;
function readAll(): Record<string, YeonsuRoom> {
  try {
    const data = JSON.parse(readFileSync(FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

// 방 이름으로 그 연수 방을 찾는다 (방송 목록의 방과 같은 모양). 끝난 방은 없는 방이다
export function yeonsuRoomDef(name: unknown) {
  if (!yeonsuIdOf(name)) return undefined;
  const r = readAll()[name as string];
  if (!r || !(Date.parse(r.endsAt) > Date.now())) return undefined;
  scheduleEnd(name as string, r.endsAt);
  return { name: name as string, password: "", guest: false, owner: r.owner, title: r.title };
}

// 도름스가 들여보낸 뒤 방을 남긴다. 제목·끝나는 시각이 바뀌었으면 고쳐 쓴다 (임시 파일에 쓰고 바꿔 끼워 반쯤 쓴 파일이 남지 않게)
export function registerYeonsuRoom(name: string, room: YeonsuRoom) {
  const all = readAll();
  const now = Date.now();
  for (const [key, value] of Object.entries(all)) if (!(Date.parse(value?.endsAt) + KEEP_AFTER_END > now)) delete all[key];
  const before = all[name];
  if (!before || before.title !== room.title || before.owner !== room.owner || before.endsAt !== room.endsAt) {
    all[name] = room;
    const tmp = `${FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all));
    renameSync(tmp, FILE);
  }
  scheduleEnd(name, room.endsAt);
}

// 끝나는 시간에 방을 닫는다 ("방송이 끝났어요"). 서버를 다시 켜면 다음 입장·채팅 때 다시 건다
const g = globalThis as unknown as { doliveYeonsuTimers?: Map<string, { at: string; timer: ReturnType<typeof setTimeout> }> };
const timers = (g.doliveYeonsuTimers ??= new Map());
function scheduleEnd(name: string, endsAt: string) {
  const at = Date.parse(endsAt);
  if (!Number.isFinite(at)) return;
  const had = timers.get(name);
  if (had?.at === endsAt) return;
  if (had) clearTimeout(had.timer);
  const wait = Math.max(0, Math.min(at - Date.now(), 2_000_000_000));
  const timer = setTimeout(async () => {
    timers.delete(name);
    if (Date.now() < at) return scheduleEnd(name, endsAt); // 아주 먼 끝 시각은 나눠서 기다린다
    const { endRoom } = await import("@/lib/chat");
    await endRoom(name).catch(() => {});
  }, wait);
  timer.unref?.();
  timers.set(name, { at: endsAt, timer });
}

// 화면에 보일 한국 시각 'HH:MM'
export function kstTime(iso: string | undefined) {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms) ? new Date(ms + 9 * 3600_000).toISOString().slice(11, 16) : "";
}
