import { readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildView, COMP_IDS, confirm, effective, parseNotes, readSaved, recordGap, trackAuto, worst, addMinutes, type CompId, type Lv, type Notes, type Saved } from "@/lib/statusCore";

// 상태 페이지(/status)의 점검과 기록. 웹 서버 안에서 1분마다 기능별로 점검하고 server/config/status-history.json 에 남긴다.
// 시작은 instrumentation.ts 가 서버를 켤 때 한 번 한다 (페이지를 먼저 열면 그때 시작한다).
// 운영자가 적는 사건·점검 예정은 server/config/status-notes.json (SSH로 고친다. 요청마다 다시 읽는다. 예시: server/linux/status-notes.example.json)
//
// 점검하는 것 (사용자 쪽에서 보이는 기능 이름으로 나눈다)
//   웹 화면      바깥 주소(DORMS_SITE_URL)로 /api/health/ping 을 불러 Caddy·인증서·웹을 함께 본다. 2초 넘으면 느림
//   음성·카메라  통화 서버(LiveKit) http://127.0.0.1:7880/ 이 OK 를 주는지. 1초 넘으면 느림. 화면공유도 같은 서버라 같은 결과
//   채팅         웹과 통화 서버 중 나쁜 쪽 (채팅은 둘 다 써야 된다)
//   글 읽기      목소리 모델 파일이 있는지 + 최근 15분 동안 실제로 만든 시간 (lib/voice.ts 가 noteTts 로 알려 준다). 한 문장 평균 3초 넘으면 느림
//   도름스 로그인 도름스 로그인 열쇠 주소(JWKS). 3초 넘으면 느림. 도름네이션도 같은 도름스라 같은 결과
const CONFIG = path.join(process.cwd(), "..", "..", "server", "config");
const HISTORY = path.join(CONFIG, "status-history.json");
const NOTES = path.join(CONFIG, "status-notes.json");
const MODELS = path.join(process.cwd(), "models", "supertonic");
const DORMS_JWKS = "https://dorms.school/api/sso/jwks"; // lib/dormsLogin.ts 의 DORMS_JWKS_URL 과 같은 주소 (운영 주소만 본다)
const EVERY = 60_000;

type TtsSample = { at: number; ms: number; ok: boolean };
type State = { saved?: Saved; timer?: ReturnType<typeof setInterval>; running: boolean; tts: TtsSample[]; warned: Set<string> };
// 서버 시작(instrumentation)과 페이지·api 가 따로 묶여도 같은 기록을 보게 globalThis 에 둔다 (lib/chat.ts 와 같은 방법)
const g = globalThis as unknown as { doliveStatus?: State };
const state: State = (g.doliveStatus ??= { running: false, tts: [], warned: new Set() });

function warnOnce(key: string, message: string) {
  if (state.warned.has(key)) return;
  state.warned.add(key);
  console.warn(`[status] ${message}`);
}
const read = (file: string) => { try { return readFileSync(file, "utf8"); } catch { return undefined; } };
function readNotes(): Notes {
  const { notes, error } = parseNotes(read(NOTES));
  if (error) warnOnce(`notes:${error}`, error);
  return notes;
}
function save(s: Saved) {
  try {
    const tmp = `${HISTORY}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s));
    renameSync(tmp, HISTORY); // 쓰다가 꺼져도 반쯤 쓴 파일이 남지 않게
  } catch (e) {
    warnOnce("save", `기록을 저장하지 못했습니다: ${(e as Error).message}`);
  }
}

// 글 읽기 한 문장을 만든 시간 (lib/voice.ts). 실패도 알려 준다
export function noteTts(ms: number, ok: boolean) {
  state.tts.push({ at: Date.now(), ms, ok });
  if (state.tts.length > 50) state.tts.splice(0, state.tts.length - 50);
}

async function timed(url: string | URL) {
  const t = Date.now();
  try {
    const r = await fetch(url, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(8000) });
    await r.arrayBuffer().catch(() => {});
    return { ok: r.ok, ms: Date.now() - t };
  } catch {
    return { ok: false, ms: Date.now() - t };
  }
}
const grade = (r: { ok: boolean; ms: number }, slow: number): Lv => (!r.ok ? "major" : r.ms > slow ? "minor" : "ok");

async function webCheck(): Promise<Lv> {
  const local = `http://127.0.0.1:${process.env.PORT || 3000}/api/health/ping`;
  const site = process.env.DORMS_SITE_URL?.trim();
  if (!site || process.env.NODE_ENV !== "production") return grade(await timed(local), 2000);
  const outside = await timed(new URL("/api/health/ping", site));
  if (outside.ok) return grade(outside, 2000);
  // 바깥 길은 막혔는데 웹은 살아 있다: Caddy·인증서·주소 쪽 문제거나 이 서버에서 자기 주소로 못 나가는 경우. 일부 장애로 본다
  return (await timed(local)).ok ? "minor" : "major";
}
function ttsCheck(now: number): Lv {
  let files: string[] = [];
  try { files = readdirSync(MODELS); } catch {}
  if (!files.some((f) => f.endsWith(".onnx"))) return "major";
  const recent = state.tts.filter((x) => now - x.at < 15 * 60_000);
  if (!recent.length) return "ok"; // 최근에 아무도 안 썼으면 모델 파일만 본다
  if (!recent[recent.length - 1].ok) return "major";
  const ok = recent.filter((x) => x.ok);
  return ok.reduce((a, x) => a + x.ms, 0) / ok.length > 3000 ? "minor" : "ok";
}
async function probe(now: number): Promise<Record<CompId, Lv>> {
  const [web, voice, login] = await Promise.all([webCheck(), timed("http://127.0.0.1:7880/").then((r) => grade(r, 1000)), timed(DORMS_JWKS).then((r) => grade(r, 3000))]);
  return { web, voice, share: voice, chat: worst(web, voice), tts: ttsCheck(now), login, donation: login };
}

async function tick() {
  const s = state.saved;
  if (!s || state.running) return;
  state.running = true;
  try {
    const raw = await probe(Date.now());
    const now = Date.now();
    const notes = readNotes();
    const auto = confirm(s, raw);
    const cur = effective(auto, notes, now);
    for (const c of COMP_IDS) addMinutes(s, now, c, cur[c]);
    trackAuto(s, auto, now, new Set(COMP_IDS.filter((c) => cur[c] === "maint")));
    s.last = now;
    // 120일 넘은 날은 지운다 (화면은 90일만 쓴다)
    const keep = new Date(now - 120 * 86_400_000).toISOString().slice(0, 10);
    for (const k of Object.keys(s.days)) if (k < keep) delete s.days[k];
    save(s);
  } catch (e) {
    warnOnce(`tick:${(e as Error).message}`, `점검 중 오류: ${(e as Error).message}`);
  } finally {
    state.running = false;
  }
}

// 서버를 켤 때 한 번. 웹 빌드 중에는 시작하지 않는다
export function startStatus() {
  if (state.saved || process.env.NEXT_PHASE === "phase-production-build") return;
  const now = Date.now();
  const s = (state.saved = readSaved(read(HISTORY), now));
  if (recordGap(s, now, readNotes())) s.last = now; // 꺼져 있던 시간을 적었으면 지금까지 적은 것으로 둔다
  save(s);
  setTimeout(() => void tick(), 15_000).unref?.(); // 웹이 요청을 받을 준비가 된 뒤 첫 점검
  state.timer = setInterval(() => void tick(), EVERY);
  state.timer.unref?.();
}

export function statusView() {
  startStatus();
  const now = Date.now();
  return buildView(state.saved ?? readSaved(undefined, now), readNotes(), now);
}
