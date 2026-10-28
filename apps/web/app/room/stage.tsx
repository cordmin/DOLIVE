import {
  VideoTrack,
  useConnectionQualityIndicator,
  useIsSpeaking,
  useLocalParticipant,
  useParticipantAttributes,
  useRoomContext,
  useTracks,
  type TrackReference,
} from "@livekit/components-react";
import { ConnectionQuality, RoomEvent, Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { isPhone, camWidth } from "@/lib/dolive";
import { gridFit, pageOf, rowFit } from "@/lib/faces";
import { Floats, type Float } from "./reactions";

// 가운데 위쪽: 화면공유가 있으면 공유 화면, 없으면 얼굴 바둑판. 켜진 카메라도 없으면 "LIVE 방송 준비 중" 안내.
// 화면공유 중이면 공유하는 사람 얼굴은 공유 화면 구석에(방송인처럼, 그 사람이 고른 자리·모양), 나머지 얼굴은 공유 화면 아래 한 줄.
// 공유가 없을 때는 얼굴 위치 설정과 관계없이 카메라 켠 사람들 모두 얼굴 바둑판.
// 자리가 모자라면 공유 화면이 줄어든다. 휴대폰은 채팅 내용이 그 아래, PC는 오른쪽.
export function Stage({ screen, floats, confirmShare, overlay }: { screen?: TrackReference; floats: Float[]; confirmShare: () => Promise<boolean>; overlay?: ReactNode }) {
  const cams = useCams();
  const [dismissedShare, setDismissedShare] = useState("");
  useRoomTick(); // 얼굴 자리(camPos)·화면공유 권한이 바뀌면 다시 그린다
  const corner = (c: TrackReference) => c.participant.attributes?.camPos !== "row";
  const onScreen = screen
    ? cams.find((c) => c.participant.identity === screen.participant.identity && corner(c))
    : undefined;
  const row = cams.filter((c) => c !== onScreen);
  return (
    <div
      // PC: 위아래 두 칸을 다 써서 바닥이 오른쪽 채팅 카드 바닥과 맞는다. 공유 화면이 이 칸 크기(cqw·cqh)에 맞춰 커지게 크기를 알려 준다
      className={`room-stage relative flex min-h-0 flex-col gap-2 p-2 md:col-start-1 md:row-span-2 md:row-start-1 md:p-0 md:pr-[18px] md:[container-type:size] ${screen ? "phone-land:flex-1 phone-land:p-0" : "shrink-0"}`}
    >
      {screen ? (
        // 아래 얼굴 줄이 생기면 공유 화면이 남은 높이 안에서 가장 크게 (휴대폰은 그대로)
        <div className="contents md:flex md:min-h-0 md:flex-1 md:[container-type:size]">
          <ScreenView screen={screen} floats={floats} face={onScreen}>
            {overlay}
            {/* 내 공유 화면도 그대로 보여 준다. 한 모니터에서는 창을 내려야 겹친 화면이 사라진다. */}
            {screen.participant.isLocal && dismissedShare !== screen.publication.trackSid && (
              <ShareNotice
                confirm={confirmShare}
                close={() => setDismissedShare(screen.publication.trackSid)}
              />
            )}
          </ScreenView>
        </div>
      ) : cams.length ? (
        <FaceGrid cams={cams} />
      ) : (
        <>
          {/* 휴대폰은 공유 화면과 같은 16:9 칸, PC는 왼쪽 칸 전체 가운데에 안내. */}
          <div className="relative flex aspect-video min-h-0 w-full items-center justify-center rounded-xl bg-[#1e1e21] text-xl font-bold text-zinc-400 hw-inset md:aspect-auto md:flex-1 md:text-2xl">
            <div className="relative flex items-center gap-2 md:gap-3">
              <a
                href="https://myboard.my/"
                target="_blank"
                rel="noopener noreferrer"
                className="absolute bottom-full left-0 mb-1 whitespace-nowrap bg-linear-to-b from-[#ead39e] via-[#c9a65c] to-[#a8894d] bg-clip-text text-xs font-medium tracking-wide text-transparent transition-[filter] hover:brightness-125 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#c9a65c]"
              >
                Designed By Neil
              </a>
              <span className="size-2.5 animate-pulse rounded-full bg-red-500 md:size-3" />
              <span><span className="text-red-500">LIVE</span> 방송 준비 중</span>
            </div>
          </div>
        </>
      )}
      {screen && row.length > 0 && <FaceRow cams={row} />}
      {/* 공유 화면이 없으면 이 칸 안에서 띄운다. 있으면 공유 화면 안에서 띄운다. */}
      {!screen && <Floats floats={floats} />}
      {!screen && overlay}
    </div>
  );
}

// 확인 전에는 방 안의 다른 버튼을 막는다. 확인을 누른 순간 채팅도 분리한다.
function ShareNotice({ confirm, close }: { confirm: () => Promise<boolean>; close: () => void }) {
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = box.current;
    dialog?.showModal();
    button.current?.focus();
    return () => dialog?.close();
  }, []);
  async function accept() {
    if (busy) return;
    setBusy(true);
    try {
      if (await confirm()) close();
    } finally {
      setBusy(false);
    }
  }
  return (
      <dialog
        ref={box}
        aria-modal="true"
        aria-label="화면 공유 시작 안내"
        aria-busy={busy}
        onCancel={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="m-auto max-h-[92dvh] w-[680px] max-w-[calc(100%-2rem)] scale-[0.85] overflow-y-auto rounded-[18px] border border-[#4c4841] bg-[#252526] px-6 py-9 text-center shadow-[0_12px_36px_#0008] backdrop:bg-black/40"
      >
        <p className="text-2xl font-semibold text-[#d1b77f]">화면 공유가 시작되었습니다.</p>
        <p className="mt-5 text-xl leading-relaxed text-[#dedbd5]">DOLIVE 브라우저를 최소화하고, 연수를 시작하세요</p>
        <button ref={button} type="button" disabled={busy} onClick={accept} className="dolive-button dolive-danger mt-10 h-[42px] w-36 rounded-[12px] border border-[#75664b] bg-[#393631] text-sm text-white transition hover:bg-[#454037] disabled:opacity-50"><span className="dolive-button-cap text-white">닫기</span></button>
      </dialog>
  );
}

// 참여자 표시·권한·마이크가 바뀌면 다시 그린다 (useTracks 는 카메라 영상이 바뀔 때만 다시 그려서)
function useRoomTick() {
  const room = useRoomContext();
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    // 표시·권한, 그리고 마이크 켜고 끄기 (얼굴 순서)
    const events = [RoomEvent.ParticipantAttributesChanged, RoomEvent.ParticipantPermissionsChanged, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished] as const;
    events.forEach((e) => room.on(e, bump));
    return () => events.forEach((e) => void room.off(e, bump));
  }, [room]);
}

// ---- 얼굴(카메라)
// 한 사람이 동시에 받는 얼굴 수. 서버 인터넷 300Mbps 기준 (page.tsx ROOM_OPTIONS). 작은 칸은 작은 화질로 받는다
const MAX_ROW = 6; // 공유 화면 아래 줄 (+ 공유하는 사람 얼굴 1)
const MAX_GRID = 9; // 공유가 없을 때 바둑판
const MAX_PHONE = 4; // 휴대폰 얼굴 바둑판
const MAX_PHONE_ROW = 5; // 휴대폰 공유 화면 아래 줄
const GAP = 8;
const phone = () => typeof window !== "undefined" && isPhone();

// 카메라를 켠 사람들: 나 → 말하는 사람 → 마이크 켠 사람 → 나머지. 같은 순위면 들어온 순서
function useCams() {
  useRoomTick();
  const cams = useTracks([Track.Source.Camera], { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged] }).filter((t) => !t.publication.isMuted);
  const rank = (c: TrackReference) => (c.participant.isLocal ? 3 : c.participant.isSpeaking ? 2 : c.participant.isMicrophoneEnabled ? 1 : 0);
  return [...cams].sort((a, b) => rank(b) - rank(a));
}

// 다른 얼굴들을 보는 중 새로 말하는 사람이 생기면 첫 묶음으로 돌아온다. 소리 크기만 바뀔 때는 그대로
function useFacePage(cams: TrackReference[]) {
  const speakers = JSON.stringify(cams.filter((c) => c.participant.isSpeaking).map((c) => c.participant.identity).sort());
  const [view, setView] = useState({ page: 0, speakers });
  if (view.speakers !== speakers) {
    setView({ page: speakers === "[]" ? view.page : 0, speakers });
  }
  return [view.page, () => setView({ page: view.page + 1, speakers })] as const;
}

// 채팅 분리 창 맨 위에 세 버튼을 항상 둔다. 채팅만 골라도 다시 바꿀 수 있다.
// [공유 화면] = 공유 화면과 구석 얼굴, [내 얼굴] = 내 캠, [채팅만] = 영상 칸을 없앤다.
// 고른 것은 이 브라우저에 기억한다. 내 컴퓨터에서 다시 보여 주기만 해서 서버 부담 없음 (내 공유 화면은 보내기 전 원래 화질)
// ponytail: 모니터 하나에서 그 모니터 전체를 공유하며 [공유 화면]을 고르면 화면이 끝없이 겹쳐 보인다.
// 듀얼 모니터(다른 모니터에 이 창)면 괜찮아서 막지 않고 사용자에게 맡긴다 (사용자 결정)
const SPLIT_KEY = "dolive-split-view";
export function SharePreview({ screen }: { screen: TrackReference }) {
  const cams = useCams();
  const [ratio, setRatio] = useState(16 / 9);
  const face = cams.find((c) => c.participant.identity === screen.participant.identity && c.participant.attributes.camPos !== "row");
  return (
    <div style={{ aspectRatio: ratio }} className="relative overflow-hidden rounded-[10px] bg-black">
      <VideoTrack trackRef={screen} disablePictureInPicture onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoHeight) setRatio(v.videoWidth / v.videoHeight); }} onResize={(e) => { const v = e.currentTarget; if (v.videoHeight) setRatio(v.videoWidth / v.videoHeight); }} className="size-full object-contain" />
      {face && <FaceOverlay cam={face} />}
    </div>
  );
}

export function SplitTop({ screen, children }: { screen?: TrackReference; children?: ReactNode }) {
  const cams = useCams();
  useRoomTick();
  const [view, setView] = useState(() => {
    try {
      const saved = localStorage.getItem(SPLIT_KEY);
      return saved === "view" || saved === "chat" ? saved : "face";
    } catch {
      return "face";
    }
  });
  function pick(v: string) {
    setView(v);
    try {
      localStorage.setItem(SPLIT_KEY, v);
    } catch {}
  }
  const mine = cams.find((c) => c.participant.isLocal);
  const myAttrs = useLocalParticipant().localParticipant.attributes;
  const circle = myAttrs?.camShape === "circle" && myAttrs?.camPos !== "row";
  const onScreen = screen ? cams.find((c) => c.participant.identity === screen.participant.identity && c.participant.attributes?.camPos !== "row") : undefined;
  const choice = (on: boolean) =>
    `dolive-split-choice h-9 min-w-0 flex-1 rounded-[8px] border text-[12px] whitespace-nowrap transition ${on ? "border-[#71695b] bg-[#202022] text-[#f0dfbd]" : "border-transparent text-[#aba8a4] hover:text-zinc-100"}`;
  // 채팅 창 가장자리에서 조금 띄운 둥근 칸. 동그라미 얼굴은 검은 칸 없이 채팅 창 바탕 위에 바로 (이질감 없게)
  const bare = view === "face" && circle;
  return (
    <div className="shrink-0">
      <div role="group" aria-label="보기 선택" className="border-b border-[#423e38] bg-[#252526] px-2.5 py-3">
        <div className="flex gap-1 rounded-[12px] bg-[#19191b] p-1 shadow-[inset_0_2px_5px_#0009,inset_0_0_0_1px_#383838]">
        <button type="button" aria-pressed={view === "view"} onClick={() => pick("view")} className={`dolive-button ${choice(view === "view")}`}><span className="dolive-button-cap">공유 화면</span></button>
        <button type="button" aria-pressed={view === "face"} onClick={() => pick("face")} className={`dolive-button ${choice(view === "face")}`}><span className="dolive-button-cap">내 얼굴</span></button>
        <button type="button" aria-pressed={view === "chat"} onClick={() => pick("chat")} className={`dolive-button ${choice(view === "chat")}`}><span className="dolive-button-cap">채팅만</span></button>
        </div>
        {children}
      </div>
      {view !== "chat" && <div className="px-2.5 pt-2.5">
      <div className={`relative mx-auto aspect-video w-full max-w-[calc((100dvh-232px)*16/9)] overflow-hidden rounded-xl ${bare ? "" : "bg-black shadow-[0_4px_14px_#0006] ring-1 ring-white/10"}`}>
        {view === "view" ? (
          screen && (
            <>
              <VideoTrack trackRef={screen} disablePictureInPicture className="size-full object-contain" />
              {onScreen && <FaceOverlay cam={onScreen} />}
            </>
          )
        ) : (
          mine ? (
            <div className="grid size-full place-items-center">
              <Face cam={mine} name={false} round={circle ? "rounded-full" : "rounded-none"} className={`relative ${circle ? "aspect-square h-[92%]" : "size-full"}`} />
            </div>
          ) : <div className="grid size-full place-items-center text-xs text-[#9e9a94]">카메라가 꺼져 있어요.</div>
        )}
      </div>
      </div>}
    </div>
  );
}

// 칸 크기를 재는 상자 (창 크기·채팅 폭이 바뀌면 다시 잰다)
function useBoxSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// 얼굴 한 칸: 칸에 맞게 가운데를 잘라 꽉 채운다. 좌우 반전은 그 사람이 카메라 설정에서 고른 대로 모두(나 포함) 같게. 말하는 중은 초록 테두리
// className 에는 자리 잡는 법(relative/absolute)까지 넣는다 (둘 다 붙으면 어느 쪽이 이길지 몰라서)
function Face({ cam, style, className = "relative", round = "rounded-lg", name = true, speakingBorder = true }: { cam: TrackReference; style?: CSSProperties; className?: string; round?: string; name?: boolean; speakingBorder?: boolean }) {
  const speaking = useIsSpeaking(cam.participant);
  const mirror = useParticipantAttributes({ participant: cam.participant }).attributes?.camMirror === "1";
  return (
    <div style={style} className={`shrink-0 overflow-hidden bg-zinc-800 ${round} ${className}`}>
      {/* 엣지·크롬이 영상 위에 저절로 붙이는 "화면 속 화면" 버튼은 안 띄운다 */}
      <VideoTrack trackRef={cam} disablePictureInPicture className={`size-full object-cover ${mirror ? "-scale-x-100" : ""}`} />
      {speakingBorder && speaking && <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-green-500 ring-inset" />}
      {name && (
        <span className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/60 px-1.5 text-[11px] leading-4 text-zinc-100">
          {cam.participant.name}
        </span>
      )}
    </div>
  );
}

// 칸이 모자랄 때 마지막 칸. 누르면 다음 얼굴들
function More({ more, next, style }: { more: number; next: () => void; style: CSSProperties }) {
  return (
    <button type="button" onClick={next} style={style} data-tip="다른 얼굴 보기" className="shrink-0 rounded-lg bg-zinc-800 text-sm text-zinc-200 hover:bg-zinc-700">
      +{more}명
    </button>
  );
}

// 공유 화면 아래 한 줄: 모든 칸이 줄 높이를 다 쓰고, 폭은 16:9 까지만 넓어진다. PC와 휴대폰 모두 왼쪽부터 놓는다
// PC 줄 높이: 16:9 공유 화면이 폭에 꽉 차고 남는 높이를 다 쓴다 (빈 여백 대신 얼굴을 크게). 최소 84px(또는 칸 높이의 14%), 최대 180px
function FaceRow({ cams }: { cams: TrackReference[] }) {
  const [ref, { w, h }] = useBoxSize();
  const [page, next] = useFacePage(cams);
  const { shown, tw } = rowFit(Math.min(cams.length, phone() ? MAX_PHONE_ROW : MAX_ROW), w, h, GAP);
  const { faces, more } = pageOf(cams, shown, page);
  return (
    <div ref={ref} className="flex h-16 shrink-0 justify-start gap-2 md:h-[clamp(max(84px,14cqh),calc(100cqh-100cqw*9/16-8px),180px)] phone-land:hidden">
      {w > 0 && faces.map((c) => <Face key={c.participant.identity} cam={c} style={{ width: tw }} />)}
      {w > 0 && more > 0 && <More more={more} next={next} style={{ width: tw }} />}
    </div>
  );
}

// 공유가 없을 때: 얼굴 바둑판. 사람 수에 맞춰 한 줄 칸 수와 칸 모양(3:4 ~ 16:9)을 골라 자리를 꽉 채운다 (lib/faces.ts)
// 휴대폰은 "LIVE 방송 준비 중" 과 같은 16:9 칸 안에
function FaceGrid({ cams }: { cams: TrackReference[] }) {
  const [ref, { w, h }] = useBoxSize();
  const [page, next] = useFacePage(cams);
  const { faces, more } = pageOf(cams, phone() ? MAX_PHONE : MAX_GRID, page);
  const { tw, th } = gridFit(faces.length + (more ? 1 : 0), w, h, GAP);
  const size = { width: tw, height: th };
  return (
    <div ref={ref} className="flex aspect-video min-h-0 w-full flex-wrap content-center justify-center gap-2 md:aspect-auto md:flex-1">
      {w > 0 && faces.map((c) => <Face key={c.participant.identity} cam={c} style={size} />)}
      {w > 0 && more > 0 && <More more={more} next={next} style={size} />}
    </div>
  );
}

// 화면공유하는 사람 얼굴을 공유 화면 구석에 (방송인처럼). 자리·모양은 그 사람이 카메라 메뉴에서 고른 대로 (api/cam)
// 공유 화면 크기에 맞춰 같이 커지고 줄어서, 전체화면이나 휴대폰에서도 같은 자리·같은 비율로 보인다. 화면 누르기·쓸기는 그대로 통과
const CORNER: Record<string, string> = { br: "right-[2%] bottom-[2%]", bl: "left-[2%] bottom-[2%]", tr: "right-[2%] top-[2%]", tl: "left-[2%] top-[2%]" };
function FaceOverlay({ cam }: { cam: TrackReference }) {
  const a = useParticipantAttributes({ participant: cam.participant }).attributes;
  const circle = a?.camShape === "circle";
  return (
    <Face
      cam={cam}
      name={false}
      speakingBorder={false}
      round={circle ? "rounded-full" : "rounded-lg"}
      style={{ width: `${camWidth(Number(a?.camSize), circle)}%` }}
      className={`pointer-events-none absolute z-[5] shadow-lg shadow-black/50 ${CORNER[a?.camPos ?? ""] ?? CORNER.br} ${circle ? "aspect-square" : "aspect-video"}`}
    />
  );
}

// 공유 화면. 휴대폰은 유튜브처럼 위로 쓸어 올리면 전체화면, 전체화면에서 아래로 쓸어 내리면 원래대로.
// 휴대폰 가로에서 한 번 누르면 채팅 열기 버튼만 표시한다 (room/page.tsx).
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

function ScreenView({ screen, floats, face, children }: { screen: TrackReference; floats: Float[]; face?: TrackReference; children?: ReactNode }) {
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

  // 손가락으로 위아래로 50px 넘게 쓸면 전체화면을 켜고 끈다.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  // 쓰는 동안 공유 화면이 손가락을 따라 움직인다 (유튜브처럼): 평소엔 아래 가운데를 붙박고 위·양옆으로 커지고(최대 1.5배), 전체화면에선 아래로만 밀려 내려온다.
  // 전체화면이 켜지고 꺼지는 순간은 브라우저가 해서 그 사이를 움직이게 할 수는 없다. 덜 쓸고 손을 떼면 제자리로 스르륵
  const [drag, setDrag] = useState({ d: 0, smooth: false });
  const follow = (dy: number) => setDrag({ d: full ? Math.max(0, dy) : Math.min(0, dy), smooth: false });
  const settle = (smooth: boolean) => setDrag({ d: 0, smooth });

  return (
    <div
      ref={box}
      data-share-view
      data-grow={drag.d < 0 || undefined} // 커지는 동안 바깥 칸이 잘라 내지 않게 (page.tsx)
      onPointerMove={(e) => {
        wake();
        if (touchStart.current) follow(e.clientY - touchStart.current.y);
      }}
      onPointerCancel={() => {
        touchStart.current = null;
        settle(true);
      }}
      onPointerDown={(e) => {
        wake();
        touchStart.current = e.pointerType === "touch" ? { x: e.clientX, y: e.clientY } : null;
      }}
      onPointerUp={(e) => {
        const s = touchStart.current;
        touchStart.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (Math.abs(dy) < 50 || Math.abs(dy) < Math.abs(dx)) return settle(true);
        const toggle = dy < 0 !== full; // 위로 = 켜기, 아래로 = 끄기
        settle(!toggle); // 켜고 끌 때는 바로 제자리에 두고 브라우저에 넘긴다
        if (toggle) toggleFull();
      }}
      // PC: 공유된 화면 비율 그대로(검은 띠 없이) 왼쪽 칸 안에서 가장 크게, 가운데에. 보통 PC 화면은 옆으로 넓어서 높이가 칸 바닥(= 채팅 카드 바닥)까지 닿는다.
      // 휴대폰 가로는 전처럼 꽉 채운다 (넓은 휴대폰은 md 도 걸려서 ! 로 이긴다)
      style={
        {
          "--ratio": ratio,
          translate: drag.d && full ? `0 ${drag.d}px` : undefined,
          scale: drag.d && !full ? Math.min(1.5, 1 - drag.d / 400) : undefined,
          transformOrigin: "50% 100%",
          transition: drag.smooth ? "translate 200ms ease-out, scale 200ms ease-out" : undefined,
        } as React.CSSProperties
      }
      // 모서리는 채팅 카드와 같은 둥글기(rounded-xl). overflow-hidden: 영상 모서리도 같이 둥글게 잘리도록
      className="relative aspect-video min-h-0 w-full touch-none overflow-hidden rounded-xl bg-black [&:fullscreen]:rounded-none md:m-auto md:aspect-(--ratio) md:w-[min(100cqw,calc(100cqh*var(--ratio)))] phone-land:m-0! phone-land:aspect-auto! phone-land:w-full! phone-land:flex-1"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 z-10 hidden rounded-[inherit] md:block md:hw-inset" />
      <VideoTrack
        trackRef={screen}
        onResize={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
        }}
        className="size-full object-contain"
      />
      {face && <FaceOverlay cam={face} />}
      <Floats floats={floats} />
      {children}
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
    </div>
  );
}
