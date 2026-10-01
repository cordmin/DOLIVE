"use client";

import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
  useIsMuted,
  useIsSpeaking,
} from "@livekit/components-react";
import { ConnectionError, ConnectionErrorReason, DisconnectReason, Track, type Participant, type RoomOptions } from "livekit-client";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Switch } from "@/components/Switch";
import { Tooltips } from "@/components/Tooltips";
import { VOICE_BOT, isPhone, leaveForDorms, savedAvatar } from "@/lib/dolive";
import { ChatInput, ChatLog, useMessages } from "./chat";
import { useReactions } from "./reactions";
import { MediaControls, useDuckShareAudio, usePauseOldShare, useShareRequests } from "./share";
import { Stage, useAvatarOf } from "./stage";

// 방 화면은 여러 파일로 나눠 둔다: chat.tsx(채팅), stage.tsx(공유 화면·프로필 사진 칸), share.tsx(화면공유·마이크), reactions.tsx(하트·ㅋ·헐)

// 영상은 화면공유뿐. 안 보이는 영상은 받지 않음(adaptiveStream).
// 단, 다른 앱에 갔다 와도 바로 보이게 뒤에 숨어 있는 동안에도 계속 받는다
// (끊었다 다시 받으면 새 그림 한 장이 올 때까지 검은 화면이 된다. 대신 숨어 있는 동안에도 데이터가 든다)
const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: { pauseVideoInBackground: false },
  dynacast: true,
};

type Conn = { token: string; url: string; isAdmin: boolean };

const CHAT_W_KEY = "dolive-chat-width"; // PC 채팅 카드 폭 기억 (이 브라우저에만)

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
      root.toggleAttribute("data-phone-land", land && isPhone());
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
    // 개발 중엔 이 부분이 두 번 돌아서, 마지막에 받은 입장권만 쓴다 (채팅이 방과 같은 입장권을 써야 해서)
    let alive = true;
    fetch("/api/token", { method: "POST", body: JSON.stringify({ name, avatar: savedAvatar(), photo: sessionStorage.getItem("photo") }) })
      .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json().catch(() => null))?.reason)))
      .then((c) => alive && setConn(c))
      // 도름스 확인에 막히면 다시 로그인하거나 안내 화면으로, 그 밖의 실패는 첫 화면으로
      .catch((reason) => alive && !leaveForDorms(reason) && router.replace("/"));
    return () => {
      alive = false;
    };
  }, [router]);

  // 방에서 나오면 첫 화면으로. 서버가 꺼져 있으면 첫 화면을 받아 올 수 없어서 멈춘 것처럼 보이니,
  // 먼저 서버에 물어보고 답이 없으면 이 자리에서 "방송이 끝났어요"를 보여 준다
  const [ended, setEnded] = useState(false);
  function goHome() {
    fetch("/", { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(3000) }).then(
      (r) => {
        if (!r.ok) return setEnded(true);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); // 입장할 때 켠 전체화면도 끝낸다
        router.push("/");
      },
      () => setEnded(true),
    );
  }

  if (ended)
    return (
      <div className="m-auto flex flex-col items-center gap-3 p-6 text-center">
        <b className="text-xl">
          DO<span className="text-red-500">LIVE</span>
        </b>
        <p>
          방송이 끝났어요.
          <br />
          다음에 다시 만나요.
        </p>
      </div>
    );
  if (!conn) return <p className="m-auto text-zinc-400">들어가는 중...</p>;

  return (
    <LiveKitRoom
      serverUrl={conn.url}
      token={conn.token}
      connect
      audio={false} // 마이크는 꺼진 채로 들어간다 (위쪽 스위치로 켠다)
      options={ROOM_OPTIONS}
      // 방장이 서버를 끄면서 방을 닫았으면(api/end) 물어볼 것 없이 바로 "방송이 끝났어요"
      onDisconnected={(reason) => (reason === DisconnectReason.ROOM_DELETED ? setEnded(true) : goHome())}
      onError={(e) => {
        // 다시 붙는 중에 [예]로 내가 끊은 건 오류가 아니다 (바로 "방송이 끝났어요" 화면이 뜬다)
        if (e instanceof ConnectionError && e.reason === ConnectionErrorReason.Cancelled) return;
        alert(`연결 오류: ${e.message}`);
      }}
      onMediaDeviceFailure={() =>
        alert("마이크를 쓸 수 없어요. 주소창 왼쪽 아이콘을 눌러 권한을 '허용'으로 바꿔 주세요.")
      }
      className="fixed inset-x-0 top-0 flex flex-col"
      style={{ height: "var(--vh, 100dvh)" }}
    >
      <RoomAudioRenderer />
      {/* 소리 켜기 안내 버튼은 두지 않는다. 브라우저가 소리를 막아 두면 화면 아무 데나 처음 누를 때 켠다 (RoomView) */}
      <RoomView isAdmin={conn.isAdmin} token={conn.token} />
    </LiveKitRoom>
  );
}

// 위: 로고, 참여자 수, (방장), 화면공유, 마이크 스위치
// 휴대폰: [화면공유 또는 프로필 사진 / 채팅 내용 / 메시지 입력칸]  (참여자 목록은 눌러서 연다)
// PC:     [화면공유 또는 프로필 사진 | 채팅 내용  ]
//         [참여자 한 줄              | 메시지 입력칸]
function RoomView({ isAdmin, token }: { isAdmin: boolean; token: string }) {
  // 나는 늘 맨 앞(왼쪽), 그다음 마이크를 켠 사람, 나머지는 들어온 순서 그대로. 마이크를 켜고 끄면 바로 자리가 바뀐다.
  // "/글" 을 읽어 주는 서버 참여자는 사람이 아니라서 목록·인원수에서 뺀다 (소리는 RoomAudioRenderer 가 그대로 튼다)
  const rank = (p: Participant) => (p.isLocal ? 2 : p.isMicrophoneEnabled ? 1 : 0);
  const participants = useParticipants()
    .filter((p) => p.identity !== VOICE_BOT)
    .sort((a, b) => rank(b) - rank(a));
  const [showPeople, setShowPeople] = useState(false); // 휴대폰에서 참여자 목록 열기
  const [peopleAt, setPeopleAt] = useState({ left: 0, top: 0 }); // 목록 카드가 내려올 자리 (배지 가로 가운데, 배지 바로 아래)
  // 채팅 글·사진 (들어올 때 서버 기록을 받고, 그 뒤엔 새로 온 것을 더한다)
  const { messages, send: sendChat, sendImage } = useMessages(token);
  // 공유가 여럿이면 멈추지 않은(보내는 중인) 것 하나만 보여 준다
  const screen = useTracks([Track.Source.ScreenShare])
    .filter((t) => !t.publication.isMuted)
    .at(-1);
  const room = useRoomContext();
  usePauseOldShare();
  useDuckShareAudio();

  const { floats, react } = useReactions();
  const { waiting, answer, asked, requestShare } = useShareRequests(isAdmin, participants);

  // PC 채팅 카드 폭(px). 왼쪽 가장자리를 끌어서 바꾸고, 이 브라우저에만 기억한다. null = 기본 폭
  const grid = useRef<HTMLDivElement>(null);
  const [chatW, setChatW] = useState<number | null>(() => {
    try {
      return Number(localStorage.getItem(CHAT_W_KEY)) || null;
    } catch {
      return null;
    }
  });
  function saveChatW(w: number | null) {
    setChatW(w);
    try {
      if (w) localStorage.setItem(CHAT_W_KEY, String(w));
      else localStorage.removeItem(CHAT_W_KEY);
    } catch {}
  }
  function dragChat(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault(); // 끄는 동안 글자가 선택되지 않게
    const handle = e.currentTarget;
    const box = grid.current!.getBoundingClientRect();
    handle.setPointerCapture(e.pointerId);
    let w = chatW;
    // 채팅 칸은 300px ~ 800px (창이 좁으면 절반까지). 큰 모니터에서 공유 화면 자리를 뺏지 않게
    const move = (ev: PointerEvent) => {
      w = Math.round(Math.min(Math.max(box.right - ev.clientX, 300), 800, box.width * 0.5));
      setChatW(w);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      saveChatW(w);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }

  // 채팅분리: 화면공유 하는 사람은 다른 프로그램을 보여 주느라 이 창을 못 보니까,
  // 늘 맨 위에 떠 있는 작은 창(크롬·엣지 PC만 됨)에 채팅을 띄운다.
  // 창 제목 줄의 주소와 창 투명도는 브라우저가 정하는 거라 바꿀 수 없다
  const docPip = typeof window !== "undefined" ? (window as { documentPictureInPicture?: DocPip }).documentPictureInPicture : undefined;
  const [pip, setPip] = useState<Window | null>(null);
  async function togglePip(on: boolean) {
    if (!on || !docPip) return pip?.close();
    const w = await docPip.requestWindow({ width: 360, height: 560 }).catch(() => null);
    if (!w) return alert("채팅 창을 띄울 수 없어요.");
    copyStyles(w);
    w.addEventListener("pagehide", () => setPip(null)); // 작은 창의 X를 눌러 닫았을 때
    setPip(w);
  }
  useEffect(() => () => pip?.close(), [pip]); // 방을 나가면 작은 창도 닫는다
  // 스위치는 내가 화면공유 중일 때만 보이고, 공유를 끝내면 작은 창도 닫는다
  const { isScreenShareEnabled: sharing } = useLocalParticipant();
  useEffect(() => {
    if (!sharing) pip?.close();
  }, [sharing, pip]);
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

  // 뒤로가기를 누르면 바로 나가지 않고 "DOLIVE를 나가시겠습니까?" 창을 먼저 띄운다.
  // 같은 주소를 한 칸 더 쌓아 두고, 뒤로가기로 그 칸이 빠지면 창을 연다
  const leave = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    history.pushState(history.state, "");
    const onBack = () => leave.current?.showModal();
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);
  function stay() {
    leave.current?.close();
    history.pushState(history.state, ""); // 다음 뒤로가기도 다시 막는다
  }

  return (
    <>
      <dialog
        ref={leave}
        onCancel={(e) => {
          e.preventDefault(); // Esc도 [아니오]와 똑같이
          stay();
        }}
        className="m-auto w-72 rounded-xl bg-zinc-800 p-5 text-zinc-100 ring-1 ring-zinc-700 backdrop:bg-black/60"
      >
        <p className="mb-10 text-center font-semibold">DOLIVE를 나가시겠습니까?</p>
        <div className="flex gap-2">
          <button onClick={() => room.disconnect()} className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold hover:bg-red-500">
            예
          </button>
          <button onClick={stay} className="flex-1 rounded-lg bg-zinc-700 py-2 text-sm hover:bg-zinc-600">
            아니오
          </button>
        </div>
      </dialog>
      {waiting && (
        <div className="fixed inset-x-0 top-16 z-30 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl bg-zinc-800 px-4 py-3 shadow-lg ring-1 ring-zinc-700">
          <span className="text-sm">
            <b>{waiting.name}</b>님이 화면공유를 하려고 해요
          </span>
          <button
            onClick={() => answer(waiting, true)}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold hover:bg-indigo-500"
          >
            승인
          </button>
          <button onClick={() => answer(waiting, false)} className="rounded-lg bg-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-600">
            거부
          </button>
        </div>
      )}
      <header
        className={`${hideOnLand} flex h-12 shrink-0 items-center gap-3 overflow-x-auto border-b border-zinc-800 px-3 md:border-b-0 text-sm whitespace-nowrap`}
      >
        <b className="text-base">
          DO<span className="text-red-500">LIVE</span>
        </b>
        {/* 휴대폰: 눌러서 참여자 목록을 여는 배지. 넓은 화면은 목록이 늘 보여서 그냥 글자 */}
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setPeopleAt({ left: r.left + r.width / 2, top: r.bottom + 8 });
            setShowPeople(!showPeople);
          }}
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
          {/* 서버 PC에서 들어온 사람도, 운영진 목록(서버 켜기 창 톱니바퀴)에 있는 도름스 회원도 "관리자" (입장 화면 오른쪽 위 표시와 같은 모양) */}
          {isAdmin && (
            <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-black">관리자</span>
          )}
          <MediaControls asked={asked} requestShare={requestShare} />
          {docPip && sharing && (
            <div className="hidden sm:block">
              <Switch label="채팅분리" on={!!pip} onChange={togglePip} />
            </div>
          )}
        </div>
      </header>

      {/* PC는 2x2 칸(grid). 오른쪽 채팅 칸은 기본 500px, 창이 좁으면 절반까지만 (끌어서 바꾼 폭이 있으면 그 폭). 휴대폰은 위에서 아래로 쌓고, 안쪽 칸(md:contents)이 참여자 목록을 띄울 자리가 된다.
          휴대폰 가로 + 화면공유는 공유 화면만 꽉 차게 (나머지는 hideOnLand 로 숨김) */}
      <div
        ref={grid}
        style={chatW ? { gridTemplateColumns: `minmax(0,1fr) min(${chatW}px,800px,50%)` } : undefined}
        className={`flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(0,1fr)_min(500px,50%)] md:grid-rows-[minmax(0,1fr)_auto] ${screen ? "phone-land:flex!" : ""}`}
      >
        {/* PC: 채팅 카드 왼쪽 가장자리. 끌면 폭이 바뀌고, 두 번 누르면 기본 폭으로. 평소엔 안 보이고 마우스를 올리면 보라색.
            위아래 끝은 채팅 카드 위아래 끝과 맞춘다(my-2) */}
        <div
          onPointerDown={dragChat}
          onDoubleClick={() => saveChatW(null)}
          data-tip="드래그 너비 조절"
          className={`z-10 hidden w-3 -translate-x-1.5 cursor-col-resize md:my-2 justify-self-start rounded-full hover:bg-indigo-500/40 md:col-start-2 md:row-span-2 md:row-start-1 md:block ${hideOnLand}`}
        />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:contents">
          {/* 휴대폰: 목록이 열려 있을 때 바깥을 누르면 닫힌다 */}
          {showPeople && <div onClick={() => setShowPeople(false)} className="fixed inset-0 z-20 md:hidden" />}
          {/* 휴대폰: 배지 아래로 스르륵 내려오는 둥근 카드 (가로 가운데를 배지와 맞춤). PC: 아래쪽 참여자 한 줄 */}
          <aside
            style={{ left: peopleAt.left, top: peopleAt.top }}
            className={`fixed z-30 flex max-h-[60dvh] w-max max-w-[80vw] origin-top -translate-x-1/2 flex-col gap-1 overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-2 shadow-xl shadow-black/50 transition-[opacity,translate,scale,visibility] duration-200 ease-out ${showPeople ? "" : "pointer-events-none invisible -translate-y-2 scale-95 opacity-0"} md:visible md:pointer-events-auto md:static md:col-start-1 md:row-start-2 md:max-h-none md:w-auto md:max-w-none md:translate-none md:scale-100 md:flex-row md:gap-1 md:overflow-x-auto md:overflow-y-hidden md:rounded-none md:border-0 md:px-3 md:z-auto md:opacity-100 md:shadow-none md:transition-none ${hideOnLand}`}
          >
            {participants.map((p) => (
              <PersonRow key={p.identity} p={p} isAdmin={isAdmin} />
            ))}
          </aside>

          <Stage participants={participants} screen={screen} floats={floats} />
          {/* 휴대폰에서 화면공유 중에 자판이 올라오면 채팅 내용 칸이 먼저 줄고, 그래도 좁으면 공유 화면도 줄어든다 */}
          <ChatLog
            messages={messages}
            // PC: 채팅 내용 + 아래 입력칸이 둥근 카드 하나로 이어진다 (구분선 없이 카드로 나눔)
            className={`${screen ? "min-h-24 flex-1" : "min-h-0 flex-1"} border-t border-zinc-800 md:col-start-2 md:row-start-1 md:mt-2 md:mr-2 md:min-h-0 md:rounded-t-xl md:border md:border-b-0 md:bg-zinc-800/40 ${hideOnLand}`}
          />
        </div>

        <ChatInput
          send={sendChat}
          sendImage={sendImage}
          react={react}
          // PC: 아래 줄 높이는 왼쪽 참여자 줄이 정해서 입력줄보다 높다. 남는 높이를 위아래 똑같이 나눠 입력줄을 가운데에 (flex-wrap 이어야 content-center 가 먹는다).
          // 경계선이 없어서 "맨 아래로" 버튼은 이 칸 위쪽 끝을 사이에 두고 보내기 버튼과 대칭 = (칸 높이 - 버튼 48px) / 2
          className={`md:col-start-2 md:row-start-2 md:mr-2 md:mb-2 md:flex-wrap md:content-center md:rounded-b-xl md:border md:border-t-0 md:bg-zinc-800/40 md:pb-3 md:[--down-gap:calc(50%-24px)] ${hideOnLand}`}
        />
      </div>

      {pip &&
        createPortal(
          <div className="flex h-dvh flex-col">
            <ChatLog messages={messages} className="min-h-0 flex-1" />
            <ChatInput send={sendChat} sendImage={sendImage} react={react} className="" />
            <Tooltips doc={pip.document} />
          </div>,
          pip.document.body,
        )}
      <Tooltips />
    </>
  );
}

type DocPip = { requestWindow(size: { width: number; height: number }): Promise<Window> };

// 작은 창은 빈 페이지라서, 이 페이지의 꾸밈(색·글꼴·배치)을 그대로 옮겨 준다
function copyStyles(w: Window) {
  for (const s of document.styleSheets) {
    try {
      const el = w.document.createElement("style");
      el.textContent = [...s.cssRules].map((r) => r.cssText).join("\n");
      w.document.head.append(el);
    } catch {
      // 다른 주소에서 온 꾸밈은 내용을 못 읽어서 주소째 붙인다
      const el = w.document.createElement("link");
      el.rel = "stylesheet";
      el.href = s.href ?? "";
      w.document.head.append(el);
    }
  }
  w.document.documentElement.className = document.documentElement.className;
  w.document.body.className = document.body.className;
}


// 방장은 다른 사람 사진 구석의 초록 점(마이크 켜짐)을 누르면 그 사람 마이크를 끈다 (/api/mute 가 방장인지 다시 확인한다)
function PersonRow({ p, isAdmin }: { p: Participant; isAdmin: boolean }) {
  const speaking = useIsSpeaking(p);
  const muted = useIsMuted({ participant: p, source: Track.Source.Microphone });

  async function forceMute() {
    const r = await fetch("/api/mute", { method: "POST", body: JSON.stringify({ identity: p.identity }) });
    if (!r.ok) alert("마이크를 끄지 못했어요.");
  }

  return (
    // 사진 + 이름 (PC 아래쪽 한 줄은 사진 밑에 이름). 마이크는 사진 구석 점, 말하는 중은 초록 테두리.
    // 나는 사진 아래에 걸친 ME (이름 옆에 붙이면 이름이 잘려서)
    <div className="flex items-center gap-2 rounded p-1 hover:bg-zinc-800 md:w-[4.5rem] md:shrink-0 md:flex-col md:gap-2">
      <div className="relative shrink-0">
        <Avatar id={useAvatarOf(p)} talking={speaking && !muted} mic={!muted} px={47} className="w-10 md:w-[47px]" />
        {p.isLocal && (
          <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-1 text-[10px] leading-[14px] font-bold ring-2 ring-zinc-900">
            ME
          </span>
        )}
        {/* 점이 작아서 누르기 쉽게 점 둘레까지 누르는 자리로 */}
        {isAdmin && !p.isLocal && !muted && (
          <button
            onClick={forceMute}
            data-tip="마이크 끄기"
            aria-label={`${p.name} 마이크 끄기`}
            className="absolute -right-1.5 -bottom-1.5 size-6 rounded-full hover:bg-red-500/40"
          />
        )}
      </div>
      <div className="min-w-0 truncate text-sm md:w-full md:text-center">{p.name}</div>
    </div>
  );
}

