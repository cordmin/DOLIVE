"use client";

import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  VideoTrack,
  useChat,
  useIsMuted,
  useIsSpeaking,
  useLocalParticipant,
  useParticipantAttributes,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import type { TrackReference } from "@livekit/components-react";
import { Participant, RoomOptions, ScreenSharePresets, Track } from "livekit-client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Switch } from "@/components/Switch";
import { AVATARS, savedAvatar } from "@/lib/dolive";

// 영상은 화면공유(1080p)뿐. 안 보이는 영상은 받지 않음(adaptiveStream).
const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: { screenShareEncoding: ScreenSharePresets.h1080fps30.encoding },
};

type Conn = { token: string; url: string; isAdmin: boolean };

// 휴대폰 자판이 올라와도 화면 전체가 밀려 올라가지 않게, 방 높이를 '실제로 보이는 높이'에 맞춘다.
// (안드로이드는 layout.tsx 의 interactiveWidget 설정으로, 아이폰은 이 코드로 처리)
function useFitVisibleHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => {
      if (!vv.height) return; // 창이 가려져 높이가 0으로 잡힐 때는 무시
      document.documentElement.style.setProperty("--vh", `${vv.height}px`);
      window.scrollTo(0, 0);
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, []);
}

// 휴대폰을 가로로 눕혔는지 <html data-phone-land> 로 알린다 (globals.css 의 phone-land).
// 화면 모양으로 판단하면 세로에서 자판이 올라와 화면이 납작해질 때도 가로로 잘못 알아서, 기기 방향을 본다.
function usePhoneLandscape() {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const land = screen.orientation
        ? screen.orientation.type.startsWith("landscape")
        : matchMedia("(orientation: landscape)").matches; // 옛 아이폰: 자판이 화면 크기를 안 바꿔서 괜찮다
      // 손가락으로 쓰는 작은 화면만 (크기를 0으로 알려 주는 브라우저도 있어서 0은 제외)
      const short = Math.min(screen.width, screen.height);
      const phone = short > 0 && short <= 500 && matchMedia("(pointer: coarse)").matches;
      root.toggleAttribute("data-phone-land", land && phone);
      // 다시 세로로 세우면 전체화면을 푼다
      if (!land && document.fullscreenElement) document.exitFullscreen();
    };
    update();
    screen.orientation?.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      screen.orientation?.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      root.removeAttribute("data-phone-land");
    };
  }, []);
}

export default function RoomPage() {
  const router = useRouter();
  const [conn, setConn] = useState<Conn>();
  useFitVisibleHeight();
  usePhoneLandscape();

  useEffect(() => {
    const name = sessionStorage.getItem("name");
    if (!name) {
      router.replace("/");
      return;
    }
    fetch("/api/token", { method: "POST", body: JSON.stringify({ name, avatar: savedAvatar() }) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setConn)
      .catch(() => router.replace("/"));
  }, [router]);

  if (!conn) return <p className="m-auto text-zinc-400">들어가는 중...</p>;

  return (
    <LiveKitRoom
      serverUrl={conn.url}
      token={conn.token}
      connect
      audio // 마이크는 켜진 채로 들어간다
      options={ROOM_OPTIONS}
      onDisconnected={() => router.push("/")}
      onError={(e) => alert(`연결 오류: ${e.message}`)}
      onMediaDeviceFailure={() =>
        alert("마이크를 쓸 수 없어요. 주소창 왼쪽 아이콘을 눌러 권한을 '허용'으로 바꿔 주세요.")
      }
      className="fixed inset-x-0 top-0 flex flex-col"
      style={{ height: "var(--vh, 100dvh)" }}
    >
      <RoomAudioRenderer />
      {/* 휴대폰에서는 안내 버튼 없이, 화면 아무 데나 처음 누를 때 소리를 켠다 (RoomView) */}
      <div className="hidden sm:block phone-land:hidden!">
        <StartAudio
          label="여기를 눌러 소리 켜기"
          className="fixed inset-x-0 top-14 z-20 mx-auto w-fit rounded-lg bg-indigo-600 px-4 py-2"
        />
      </div>
      <RoomView isAdmin={conn.isAdmin} />
    </LiveKitRoom>
  );
}

// 위: 로고, 참여자 수, (방장), 화면공유, 마이크 스위치
// 가운데: [참여자 목록] [위: 화면공유 또는 프로필 사진 / 아래: 채팅 내용]  (휴대폰은 참여자 목록을 눌러서 연다)
// 아래: 카카오톡처럼 항상 보이는 메시지 입력칸
function RoomView({ isAdmin }: { isAdmin: boolean }) {
  const participants = useParticipants();
  const [showPeople, setShowPeople] = useState(false); // 휴대폰에서 참여자 목록 열기
  const chat = useChat();
  const screen = useTracks([Track.Source.ScreenShare])[0];
  const room = useRoomContext();
  // 휴대폰을 가로로 눕히면 공유 화면만 꽉 차게 보여 주고 나머지는 모두 숨긴다
  const hideOnLand = screen ? "phone-land:hidden!" : "";

  // 브라우저가 소리를 막아 둔 경우, 화면을 한 번이라도 누르면 풀린다
  useEffect(() => {
    const unlock = () => {
      if (!room.canPlaybackAudio) room.startAudio();
    };
    document.addEventListener("pointerdown", unlock);
    return () => document.removeEventListener("pointerdown", unlock);
  }, [room]);

  return (
    <>
      <header
        className={`${hideOnLand} flex h-12 shrink-0 items-center gap-3 overflow-x-auto border-b border-zinc-800 px-3 text-sm whitespace-nowrap`}
      >
        <b className="text-base">
          DO<span className="text-red-500">LIVE</span>
        </b>
        {/* 휴대폰: 눌러서 참여자 목록을 여는 배지. 넓은 화면은 목록이 늘 보여서 그냥 글자 */}
        <button
          onClick={() => setShowPeople(!showPeople)}
          aria-expanded={showPeople}
          className={`flex items-center gap-1 rounded-full px-3 py-1 text-zinc-200 md:pointer-events-none md:bg-transparent md:px-0 md:text-zinc-400 ${showPeople ? "bg-indigo-600" : "bg-zinc-800 active:bg-zinc-700"}`}
        >
          참여자 {participants.length}명
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
            className={`size-4 transition-transform md:hidden ${showPeople ? "rotate-180" : ""}`}
          >
            <path d="M5.2 7.2a.75.75 0 0 1 1.06 0L10 10.94l3.74-3.74a.75.75 0 1 1 1.06 1.06l-4.27 4.27a.75.75 0 0 1-1.06 0L5.2 8.26a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </button>
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-black">방장</span>
          )}
          <MediaControls />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={`${showPeople ? "absolute inset-y-0 left-0 z-10 flex" : "hidden"} w-56 flex-col gap-1 overflow-y-auto border-r border-zinc-800 bg-zinc-900 p-2 md:static md:flex ${hideOnLand}`}
        >
          {participants.map((p) => (
            <PersonRow key={p.identity} p={p} isAdmin={isAdmin} />
          ))}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Stage participants={participants} screen={screen} />
          {/* 휴대폰에서 화면공유 중에 자판이 올라오면 채팅 내용 칸이 먼저 줄고, 그래도 좁으면 공유 화면도 줄어든다 */}
          <ChatLog
            messages={chat.chatMessages}
            className={`${screen ? "min-h-24 flex-1" : "min-h-0 flex-1 md:h-2/5 md:flex-none"} border-t border-zinc-800 ${hideOnLand}`}
          />
        </div>
      </div>

      {/* 넓은 화면: 왼쪽 참여자 목록 밑으로는 들어가지 않게 (왼쪽 테두리가 목록의 오른쪽 테두리와 이어진다) */}
      <ChatInput send={chat.send} className={`md:ml-[calc(14rem-1px)] md:border-l ${hideOnLand}`} />
    </>
  );
}

function useAvatarOf(p: Participant) {
  return useParticipantAttributes({ participant: p }).attributes?.avatar ?? AVATARS[0];
}

// 방장에게는 다른 사람 옆에 "마이크 끄기" 버튼이 보인다 (/api/mute 가 방장인지 다시 확인한다)
function PersonRow({ p, isAdmin }: { p: Participant; isAdmin: boolean }) {
  const speaking = useIsSpeaking(p);
  const muted = useIsMuted({ participant: p, source: Track.Source.Microphone });

  async function forceMute() {
    const r = await fetch("/api/mute", { method: "POST", body: JSON.stringify({ identity: p.identity }) });
    if (!r.ok) alert("마이크를 끄지 못했어요.");
  }

  return (
    <div className="flex items-center gap-2 rounded p-1 hover:bg-zinc-800">
      <Avatar id={useAvatarOf(p)} talking={speaking && !muted} muted={muted} px={47} className="w-9 shrink-0 md:w-[47px]" />
      <div className="min-w-0">
        <div className="truncate text-sm">
          {p.name}
          {p.isLocal && <span className="text-zinc-500"> (나)</span>}
        </div>
        <div className="text-xs text-zinc-500">{muted ? "음소거" : speaking ? "말하는 중" : "대기 중"}</div>
      </div>
      {isAdmin && !p.isLocal && !muted && (
        <button
          onClick={forceMute}
          className="ml-auto shrink-0 rounded-full bg-red-600/20 px-2.5 py-1 text-xs text-red-300 hover:bg-red-600/40"
        >
          마이크 끄기
        </button>
      )}
    </div>
  );
}

// 가운데 위쪽: 화면공유가 있으면 공유 화면만 (사진은 왼쪽 참여자 목록에 있으니 안 보여 줌), 없으면 프로필 사진 칸.
// 자리가 모자라면 공유 화면이 줄어든다. 채팅 내용은 PC든 휴대폰이든 그 아래.
function Stage({ participants, screen }: { participants: Participant[]; screen?: TrackReference }) {
  return (
    <div
      className={`flex min-h-0 flex-col gap-2 p-2 ${screen ? "phone-land:flex-1 phone-land:p-0" : "shrink-0 md:flex-1"}`}
    >
      {screen ? (
        <ScreenView screen={screen} />
      ) : (
        // 휴대폰: 폭 80px 카드 2줄, 사람이 많으면 옆으로 밀어서 본다. 넓은 화면: 최소 160px 카드를 여러 줄로
        <div className="grid auto-cols-[80px] grid-flow-col [grid-template-rows:repeat(2,auto)] gap-2 overflow-x-auto md:flex-1 md:auto-cols-auto md:auto-rows-min md:grid-flow-row md:[grid-template-rows:none] md:content-center md:overflow-x-visible md:overflow-y-auto md:[grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
          {participants.map((p) => (
            <Tile key={p.identity} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

// 공유 화면. 휴대폰을 가로로 눕히고 화면을 누르면 주소창·아래 버튼까지 숨긴 전체화면(영화관 모드)이 되고, 한 번 더 누르면 풀린다.
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

function ScreenView({ screen }: { screen: TrackReference }) {
  const [full, setFull] = useState(false);
  const [ratio, setRatio] = useState(16 / 9); // 공유된 화면의 실제 가로:세로

  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFull(e: React.MouseEvent<HTMLDivElement>) {
    if (full) return void document.exitFullscreen();
    if (!document.documentElement.hasAttribute("data-phone-land")) return;
    const root = document.documentElement;
    if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
    // 아이폰은 페이지 전체화면이 안 돼서, 영상만 아이폰 기본 전체화면으로 띄운다
    else (e.currentTarget.querySelector("video") as IosVideo | null)?.webkitEnterFullscreen?.();
  }

  return (
    <div
      onClick={toggleFull}
      // PC: 공유된 화면 비율 그대로(위아래 검은 띠 없이). 높이는 화면의 60%까지만 써서 아래 채팅 자리를 남긴다
      style={{ "--ratio": ratio } as React.CSSProperties}
      className="relative aspect-video min-h-0 w-full rounded-lg bg-black lg:mx-auto lg:aspect-(--ratio) lg:max-w-[calc(60vh*var(--ratio))] phone-land:aspect-auto phone-land:flex-1 phone-land:rounded-none"
    >
      <VideoTrack
        trackRef={screen}
        onResize={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
        }}
        className="size-full object-contain"
      />
      <span className="absolute top-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs phone-land:hidden">
        {screen.participant.name}님의 화면
      </span>
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
      <Avatar id={avatar} muted={muted} round={false} className="w-full" />
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-xs">{p.name}</span>
    </div>
  );
}

// 위쪽 오른쪽: 화면공유(PC만) + 마이크 스위치
function MediaControls() {
  const { localParticipant: me, isMicrophoneEnabled, isScreenShareEnabled } = useLocalParticipant();
  const canShare = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

  async function run(action: () => Promise<unknown>, fail: string) {
    try {
      await action();
    } catch (e) {
      // 화면공유 창에서 '취소'를 누른 경우는 조용히 넘어간다
      if ((e as Error).name !== "NotAllowedError" || fail !== "화면공유") alert(`${fail}를 켤 수 없어요.`);
    }
  }

  return (
    <>
      {canShare && (
        <button
          // 휴대폰은 화면공유를 못 하고 자리도 좁아서 숨긴다
          className={`hidden rounded-full px-3 py-1.5 sm:block ${isScreenShareEnabled ? "bg-indigo-600" : "bg-zinc-800 hover:bg-zinc-700"}`}
          onClick={() =>
            run(
              () =>
                me.setScreenShareEnabled(!isScreenShareEnabled, {
                  audio: true,
                  resolution: ScreenSharePresets.h1080fps30.resolution,
                  contentHint: "detail",
                  video: { displaySurface: "monitor" }, // 고르는 창에서 '전체 화면' 칸이 먼저 열리게
                  selfBrowserSurface: "exclude", // 이 탭은 목록에서 뺀다 (화면 속 화면이 끝없이 비치는 것 방지)
                }),
              "화면공유",
            )
          }
        >
          {isScreenShareEnabled ? "공유 중지" : "화면공유"}
        </button>
      )}
      <Switch label="마이크" on={isMicrophoneEnabled} onChange={(on) => run(() => me.setMicrophoneEnabled(on), "마이크")} />
    </>
  );
}

type Chat = ReturnType<typeof useChat>;

// "오전 12:03"
const chatTime = (t: number) => new Date(t).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });

// 카카오톡처럼: 남의 말은 왼쪽(사진·이름 + 회색 말풍선), 내 말은 오른쪽(보라색 말풍선).
// 같은 사람이 같은 분에 이어 보낸 말은 한 묶음이라 사진·이름은 첫 말에만, 시간은 마지막 말에만 붙인다.
function ChatLog({ messages, className }: { messages: Chat["chatMessages"]; className: string }) {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div className={`overflow-y-auto p-3 text-sm ${className}`}>
      {messages.map((m, i) => {
        const who = m.from?.identity;
        const same = (o?: (typeof messages)[number]) =>
          !!o && o.from?.identity === who && chatTime(o.timestamp) === chatTime(m.timestamp);
        const first = !same(messages[i - 1]);
        const last = !same(messages[i + 1]);
        const mine = m.from?.isLocal;
        return (
          <div key={m.id} className={`flex gap-2 ${mine ? "justify-end" : ""} ${first ? "mt-3" : "mt-1"}`}>
            {!mine &&
              (first ? (
                <Avatar id={m.from?.attributes?.avatar ?? AVATARS[0]} px={52} className="size-10 shrink-0 md:size-13" />
              ) : (
                <div className="w-10 shrink-0 md:w-13" />
              ))}
            <div className={`flex max-w-[75%] min-w-0 flex-col ${mine ? "items-end" : "items-start"}`}>
              {first && !mine && <span className="mb-1 text-xs text-zinc-400">{m.from?.name ?? "나간 사람"}</span>}
              <div className={`flex items-end gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
                <p
                  className={`min-w-0 rounded-2xl px-3 py-2 break-words whitespace-pre-wrap ${
                    mine ? "bg-indigo-600" : "bg-zinc-800"
                  } ${first ? (mine ? "rounded-tr-sm" : "rounded-tl-sm") : ""}`}
                >
                  {m.message}
                </p>
                {last && <span className="shrink-0 text-[11px] text-zinc-500">{chatTime(m.timestamp)}</span>}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={bottom} />
    </div>
  );
}

// 맨 아래 항상 보이는 입력칸. 보낸 뒤에도 입력칸에 그대로 머물러 휴대폰 자판이 닫히지 않는다.
function ChatInput({ send, className }: { send: Chat["send"]; className: string }) {
  const [text, setText] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        send(text.trim());
        setText("");
      }}
      // 아래 여백: 브라우저 맨 아래에 붙지 않게 (아이폰 홈 바 자리도 비움)
      className={`${className} flex shrink-0 gap-2 border-t border-zinc-800 px-3 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]`}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="메시지 입력"
        className="h-12 min-w-0 flex-1 rounded-full bg-zinc-800 px-5 text-base outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <button
        type="submit"
        disabled={!text.trim()}
        onPointerDown={(e) => e.preventDefault()} // 눌러도 입력칸에서 손이 안 떨어지게
        className="h-12 rounded-full bg-indigo-600 px-5 text-base font-semibold hover:bg-indigo-500 disabled:opacity-40"
      >
        보내기
      </button>
    </form>
  );
}
