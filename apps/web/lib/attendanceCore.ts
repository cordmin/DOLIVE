// 연수 참석 기록의 계산 (파일·통화 서버를 모른다. 시험: tests/attendance.cjs). 저장과 권한은 lib/attendance.ts.
// 한 사람(도름스 회원 번호로 구분)이 여러 번 들어오고 나갈 수 있고, 탭을 두 개 열어 겹칠 수도 있다.
// 들어온 한 번 = 통화 서버의 참여자 번호(sid) 하나. 같은 sid 는 한 번만 센다 (알림이 두 번 와도 같다).
// 통화 서버의 입·퇴장 알림(웹훅)은 빠지거나 늦게 올 수 있어서 1분마다 실제 방 인원과 맞춰 본다 (seen = 마지막으로 방에 있던 것을 확인한 때).

export type Visit = { sid: string; from: number; to?: number; seen: number };
export type Person = { dorms: string; name: string; dormsName: string; visits: Visit[] };
export type Attendance = { room: string; title: string; host: string; startsAt: string; endsAt: string; people: Record<string, Person> };
// 통화 서버 참여자 한 명에서 쓰는 값
export type Seen = { sid: string; identity: string; name: string; dorms: string; joinedAt?: number; dormsName?: string };

// 방에 있다고 확인한 지 이만큼 지나도록 다시 확인하지 못하면, 마지막 확인 때 나간 것으로 본다 (1분 점검이 두 번 빠진 셈)
export const STALE = 3 * 60_000;
// 한 사람이 남길 수 있는 들어온 횟수 (끊겼다 붙기를 수없이 반복해도 파일이 커지지 않게. 넘치면 가장 오래된 것부터 합친다)
const MAX_VISITS = 200;

export const emptyAttendance = (room: string, info: { title: string; host: string; startsAt?: string; endsAt: string }): Attendance =>
  ({ room, title: info.title, host: info.host, startsAt: info.startsAt ?? "", endsAt: info.endsAt, people: {} });

// 도름스 회원은 회원 번호로, 마스터(서버 PC)처럼 번호가 없으면 그 입장의 이름표로 구분한다
const keyOf = (s: Seen) => (s.dorms ? s.dorms : `id:${s.identity}`);

function personOf(a: Attendance, s: Seen): Person {
  const key = keyOf(s);
  const p = (a.people[key] ??= { dorms: s.dorms, name: s.name, dormsName: s.dormsName ?? "", visits: [] });
  if (s.name) p.name = s.name;
  if (s.dormsName) p.dormsName = s.dormsName;
  return p;
}
function findVisit(a: Attendance, sid: string): Visit | undefined {
  for (const p of Object.values(a.people)) for (const v of p.visits) if (v.sid === sid) return v;
}
function trim(p: Person) {
  if (p.visits.length <= MAX_VISITS) return;
  p.visits.sort((x, y) => x.from - y.from);
  const [a, b] = p.visits.splice(0, 2);
  p.visits.unshift({ sid: b.sid, from: a.from, to: b.to, seen: Math.max(a.seen, b.seen) });
}

// 지금 방에 있다고 확인했다 (입장 알림 뒤 통화 서버에 다시 물어 확인했거나, 1분 점검에서 보였다).
// 처음 보는 sid 면 들어온 기록을 새로 만들고, 이미 있으면 '마지막 확인'을 지금으로. 잘못 닫혔던 기록이면 다시 연다
export function notePresent(a: Attendance, s: Seen, now: number) {
  const v = findVisit(a, s.sid);
  const p = personOf(a, s);
  if (v) {
    v.seen = Math.max(v.seen, now);
    delete v.to;
    return;
  }
  p.visits.push({ sid: s.sid, from: Math.min(s.joinedAt || now, now), seen: now });
  trim(p);
}

// 나갔다 (퇴장 알림). 이미 닫혔으면 그대로 둔다 (같은 알림이 두 번 와도 같다).
// 입장 알림을 놓쳤으면 통화 서버가 알려 준 들어온 시각으로 기록을 만든다.
// create=false: 연결이 처음부터 안 된 사람(participant_connection_aborted)은 들어온 적이 없으면 기록하지 않는다
export function noteLeft(a: Attendance, s: Seen, at: number, create = true) {
  const v = findVisit(a, s.sid);
  if (v) {
    if (v.to === undefined) v.to = Math.max(v.from, at);
    return;
  }
  if (!create) return;
  const p = personOf(a, s);
  const from = Math.min(s.joinedAt || at, at);
  p.visits.push({ sid: s.sid, from, to: at, seen: at });
  trim(p);
}

// 1분 점검: 방에 실제로 있는 사람(present)과 맞춘다. 퇴장 알림을 놓쳐 열린 채 남은 기록은 마지막으로 확인한 때 나간 것으로 닫는다
export function reconcile(a: Attendance, present: Seen[], now: number) {
  const here = new Set(present.map((s) => s.sid));
  for (const s of present) notePresent(a, s, now);
  for (const p of Object.values(a.people)) for (const v of p.visits) if (v.to === undefined && !here.has(v.sid)) v.to = v.seen;
}

export const hasOpenVisit = (a: Attendance) => Object.values(a.people).some((p) => p.visits.some((v) => v.to === undefined));

// 열린 기록이 어디까지인지: 최근에 확인했으면 지금까지, 오래 확인하지 못했으면 마지막 확인까지
const endOf = (v: Visit, now: number) => v.to ?? (now - v.seen < STALE ? now : v.seen);

// 겹친 구간(탭 두 개 등)은 한 번만 센다
export function unionMs(spans: [number, number][]) {
  const sorted = spans.filter(([f, t]) => t > f).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curF = -Infinity;
  let curT = -Infinity;
  for (const [f, t] of sorted) {
    if (f > curT) {
      if (curT > curF) total += curT - curF;
      curF = f;
      curT = t;
    } else curT = Math.max(curT, t);
  }
  if (curT > curF) total += curT - curF;
  return total;
}

export type AttendRow = { name: string; dormsName: string; host: boolean; first: number; last: number; ms: number; visits: number; here: boolean };
export type AttendSummary = { title: string; startsAt: string; endsAt: string; count: number; here: number; rows: AttendRow[] };

// 여는 선생님에게 보여 줄 표. 들어온 순서대로, 여는 선생님은 맨 위에 두고 인원에서 뺀다
export function summarize(a: Attendance, now: number): AttendSummary {
  const rows: AttendRow[] = Object.values(a.people)
    .filter((p) => p.visits.length)
    .map((p) => {
      const spans = p.visits.map((v) => [v.from, endOf(v, now)] as [number, number]);
      return {
        name: p.name,
        dormsName: p.dormsName,
        host: !!p.dorms && p.dorms === a.host,
        first: Math.min(...spans.map((s) => s[0])),
        last: Math.max(...spans.map((s) => s[1])),
        ms: unionMs(spans),
        visits: p.visits.length,
        here: p.visits.some((v) => v.to === undefined && now - v.seen < STALE),
      };
    })
    .sort((x, y) => Number(y.host) - Number(x.host) || x.first - y.first);
  const guests = rows.filter((r) => !r.host);
  return { title: a.title, startsAt: a.startsAt, endsAt: a.endsAt, count: guests.length, here: guests.filter((r) => r.here).length, rows };
}

// 화면·표에 쓰는 한국 시각과 머문 시간
export const kstClock = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(11, 16);
export const kstDate = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
export function duration(ms: number) {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "1분 안 됨";
  const h = Math.floor(min / 60);
  return h ? `${h}시간 ${min % 60}분` : `${min}분`;
}

// 내려받는 표 (엑셀에서 한글이 깨지지 않게 BOM 을 붙인다). 칸 안의 쉼표·따옴표·줄바꿈은 따옴표로 감싸고,
// 엑셀이 수식으로 읽지 않게 = + - @ 로 시작하는 이름 앞에 ' 를 붙인다
const cell = (s: string | number) => {
  let t = String(s);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
export function toCsv(s: AttendSummary) {
  const head = ["입장 이름", "도름스 이름", "구분", "처음 들어온 시각", "마지막으로 나간 시각", "머문 시간(분)", "들어온 횟수", "지금 있음"];
  const lines = s.rows.map((r) => [
    r.name, r.dormsName, r.host ? "여는 선생님" : "참석",
    `${kstDate(r.first)} ${kstClock(r.first)}`, r.here ? "" : `${kstDate(r.last)} ${kstClock(r.last)}`,
    Math.floor(r.ms / 60_000), r.visits, r.here ? "예" : "",
  ].map(cell).join(","));
  return "﻿" + [head.join(","), ...lines].join("\r\n") + "\r\n";
}
