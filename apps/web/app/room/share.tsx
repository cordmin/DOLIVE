import { useDataChannel, useLocalParticipant, useLocalParticipantPermissions, useRoomContext } from "@livekit/components-react";
import { ScreenSharePresets, RoomEvent, Track, type Participant, type RemoteParticipant, type RemoteTrackPublication } from "livekit-client";
import { useEffect, useState } from "react";
import { Knob } from "@/components/Knob";
import { VOICE_BOT, VOICE_ON } from "@/lib/dolive";
import { CameraKnob } from "./camera";
import { TtsButton } from "./tts";
import { MicrophoneKnob } from "./microphone";

// 화면공유는 720p와 낮은 화질을 같이 보내고,
// 보는 사람 인터넷이 느려서 끊기면 서버가 그 사람에게만 낮은 쪽으로 자동으로 바꿔 보낸다.
const QUALITY = { top: ScreenSharePresets.h720fps30, low: ScreenSharePresets.h360fps15 };

// 화면공유 요청("request")과 거부("denied")를 주고받는 채널
const SHARE_TOPIC = "dolive-share";
export const SCREEN_SHARE_SOURCE = 3; // LiveKit 권한 목록에서 화면공유를 뜻하는 번호 (TrackSource.SCREEN_SHARE)
const text = (s: string) => new TextEncoder().encode(s);

// 라디오 DJ처럼: 누가 마이크로 말하거나 "/글" 음성이 나오는 동안 화면공유 소리(배경음악 등)를
// DUCK(마이크) / DUCK_TTS("/글" 음성, 휴대폰에서도 또렷하게 더 낮춤) 까지 0.25초에 걸쳐 낮추고, 말이 끝나고 0.7초 뒤에 1초에 걸쳐 되돌린다.
// 보는 사람 브라우저가 각자 크기만 바꿔서 서버 부담은 없다. '말하는 중'은 방 서버가 마이크 소리로만 판단한다 (공유 소리는 안 셈).
// 방 서버의 '말하는 중' 알림은 0.5초쯤 늦어서, "/글" 음성은 음성 참여자가 읽기 전에 미리 켜 두는 VOICE_ON 으로 먼저 줄인다
// ponytail: 아이폰 브라우저는 코드로 소리 크기를 못 바꿔서 거기선 안 줄어든다. 공유하는 사람 PC에서 직접 듣는 노래도 그대로
const DUCK = 0.3;
const DUCK_TTS = 0.15;
export function useDuckShareAudio() {
  const room = useRoomContext();
  useEffect(() => {
    let vol = 1;
    let lastTalk = 0;
    let floor = DUCK;
    const iv = setInterval(() => {
      const now = Date.now();
      const tts = !!room.remoteParticipants.get(VOICE_BOT)?.attributes[VOICE_ON];
      if (tts || room.activeSpeakers.length) {
        lastTalk = now;
        floor = tts ? DUCK_TTS : DUCK;
      }
      const target = now - lastTalk < 700 ? floor : 1;
      const next = vol > target ? Math.max(target, vol - 0.14) : Math.min(target, vol + 0.035); // 내릴 땐 빠르게, 올릴 땐 천천히
      if (next === vol) return;
      vol = next;
      room.remoteParticipants.forEach((p) => p.setVolume(vol, Track.Source.ScreenShareAudio));
    }, 50);
    return () => clearInterval(iv);
  }, [room]);
}

// 새 사람이 화면공유를 시작하면 내 공유는 잠시 멈춘다. 멈춘 동안은 아예 보내지 않아서 데이터가 들지 않는다.
// 그 사람이 공유를 끝내고 보내는 사람이 아무도 없으면 내 공유를 다시 보낸다.
// ponytail: 셋이 겹쳐 공유하다 마지막 사람이 끝내면 멈춰 있던 둘이 같이 다시 켜진다. 드문 일이라 그대로 둠.
export function usePauseOldShare() {
  const room = useRoomContext();
  useEffect(() => {
    const mine = () =>
      [Track.Source.ScreenShare, Track.Source.ScreenShareAudio]
        .map((s) => room.localParticipant.getTrackPublication(s))
        .filter((p) => !!p);
    const onPublished = (pub: RemoteTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare) mine().forEach((p) => p.mute());
    };
    const onUnpublished = (pub: RemoteTrackPublication) => {
      if (pub.source !== Track.Source.ScreenShare) return;
      const othersSending = [...room.remoteParticipants.values()].some((p) => {
        const s = p.getTrackPublication(Track.Source.ScreenShare);
        return s && s !== pub && !s.isMuted;
      });
      if (!othersSending) mine().forEach((p) => p.unmute());
    };
    room.on(RoomEvent.TrackPublished, onPublished).on(RoomEvent.TrackUnpublished, onUnpublished);
    return () => {
      room.off(RoomEvent.TrackPublished, onPublished).off(RoomEvent.TrackUnpublished, onUnpublished);
    };
  }, [room]);
}

// 화면공유 승인 받기: 방장이 아닌 사람이 요청하면 방장 화면에 [승인] [거부]가 뜬다.
// waiting: 방장이 지금 답할 요청 (방을 나간 사람 요청은 건너뛴다), asked: 내가 요청하고 기다리는 중
export function useShareRequests(isAdmin: boolean, participants: Participant[], token: string) {
  const room = useRoomContext();
  const [requests, setRequests] = useState<{ identity: string; name: string }[]>([]); // 방장이 받은 요청
  const [asked, setAsked] = useState(false); // 내가 요청하고 기다리는 중
  const { send } = useDataChannel(SHARE_TOPIC, (msg) => {
    const what = new TextDecoder().decode(msg.payload);
    const from = msg.from;
    if (what === "request" && from) { // 요청은 운영 권한이 있는 사람에게만 온다 (requestShare). 권한이 막 넘어와도 받게 isAdmin 은 안 본다
      setRequests((r) =>
        r.some((x) => x.identity === from.identity) ? r : [...r, { identity: from.identity, name: from.name ?? "" }],
      );
    }
    if (what === "denied") {
      setAsked(false);
      alert("방장이 화면공유를 거부했어요.");
    }
  });

  function requestShare() {
    const admins = participants.filter((p) => p.attributes?.roomAdmin === "1").map((p) => p.identity);
    if (!admins.length) return alert("방장이 방에 없어서 화면공유를 요청할 수 없어요.");
    send(text("request"), { reliable: true, destinationIdentities: admins });
    setAsked(true);
    setTimeout(() => setAsked(false), 60_000); // 방장이 답이 없으면 1분 뒤 다시 누를 수 있게
  }

  async function answer(req: { identity: string }, allow: boolean) {
    setRequests((r) => r.filter((x) => x.identity !== req.identity));
    if (!allow) return send(text("denied"), { reliable: true, destinationIdentities: [req.identity] });
    const r = await fetch("/api/share", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ room: room.name, identity: req.identity, allow: true }) });
    if (!r.ok) alert("승인하지 못했어요. 그 사람이 방을 나갔을 수 있어요.");
  }

  // 방장: 승인받은 사람이 공유를 끝내면 권한을 도로 거둔다 (다음에 또 하려면 다시 승인받기)
  useEffect(() => {
    if (!isAdmin) return;
    const onUnpublished = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
      if (pub.source !== Track.Source.ScreenShare || p.attributes.roomAdmin === "1") return;
      fetch("/api/share", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ room: room.name, identity: p.identity, allow: false }) });
    };
    room.on(RoomEvent.TrackUnpublished, onUnpublished);
    return () => {
      room.off(RoomEvent.TrackUnpublished, onUnpublished);
    };
  }, [room, isAdmin, token]);
  const waiting = requests.find((r) => participants.some((p) => p.identity === r.identity));
  return { waiting, answer, asked, requestShare };
}

// 위쪽 오른쪽: 화면공유(PC만) + TTS + 카메라 + 마이크 스위치. 넓은 PC 화면(md 이상)은 같은 일을 하는 동그란 기계 버튼(Knob)으로 따로 그린다
// 화면공유 버튼: 방장은 바로 공유. 다른 사람은 [화면공유 -> 요청 중... -> (방장 승인) -> 지금 공유하기] 순서.
// (승인이 나도 공유 고르는 창은 본인이 버튼을 눌러야 열린다 - 브라우저 규칙)
export function MediaControls({ asked, requestShare, token }: { asked: boolean; requestShare: () => void; token: string }) {
  const { localParticipant: me, isScreenShareEnabled } = useLocalParticipant();
  const canShare = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
  const sources = useLocalParticipantPermissions()?.canPublishSources ?? [];
  const allowed = sources.length === 0 || sources.includes(SCREEN_SHARE_SOURCE); // 빈 목록 = 다 보낼 수 있음(방장)
  const approved = allowed && sources.length > 0 && me.attributes.roomAdmin !== "1"; // 운영자가 아닌데 따로 승인받음
  const paused = me.getTrackPublication(Track.Source.ScreenShare)?.isMuted; // 다른 사람이 공유 중이라 멈춤

  async function run(action: () => Promise<unknown>, fail: string) {
    try {
      await action();
    } catch (e) {
      // 화면공유 창에서 '취소'를 누른 경우는 조용히 넘어간다
      if ((e as Error).name !== "NotAllowedError" || fail !== "화면공유") alert(`${fail}를 켤 수 없어요.`);
    }
  }

  // 화면공유 시작·끝 (아직 권한이 없으면 방장에게 요청)
  const toggleShare = () =>
    !isScreenShareEnabled && !allowed
      ? requestShare()
      : run(
        () =>
          me.setScreenShareEnabled(
            !isScreenShareEnabled,
            {
              audio: {
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false,
                // 컴퓨터 소리를 담을 때 이 도라이브 창에서 나는 소리("/글" 음성, 다른 사람 목소리)는 빼고 담는다.
                // 안 빼면 그 소리가 공유 소리에 섞여 한 번 더 나가서, 모두에게 늦게 두 번 들린다 (말한 사람에겐 자기 목소리가 되돌아옴)
                restrictOwnAudio: true,
              },
              resolution: QUALITY.top.resolution,
              contentHint: "detail",
              video: { displaySurface: "monitor" }, // 고르는 창에서 '전체 화면' 칸이 먼저 열리게
              selfBrowserSurface: "exclude", // 이 탭은 목록에서 뺀다 (화면 속 화면이 끝없이 비치는 것 방지)
              systemAudio: "include", // '전체 화면'에서 '시스템 오디오와 공유'를 늘 보여 준다 (켜짐이 기본)
            },
            { screenShareEncoding: QUALITY.top.encoding, screenShareSimulcastLayers: [QUALITY.low] },
          ),
        "화면공유",
      );
  const shareLabel = isScreenShareEnabled
    ? paused
      ? "공유 중지 (잠시 멈춤)"
      : "공유 중지"
    : allowed
      ? approved
        ? "지금 공유하기"
        : "화면공유"
      : asked
        ? "요청 중..."
        : "화면공유";

  return (
    <>
      {canShare && (
        <button
          // 휴대폰은 화면공유를 못 하고 자리도 좁아서 숨긴다
          className={`hidden rounded-full px-3 py-1.5 disabled:opacity-60 sm:block md:hidden ${
            isScreenShareEnabled ? "bg-indigo-600" : approved ? "bg-green-600 hover:bg-green-500" : "bg-zinc-800 hover:bg-zinc-700"
          }`}
          disabled={!isScreenShareEnabled && !allowed && asked}
          onClick={toggleShare}
        >
          {shareLabel}
        </button>
      )}
      {/* PC: 화면공유 중이거나 승인받으면 초록 불빛 */}
      {canShare && (
        <Knob
          className="hidden md:flex"
          label={shareLabel}
          led={isScreenShareEnabled || approved ? "green" : undefined}
          disabled={!isScreenShareEnabled && !allowed && asked}
          onClick={toggleShare}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-[17px]">
              <rect x="3" y="4" width="18" height="12" rx="2" />
              <path d="M8 20h8M12 16v4" />
            </svg>
          }
        />
      )}
      <TtsButton />
      <CameraKnob token={token} />
      <MicrophoneKnob />
    </>
  );
}

