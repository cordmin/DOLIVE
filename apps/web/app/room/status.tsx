import { useDataChannel, useRoomContext, type TrackReference } from "@livekit/components-react";
import { ConnectionQuality, type Participant, type RemoteVideoTrack } from "livekit-client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { REASON, diagnose, type Level } from "@/lib/shareHealth";
import { STATUS_TOPIC, TICK, lastLocalReport, type ShareReport } from "./share-report";

// 관리자 배지를 누르면 뜨는 "방송 상태" 창 (시안: docs/시안/상태판_A2.png, 2026-11-11 사용자 선택).
// 송출자 칸: 송출자 브라우저가 2초마다 재서 이 방 관리자에게만 보낸다 (share-report.ts 의 useShareHealth). 받는 쪽은 지금 공유 화면 주인이 보낸 것만 쓴다.
// 보는 사람 칸: 내(관리자) 화면이 받는 값 + 모두의 연결 품질. 서버 칸: api/status (관리자 아니면 서버가 거절)

type Server = { cpu: number; cores: number; memUsed: number; memTotal: number; uptime: number; rooms: number; people: number };
type Seen = { w?: number; h?: number; fps: number; mbps: number; dropped: number };

const SURFACE: Record<string, string> = { monitor: "전체 화면", window: "창", browser: "크롬 탭" };
const QUALITY_NAME: (string | undefined)[] = ["좋음", "보통", "나쁨"];
const quality = (p: Participant) =>
  p.connectionQuality === ConnectionQuality.Excellent ? 0 : p.connectionQuality === ConnectionQuality.Good ? 1 : p.connectionQuality === ConnectionQuality.Unknown ? -1 : 2;
const INK: Record<Level, string> = { g: "text-[#7ed957]", a: "text-[#e8b46a]", r: "text-[#ff6b5e]" };
const LED: Record<Level, string> = { g: "hw-led-green", a: "hw-led-amber", r: "hw-led-red" };
const gb = (b: number) => (b / 1024 ** 3).toFixed(1);
// 세로 크기에서 가장 가까운 이름으로만 보여 준다 (1600x900 → 1080p)
const res = (h?: number) => (!h ? "-" : h >= 900 ? "1080p" : h >= 540 ? "720p" : "360p");

function Row({ k, children, level }: { k: string; children: ReactNode; level?: Level }) {
  return (
    <div className="flex justify-between gap-2 border-b border-white/[.03] text-[12.5px] leading-[25px]">
      <span className="whitespace-nowrap text-[#a39f98]">{k}</span>
      <span className={`text-right font-semibold whitespace-nowrap ${level ? INK[level] : ""}`}>{children}</span>
    </div>
  );
}

function Section({ title, who, level, children }: { title: string; who?: string; level?: Level; children: ReactNode }) {
  return (
    <section className="hw-inset mb-2.5 rounded-[10px] bg-[#1e1e21] px-3.5 pt-3 pb-2.5">
      <h3 className="mb-2 flex items-center gap-[7px] text-[13px] font-semibold">
        <span className={`hw-led ${level ? LED[level] : ""}`} />
        {title}
        {who && <span className="font-normal text-[#a39f98]">· {who}</span>}
      </h3>
      {children}
    </section>
  );
}

export function StatusDialog({ token, participants, screen, close }: { token: string; participants: Participant[]; screen?: TrackReference; close: () => void }) {
  const room = useRoomContext();
  const dlg = useRef<HTMLDialogElement>(null);
  const [got, setGot] = useState<{ from: string; report: ShareReport | null } | null>(null); // 누가 보낸 값인지 같이 둔다
  const [server, setServer] = useState<Server | null>(null);
  const [seenOf, setSeen] = useState<{ sid: string; seen: Seen } | null>(null);
  const sharer = screen?.participant;
  // 방 화면이 다시 그려질 때마다 screen 객체가 새로 만들어져서, 2초 재기는 공유 화면이 바뀔 때만 새로 시작한다
  const screenNow = useRef(screen);
  useEffect(() => {
    screenNow.current = screen;
  });
  const sid = screen?.publication.trackSid;
  // 공유하는 사람이 바뀌면 앞사람 값은 쓰지 않는다
  const report = sharer && got?.from === sharer.identity ? got.report : null;
  const seen = sid && seenOf?.sid === sid ? seenOf.seen : null;

  useEffect(() => {
    dlg.current?.showModal();
  }, []);

  useDataChannel(STATUS_TOPIC, (msg) => {
    if (!sharer || msg.from?.identity !== sharer.identity) return; // 지금 공유 화면 주인이 보낸 것만
    try {
      setGot({ from: sharer.identity, report: JSON.parse(new TextDecoder().decode(msg.payload)) });
    } catch {}
  });

  useEffect(() => {
    let prev: { t: number; frames: number; bytes: number } | null = null;
    const drops: number[] = []; // 최근 10초 (2초씩 5칸)
    let lastDropped = 0;
    const tick = async () => {
      const screen = screenNow.current;
      fetch("/api/status", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ room: room.name }) })
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => setServer(s))
        .catch(() => setServer(null));
      if (screen?.participant.isLocal) {
        setGot({ from: screen.participant.identity, report: lastLocalReport() });
        return;
      }
      const t = screen?.publication.videoTrack as RemoteVideoTrack | undefined;
      const s = await t?.getReceiverStats().catch(() => undefined);
      if (!s) return;
      const now = Date.now();
      const dt = prev ? (now - prev.t) / 1000 : 0;
      if (prev) drops.push(Math.max(0, s.framesDropped - lastDropped));
      while (drops.length > 5) drops.shift();
      lastDropped = s.framesDropped;
      if (screen) setSeen({ sid: screen.publication.trackSid, seen: {
        w: s.frameWidth,
        h: s.frameHeight,
        fps: dt && prev ? Math.round((s.framesDecoded - prev.frames) / dt) : 0,
        mbps: dt && prev ? Math.max(0, ((s.bytesReceived ?? 0) - prev.bytes) * 8 / dt / 1e6) : 0,
        dropped: drops.reduce((a, b) => a + b, 0),
      } });
      prev = { t: now, frames: s.framesDecoded, bytes: s.bytesReceived ?? 0 };
    };
    tick();
    const iv = setInterval(tick, TICK);
    return () => clearInterval(iv);
  }, [room, token, sid]);


  const viewers = participants.filter((p) => p.identity !== sharer?.identity);
  const counts = [0, 1, 2].map((q) => viewers.filter((p) => quality(p) === q));
  const sharerQ = sharer ? quality(sharer) : -1;
  const d = diagnose({ sharing: !!sharer, recent: report?.recent, sharerPoor: sharerQ === 2, serverCpu: server?.cpu, poorViewers: counts[2].length });

  const sharerLevel: Level | undefined = !report ? undefined : report.recent.cpu >= 0.3 || report.recent.bandwidth >= 0.3 || sharerQ === 2 ? "a" : "g";
  const viewerLevel: Level = counts[2].length ? "a" : "g";
  const serverLevel: Level | undefined = !server ? undefined : server.cpu >= 85 || server.memUsed / server.memTotal >= 0.9 ? "r" : server.cpu >= 70 || server.memUsed / server.memTotal >= 0.8 ? "a" : "g";
  const short = (got?: number, want?: number): Level | undefined => (got !== undefined && want && got < want * 0.9 ? "a" : undefined);
  const LAYER = ["원본", "중간", "낮음"];

  return (
    <dialog
      ref={dlg}
      onClose={close}
      onClick={(e) => e.target === e.currentTarget && dlg.current?.close()}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(560px,calc(100vw-32px))] max-w-none overflow-y-auto rounded-[14px] bg-[#141416] px-[18px] pt-[22px] pb-[18px] text-[#d6d3cd] shadow-[0_0_0_1px_#000,0_0_0_2px_#ffffff14,0_12px_30px_#000a] outline-none backdrop:bg-black/60"
    >
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[22px] font-bold tracking-tight text-[#d3d0ca]">
          DO<span className="text-red-500">LIVE</span>
        </span>
        <span className="translate-y-px rounded-[3px] border border-[#e8b46a]/40 px-1.5 text-[11px] leading-[17px] text-[#e8b46a]">관리자</span>
        <span className="ml-1 text-[15px] font-semibold">방송 상태</span>
      </div>

      <div className="hw-inset mb-3 flex gap-2.5 rounded-[10px] bg-[#1e1e21] px-3.5 py-3 text-[13px] leading-[1.55]">
        <span className={`hw-led mt-1.5 shrink-0 ${LED[d.level]}`} />
        <div>
          <p>
            <b className={`font-semibold ${INK[d.level]}`}>{d.head}</b>
            {d.level === "g" ? "." : d.head.includes("송출자") ? " 화질과 프레임이 떨어질 수 있어요." : " 화면이 끊길 수 있어요."}
          </p>
          <p className="mt-0.5 text-xs text-[#a39f98]">{d.tip}</p>
        </div>
      </div>

      <Section title="송출자" who={sharer ? sharer.name || sharer.identity : undefined} level={sharerLevel}>
        {!sharer ? (
          <p className="py-6 text-center text-[13px] text-[#a39f98]">지금 화면공유하는 사람이 없어요</p>
        ) : !report ? (
          <p className="py-6 text-center text-[13px] text-[#a39f98]">송출자 브라우저에서 값을 기다리는 중이에요</p>
        ) : (
          <>
            <table className="mt-0.5 mb-2 w-full border-collapse text-xs">
              <thead>
                <tr className="text-[#7c7973]">
                  <th className="py-[3px] text-left font-normal">화질 단계</th>
                  <th className="text-right font-normal">화질</th>
                  <th className="text-right font-normal">초당 프레임</th>
                  <th className="text-right font-normal">속도</th>
                </tr>
              </thead>
              <tbody>
                {report.layers.map((l, i) => (
                  <tr key={i} className="border-t border-white/[.03]">
                    <td className="py-1 text-[#a39f98]">{LAYER[i + 3 - report.layers.length] ?? "-"}</td>
                    <td className={`text-right font-semibold ${i === 0 && short(l.h, report.target.h) ? INK.a : ""}`}>
                      {res(l.h)}
                      {i === 0 && res(l.h) !== res(report.target.h) && <span className="text-[#a39f98]"> / {res(report.target.h)}</span>}
                    </td>
                    <td className={`text-right font-semibold ${i === 0 && short(l.fps, report.target.fps) ? INK.a : ""}`}>
                      {l.fps}
                      {i === 0 && <span className="text-[#a39f98]"> / {report.target.fps}</span>}
                    </td>
                    <td className="text-right font-semibold">{(l.kbps / 1000).toFixed(1)} Mbps</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-[#a39f98]">방송 송출 상태 (최근 1분)</p>
            <div className="mt-1.5 mb-1 flex h-2 overflow-hidden rounded bg-[#2a2a2d] shadow-[inset_0_1px_2px_#000a]">
              <i className="block bg-[#e8b46a]" style={{ width: `${report.recent.cpu * 100}%` }} />
              <i className="block bg-[#e42b20]" style={{ width: `${report.recent.bandwidth * 100}%` }} />
              <i className="block bg-[#7ed957]" style={{ width: `${report.recent.none * 100}%` }} />
            </div>
            <div className="mb-1.5 flex flex-wrap gap-x-3 text-[11px] text-[#a39f98]">
              <span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-[#e8b46a]" />{REASON.cpu} {Math.round(report.recent.cpu * 100)}%</span>
              <span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-[#e42b20]" />{REASON.bandwidth} {Math.round(report.recent.bandwidth * 100)}%</span>
              <span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-[#7ed957]" />{REASON.none} {Math.round(report.recent.none * 100)}%</span>
            </div>
            <div className="grid grid-cols-1 gap-x-[22px] sm:grid-cols-2">
              <Row k="현재 송출 상태" level={report.reason === "none" ? undefined : "a"}>{REASON[report.reason] ?? report.reason}</Row>
              <Row k="자동 프레임 줄이기" level={report.capped ? "a" : undefined}>{report.capped ? "15프레임으로 줄임" : "안 함"}</Row>
              <Row k="연결 품질" level={sharerQ === 2 ? "r" : sharerQ === 1 ? "a" : sharerQ === 0 ? "g" : undefined}>{QUALITY_NAME[sharerQ] ?? "모름"}</Row>
              <Row k="서버 응답 시간">{report.rtt !== undefined ? `${report.rtt}ms` : "-"}</Row>
              <Row k="패킷 손실" level={report.loss !== undefined && report.loss >= 2 ? "a" : undefined}>{report.loss !== undefined ? `${report.loss.toFixed(1)}%` : "-"}</Row>
              <Row k="압축 방식">{report.codec ?? "-"}</Row>
              <Row k="메모리" level={report.mem && report.mem <= 4 ? "a" : undefined}>{report.mem ? `${report.mem}GB${report.mem >= 8 ? " 이상" : ""}` : "모름"}</Row>
              <Row k="CPU" level={report.cores && report.cores <= 4 ? "a" : undefined}>{report.cores ? `${report.cores}코어` : "모름"}</Row>
              <Row k="공유한 것">{SURFACE[report.surface ?? ""] ?? "-"}</Row>
              <Row k="브라우저">{report.browser}</Row>
            </div>
          </>
        )}
      </Section>

      <Section title="보는 사람" who={`${viewers.length}명`} level={viewerLevel}>
        <div className="grid grid-cols-1 gap-x-[22px] sm:grid-cols-2">
          {sharer && !sharer.isLocal && (
            <>
              <Row k="내가 받는 화질">{res(seen?.h)}</Row>
              <Row k="내가 받는 프레임">{seen ? `${seen.fps}프레임` : "-"}</Row>
              <Row k="내가 받는 속도">{seen ? `${seen.mbps.toFixed(1)} Mbps` : "-"}</Row>
              <Row k="끊긴 프레임 (최근 10초)" level={seen && seen.dropped > 0 ? "a" : undefined}>{seen ? `${seen.dropped}프레임` : "-"}</Row>
            </>
          )}
        </div>
        <div className="grid grid-cols-3 gap-x-4">
          <Row k="연결 좋음" level={counts[0].length ? "g" : undefined}>{counts[0].length}명</Row>
          <Row k="연결 보통" level={counts[1].length ? "a" : undefined}>{counts[1].length}명</Row>
          <Row k="연결 나쁨" level={counts[2].length ? "r" : undefined}>{counts[2].length}명</Row>
        </div>
        {[1, 2].map((q) =>
          counts[q].length ? (
            <p key={q} className="mt-1.5 text-xs leading-relaxed text-[#a39f98]">
              연결 {QUALITY_NAME[q]}: <b className={`font-semibold ${q === 2 ? INK.r : INK.a}`}>{counts[q].map((p) => p.name || p.identity).join(", ")}</b>
            </p>
          ) : null,
        )}
      </Section>

      <Section title="DOLIVE 서버" level={serverLevel}>
        {!server ? (
          <p className="py-3 text-center text-[13px] text-[#a39f98]">서버 상태를 읽지 못했어요</p>
        ) : (
          <div className="grid grid-cols-1 gap-x-[22px] sm:grid-cols-2">
            <Row k="CPU 사용 (1분 평균)" level={server.cpu >= 85 ? "r" : server.cpu >= 70 ? "a" : undefined}>{server.cpu}%</Row>
            <Row k="CPU">{server.cores}코어</Row>
            <Row k="메모리" level={server.memUsed / server.memTotal >= 0.9 ? "r" : server.memUsed / server.memTotal >= 0.8 ? "a" : undefined}>
              {gb(server.memUsed)} / {gb(server.memTotal)}GB
            </Row>
            <Row k="켜진 지">{Math.floor(server.uptime / 86400)}일 {Math.floor((server.uptime % 86400) / 3600)}시간</Row>
            <Row k="지금 방송">{server.rooms}개</Row>
            <Row k="전체 참여">{server.people}명</Row>
          </div>
        )}
      </Section>

      <button onClick={() => dlg.current?.close()} className="dolive-button dolive-primary mt-3.5 w-full py-2 text-sm">
        <span className="dolive-button-cap">닫기</span>
      </button>
    </dialog>
  );
}
