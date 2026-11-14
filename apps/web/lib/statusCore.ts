// 상태 페이지(/status)의 계산만 모은 곳. 파일·네트워크를 쓰지 않아서 tests/status.cjs 가 그대로 돌려 본다.
// 실제 점검·저장은 lib/status.ts 가 한다.
//
// 가동률은 Atlassian Statuspage 방식을 따른다: (장애 분 + 느림 분 x 0.3) 을 기록한 전체 분에서 뺀 비율.
// 점검 중인 시간은 빼지 않는다. 날짜는 한국 시간(UTC+9, 서머타임 없음)으로 나눈다.

export type Lv = "ok" | "minor" | "major" | "maint";
export type CompId = "web" | "voice" | "share" | "chat" | "tts" | "login" | "donation";

export const COMPS: { id: CompId; name: string; desc: string }[] = [
  { id: "web", name: "웹 화면", desc: "dolive.site 열기, 입장 화면, 방송 목록" },
  { id: "voice", name: "음성·카메라", desc: "대화와 얼굴 보기를 맡는 통화 서버" },
  { id: "share", name: "화면공유", desc: "방장 공유와 허락받은 공유. 음성·카메라와 같은 통화 서버를 씁니다" },
  { id: "chat", name: "채팅", desc: "글·사진·링크·반응. 웹과 통화 서버가 모두 되어야 합니다" },
  { id: "tts", name: "글 읽기", desc: "채팅을 목소리로 읽기 (서연·하은·민준·마왕)" },
  { id: "login", name: "도름스 로그인", desc: "도름스 계정으로 입장" },
  { id: "donation", name: "도름네이션", desc: "도름스 연결 후원. 도름스 로그인과 같은 서버를 씁니다" },
];
export const COMP_IDS = COMPS.map((c) => c.id);
export const compName = (id: CompId) => COMPS.find((c) => c.id === id)?.name ?? id;

export const LONG: Record<Lv | "none", string> = { ok: "정상", minor: "느림", major: "장애", maint: "점검 중", none: "기록 없음" };
const RANK: Record<Lv, number> = { ok: 0, maint: 1, minor: 2, major: 3 };
export const worst = (...list: Lv[]): Lv => list.reduce<Lv>((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");
const isLv = (v: unknown): v is Lv => v === "ok" || v === "minor" || v === "major" || v === "maint";
const isComp = (v: unknown): v is CompId => COMP_IDS.includes(v as CompId);

const MIN = 60_000;
const KST = 9 * 3600_000;
export const dayKey = (t: number) => new Date(t + KST).toISOString().slice(0, 10);
export const hhmm = (t: number) => new Date(t + KST).toISOString().slice(11, 16);
const WEEK = "일월화수목금토";
export function dayLabel(key: string) {
  const d = new Date(`${key}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEK[d.getUTCDay()]})`;
}
// 오늘(한국 시간)까지 n일의 날짜, 오래된 날부터
export function lastDays(now: number, n: number) {
  const today = Date.parse(`${dayKey(now)}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(today - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

// 받침에 맞는 조사 (이/가, 은/는). 한글이 아니면 받침 없는 쪽
export function josa(word: string, withFinal: string, without: string) {
  const c = word.charCodeAt(word.length - 1);
  const final = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 > 0;
  return word + (final ? withFinal : without);
}

// 하루 한 기능의 기록: [정상, 느림, 장애, 점검] 분
export type Bucket = [number, number, number, number];
const SLOT: Record<Lv, number> = { ok: 0, minor: 1, major: 2, maint: 3 };

export type Update = { at: number; state: string; text: string };
export type Incident = { id: string; title: string; impact: Lv; comps: CompId[]; start: number; end?: number; updates: Update[]; auto?: boolean };
export type Maint = { id: string; title: string; comps: CompId[]; start: number; end: number; text: string };
export type Notes = { incidents: Incident[]; maintenance: Maint[] };

// status-history.json 에 남기는 모양
export type Saved = {
  v: 1;
  since: number; // 기록을 처음 시작한 때
  last: number; // 마지막으로 점검한 때. 웹이 꺼져 있던 시간을 알아내는 데 쓴다
  days: Record<string, Partial<Record<CompId, Bucket>>>;
  events: Incident[]; // 자동으로 만든 사건
  seen: Partial<Record<CompId, { lv: Lv; n: number }>>; // 같은 결과가 몇 번 이어졌나
  auto: Partial<Record<CompId, Lv>>; // 두 번 이어져서 확정한 자동 점검 결과
};
export const emptySaved = (now: number): Saved => ({ v: 1, since: now, last: 0, days: {}, events: [], seen: {}, auto: {} });

export function readSaved(text: string | undefined, now: number): Saved {
  try {
    const s = JSON.parse(text ?? "") as Saved;
    if (s && s.v === 1 && typeof s.since === "number" && s.days && Array.isArray(s.events)) return { ...emptySaved(now), ...s };
  } catch {}
  return emptySaved(now);
}

export function addMinutes(s: Saved, t: number, comp: CompId, lv: Lv, n = 1) {
  const day = (s.days[dayKey(t)] ??= {});
  const b = (day[comp] ??= [0, 0, 0, 0]);
  b[SLOT[lv]] += n;
}

// 한 번 실패로 바로 장애라고 하지 않는다. 같은 결과가 두 번(약 2분) 이어지면 바꾼다. 나아질 때도 똑같이
export function confirm(s: Saved, raw: Record<CompId, Lv>) {
  for (const c of COMP_IDS) {
    const prev = s.seen[c];
    const seen = prev && prev.lv === raw[c] ? { lv: raw[c], n: prev.n + 1 } : { lv: raw[c], n: 1 };
    s.seen[c] = seen;
    if (seen.n >= 2) s.auto[c] = seen.lv;
    else s.auto[c] ??= "ok";
  }
  return s.auto as Record<CompId, Lv>;
}

const activeMaint = (notes: Notes, now: number) => notes.maintenance.filter((m) => m.start <= now && now < m.end);
const activeManual = (notes: Notes) => notes.incidents.filter((i) => i.end === undefined);

// 기능마다 지금 보여 줄 상태: 점검 시간이면 점검, 아니면 자동 점검과 운영자가 적은 진행 중 사건 중 나쁜 쪽
export function effective(auto: Partial<Record<CompId, Lv>>, notes: Notes, now: number) {
  const maint = new Set(activeMaint(notes, now).flatMap((m) => m.comps));
  const manual = activeManual(notes);
  const out = {} as Record<CompId, Lv>;
  for (const c of COMP_IDS) {
    if (maint.has(c)) out[c] = "maint";
    else out[c] = worst(auto[c] ?? "ok", ...manual.filter((i) => i.comps.includes(c)).map((i) => i.impact));
  }
  return out;
}

const names = (comps: CompId[]) => comps.map(compName).join(", ");
const minutes = (ms: number) => Math.max(1, Math.round(ms / MIN));
export const autoTitle = (comps: CompId[], impact: Lv) => `${josa(names(comps), "이", "가")} ${impact === "major" ? "되지 않습니다" : "느립니다"}`;

// 자동 사건: 문제가 생기면 열고, 문제가 늘거나 바뀌면 소식을 붙이고, 모두 정상이 되면 닫는다. 점검 중인 기능은 빼고 본다
export function trackAuto(s: Saved, auto: Record<CompId, Lv>, now: number, maint: Set<CompId>) {
  const bad = COMP_IDS.filter((c) => !maint.has(c) && (auto[c] === "minor" || auto[c] === "major"));
  const impact = worst(...bad.map((c) => auto[c]));
  const open = s.events.find((e) => e.end === undefined);
  if (!open && bad.length) {
    s.events.push({
      id: `auto-${now}`,
      title: autoTitle(bad, impact),
      impact,
      comps: bad,
      start: now,
      auto: true,
      updates: [{ at: now, state: "확인 중", text: `자동 점검에서 ${josa(names(bad), "이", "가")} ${impact === "major" ? "응답하지 않는" : "평소보다 느린"} 것을 찾았습니다. 원인을 확인하고 있습니다.` }],
    });
  } else if (open && bad.length) {
    const added = bad.filter((c) => !open.comps.includes(c));
    const worse = impact !== open.impact && worst(impact, open.impact) === impact;
    if (added.length || worse) {
      open.comps = [...open.comps, ...added];
      open.impact = worst(open.impact, impact);
      open.title = autoTitle(open.comps, open.impact);
      open.updates.unshift({ at: now, state: "확인 중", text: `${josa(names(bad), "이", "가")} 지금 ${impact === "major" ? "되지 않습니다" : "느립니다"}.` });
    }
  } else if (open && !bad.length) {
    open.end = now;
    open.updates.unshift({ at: now, state: "해결", text: `자동 점검에서 다시 정상으로 확인했습니다. ${minutes(now - open.start)}분 동안 영향이 있었습니다.` });
  }
  s.events = s.events.filter((e) => e.end === undefined || now - e.end < 100 * 86_400_000);
}

// 웹 서버가 꺼져 있던 시간. 마지막 점검에서 3분 넘게 지났으면 그동안 웹 화면·채팅·글 읽기를 장애로 적는다
// (같은 프로세스라 함께 멈춘다. 통화 서버와 도름스는 따로 돌아서 알 수 없으니 적지 않는다). 점검 시간 안이면 점검으로 적는다.
// 업데이트로 다시 켜는 1분 안팎은 세지 않는다.
const GAP_COMPS: CompId[] = ["web", "chat", "tts"];
export function recordGap(s: Saved, now: number, notes: Notes) {
  if (!s.last || now - s.last <= 3 * MIN) return 0;
  const from = Math.max(s.last + MIN, now - 7 * 86_400_000);
  let down = 0;
  for (let t = from; t < now; t += MIN) {
    const maint = new Set(activeMaint(notes, t).flatMap((m) => m.comps));
    for (const c of GAP_COMPS) addMinutes(s, t, c, maint.has(c) ? "maint" : "major");
    if (!GAP_COMPS.every((c) => maint.has(c))) down++;
  }
  if (down >= 3) {
    s.events.push({
      id: `gap-${now}`,
      title: "웹 서버가 멈춰 있었습니다",
      impact: "major",
      comps: GAP_COMPS,
      start: from,
      end: now,
      auto: true,
      updates: [{ at: now, state: "해결", text: `웹 서버가 ${hhmm(from)}부터 ${hhmm(now)}까지 ${down}분 동안 응답하지 않았습니다. 다시 켜져서 정상으로 돌아왔습니다.` }],
    });
  }
  return down;
}

// 운영자가 SSH로 적는 server/config/status-notes.json. 틀린 항목은 건너뛴다
export function parseNotes(text: string | undefined): { notes: Notes; error?: string } {
  const empty: Notes = { incidents: [], maintenance: [] };
  if (!text?.trim()) return { notes: empty };
  let raw: { incidents?: unknown[]; maintenance?: unknown[] };
  try {
    raw = JSON.parse(text);
  } catch {
    return { notes: empty, error: "status-notes.json 을 읽지 못했습니다 (JSON 모양 확인)" };
  }
  const time = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const comps = (v: unknown) => (Array.isArray(v) ? v.filter(isComp) : []);
  const incidents: Incident[] = [];
  for (const [i, x] of (Array.isArray(raw?.incidents) ? raw.incidents : []).entries()) {
    const o = (x ?? {}) as Record<string, unknown>;
    const updates = (Array.isArray(o.updates) ? o.updates : [])
      .map((u) => { const p = (u ?? {}) as Record<string, unknown>; return { at: time(p.at), state: str(p.state) || "소식", text: str(p.text) }; })
      .filter((u) => !Number.isNaN(u.at) && u.text)
      .sort((a, b) => b.at - a.at);
    const end = o.resolved === undefined ? undefined : time(o.resolved);
    const impact = isLv(o.impact) ? o.impact : "minor";
    if (!str(o.title) || !updates.length || (end !== undefined && Number.isNaN(end))) continue;
    incidents.push({ id: str(o.id) || `note-${i}`, title: str(o.title), impact, comps: comps(o.components), start: updates[updates.length - 1].at, end, updates });
  }
  const maintenance: Maint[] = [];
  for (const [i, x] of (Array.isArray(raw?.maintenance) ? raw.maintenance : []).entries()) {
    const o = (x ?? {}) as Record<string, unknown>;
    const start = time(o.start), end = time(o.end);
    if (!str(o.title) || Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
    maintenance.push({ id: str(o.id) || `maint-${i}`, title: str(o.title), comps: comps(o.components), start, end, text: str(o.text) });
  }
  return { notes: { incidents, maintenance } };
}

// ───────── 화면에 보낼 모양 ─────────
export type DayView = { key: string; lv: Lv | "none"; up: number | null; mins: Bucket | null; titles: string[] };
export type CompView = { id: CompId; name: string; desc: string; lv: Lv; days: DayView[]; up90: number | null; up30: number | null };
export type IncView = { id: string; title: string; impact: Lv; comps: string; span: string; open: boolean; auto: boolean; updates: { at: string; state: string; text: string }[] };
export type StatusView = {
  lv: Lv | "none";
  text: string;
  checked: string | null; // 마지막 점검 시각 (한국 시간 "11월 10일 (화) 21:50")
  stale: boolean; // 3분 넘게 점검하지 못함
  since: string;
  comps: CompView[];
  open: IncView[];
  planned: { title: string; comps: string; span: string; text: string; now: boolean }[];
  past: { key: string; label: string; items: IncView[] }[];
};

// 90일 막대에 올리면 보이는 설명 (상태 페이지와 방송 상태 창이 같이 쓴다)
export function dayTip(d: DayView) {
  const lines = [dayLabel(d.key), d.lv === "none" ? "기록 없음" : `${LONG[d.lv]}${d.up === null ? "" : ` · ${d.up}%`}`];
  if (d.mins) {
    const parts = [["장애", d.mins[2]], ["느림", d.mins[1]], ["점검", d.mins[3]]].filter(([, m]) => +m > 0).map(([t, m]) => `${t} ${m}분`);
    if (parts.length) lines.push(parts.join(" · "));
  }
  return [...lines, ...d.titles].join("\n");
}

const upOf = (b: Bucket) => {
  const total = b[0] + b[1] + b[2] + b[3];
  return total ? Math.max(0, 1 - (b[2] + b[1] * 0.3) / total) * 100 : null;
};
const sum = (list: (Bucket | undefined)[]) => list.reduce<Bucket>((a, b) => (b ? [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]] : a), [0, 0, 0, 0]);
// 하루 막대 색: 장애 5분 이상이면 빨강, 그보다 짧은 장애나 느림은 노랑, 점검만 있었으면 파랑
export function dayLevel(b: Bucket | undefined): Lv | "none" {
  if (!b || b[0] + b[1] + b[2] + b[3] === 0) return "none";
  if (b[2] >= 5) return "major";
  if (b[2] > 0 || b[1] > 0) return "minor";
  if (b[3] > 0) return "maint";
  return "ok";
}
const round2 = (n: number | null) => (n === null ? null : Math.floor(n * 100) / 100);

function spanText(i: Incident) {
  const day = (t: number) => dayLabel(dayKey(t)).replace(/ \(.\)$/, "");
  const start = `${day(i.start)} ${hhmm(i.start)}`;
  if (i.end === undefined) return `${start}부터`;
  const same = dayKey(i.start) === dayKey(i.end);
  return `${start} ~ ${same ? "" : `${day(i.end)} `}${hhmm(i.end)} (${minutes(i.end - i.start)}분)`;
}
const incView = (i: Incident): IncView => ({
  id: i.id,
  title: i.title,
  impact: i.impact,
  comps: names(i.comps),
  span: spanText(i),
  open: i.end === undefined,
  auto: !!i.auto,
  updates: i.updates.map((u) => ({ at: `${dayLabel(dayKey(u.at)).replace(/ \(.\)$/, "")} ${hhmm(u.at)}`, state: u.state, text: u.text })),
});

export function buildView(s: Saved, notes: Notes, now: number, current?: Record<CompId, Lv>): StatusView {
  const keys = lastDays(now, 90);
  const all = [...s.events, ...notes.incidents];
  const titlesOn = (key: string, c: CompId) => all.filter((i) => i.comps.includes(c) && dayKey(i.start) <= key && (i.end === undefined ? key <= dayKey(now) : key <= dayKey(i.end))).map((i) => i.title);
  const stale = !s.last || now - s.last > 3 * MIN;
  const cur = current ?? effective(s.auto, notes, now);
  const comps: CompView[] = COMPS.map((c) => {
    const days = keys.map((key) => {
      const b = s.days[key]?.[c.id];
      const lv = dayLevel(b);
      return { key, lv, up: b ? round2(upOf(b)) : null, mins: b ?? null, titles: lv === "none" ? [] : titlesOn(key, c.id) };
    });
    const span = (n: number) => round2(upOf(sum(keys.slice(-n).map((k) => s.days[k]?.[c.id]))));
    return { ...c, lv: cur[c.id], days, up90: span(90), up30: span(30) };
  });
  const lv = stale ? "none" : worst(...comps.map((c) => c.lv));
  const text = stale
    ? "상태를 확인하지 못하고 있습니다"
    : { ok: "모든 기능이 정상입니다", minor: "일부 기능이 느립니다", major: "일부 기능이 되지 않습니다", maint: "점검 중입니다" }[lv as Lv];
  const open = all.filter((i) => i.end === undefined).sort((a, b) => b.start - a.start).map((i) => incView(i));
  const planned = notes.maintenance
    .filter((m) => m.end > now)
    .sort((a, b) => a.start - b.start)
    .map((m) => ({ title: m.title, comps: names(m.comps), span: `${dayLabel(dayKey(m.start))} ${hhmm(m.start)} ~ ${dayKey(m.start) === dayKey(m.end) ? "" : `${dayLabel(dayKey(m.end))} `}${hhmm(m.end)}`, text: m.text, now: m.start <= now }));
  // 기록을 시작하기 전 날은 '문제 없음'이라고 하지 않도록 뺀다
  const past = keys.slice(-15).filter((key) => key >= dayKey(s.since)).reverse().map((key) => ({
    key,
    label: dayLabel(key),
    items: all.filter((i) => i.end !== undefined && dayKey(i.end) === key).sort((a, b) => b.start - a.start).map((i) => incView(i)),
  }));
  const label = (t: number) => `${dayLabel(dayKey(t))} ${hhmm(t)}`;
  return { lv, text, checked: s.last ? label(s.last) : null, stale, since: dayLabel(dayKey(s.since)), comps, open, planned, past };
}
