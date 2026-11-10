import { useDataChannel, useRoomContext } from "@livekit/components-react";
import { Track, type LocalVideoTrack } from "livekit-client";
import { useEffect } from "react";
import { startGovernor, stepGovernor, type Governor } from "@/lib/shareHealth";
import { deviceMemory } from "./share";

// 송출자 브라우저가 2초마다 화면공유 상태를 재서 방 관리자에게 보낸다. 받아서 보여 주는 쪽은 status.tsx (status.tsx 에서 나눔)
export const STATUS_TOPIC = "dolive-status";
export const TICK = 2000;

type Layer = { w: number; h: number; fps: number; kbps: number };
export type ShareReport = {
  layers: Layer[]; // 큰 화질부터
  target: { w: number; h: number; fps: number };
  reason: string;
  recent: { cpu: number; bandwidth: number; none: number }; // 최근 1분 비율
  rtt?: number;
  loss?: number;
  codec?: string;
  surface?: string;
  mem?: number;
  cores?: number;
  browser: string;
  capped: boolean; // 자동으로 프레임을 줄인 중
};

// 관리자가 직접 공유할 때는 자기에게 메시지를 못 보내서 여기 둔다
let localReport: ShareReport | null = null;
export const lastLocalReport = () => localReport;

function browserName(ua: string) {
  const b = /Edg\//.test(ua) ? "엣지" : /Whale/.test(ua) ? "웨일" : /Chrome\//.test(ua) ? "크롬" : /Firefox/.test(ua) ? "파이어폭스" : /Safari/.test(ua) ? "사파리" : "기타";
  const os = /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "크롬북" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${b} · ${os}` : b;
}

// 송출자 쪽: 화면공유 중이면 2초마다 보내는 상태를 재서 관리자에게 보내고, 버벅이면 맨 위 겹의 프레임을 줄인다 (규칙은 lib/shareHealth.ts)
export function useShareHealth() {
  const room = useRoomContext();
  const { send } = useDataChannel(STATUS_TOPIC);
  useEffect(() => {
    let track: LocalVideoTrack | undefined;
    let gov: Governor = startGovernor(Date.now());
    let fullFps = 30;
    let prev = new Map<string, number>(); // 겹(rid)마다 지금까지 보낸 바이트
    let prevAt = 0;
    const hist: { t: number; d: Record<string, number> }[] = []; // 막힌 까닭별 누적 초 (최근 1분 계산용)
    const iv = setInterval(async () => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      const t = pub?.videoTrack as LocalVideoTrack | undefined;
      // 잠시 멈춤(다른 사람이 공유 중)은 같은 영상이라 줄인 프레임 기억을 지우지 않는다. 새로 공유하면 새 영상이라 처음부터
      if (!t || pub?.isMuted) {
        localReport = null;
        return;
      }
      const now = Date.now();
      if (t !== track) {
        track = t;
        gov = startGovernor(now);
        fullFps = t.sender?.getParameters().encodings.at(-1)?.maxFramerate ?? 30;
        prev = new Map();
        hist.length = 0;
      }
      const stats = (await t.getSenderStats().catch(() => [])).filter((s) => s.frameWidth).sort((a, b) => b.frameWidth - a.frameWidth);
      const top = stats[0];
      if (!top) return;

      // 자동 프레임 줄이기: 맨 위 겹이 컴퓨터·인터넷 때문에 막혔는지로 판단하고, 바뀔 때만 브라우저 설정을 고친다
      const limited = top.qualityLimitationReason === "cpu" || top.qualityLimitationReason === "bandwidth";
      const next = stepGovernor(gov, limited, now);
      if (next.low !== gov.low && t.sender) {
        const params = t.sender.getParameters();
        const enc = params.encodings.at(-1);
        if (enc) {
          enc.maxFramerate = next.low ? Math.min(15, fullFps) : fullFps;
          await t.sender.setParameters(params).catch(() => {});
        }
      }
      gov = next;

      const dt = prevAt ? (now - prevAt) / 1000 : 0;
      const layers = stats.map((s) => {
        const before = prev.get(s.rid);
        return { w: s.frameWidth, h: s.frameHeight, fps: Math.round(s.framesPerSecond ?? 0), kbps: before !== undefined && dt ? Math.max(0, ((s.bytesSent ?? 0) - before) * 8 / dt / 1000) : 0 };
      });
      prev = new Map(stats.map((s) => [s.rid, s.bytesSent ?? 0]));
      prevAt = now;

      hist.push({ t: now, d: top.qualityLimitationDurations ?? {} });
      while (hist.length > 1 && now - hist[0].t > 60_000) hist.shift();
      const diff = (k: string) => Math.max(0, (hist.at(-1)!.d[k] ?? 0) - (hist[0].d[k] ?? 0));
      const total = diff("cpu") + diff("bandwidth") + diff("other") + diff("none");
      const part = (k: string) => (total ? diff(k) / total : 0);

      const set = t.mediaStreamTrack.getSettings() as MediaTrackSettings & { displaySurface?: string };
      const sent = (top.packetsSent ?? 0) + (top.packetsLost ?? 0);
      const report: ShareReport = {
        layers,
        target: { w: set.width ?? top.frameWidth, h: set.height ?? top.frameHeight, fps: gov.low ? Math.min(15, fullFps) : fullFps },
        reason: top.qualityLimitationReason ?? "none",
        recent: { cpu: part("cpu"), bandwidth: part("bandwidth"), none: total ? part("none") : 1 },
        rtt: top.roundTripTime !== undefined ? Math.round(top.roundTripTime * 1000) : undefined,
        loss: sent ? ((top.packetsLost ?? 0) / sent) * 100 : undefined,
        codec: t.codec?.toUpperCase(),
        surface: set.displaySurface,
        mem: deviceMemory(),
        cores: navigator.hardwareConcurrency,
        browser: browserName(navigator.userAgent),
        capped: gov.low,
      };
      localReport = report;
      const admins = [...room.remoteParticipants.values()].filter((p) => p.attributes.roomAdmin === "1").map((p) => p.identity);
      if (admins.length) send(new TextEncoder().encode(JSON.stringify(report)), { reliable: false, destinationIdentities: admins }).catch(() => {});
    }, TICK);
    return () => clearInterval(iv);
  }, [room, send]);
}
