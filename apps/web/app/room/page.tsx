"use client";

import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useLocalParticipant,
  useParticipantAttributes,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { ConnectionError, ConnectionErrorReason, ConnectionState, DisconnectReason, Track, VideoPresets, type Participant, type RoomOptions } from "livekit-client";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Knob } from "@/components/Knob";
import { Tooltips } from "@/components/Tooltips";
import { VOICE_BOT, isPhone, leaveForDorms, savedAvatar } from "@/lib/dolive";
import { ChatInput, ChatLog } from "./chat";
import { useReactions } from "./reactions";
import { CAM_CAPTURE } from "./camera";
import { MediaControls, useDuckShareAudio, usePauseOldShare, useShareRequests } from "./share";
import { SplitTop, Stage } from "./stage";
import { DonationDialog } from "./donation";
import { donationReturning, DONATION_RETURN_KEY } from "./donation-connection";
import { usePhoneAudio } from "./phone-audio";
import { PersonRow, SplitPeople } from "./participants";
import { useMessages } from "./messages";
import { useSplitChat } from "./split-chat";
import { RecordKnob } from "./recording";
import { ROOM_ENTRY_KEY, leaveRoomHistory, watchRoomBack } from "@/lib/roomHistory";

// 방 화면: chat.tsx(채팅 화면), messages.ts(채팅 주고받기), participants.tsx(참여자·관리 메뉴), split-chat.ts(채팅 분리 창).
// stage.tsx(공유 화면·얼굴), share.tsx(화면공유·마이크), camera.tsx(카메라), reactions.tsx(하트·ㅋ·헐).

// 영상은 화면공유와 얼굴(카메라). 안 보이는 영상은 받지 않고, 작게 보이는 영상은 작은 화질로 받음(adaptiveStream).
// 단, 다른 앱에 갔다 와도 바로 보이게 뒤에 숨어 있는 동안에도 계속 받는다
// (끊었다 다시 받으면 새 그림 한 장이 올 때까지 검은 화면이 된다. 대신 숨어 있는 동안에도 데이터가 든다)
// 얼굴은 640x360(약 0.45Mbps, 1초 20장)과 320x180(약 0.16Mbps) 두 가지로 보내고, 서버가 보는 칸 크기에 맞는 쪽만 보낸다.
// 서버 인터넷 올리는 속도 300Mbps 를 기준으로 잡았다: 방 4개 x 20명이 모두 화면공유 + 한 사람이 얼굴 6개(휴대폰 4개)까지 봐도 넘지 않게 (stage.tsx 의 MAX_*)
const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: { pauseVideoInBackground: false },
  dynacast: true,
  videoCaptureDefaults: { resolution: CAM_CAPTURE },
  publishDefaults: { videoEncoding: VideoPresets.h360.encoding, videoSimulcastLayers: [VideoPresets.h180] },
  // 수정용 서버는 내부 브라우저에서도 열리도록 기존 연결 방식을 쓴다.
  singlePeerConnection: process.env.NODE_ENV !== "development",
};

type Conn = { token: string; url: string };

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
  const leavingPage = useRef(false);
  useFitVisibleHeight();
  usePhoneLandscape();

  useEffect(() => {
    // 도름스 허용이나 새로고침으로 화면을 떠날 때는 퇴장 처리로 이동을 가로막지 않는다.
    const leaving = () => { leavingPage.current = true; };
    const returned = () => { leavingPage.current = false; };
    window.addEventListener("beforeunload", leaving);
    window.addEventListener("pagehide", leaving);
    window.addEventListener("pageshow", returned);
    return () => {
      window.removeEventListener("beforeunload", leaving);
      window.removeEventListener("pagehide", leaving);
      window.removeEventListener("pageshow", returned);
    };
  }, []);

  useEffect(() => {
    const name = sessionStorage.getItem("name");
    if (!name || sessionStorage.getItem(ROOM_ENTRY_KEY) !== "1") {
      router.replace("/");
      return;
    }
    // 개발 중엔 이 부분이 두 번 돌아서, 마지막에 받은 입장권만 쓴다 (채팅이 방과 같은 입장권을 써야 해서)
    let alive = true;
    // room·password: 입장 화면에서 고른 방송과 그 비밀번호 (비밀번호 방이 아니면 빈칸)
    const body = { name, avatar: savedAvatar(), photo: sessionStorage.getItem("photo"), room: sessionStorage.getItem("room"), password: sessionStorage.getItem("password") };
    fetch("/api/token", { method: "POST", body: JSON.stringify(body) })
      .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json().catch(() => null))?.reason)))
      .then((c) => alive && setConn(c))
      // 도름스 확인에 막히면 다시 로그인하거나 안내 화면으로, 그 밖의 실패(방송이 닫혔거나 비밀번호가 바뀜 등)는 첫 화면으로
      .catch((reason) => {
        if (!alive) return;
        sessionStorage.removeItem(ROOM_ENTRY_KEY);
        // 도름스 연수 방이면 그 연수의 입장 화면으로 돌아가 까닭을 본다 (로그인이 풀렸으면 거기서 다시 로그인한다)
        const yeonsu = /^yeonsu-([0-9a-f-]{36})$/.exec(body.room ?? "")?.[1];
        if (yeonsu) return router.replace(`/yeonsu/${yeonsu}`);
        if (!leaveForDorms(reason)) router.replace("/");
      });
    return () => {
      alive = false;
    };
  }, [router]);

  // 방에서 나오면 첫 화면으로. 서버가 꺼져 있으면 첫 화면을 받아 올 수 없어서 멈춘 것처럼 보이니,
  // 먼저 서버에 물어보고 답이 없으면 이 자리에서 "방송이 끝났어요"를 보여 준다
  const [ended, setEnded] = useState<"" | "end" | "kick">(""); // end = 방송이 끝남, kick = 방장이 내보냄(api/kick)
  function goHome() {
    sessionStorage.removeItem(ROOM_ENTRY_KEY);
    fetch("/", { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(3000) }).then(
      (r) => {
        if (!r.ok) return setEnded("end");
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); // 사용자가 켠 전체화면도 끝낸다
        leaveRoomHistory(() => router.replace("/"));
      },
      () => setEnded("end"),
    );
  }

  if (ended)
    return (
      <div className="m-auto flex flex-col items-center gap-3 p-6 text-center">
        <b className="text-xl">
          DO<span className="text-red-500">LIVE</span>
        </b>
        <p>
          {ended === "kick" ? "방에서 내보내졌어요." : "방송이 끝났어요."}
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
      // 방장이 내보냈으면(api/kick) "방에서 내보내졌어요"
      onDisconnected={(reason) => {
        if (leavingPage.current && reason === DisconnectReason.CLIENT_INITIATED) return;
        sessionStorage.removeItem(ROOM_ENTRY_KEY);
        if (reason === DisconnectReason.ROOM_DELETED) setEnded("end");
        else if (reason === DisconnectReason.PARTICIPANT_REMOVED) setEnded("kick");
        else goHome();
      }}
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
      <RoomView token={conn.token} />
    </LiveKitRoom>
  );
}

// 위: 로고, 참여자 수, (방장), 화면공유, 마이크 스위치
// 휴대폰: [화면공유 또는 프로필 사진 / 채팅 내용 / 메시지 입력칸]  (참여자 목록은 눌러서 연다)
// PC:     [화면공유 또는 프로필 사진 | 채팅 내용  ]
//         [참여자 한 줄              | 메시지 입력칸]
function RoomView({ token }: { token: string }) {
  // 이 방의 방장 노릇(마스터·운영진·방을 만든 사람)과 방 주인. 방장을 넘기면 서버가 표시를 바꿔서 바로 바뀐다 (api/owner)
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const mine = useParticipantAttributes({ participant: localParticipant }).attributes;
  const isAdmin = mine?.roomAdmin === "1";
  const isOwner = mine?.owner === "1";
  // 나는 늘 맨 앞(왼쪽), 그다음 마이크를 켠 사람, 나머지는 들어온 순서 그대로. 마이크를 켜고 끄면 바로 자리가 바뀐다.
  // "/글" 을 읽어 주는 서버 참여자는 사람이 아니라서 목록·인원수에서 뺀다 (소리는 RoomAudioRenderer 가 그대로 튼다)
  const rank = (p: Participant) => (p.isLocal ? 2 : p.isMicrophoneEnabled ? 1 : 0);
  const participants = useParticipants()
    .filter((p) => p.identity !== VOICE_BOT)
    .sort((a, b) => rank(b) - rank(a));
  const [showPeople, setShowPeople] = useState(false); // 휴대폰에서 참여자 목록 열기
  const [peopleAt, setPeopleAt] = useState({ left: 0, top: 0 }); // 목록 카드가 내려올 자리 (배지 가로 가운데, 배지 바로 아래)
  // 채팅 글·사진 (들어올 때 서버 기록을 받고, 그 뒤엔 새로 온 것을 더한다)
  const { messages, send: sendChat, sendImage, remove: removeChat, edit: editChat } = useMessages(token);
  // 공유가 여럿이면 멈추지 않은(보내는 중인) 것 하나만 보여 준다
  const screen = useTracks([Track.Source.ScreenShare])
    .filter((t) => !t.publication.isMuted)
    .at(-1);
  const room = useRoomContext();
  usePhoneAudio(room, isMicrophoneEnabled);
  usePauseOldShare();
  useDuckShareAudio();

  const { floats, react, donation } = useReactions();
  const [donating, setDonating] = useState(() => donationReturning(room.name));
  useEffect(() => {
    if (donationReturning(room.name)) sessionStorage.removeItem(DONATION_RETURN_KEY);
  }, [room.name]);
  const { waiting, answer, asked, requestShare } = useShareRequests(isAdmin, participants, token);

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
    // 채팅 칸은 300px ~ 600px (창이 좁으면 절반까지). 큰 모니터에서 공유 화면 자리를 뺏지 않게
    const move = (ev: PointerEvent) => {
      w = Math.round(Math.min(Math.max(box.right - ev.clientX, 300), 600, box.width * 0.5));
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

  const { isScreenShareEnabled: sharing } = useLocalParticipant();
  const { pip, docPip, togglePip } = useSplitChat(sharing, isAdmin);
  // PC와 휴대폰 모두 전체화면 버튼으로 켜고 끈다.
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  useEffect(() => {
    setCanFullscreen(!!document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function");
    const update = () => setFullscreen(!!document.fullscreenElement);
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggleFullscreen = () =>
    document.fullscreenElement ? document.exitFullscreen().catch(() => {}) : document.documentElement.requestFullscreen?.().catch(() => {});
  // PC 로고 아래 불빛: 통화 서버와 이어져 있으면 초록 "방송중", 끊겨서 다시 붙는 중이면 호박색
  const live = useConnectionState() === ConnectionState.Connected;

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

  // 뒤로가기를 누르면 바로 나가지 않고 "메인으로 나가시겠습니까?" 창을 먼저 띄운다.
  // 확인창용 기록은 한 칸만 두고, 퇴장할 때 함께 정리한다.
  const leave = useRef<HTMLDialogElement>(null);
  const backGuard = useRef<ReturnType<typeof watchRoomBack> | null>(null);
  useEffect(() => {
    const guard = watchRoomBack(() => {
      if (!leave.current?.open) leave.current?.showModal();
    }, () => leave.current?.close());
    backGuard.current = guard;
    return () => { guard.dispose(); backGuard.current = null; };
  }, []);
  function stay() {
    backGuard.current?.stay();
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
        <p className="mb-5 text-center font-semibold">메인으로 나가시겠습니까?</p>
        {/* 버튼의 얇은 테두리까지 포함해, 사이 간격과 아래 여백을 맞춘다. */}
        <div className="flex gap-[21px]">
          <button onClick={() => room.disconnect()} className="dolive-button flex-1 rounded-lg bg-zinc-700 py-2 text-sm font-semibold hover:bg-zinc-600"><span className="dolive-button-cap">
            예
          </span></button>
          <button onClick={stay} className="dolive-button dolive-danger flex-1 rounded-lg bg-red-600 py-2 text-sm hover:bg-red-500"><span className="dolive-button-cap">
            아니오
          </span></button>
        </div>
      </dialog>
      {waiting && (
        <div className="fixed inset-x-0 top-16 z-30 mx-auto flex w-fit md:top-28 max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl bg-zinc-800 px-4 py-3 shadow-lg ring-1 ring-zinc-700">
          <span className="text-sm">
            <b>{waiting.name}</b>님이 화면공유를 하려고 해요
          </span>
          <button
            onClick={() => answer(waiting, true)}
            className="dolive-button dolive-primary rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold hover:bg-indigo-500"
          ><span className="dolive-button-cap">
            승인
          </span></button>
          <button onClick={() => answer(waiting, false)} className="dolive-button dolive-danger rounded-lg bg-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-600"><span className="dolive-button-cap">
            거부
          </span></button>
        </div>
      )}
      {/* PC: 바깥 판 없이 공유 화면과 채팅의 파인 테두리만 둔다. 휴대폰은 그대로 */}
      <div className="contents md:flex md:min-h-0 md:flex-1 md:flex-col md:gap-3.5 md:px-[18px] md:pt-3.5 md:pb-[18px]">
        <header
          // 위 줄(로고·참여자·버튼들) 어디를 오른쪽 클릭해도 브라우저 메뉴가 뜨지 않게 (카메라 버튼·참여자는 자기 메뉴를 먼저 띄운다)
          onContextMenu={(e) => e.preventDefault()}
          // PC 는 아래로 펼치는 참여자 목록이 잘리지 않게 overflow 를 풀어 둔다 (휴대폰은 좁아서 옆으로 밀어 본다)
          className={`${hideOnLand} flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-zinc-800 px-3 md:h-auto md:gap-4 md:overflow-visible md:border-b-0 md:px-0 text-sm whitespace-nowrap`}
        >
          {/* 로고를 누르면 메인화면으로 돌아간다. */}
          <button type="button" onClick={() => leave.current?.showModal()} aria-label="메인화면으로 가기" className="text-base font-bold md:hidden">
            DO<span className="text-red-500">LIVE</span>
          </button>
          {/* PC: 로고(+ 관리자 배지) 아래에 불빛과 참여자 수 */}
          <div className="hidden flex-col gap-1.5 md:flex">
            <div className="flex items-center gap-2">
              <button type="button" aria-label="메인화면으로 가기" onClick={() => leave.current?.showModal()} className="cursor-pointer text-2xl font-bold tracking-tight text-[#d3d0ca] transition-[filter,text-shadow] duration-150 hover:brightness-125 hover:[text-shadow:0_0_10px_rgb(255_255_255/0.2)] focus-visible:rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-zinc-400">
                DO<span className="text-red-500">LIVE</span>
              </button>
              {/* 서버 PC에서 들어온 사람도, 운영진 목록에 있는 도름스 회원도 "관리자". 아니면 배지 없음 */}
              {isAdmin && (
                <span className="translate-y-px rounded-[3px] border border-[#e8b46a]/40 px-1.5 text-[11px] leading-[17px] text-[#e8b46a]">관리자</span>
              )}
            </div>
            <span className="flex items-center gap-1.5 text-[11px] text-[#a39f98]">
              <span className={`hw-led ${live ? "hw-led-green" : "hw-led-amber"}`} />
              참여 {participants.length}명
            </span>
          </div>
          {/* 휴대폰: 눌러서 참여자 목록을 여는 배지. 넓은 화면은 목록이 늘 보여서 그냥 글자 */}
          <button
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPeopleAt({ left: r.left + r.width / 2, top: r.bottom + 8 });
              setShowPeople(!showPeople);
            }}
            aria-expanded={showPeople}
            className="flex min-h-11 shrink-0 items-center gap-1 rounded px-1 text-xs font-normal text-[#b1aea8] active:text-zinc-100 focus-visible:outline-2 focus-visible:outline-zinc-400 md:hidden"
          ><span className="flex items-center gap-1">
            참여 {participants.length}명
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden
              className={`size-4 transition-transform md:hidden ${showPeople ? "rotate-180" : ""}`}
            >
              <path d="M5.2 7.2a.75.75 0 0 1 1.06 0L10 10.94l3.74-3.74a.75.75 0 1 1 1.06 1.06l-4.27 4.27a.75.75 0 0 1-1.06 0L5.2 8.26a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </span></button>
          {/* PC: 참여자 사진·이름을 한 줄로. 자리가 모자라면 뒤쪽은 안 보이고(다음 줄로 넘어가 가려짐), 마우스를 올리면 아래로 스르륵 펼쳐 모두 보여 준다.
              사진은 오른쪽 버튼과 같은 38px, 이름은 사진 아래 가운데 */}
          <div
            // 펼친 목록을 아래로 내려 본 채 마우스가 나가도, 접히면서 맨 위(나 → 마이크 켠 사람 → 나머지 순서의 첫 줄)로 돌아오게
            onPointerLeave={(e) => e.currentTarget.firstElementChild?.scrollTo({ top: 0, behavior: "smooth" })}
            // 빈 곳을 오른쪽 클릭해도 브라우저 메뉴가 뜨지 않게 (사람 위는 PersonRow 가 자기 메뉴를 띄운다)
            onContextMenu={(e) => e.preventDefault()}
            className="group relative mr-6 hidden h-[71px] min-w-0 flex-1 md:z-30 md:block md:translate-y-[2px]"
          >
            <div className="absolute inset-x-0 top-0 z-30 h-[71px] max-h-[60vh] overflow-hidden rounded-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden transition-[height,background-color,box-shadow] duration-300 ease-out [interpolate-size:allow-keywords] strip-open:h-auto strip-open:-inset-x-2 strip-open:overflow-y-auto strip-open:bg-[#232324] strip-open:p-2 strip-open:shadow-xl strip-open:shadow-black/50 strip-open:ring-1 strip-open:ring-[#3a3836]">
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                {participants.map((p) => (
                  <PersonRow key={p.identity} p={p} isAdmin={isAdmin} isOwner={isOwner} token={token} />
                ))}
              </div>
            </div>
          </div>
          {/* 휴대폰: 버튼 4개(전체화면·TTS·카메라·마이크)가 375px 폭에 다 들어가게 사이를 8px 로 */}
          <div className="ml-auto mr-1.5 flex items-center gap-2 md:mr-0 md:items-end md:gap-5">
            {canFullscreen && <Knob
              compactMobile
              label="전체화면"
              mobileRing={false}
              led={fullscreen ? "green" : undefined}
              aria-pressed={fullscreen}
              onClick={toggleFullscreen}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-[17px]">
                  <path className="hidden md:block" d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
                  <path className="md:hidden" d={fullscreen ? "M3 8h5V3M16 3v5h5M21 16h-5v5M8 21v-5H3" : "M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"} />
                </svg>
              }
            />}
            <MediaControls asked={asked} requestShare={requestShare} token={token} record={isAdmin && typeof window !== "undefined" && !isPhone() && <RecordKnob screen={screen} />} />
            {docPip && sharing && isAdmin && (
              <Knob
                className="hidden md:flex"
                role="switch"
                aria-checked={!!pip}
                label="채팅 분리"
                led={pip ? "green" : undefined}
                onClick={() => togglePip(!pip)}
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-[17px]">
                    <rect x="3" y="5" width="12" height="10" rx="2" />
                    <path d="M9 19h10a2 2 0 0 0 2-2V9" />
                  </svg>
                }
              />
            )}
          </div>
        </header>

        {/* PC는 2x2 칸(grid): 왼쪽은 위아래 두 칸을 다 쓰는 공유 화면, 오른쪽은 채팅 내용 + 입력칸. 오른쪽 채팅 칸은 기본 500px, 창이 좁으면 절반까지만 (끌어서 바꾼 폭이 있으면 그 폭).
            휴대폰은 위에서 아래로 쌓고, 안쪽 칸(md:contents)이 참여자 목록을 띄울 자리가 된다. (PC 참여자 목록은 맨 위 줄에)
            휴대폰 가로 + 화면공유는 공유 화면만 꽉 차게 (나머지는 hideOnLand 로 숨김) */}
        <div
          ref={grid}
          style={chatW ? { gridTemplateColumns: `minmax(0,1fr) min(${chatW}px,600px,50%)` } : undefined}
          className={`flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(0,1fr)_min(500px,50%)] md:grid-rows-[minmax(0,1fr)_auto] ${screen ? "phone-land:flex!" : ""}`}
        >
          {/* PC: 채팅 카드 왼쪽 가장자리. 끌면 폭이 바뀌고, 두 번 누르면 기본 폭으로. 평소엔 안 보이고 마우스를 올리면 보라색.
              위아래 끝은 채팅 카드 위아래 끝과 맞춘다 */}
          <div
            onPointerDown={dragChat}
            onDoubleClick={() => saveChatW(null)}
            data-tip="드래그 너비 조절"
            className={`z-10 hidden w-3 -translate-x-1.5 cursor-col-resize justify-self-start rounded-full hover:bg-indigo-500/40 md:col-start-2 md:row-span-2 md:row-start-1 md:block ${hideOnLand}`}
          />
          {/* 공유 화면을 쓸어 올려 커지는 동안(data-grow)은 위로 삐져나와도 잘리지 않게 */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:contents [&:has([data-grow])]:overflow-visible">
            {/* 휴대폰: 목록이 열려 있을 때 바깥을 누르면 닫힌다 */}
            {showPeople && <div onClick={() => setShowPeople(false)} className="fixed inset-0 z-20 md:hidden" />}
            {/* 휴대폰: 배지 아래로 스르륵 내려오는 둥근 카드 (가로 가운데를 배지와 맞춤). PC 는 맨 위 줄에 따로 있어서 숨긴다 */}
            <aside
              style={{ left: peopleAt.left, top: peopleAt.top }}
              className={`fixed z-30 flex max-h-[60dvh] w-max max-w-[80vw] origin-top -translate-x-1/2 flex-col gap-1 overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-2 shadow-xl shadow-black/50 transition-[opacity,translate,scale,visibility] duration-200 ease-out ${showPeople ? "" : "pointer-events-none invisible -translate-y-2 scale-95 opacity-0"} md:hidden ${hideOnLand}`}
            >
              {participants.map((p) => (
                <PersonRow key={p.identity} p={p} isAdmin={isAdmin} isOwner={isOwner} token={token} />
              ))}
            </aside>

            <Stage screen={screen} floats={floats} confirmShare={() => isAdmin && !isPhone() ? togglePip(true) : Promise.resolve(true)} />
            <div className={`flex min-h-0 flex-1 flex-col md:contents ${hideOnLand}`}>
              {/* PC만 채팅 내용과 입력칸을 한 테두리로 감싼다. 그림자만 겹쳐서 버튼 누르기와 폭 조절은 그대로 */}
              <div aria-hidden className="pointer-events-none z-20 hidden rounded-xl md:block md:hw-inset md:col-start-2 md:row-span-2 md:row-start-1" />
              {/* 휴대폰에서 화면공유 중에 자판이 올라오면 채팅 내용 칸이 먼저 줄고, 그래도 좁으면 공유 화면도 줄어든다 */}
              <ChatLog
                messages={messages}
                isAdmin={isAdmin}
                remove={removeChat} edit={editChat}
                // PC: 채팅 내용 + 아래 입력칸이 둥근 카드 하나로 이어진다 (구분선 없이 카드로 나눔)
                // (PC 카드 색 #1e1e21 = 예전 zinc-900 바탕 위 zinc-800/40 과 같은 색. 판 위에서도 지금과 같아 보이게)
                className={`${screen ? "min-h-24 flex-1" : "min-h-0 flex-1"} md:rounded-t-xl md:col-start-2 md:row-start-1 md:min-h-0 md:bg-[#1e1e21] ${hideOnLand}`}
              />

              <ChatInput
                donate={() => setDonating(true)}
                send={sendChat}
                sendImage={sendImage}
                react={react}
                // PC: 경계선이 없어서 "맨 아래로" 버튼은 이 칸 위쪽 끝을 사이에 두고 보내기 버튼과 대칭 = (칸 높이 - 버튼 48px) / 2
                className={`border-t-0! md:rounded-b-xl md:col-start-2 md:row-start-2 md:bg-[#1e1e21] md:pb-3 md:[--down-gap:calc(50%-24px)] ${hideOnLand}`}
              />
            </div>
          </div>
        </div>
      </div>

      {pip &&
        createPortal(
          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            <SplitTop screen={screen}><SplitPeople participants={participants} /></SplitTop>
            <ChatLog messages={messages} isAdmin={isAdmin} remove={removeChat} edit={editChat} className="min-h-0 flex-1" />
            <ChatInput send={sendChat} sendImage={sendImage} react={react} donate={() => setDonating(true)} className="border-t-0! px-2.5! pt-2! pb-2!" />
            <Tooltips doc={pip.document} />
          </div>,
          pip.document.body,
        )}
      {donating && <DonationDialog token={token} room={room.name} isGuest={!mine?.dorms} close={() => setDonating(false)} success={donation} />}
      <Tooltips />
    </>
  );
}
