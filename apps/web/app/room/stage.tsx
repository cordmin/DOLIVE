import {
  VideoTrack,
  useConnectionQualityIndicator,
  useIsMuted,
  useIsSpeaking,
  useLocalParticipant,
  useParticipantAttributes,
  useRoomContext,
  type TrackReference,
} from "@livekit/components-react";
import { ConnectionQuality, RoomEvent, Track, type Participant } from "livekit-client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/Avatar";
import { avatarOf, isPhone } from "@/lib/dolive";
import { Floats, type Float } from "./reactions";

export function useAvatarOf(p: Participant) {
  useParticipantAttributes({ participant: p });
  return avatarOf(p.attributes?.avatar);
}

// 가운데 위쪽: 화면공유가 있으면 공유 화면만, 없으면 PC는 "LIVE 방송 준비 중" 카드, 휴대폰은 프로필 사진 칸.
// 자리가 모자라면 공유 화면이 줄어든다. 휴대폰은 채팅 내용이 그 아래, PC는 오른쪽.
export function Stage({ participants, screen, floats }: { participants: Participant[]; screen?: TrackReference; floats: Float[] }) {
  return (
    <div
      // PC: 위아래 두 칸을 다 써서 바닥이 오른쪽 채팅 카드 바닥과 맞는다. 공유 화면이 이 칸 크기(cqw·cqh)에 맞춰 커지게 크기를 알려 준다
      className={`relative flex min-h-0 flex-col gap-2 p-2 md:col-start-1 md:row-span-2 md:row-start-1 md:[container-type:size] ${screen ? "phone-land:flex-1 phone-land:p-0" : "shrink-0"}`}
    >
      {screen?.participant.isLocal ? (
        // 내가 공유 중이면 내 공유 화면은 보여 주지 않는다. 모니터를 공유할 때 이 창이 다시 찍혀서
        // 화면 속에 화면이 끝없이 생기는 것을 막고, 그 자리만큼 채팅을 넓게 본다.
        <div className="rounded-lg bg-indigo-600/15 px-4 py-3 text-sm text-indigo-100 ring-1 ring-indigo-500/40">
          내 화면을 공유하고 있어요. 다른 사람들에게는 내 화면이 보여요.
        </div>
      ) : screen ? (
        <ScreenView screen={screen} floats={floats} />
      ) : (
        <>
          {/* PC: 공유 화면이 들어올 자리(왼쪽 칸 전체)를 카드로 미리 잡아 두고 가운데에 안내 */}
          <div className="hidden min-h-0 w-full flex-1 items-center justify-center gap-3 rounded-xl border border-zinc-800 bg-zinc-800/40 text-2xl font-bold text-zinc-400 md:flex">
            <span className="size-3 animate-pulse rounded-full bg-red-500" />
            <span>
              <span className="text-red-500">LIVE</span> 방송 준비 중
            </span>
          </div>
          {/* 휴대폰만 (PC는 맨 위 참여자 줄에 사진이 이미 있어서 숨김). 한 줄, 손가락으로 밀어서 본다 (스크롤바 없음)
              p-0.5: 말할 때 생기는 초록 테두리(바깥쪽 2px)가 스크롤 칸 가장자리에서 잘리지 않게 */}
          <div className="grid auto-cols-[80px] grid-flow-col gap-2 overflow-x-auto p-0.5 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
            {participants.map((p) => (
              <Tile key={p.identity} p={p} />
            ))}
          </div>
        </>
      )}
      {/* 남의 공유 화면이 없으면 이 칸 안에서 띄운다 (있으면 공유 화면 안에서. 전체화면에서도 보이게) */}
      {!(screen && !screen.participant.isLocal) && <Floats floats={floats} />}
    </div>
  );
}

// 공유 화면. 휴대폰은 유튜브처럼 위로 쓸어 올리면 전체화면, 전체화면에서 아래로 쓸어 내리면 원래대로.
// 휴대폰을 가로로 눕히고 화면을 눌러도 전체화면이 되고, 한 번 더 누르면 풀린다.
// 전체화면은 늘 가로. 왼쪽·오른쪽 어느 쪽으로 눕혀도 그 방향에 맞게 돌고, 눕혔다가 다시 세우면 끝난다 (안드로이드만)
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };
type OrientationLock = { lock?: (o: "landscape") => Promise<void>; unlock?: () => void };

// 보는 사람 인터넷이 느릴 때 공유 화면 위에 띄울 안내. 내 공유 화면에는 띄우지 않는다.
// 멈춤: 길이 너무 막혀서 서버가 화면은 멈추고 소리만 보내는 중. 느림: 아직 나오지만 곧 끊길 수 있음.
function useSlowNotice(screen: TrackReference) {
  const { localParticipant } = useLocalParticipant();
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant });
  const room = useRoomContext();
  const paused = useSyncExternalStore(
    useCallback(
      (cb: () => void) => {
        room.on(RoomEvent.TrackStreamStateChanged, cb);
        return () => void room.off(RoomEvent.TrackStreamStateChanged, cb);
      },
      [room],
    ),
    () => screen.publication.track?.streamState === Track.StreamState.Paused,
    () => false,
  );
  if (screen.participant.isLocal) return null;
  if (paused) return "인터넷이 느려서 화면이 잠시 멈췄어요. 소리는 계속 나와요";
  if (quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost) return "인터넷이 느려서 화면이 끊길 수 있어요";
  return null;
}

function ScreenView({ screen, floats }: { screen: TrackReference; floats: Float[] }) {
  const slow = useSlowNotice(screen);
  const [full, setFull] = useState(false);
  const [pip, setPip] = useState(false);
  const [canPip, setCanPip] = useState(false);
  const [ratio, setRatio] = useState(16 / 9); // 공유된 화면의 실제 가로:세로

  useEffect(() => {
    // 휴대폰은 방 전체가 이미 전체화면일 수 있어서(입장 버튼), 공유 화면이 전체화면일 때만 true.
    // 공유 화면 전체화면이 끝나 방 전체화면으로 돌아오면 가로 잠금도 푼다 (브라우저는 전체화면이 다 끝나야 풀어 줘서)
    const onChange = () => {
      const on = document.fullscreenElement === box.current;
      setFull(on);
      if (!on) (window.screen.orientation as unknown as OrientationLock).unlock?.();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const box = useRef<HTMLDivElement>(null);

  // 팝업 윈도우(PiP) 지원 여부 및 진입/해제 상태 감지
  useEffect(() => {
    const v = box.current?.querySelector("video");
    if (!v) return;
    setCanPip(!!document.pictureInPictureEnabled && !v.disablePictureInPicture);
    const onEnter = () => setPip(true);
    const onLeave = () => setPip(false);
    v.addEventListener("enterpictureinpicture", onEnter);
    v.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      v.removeEventListener("enterpictureinpicture", onEnter);
      v.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [screen]);

  async function togglePip() {
    const v = box.current?.querySelector("video");
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch {}
  }

  // 전체화면 버튼은 마우스를 움직이거나 화면을 누를 때만 나타났다가 2.5초 가만히 있으면 사라진다
  const [showBtn, setShowBtn] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function wake() {
    setShowBtn(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowBtn(false), 2500);
  }
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  // 공유 화면만 전체화면으로. 들어가면 가로로 잠가서 바로 가로로 돌린다 (가로 두 방향은 휴대폰 기울기를 따라 돈다)
  // (전체화면이 풀리면 브라우저가 알아서 원래대로. PC는 돌리기가 없어서 그냥 넘어간다)
  async function toggleFull() {
    if (full) return document.exitFullscreen();
    const el = box.current!;
    // 아이폰은 영상 말고는 전체화면이 안 돼서 아이폰 기본 전체화면으로 띄운다 (돌리기·쓸어 내려 닫기는 아이폰이 알아서)
    if (!el.requestFullscreen) return (el.querySelector("video") as IosVideo | null)?.webkitEnterFullscreen?.();
    await el.requestFullscreen().catch(() => {});
    await (window.screen.orientation as unknown as OrientationLock).lock?.("landscape").catch(() => {});
  }

  // 전체화면 동안 휴대폰을 가로로 눕혔다가 다시 세로로 세우면 끝낸다 (유튜브처럼).
  // 화면이 가로로 잠겨 있어서 화면 방향으로는 알 수 없으니, 휴대폰이 받는 중력 방향(기울기)으로 본다.
  // '눕혔다가'일 때만: 세로로 들고 쓸어 올린 직후, 아직 눕히기 전에 바로 풀리지 않게
  useEffect(() => {
    if (!full || !isPhone()) return;
    let lay = false;
    const onMotion = (e: DeviceMotionEvent) => {
      const x = Math.abs(e.accelerationIncludingGravity?.x ?? 0); // 휴대폰 옆쪽으로 쏠린 힘 = 눕힘
      const y = Math.abs(e.accelerationIncludingGravity?.y ?? 0); // 휴대폰 아래쪽으로 쏠린 힘 = 세움
      if (x > 7 && x > 2 * y) lay = true;
      else if (lay && y > 7 && y > 2 * x) document.exitFullscreen().catch(() => {});
    };
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [full]);

  // 공유 화면 오른쪽 위·아래 버튼 (팝업, 전체화면)
  const overlayBtn = `absolute right-2 rounded bg-black/60 p-1.5 text-white transition-opacity duration-300 hover:bg-black/80 phone-land:hidden ${
    showBtn ? "opacity-100" : "pointer-events-none opacity-0"
  }`;

  // 손가락으로 위아래로 쓸었는지 (50px 넘게, 옆보다 위아래로 더 많이). 쓸었으면 뒤따라오는 '누름'은 무시한다
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  return (
    <div
      ref={box}
      onPointerMove={wake}
      onPointerDown={(e) => {
        wake();
        swiped.current = false;
        touchStart.current = e.pointerType === "touch" ? { x: e.clientX, y: e.clientY } : null;
      }}
      onPointerUp={(e) => {
        const s = touchStart.current;
        touchStart.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (Math.abs(dy) < 50 || Math.abs(dy) < Math.abs(dx)) return;
        swiped.current = true;
        if (dy < 0 !== full) toggleFull(); // 위로 = 켜기, 아래로 = 끄기
      }}
      onClick={() => {
        if (!swiped.current && document.documentElement.hasAttribute("data-phone-land")) toggleFull();
      }}
      // PC: 공유된 화면 비율 그대로(검은 띠 없이) 왼쪽 칸 안에서 가장 크게, 가운데에. 보통 PC 화면은 옆으로 넓어서 높이가 칸 바닥(= 채팅 카드 바닥)까지 닿는다.
      // 휴대폰 가로는 전처럼 꽉 채운다 (넓은 휴대폰은 md 도 걸려서 ! 로 이긴다)
      style={{ "--ratio": ratio } as React.CSSProperties}
      // 모서리는 채팅 카드와 같은 둥글기(rounded-xl). overflow-hidden: 영상 모서리도 같이 둥글게 잘리도록
      className="relative aspect-video min-h-0 w-full touch-none overflow-hidden rounded-xl bg-black [&:fullscreen]:rounded-none md:m-auto md:aspect-(--ratio) md:w-[min(100cqw,calc(100cqh*var(--ratio)))] phone-land:m-0! phone-land:aspect-auto! phone-land:w-full! phone-land:flex-1 phone-land:rounded-none"
    >
      <VideoTrack
        trackRef={screen}
        onResize={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
        }}
        className="size-full object-contain"
      />
      <Floats floats={floats} />
      {/* 팝업 윈도우(PiP) 버튼, 오른쪽 위 */}
      {canPip && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            togglePip();
          }}
          data-tip={pip ? "팝업 닫기" : "팝업 창으로 보기"}
          aria-label={pip ? "팝업 닫기" : "팝업 창으로 보기"}
          className={`top-2 ${overlayBtn}`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="size-5"
          >
            <rect width="18" height="14" x="3" y="5" rx="2" />
            <rect width="7" height="5" x="12" y="12" rx="1" fill="currentColor" fillOpacity={pip ? "1" : "0.35"} />
          </svg>
        </button>
      )}
      {/* 전체화면 버튼, 오른쪽 아래 (휴대폰 가로는 화면을 누르면 되니까 숨김). PC는 이 버튼이나 Esc로 끝낸다.
          숨어 있을 때는 눌리지 않아서, 휴대폰은 한 번 눌러 버튼을 띄운 뒤 누른다 (쓸어 올려도 된다) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleFull();
        }}
        data-tip={full ? "전체화면 끝내기" : "전체화면"}
        aria-label={full ? "전체화면 끝내기" : "전체화면"}
        className={`bottom-2 ${overlayBtn}`}
      >
        {/* 대각선 화살표: 켤 때는 바깥으로, 끌 때는 안으로 */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="size-5"
        >
          <path d={full ? "M18 10h-4V6M20 4l-6 6M6 14h4v4M10 14l-6 6" : "M16 20h4v-4M14 14l6 6M8 4H4v4M4 4l6 6"} />
        </svg>
      </button>
      {/* 인터넷 느림 안내. 아래 가운데 (휴대폰 가로는 이름표가 숨어서 위 가운데) */}
      {slow && (
        <span className="pointer-events-none absolute inset-x-0 bottom-2 mx-auto w-fit max-w-[calc(100%-6rem)] rounded bg-black/70 px-2 py-0.5 text-center text-xs text-amber-300 phone-land:top-2 phone-land:bottom-auto">
          {slow}
        </span>
      )}
      {/* 4초 뒤 스르륵 사라짐. 가로로 다시 눕히거나 전체화면이 풀리면 다시 나타난다 */}
      {!full && (
        <span className="absolute inset-x-0 bottom-6 mx-auto hidden w-fit rounded-2xl bg-black/70 px-8 py-4 text-3xl font-bold whitespace-nowrap text-white phone-land:block animate-[fade-out_0.8s_ease_4s_forwards]">
          화면을 누르면 전체화면
        </span>
      )}
    </div>
  );
}

function Tile({ p }: { p: Participant }) {
  const speaking = useIsSpeaking(p);
  const muted = useIsMuted({ participant: p, source: Track.Source.Microphone });
  const avatar = useAvatarOf(p);
  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-zinc-800 ${speaking && !muted ? "ring-2 ring-green-500" : ""}`}
    >
      {/* 이 카드만 사진을 자르지 않고 원래 모양 그대로 */}
      <Avatar id={avatar} mic={!muted} round={false} className="w-full" />
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-xs">{p.name}</span>
      {/* 나(ME)는 카드 안쪽 왼쪽 위 (카드 밖은 잘려서) */}
      {p.isLocal && (
        <span className="absolute top-1 left-1 rounded-full bg-indigo-600 px-1 text-[10px] leading-[14px] font-bold">
          ME
        </span>
      )}
    </div>
  );
}
