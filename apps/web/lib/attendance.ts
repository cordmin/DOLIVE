import "server-only";
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ParticipantInfo_State, type ParticipantInfo } from "livekit-server-sdk";
import { VOICE_BOT } from "@/lib/dolive";
import { rooms } from "@/lib/server";
import { isYeonsuId, isYeonsuSlug, yeonsuIdOf, yeonsuRoomInfo, yeonsuRoomName } from "@/lib/yeonsu";
import { emptyAttendance, hasOpenVisit, noteLeft, notePresent, reconcile, summarize, type Attendance, type AttendSummary, type Seen } from "@/lib/attendanceCore";

// 도름스 연수 방 참석 기록 (2026-11-12 사용자 지시): 연수를 연 선생님만 누가 왔는지·얼마나 있었는지 본다. 운영진·마스터도 못 본다.
// - 통화 서버의 입·퇴장 알림(app/api/livekit)으로 적고, 알림이 빠질 수 있어서 1분마다 실제 방 인원과 맞춘다 (startAttendance).
// - 연수마다 server/config/yeonsu-attendance/<연수 id>.json 에 남긴다. 서버를 다시 켜도 남고, 연수가 끝난 지 30일 지나면 지운다.
// - 보는 곳: 방 안의 '참석 기록' 창(app/room/attendance.tsx)과 dolive.site/<짧은 연수 번호>/attendance. 둘 다 api/yeonsu/attendance 가 판정한다.
// 계산은 lib/attendanceCore.ts.
const DIR = path.join(process.cwd(), "..", "..", "server", "config", "yeonsu-attendance");
const KEEP_AFTER_END = 30 * 24 * 3600_000;
const EVERY = 60_000;
const SWEEP_EVERY = 3600_000;

type State = { recs: Map<string, Attendance>; names: Map<string, string>; timer?: ReturnType<typeof setInterval>; swept: number; warned: boolean };
// 서버 시작(instrumentation)과 api 가 따로 묶여도 같은 기록을 보게 globalThis 에 둔다 (lib/chat.ts 와 같은 방법)
const g = globalThis as unknown as { doliveAttendance?: State };
const state: State = (g.doliveAttendance ??= { recs: new Map(), names: new Map(), swept: 0, warned: false });

const fileOf = (id: string) => path.join(DIR, `${id}.json`);

function readFile(id: string): Attendance | null {
  try {
    const a = JSON.parse(readFileSync(fileOf(id), "utf8")) as Attendance;
    return a && typeof a.host === "string" && a.people && typeof a.people === "object" ? a : null;
  } catch {
    return null;
  }
}
function save(id: string, a: Attendance) {
  try {
    mkdirSync(DIR, { recursive: true });
    const tmp = `${fileOf(id)}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(a));
    renameSync(tmp, fileOf(id)); // 쓰다가 꺼져도 반쯤 쓴 파일이 남지 않게
  } catch (e) {
    if (!state.warned) console.warn(`[attendance] 참석 기록을 저장하지 못했습니다: ${(e as Error).message}`);
    state.warned = true;
  }
}

// 그 연수 방의 기록 (메모리 → 파일 → 새로). 누가 연 연수인지 모르면(방 기록도 파일도 없으면) 적지 않는다
function recordOf(room: string): Attendance | null {
  const id = yeonsuIdOf(room);
  if (!id) return null;
  const info = yeonsuRoomInfo(room);
  let a = state.recs.get(room) ?? readFile(id);
  if (!a) {
    if (!info) return null;
    a = emptyAttendance(room, { title: info.title, host: info.owner, endsAt: info.endsAt });
  } else if (info) {
    // 제목·끝나는 시각이 바뀌었으면 따라간다 (여는 선생님은 바뀌지 않는다)
    a.title = info.title;
    a.endsAt = info.endsAt;
  }
  state.recs.set(room, a);
  return a;
}
function commit(room: string, a: Attendance) {
  save(yeonsuIdOf(room)!, a);
  if (!hasOpenVisit(a)) state.recs.delete(room); // 아무도 없는 연수는 메모리에서 내린다 (파일에 남아 있다)
}

function seenOf(p: ParticipantInfo): Seen {
  const ms = Number(p.joinedAtMs) || Number(p.joinedAt) * 1000;
  return { sid: p.sid, identity: p.identity, name: p.name || p.identity, dorms: p.attributes?.dorms ?? "", joinedAt: ms > 0 ? ms : undefined, dormsName: state.names.get(p.identity) };
}
const counts = (p: ParticipantInfo) => p.identity !== VOICE_BOT;

// 입장권을 줄 때(api/token): 그 사람의 도름스 이름을 기억해 둔다 (입장 이름은 바꿀 수 있어서 여는 선생님이 누군지 알아보게).
// 방 안 다른 사람에게 보이는 입장권에는 적지 않는다. 시작 시각도 이때 받는다
export function noteYeonsuEntrant(room: string, identity: string, dormsName: string, startsAt: string) {
  if (!yeonsuIdOf(room)) return;
  if (dormsName) state.names.set(identity, dormsName.slice(0, 40));
  if (state.names.size > 5000) state.names.delete(state.names.keys().next().value!);
  const a = recordOf(room);
  if (a && startsAt && a.startsAt !== startsAt) {
    a.startsAt = startsAt;
    commit(room, a);
  }
}

// 통화 서버 알림 (app/api/livekit). 들어옴은 통화 서버에 다시 물어 지금 있는 것을 확인한 뒤에만 부른다
export function attendJoined(room: string, p: ParticipantInfo) {
  if (!counts(p)) return;
  const a = recordOf(room);
  if (!a) return;
  notePresent(a, seenOf(p), Date.now());
  commit(room, a);
}
export function attendLeft(room: string, p: ParticipantInfo, at: number, aborted: boolean) {
  if (!counts(p)) return;
  const a = recordOf(room);
  if (!a) return;
  noteLeft(a, seenOf(p), Math.min(at || Date.now(), Date.now()), !aborted);
  commit(room, a);
}

// 1분 점검: 지금 열린 연수 방과, 아직 누가 있는 걸로 적힌 기록을 실제 방 인원과 맞춘다.
// 통화 서버에 묻지 못하면 아무것도 닫지 않는다 (통화 서버가 잠깐 안 될 때 모두 나간 것으로 적지 않게)
export async function tickAttendance() {
  const list = await rooms.listRooms().catch(() => null);
  if (!list) return;
  const live = new Set(list.map((r) => r.name).filter((n) => yeonsuIdOf(n)));
  for (const room of new Set([...live, ...state.recs.keys()])) {
    const people = live.has(room) ? await rooms.listParticipants(room).catch(() => null) : [];
    if (!people) continue;
    const present = people.filter((p) => counts(p) && p.state === ParticipantInfo_State.ACTIVE);
    const a = recordOf(room);
    if (!a || (!present.length && !hasOpenVisit(a))) continue;
    const before = JSON.stringify(a);
    reconcile(a, present.map(seenOf), Date.now());
    if (JSON.stringify(a) !== before) commit(room, a);
    else if (!hasOpenVisit(a)) state.recs.delete(room);
  }
  if (Date.now() - state.swept > SWEEP_EVERY) sweep();
}

// 끝난 지 30일 지난 기록을 지운다
function sweep() {
  state.swept = Date.now();
  let names: string[];
  try {
    names = readdirSync(DIR);
  } catch {
    return;
  }
  for (const f of names) {
    const id = f.replace(/\.json$/, "");
    if (!isYeonsuId(id)) continue;
    const a = readFile(id);
    const end = Date.parse(a?.endsAt ?? "");
    if (!a || (Number.isFinite(end) && end + KEEP_AFTER_END < Date.now())) {
      try { unlinkSync(fileOf(id)); } catch {}
    }
  }
}

export function startAttendance() {
  if (state.timer) return;
  state.timer = setInterval(() => void tickAttendance().catch(() => {}), EVERY);
  state.timer.unref?.();
  void tickAttendance().catch(() => {});
}

// 연수를 연 선생님에게만 보여 줄 표. 연수 id 나 짧은 번호(앞 8자)로 찾는다.
// 기록이 없거나 연 선생님이 아니면 null (어느 쪽인지 알려 주지 않는다)
export function attendanceFor(ref: string, userId: string): AttendSummary | null {
  const r = ref.toLowerCase();
  let ids: string[];
  if (isYeonsuId(r)) ids = [r];
  else if (isYeonsuSlug(r)) {
    try {
      ids = readdirSync(DIR).map((f) => f.replace(/\.json$/, "")).filter((id) => isYeonsuId(id) && id.startsWith(r));
    } catch {
      ids = [];
    }
  } else return null;
  for (const id of ids) {
    const room = yeonsuRoomName(id);
    const a = state.recs.get(room) ?? readFile(id) ?? (yeonsuRoomInfo(room) ? recordOf(room) : null);
    if (a && a.host && a.host.toLowerCase() === userId.toLowerCase()) return summarize(a, Date.now());
  }
  return null;
}
