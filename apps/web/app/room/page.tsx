"use client";

import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useChat,
  useDataChannel,
  useIsMuted,
  useIsSpeaking,
  useLocalParticipant,
  useLocalParticipantPermissions,
  useParticipantAttributes,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import type { TrackReference } from "@livekit/components-react";
import {
  ConnectionError,
  ConnectionErrorReason,
  Participant,
  RoomEvent,
  RoomOptions,
  ScreenSharePresets,
  Track,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/Avatar";
import { Switch } from "@/components/Switch";
import { Tooltips } from "@/components/Tooltips";
import { AVATARS, CUSTOM, savedAvatar } from "@/lib/dolive";

// 영상은 화면공유뿐. 안 보이는 영상은 받지 않음(adaptiveStream).
const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
};

// 공유하는 사람이 고르는 화질. 공유는 고른 화질과 한 단계 낮은 화질을 같이 보내고,
// 보는 사람 인터넷이 느려서 끊기면 서버가 그 사람에게만 낮은 쪽으로 자동으로 바꿔 보낸다.
const QUALITY = {
  "1080p": { top: ScreenSharePresets.h1080fps30, low: ScreenSharePresets.h720fps30 },
  "720p": { top: ScreenSharePresets.h720fps30, low: ScreenSharePresets.h360fps15 },
};
type Quality = keyof typeof QUALITY;

type Conn = { token: string; url: string; isAdmin: boolean };

const CHAT_W_KEY = "dolive-chat-width"; // PC 채팅 카드 폭 기억 (이 브라우저에만)

// 화면공유 요청("request")과 거부("denied")를 주고받는 채널
const SHARE_TOPIC = "dolive-share";
const SCREEN_SHARE_SOURCE = 3; // LiveKit 권한 목록에서 화면공유를 뜻하는 번호 (TrackSource.SCREEN_SHARE)
const text = (s: string) => new TextEncoder().encode(s);

// 각자 고른 사진(프로필 "custom")은 서버에 저장하지 않는다. 방 안에서 통화 연결로 바로 주고받고, 이 탭 메모리에만 둔다.
// 사람 identity -> 사진 주소(data:/blob:)
const PHOTO_TOPIC = "dolive-photo";
const photos = new Map<string, string>();
const photoListeners = new Set<() => void>();
let photoVersion = 0;

function setPhoto(identity: string, url?: string) {
  const old = photos.get(identity);
  if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
  if (url) photos.set(identity, url);
  else photos.delete(identity);
  photoVersion++;
  photoListeners.forEach((l) => l());
}

function usePhotos() {
  useSyncExternalStore(
    (l) => {
      photoListeners.add(l);
      return () => {
        photoListeners.delete(l);
      };
    },
    () => photoVersion,
    () => 0,
  );
  return photos;
}

// 사진 번호, 또는 그 사람이 고른 사진 주소 (아직 못 받았으면 "" = 빈 회색)
const avatarOf = (p: Participant | undefined) => {
  const a = p?.attributes?.avatar ?? AVATARS[0];
  return a === CUSTOM ? (photos.get(p!.identity) ?? "") : a;
};

// 내 사진이 있으면 방에 들어갈 때 먼저 와 있던 사람 모두에게 보내고, 나중에 누가 들어오면 그 사람에게 보낸다.
function usePhotoExchange() {
  const room = useRoomContext();
  useEffect(() => {
    const mine = sessionStorage.getItem("avatar") === CUSTOM ? sessionStorage.getItem("photo") : null;
    const sendMine = async (to?: string[]) => {
      if (!mine) return;
      const blob = await (await fetch(mine)).blob();
      await room.localParticipant
        .sendFile(new File([blob], "photo.jpg", { type: "image/jpeg" }), { topic: PHOTO_TOPIC, destinationIdentities: to })
        .catch(() => {});
    };

    room.registerByteStreamHandler(PHOTO_TOPIC, async (reader, { identity }) => {
      const chunks = await reader.readAll();
      if (chunks.reduce((n, c) => n + c.length, 0) > 300 * 1024) return; // 사진치고 너무 크면 버린다
      setPhoto(identity, URL.createObjectURL(new Blob(chunks as BlobPart[], { type: "image/jpeg" })));
    });
    const onJoin = (p: RemoteParticipant) => sendMine([p.identity]);
    const onLeave = (p: RemoteParticipant) => setPhoto(p.identity);
    const start = () => {
      if (mine) setPhoto(room.localParticipant.identity, mine);
      sendMine();
    };
    room.on(RoomEvent.ParticipantConnected, onJoin).on(RoomEvent.ParticipantDisconnected, onLeave);
    if (room.state === "connected") start();
    else room.once(RoomEvent.Connected, start);
    return () => {
      room.unregisterByteStreamHandler(PHOTO_TOPIC);
      room
        .off(RoomEvent.ParticipantConnected, onJoin)
        .off(RoomEvent.ParticipantDisconnected, onLeave)
        .off(RoomEvent.Connected, start);
    };
  }, [room]);
}

// 채팅에 붙여 넣은 사진. 서버에 저장하지 않고 방 안에서 통화 연결로 바로 주고받아 이 탭 메모리에만 둔다.
// (그래서 나중에 들어온 사람은 그 전 사진을 못 본다. 글 채팅과 같다)
const IMAGE_TOPIC = "dolive-chat-image";
const IMAGE_MAX = 10 * 1024 * 1024;
// 보여 줘도 안전한 사진 종류만 (SVG 같은 건 새 탭에서 열 때 이 사이트 안에서 코드가 돌 수 있어서 뺀다)
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// image: 사진 주소(이 탭 메모리), imageType: 저장할 때 파일 끝 이름(.png 등)을 정하려고
type Msg = { id: string; timestamp: number; from?: Participant; message: string; image?: string; imageType?: string };

// 글 채팅과 사진을 도착/작성 순서대로 하나의 목록에 쌓는다.
// (기기간 시계 오차로 타임스탬프가 달라도 방금 쓴 글이 중간에 끼지 않고 항상 맨 아래에 오도록)
function useMessages() {
  const room = useRoomContext();
  const chat = useChat();
  const [messages, setMessages] = useState<Msg[]>([]);
  const seenIds = useRef(new Set<string>());

  // 글 채팅 동기화: 새 글은 목록 끝에 추가하고, 스트리밍 중인 글은 내용을 갱신한다
  useEffect(() => {
    setMessages((prev) => {
      let changed = false;
      const updated = prev.map((m) => {
        const latest = chat.chatMessages.find((c) => c.id === m.id);
        if (latest && latest.message !== m.message) {
          changed = true;
          return { ...m, message: latest.message };
        }
        return m;
      });

      const newOnes: Msg[] = [];
      for (const c of chat.chatMessages) {
        if (!seenIds.current.has(c.id)) {
          seenIds.current.add(c.id);
          newOnes.push({
            id: c.id,
            timestamp: c.timestamp,
            from: c.from,
            message: c.message,
          });
        }
      }

      if (newOnes.length > 0) return [...updated, ...newOnes];
      return changed ? updated : prev;
    });
  }, [chat.chatMessages]);

  const addImage = useCallback((m: Msg) => {
    if (seenIds.current.has(m.id)) return;
    seenIds.current.add(m.id);
    setMessages((prev) => [...prev, m]);
  }, []);

  useEffect(() => {
    room.registerByteStreamHandler(IMAGE_TOPIC, async (reader, { identity }) => {
      const { id, timestamp, mimeType, size } = reader.info;
      if (!IMAGE_TYPES.includes(mimeType) || (size ?? 0) > IMAGE_MAX) return;
      const chunks = await reader.readAll();
      if (chunks.reduce((n, c) => n + c.length, 0) > IMAGE_MAX) return;
      const image = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: mimeType }));
      addImage({ id, timestamp, from: room.getParticipantByIdentity(identity), message: "", image, imageType: mimeType });
    });
    return () => room.unregisterByteStreamHandler(IMAGE_TOPIC);
  }, [room, addImage]);

  async function sendImage(file: File) {
    if (!IMAGE_TYPES.includes(file.type)) return alert("PNG, JPG, GIF, WEBP 사진만 보낼 수 있어요.");
    if (file.size > IMAGE_MAX) return alert("10MB보다 큰 사진은 보낼 수 없어요.");
    try {
      const { id } = await room.localParticipant.sendFile(file, { topic: IMAGE_TOPIC, mimeType: file.type });
      addImage({
        id,
        timestamp: Date.now(),
        from: room.localParticipant,
        message: "",
        image: URL.createObjectURL(file),
        imageType: file.type,
      });
    } catch {
      alert("사진을 보내지 못했어요.");
    }
  }

  return { messages, send: chat.send, sendImage };
}

// 새 사람이 화면공유를 시작하면 내 공유는 잠시 멈춘다. 멈춘 동안은 아예 보내지 않아서 데이터가 들지 않는다.
// 그 사람이 공유를 끝내고 보내는 사람이 아무도 없으면 내 공유를 다시 보낸다.
// ponytail: 셋이 겹쳐 공유하다 마지막 사람이 끝내면 멈춰 있던 둘이 같이 다시 켜진다. 드문 일이라 그대로 둠.
function usePauseOldShare() {
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
// 손가락으로 쓰는 작은 화면 (크기를 0으로 알려 주는 브라우저도 있어서 0은 제외)
function isPhone() {
  const short = Math.min(screen.width, screen.height);
  return short > 0 && short <= 500 && matchMedia("(pointer: coarse)").matches;
}

function usePhoneLandscape() {
  useEffect(() => {
    const root = document.documentElement;
    let wasLand = false;
    const update = () => {
      const land = screen.orientation
        ? screen.orientation.type.startsWith("landscape")
        : matchMedia("(orientation: landscape)").matches; // 옛 아이폰: 자판이 화면 크기를 안 바꿔서 괜찮다
      root.toggleAttribute("data-phone-land", land && isPhone());
      // 가로였다가 다시 세로로 세우면 전체화면을 푼다
      // (세로에서 전체화면 버튼을 누른 직후, 가로로 돌기 전에 풀리지 않게 '가로였다가'일 때만)
      if (wasLand && !land && document.fullscreenElement) document.exitFullscreen();
      wasLand = land;
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

  // 방에서 나오면 첫 화면으로. 서버가 꺼져 있으면 첫 화면을 받아 올 수 없어서 멈춘 것처럼 보이니,
  // 먼저 서버에 물어보고 답이 없으면 이 자리에서 "방송이 끝났어요"를 보여 준다
  const [ended, setEnded] = useState(false);
  function goHome() {
    fetch("/", { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(3000) }).then(
      (r) => (r.ok ? router.push("/") : setEnded(true)),
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
      onDisconnected={goHome}
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
      <RoomView isAdmin={conn.isAdmin} />
    </LiveKitRoom>
  );
}

// 위: 로고, 참여자 수, (방장), 화면공유, 마이크 스위치
// 휴대폰: [화면공유 또는 프로필 사진 / 채팅 내용 / 메시지 입력칸]  (참여자 목록은 눌러서 연다)
// PC:     [화면공유 또는 프로필 사진 | 채팅 내용  ]
//         [참여자 한 줄              | 메시지 입력칸]
function RoomView({ isAdmin }: { isAdmin: boolean }) {
  // 나는 늘 맨 앞(왼쪽), 그다음 마이크를 켠 사람, 나머지는 들어온 순서 그대로. 마이크를 켜고 끄면 바로 자리가 바뀐다
  const rank = (p: Participant) => (p.isLocal ? 2 : p.isMicrophoneEnabled ? 1 : 0);
  const participants = [...useParticipants()].sort((a, b) => rank(b) - rank(a));
  const [showPeople, setShowPeople] = useState(false); // 휴대폰에서 참여자 목록 열기
  // 글 채팅과 사진을 도착/작성 순서대로 섞은 통합 메시지 목록
  const { messages, send: sendChat, sendImage } = useMessages();
  // 공유가 여럿이면 멈추지 않은(보내는 중인) 것 하나만 보여 준다
  const screen = useTracks([Track.Source.ScreenShare])
    .filter((t) => !t.publication.isMuted)
    .at(-1);
  const room = useRoomContext();
  usePauseOldShare();
  usePhotoExchange();

  // 화면공유 승인 받기: 방장이 아닌 사람이 요청하면 방장 화면에 [승인] [거부]가 뜬다
  const [requests, setRequests] = useState<{ identity: string; name: string }[]>([]); // 방장이 받은 요청
  const [asked, setAsked] = useState(false); // 내가 요청하고 기다리는 중
  const { send } = useDataChannel(SHARE_TOPIC, (msg) => {
    const what = new TextDecoder().decode(msg.payload);
    const from = msg.from;
    if (what === "request" && isAdmin && from) {
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
    const admins = participants.filter((p) => p.attributes?.admin === "1").map((p) => p.identity);
    if (!admins.length) return alert("방장이 방에 없어서 화면공유를 요청할 수 없어요.");
    send(text("request"), { reliable: true, destinationIdentities: admins });
    setAsked(true);
    setTimeout(() => setAsked(false), 60_000); // 방장이 답이 없으면 1분 뒤 다시 누를 수 있게
  }

  async function answer(req: { identity: string }, allow: boolean) {
    setRequests((r) => r.filter((x) => x.identity !== req.identity));
    if (!allow) return send(text("denied"), { reliable: true, destinationIdentities: [req.identity] });
    const r = await fetch("/api/share", { method: "POST", body: JSON.stringify({ identity: req.identity, allow: true }) });
    if (!r.ok) alert("승인하지 못했어요. 그 사람이 방을 나갔을 수 있어요.");
  }

  // 방장: 승인받은 사람이 공유를 끝내면 권한을 도로 거둔다 (다음에 또 하려면 다시 승인받기)
  useEffect(() => {
    if (!isAdmin) return;
    const onUnpublished = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
      if (pub.source !== Track.Source.ScreenShare || p.attributes.admin === "1") return;
      fetch("/api/share", { method: "POST", body: JSON.stringify({ identity: p.identity, allow: false }) });
    };
    room.on(RoomEvent.TrackUnpublished, onUnpublished);
    return () => {
      room.off(RoomEvent.TrackUnpublished, onUnpublished);
    };
  }, [room, isAdmin]);
  const waiting = requests.find((r) => participants.some((p) => p.identity === r.identity));
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

  // 뒤로가기를 누르면 바로 나가지 않고 "DOLIVE 떠나기" 창을 먼저 띄운다.
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
        <p className="mb-5 text-center font-semibold">DOLIVE 떠나기</p>
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
        {/* PC: 채팅 카드 왼쪽 가장자리. 끌면 폭이 바뀌고, 두 번 누르면 기본 폭으로. 평소엔 안 보이고 마우스를 올리면 보라색 */}
        <div
          onPointerDown={dragChat}
          onDoubleClick={() => saveChatW(null)}
          data-tip="드래그 너비 조절"
          className={`z-10 hidden w-3 -translate-x-1.5 cursor-col-resize justify-self-start rounded-full hover:bg-indigo-500/40 md:col-start-2 md:row-span-2 md:row-start-1 md:block ${hideOnLand}`}
        />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:contents">
          <aside
            className={`${showPeople ? "absolute inset-y-0 left-0 z-10 flex" : "hidden"} w-fit max-w-[60vw] flex-col gap-1 overflow-y-auto border-r border-zinc-800 bg-zinc-900 p-2 md:static md:col-start-1 md:row-start-2 md:flex md:w-auto md:max-w-none md:flex-row md:gap-1 md:overflow-x-auto md:overflow-y-hidden md:border-r-0 md:px-3 ${hideOnLand}`}
          >
            {participants.map((p) => (
              <PersonRow key={p.identity} p={p} isAdmin={isAdmin} />
            ))}
          </aside>

          <Stage participants={participants} screen={screen} />
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
          className={`md:col-start-2 md:row-start-2 md:mr-2 md:mb-2 md:rounded-b-xl md:border md:border-t-0 md:bg-zinc-800/40 md:pb-3 ${hideOnLand}`}
        />
      </div>

      {pip &&
        createPortal(
          <div className="flex h-dvh flex-col">
            <ChatLog messages={messages} className="min-h-0 flex-1" />
            <ChatInput send={sendChat} sendImage={sendImage} className="" />
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

function useAvatarOf(p: Participant) {
  useParticipantAttributes({ participant: p });
  usePhotos();
  return avatarOf(p);
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

// 가운데 위쪽: 화면공유가 있으면 공유 화면만, 없으면 PC는 "LIVE 방송 준비 중" 카드, 휴대폰은 프로필 사진 칸.
// 자리가 모자라면 공유 화면이 줄어든다. 휴대폰은 채팅 내용이 그 아래, PC는 오른쪽.
function Stage({ participants, screen }: { participants: Participant[]; screen?: TrackReference }) {
  return (
    <div
      className={`flex min-h-0 flex-col gap-2 p-2 md:col-start-1 md:row-start-1 ${screen ? "phone-land:flex-1 phone-land:p-0" : "shrink-0"}`}
    >
      {screen?.participant.isLocal ? (
        // 내가 공유 중이면 내 공유 화면은 보여 주지 않는다. 모니터를 공유할 때 이 창이 다시 찍혀서
        // 화면 속에 화면이 끝없이 생기는 것을 막고, 그 자리만큼 채팅을 넓게 본다.
        <div className="rounded-lg bg-indigo-600/15 px-4 py-3 text-sm text-indigo-100 ring-1 ring-indigo-500/40">
          내 화면을 공유하고 있어요. 다른 사람들에게는 내 화면이 보여요.
        </div>
      ) : screen ? (
        <ScreenView screen={screen} />
      ) : (
        <>
          {/* PC: 공유 화면이 들어올 자리를 같은 크기(16:9) 카드로 미리 잡아 두고 가운데에 안내 */}
          <div className="hidden aspect-video w-full items-center justify-center gap-3 rounded-xl border border-zinc-800 bg-zinc-800/40 text-2xl font-bold text-zinc-400 md:flex lg:mx-auto lg:max-w-[calc((100dvh-13rem)*16/9)]">
            <span className="size-3 animate-pulse rounded-full bg-red-500" />
            <span>
              <span className="text-red-500">LIVE</span> 방송 준비 중
            </span>
          </div>
          {/* 휴대폰만 (PC는 아래쪽 참여자 줄에 사진이 이미 있어서 숨김). 한 줄, 손가락으로 밀어서 본다 (스크롤바 없음)
              p-0.5: 말할 때 생기는 초록 테두리(바깥쪽 2px)가 스크롤 칸 가장자리에서 잘리지 않게 */}
          <div className="grid auto-cols-[80px] grid-flow-col gap-2 overflow-x-auto p-0.5 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
            {participants.map((p) => (
              <Tile key={p.identity} p={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// 공유 화면. 휴대폰을 가로로 눕히고 화면을 누르면 주소창·아래 버튼까지 숨긴 전체화면(영화관 모드)이 되고, 한 번 더 누르면 풀린다.
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };
type OrientationLock = { lock?: (o: "landscape") => Promise<void> };

function ScreenView({ screen }: { screen: TrackReference }) {
  const [full, setFull] = useState(false);
  const [pip, setPip] = useState(false);
  const [canPip, setCanPip] = useState(false);
  const [ratio, setRatio] = useState(16 / 9); // 공유된 화면의 실제 가로:세로

  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const box = useRef<HTMLDivElement>(null);

  // 팝업 윈도우(PiP) 지원 여부 및 진입/해제 상태 감지
  useEffect(() => {
    const v = box.current?.querySelector("video");
    if (!v) return;
    setCanPip(typeof document !== "undefined" && !!document.pictureInPictureEnabled && !v.disablePictureInPicture);
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

  // el: 전체화면으로 띄울 것 (휴대폰은 페이지 전체 = 영화관 모드, PC 전체화면 버튼은 공유 화면만)
  // turn: 가로로 돌리기 (휴대폰 세로에서 버튼을 누를 때. 안드로이드만 되고, 전체화면이 풀리면 브라우저가 알아서 원래대로)
  async function toggleFull(el: HTMLElement, turn = false) {
    if (full) return document.exitFullscreen();
    // 아이폰은 페이지 전체화면이 안 돼서, 영상만 아이폰 기본 전체화면으로 띄운다 (돌리기는 폰을 직접 눕혀야 함)
    if (!el.requestFullscreen) return (box.current?.querySelector("video") as IosVideo | null)?.webkitEnterFullscreen?.();
    await el.requestFullscreen().catch(() => {});
    if (turn) await (window.screen.orientation as unknown as OrientationLock).lock?.("landscape").catch(() => {});
  }

  return (
    <div
      ref={box}
      onPointerMove={wake}
      onPointerDown={wake}
      onClick={() => {
        const root = document.documentElement;
        if (full ? document.fullscreenElement === root : root.hasAttribute("data-phone-land")) toggleFull(root);
      }}
      // PC: 공유된 화면 비율 그대로(위아래 검은 띠 없이). 높이는 위쪽 막대·아래 참여자 줄을 뺀 만큼까지
      style={{ "--ratio": ratio } as React.CSSProperties}
      // 모서리는 채팅 카드와 같은 둥글기(rounded-xl). overflow-hidden: 영상 모서리도 같이 둥글게 잘리도록
      className="relative aspect-video min-h-0 w-full overflow-hidden rounded-xl bg-black [&:fullscreen]:rounded-none lg:mx-auto lg:aspect-(--ratio) lg:max-w-[calc((100dvh-13rem)*var(--ratio))] phone-land:aspect-auto phone-land:flex-1 phone-land:rounded-none"
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
      {/* 팝업 윈도우(PiP) 버튼, 전체화면 버튼 왼쪽 */}
      {canPip && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            togglePip();
          }}
          data-tip={pip ? "팝업 닫기" : "팝업 창으로 보기"}
          aria-label={pip ? "팝업 닫기" : "팝업 창으로 보기"}
          className={`absolute right-11 bottom-2 rounded bg-black/60 p-1.5 text-white transition-opacity duration-300 hover:bg-black/80 phone-land:hidden ${
            showBtn ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
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
          휴대폰 세로에서 누르면 영화관 모드로 띄우고 가로로 돌린다. 끝낼 때는 화면을 한 번 더 누른다.
          숨어 있을 때는 눌리지 않아서, 휴대폰은 한 번 눌러 버튼을 띄운 뒤 누른다 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (isPhone()) toggleFull(document.documentElement, true);
          else toggleFull(box.current!);
        }}
        data-tip={full ? "전체화면 끝내기" : "전체화면"}
        aria-label={full ? "전체화면 끝내기" : "전체화면"}
        className={`absolute right-2 bottom-2 rounded bg-black/60 p-1.5 text-white transition-opacity duration-300 hover:bg-black/80 phone-land:hidden ${
          showBtn ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
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

// 위쪽 오른쪽: 화면공유(PC만) + 마이크 스위치
// 화면공유 버튼: 방장은 바로 공유. 다른 사람은 [화면공유 -> 요청 중... -> (방장 승인) -> 지금 공유하기] 순서.
// (승인이 나도 공유 고르는 창은 본인이 버튼을 눌러야 열린다 - 브라우저 규칙)
function MediaControls({ asked, requestShare }: { asked: boolean; requestShare: () => void }) {
  const { localParticipant: me, isMicrophoneEnabled, isScreenShareEnabled } = useLocalParticipant();
  const canShare = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
  const sources = useLocalParticipantPermissions()?.canPublishSources ?? [];
  const allowed = sources.length === 0 || sources.includes(SCREEN_SHARE_SOURCE); // 빈 목록 = 다 보낼 수 있음(방장)
  const approved = allowed && sources.length > 0; // 방장이 아닌데 승인받음
  const paused = me.getTrackPublication(Track.Source.ScreenShare)?.isMuted; // 다른 사람이 공유 중이라 멈춤
  const [quality, setQuality] = useState<Quality>("720p");

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
      {canShare && (allowed || isScreenShareEnabled) && (
        // 공유 중에 바꾸려면 공유를 끝냈다 다시 해야 해서(승인받은 사람은 승인도 다시), 공유 중엔 잠근다.
        // 말풍선은 감싼 칸에 단다 (잠긴 칸은 마우스를 받지 않아서 감싼 칸이 대신 받는다)
        <span className="hidden sm:flex" data-tip={isScreenShareEnabled ? "공유를 멈춘 뒤 바꿀 수 있어요" : "화면공유 화질"}>
          <select
            className="quality-select flex items-center gap-1 rounded-full bg-zinc-800 px-3 py-1.5 disabled:pointer-events-none disabled:opacity-60"
            value={quality}
            disabled={isScreenShareEnabled}
            onChange={(e) => setQuality(e.target.value as Quality)}
          >
            {Object.keys(QUALITY).map((q) => (
              <option key={q}>{q}</option>
            ))}
          </select>
        </span>
      )}
      {canShare && (
        <button
          // 휴대폰은 화면공유를 못 하고 자리도 좁아서 숨긴다
          className={`hidden rounded-full px-3 py-1.5 disabled:opacity-60 sm:block ${
            isScreenShareEnabled ? "bg-indigo-600" : approved ? "bg-green-600 hover:bg-green-500" : "bg-zinc-800 hover:bg-zinc-700"
          }`}
          disabled={!isScreenShareEnabled && !allowed && asked}
          onClick={() =>
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
                    },
                    resolution: QUALITY[quality].top.resolution,
                    contentHint: "detail",
                    video: { displaySurface: "monitor" }, // 고르는 창에서 '전체 화면' 칸이 먼저 열리게
                    selfBrowserSurface: "exclude", // 이 탭은 목록에서 뺀다 (화면 속 화면이 끝없이 비치는 것 방지)
                  },
                  { screenShareEncoding: QUALITY[quality].top.encoding, screenShareSimulcastLayers: [QUALITY[quality].low] },
                ),
              "화면공유",
            )
          }
        >
          {isScreenShareEnabled
            ? paused
              ? "공유 중지 (잠시 멈춤)"
              : "공유 중지"
            : allowed
              ? approved
                ? "지금 공유하기"
                : "화면공유"
              : asked
                ? "요청 중..."
                : "화면공유"}
        </button>
      )}
      <Switch label="마이크" on={isMicrophoneEnabled} onChange={(on) => run(() => me.setMicrophoneEnabled(on), "마이크")} />
    </>
  );
}

type Chat = ReturnType<typeof useChat>;

// "오전 12:03"
const chatTime = (t: number) => new Date(t).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });

// 채팅 글 속 링크 (http:// 또는 https:// 로 시작). 끝에 붙은 마침표·괄호 같은 것은 링크에서 뺀다
const LINK = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

// 글 속 링크를 누르면 새 탭으로 열리게
function Linkified({ text }: { text: string }) {
  return text.split(LINK).map((part, i) =>
    i % 2 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all underline">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

// 링크 미리보기 카드 (제목·설명·그림). 서버(/api/preview)가 대신 읽어 오고, 이 탭에서 한 번 읽은 건 다시 안 묻는다
type Preview = { title: string; description?: string; image?: string; site: string } | null;
const previews = new Map<string, Promise<Preview>>();

function LinkPreview({ url, onLoad }: { url: string; onLoad: () => void }) {
  const [p, setP] = useState<Preview>(null);
  const [noImage, setNoImage] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!previews.has(url))
      previews.set(
        url,
        fetch(`/api/preview?url=${encodeURIComponent(url)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      );
    previews.get(url)!.then((v) => alive && setP(v));
    return () => {
      alive = false;
    };
  }, [url]);
  useEffect(() => {
    if (p) onLoad();
  }, [p, onLoad]);
  if (!p) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 block w-72 max-w-full overflow-hidden rounded-xl bg-zinc-800 hover:bg-zinc-700"
    >
      {p.image && !noImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.image}
          alt=""
          referrerPolicy="no-referrer"
          onLoad={onLoad}
          onError={() => setNoImage(true)}
          className="aspect-video w-full bg-zinc-900 object-cover"
        />
      )}
      <div className="p-2.5">
        <div className="truncate text-xs text-zinc-400">{p.site}</div>
        <div className="line-clamp-2 font-semibold">{p.title}</div>
        {p.description && <div className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{p.description}</div>}
      </div>
    </a>
  );
}

// 카카오톡처럼: 남의 말은 왼쪽(사진·이름 + 회색 말풍선), 내 말은 오른쪽(보라색 말풍선).
// 같은 사람이 같은 분에 이어 보낸 말은 한 묶음이라 사진·이름은 첫 말에만, 시간은 마지막 말에만 붙인다.
// 링크가 있으면 말풍선 아래에 첫 링크의 미리보기 카드, 사진은 말풍선 대신 사진 그대로 (누르면 화면 위에 크게)
function ChatLog({ messages, className }: { messages: Msg[]; className: string }) {
  const bottom = useRef<HTMLDivElement>(null);

  // 사진 크게 보기: 브라우저 기본 모달(dialog). ESC로 닫히는 것도 브라우저가 해 준다. 바깥 어두운 곳을 눌러도 닫힌다
  const viewer = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState<Msg | null>(null);
  function openImage(m: Msg) {
    setShown(m);
    viewer.current?.showModal();
  }
  usePhotos(); // 사진을 받으면 다시 그리기

  // 사진·미리보기가 늦게 떠서 키가 커지면 다시 맨 아래로
  // (중괄호로 감싼 건, 요즘 브라우저의 스크롤 명령이 돌려주는 값을 React가 뒷정리 함수로 오해하지 않게)
  const toBottom = useCallback(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, []);
  useEffect(toBottom, [messages.length, toBottom]);

  return (
    <div className={`overflow-y-auto p-3 text-sm ${className}`}>
      {messages.map((m, i) => {
        const who = m.from?.identity;
        const same = (o?: Msg) => !!o && o.from?.identity === who && chatTime(o.timestamp) === chatTime(m.timestamp);
        const first = !same(messages[i - 1]);
        const last = !same(messages[i + 1]);
        const mine = m.from?.isLocal;
        const link = m.message.match(LINK)?.[0];
        return (
          <div key={m.id} className={`flex gap-2 ${mine ? "justify-end" : ""} ${first ? "mt-3" : "mt-1"}`}>
            {!mine &&
              (first ? (
                <Avatar id={avatarOf(m.from)} px={52} className="size-10 shrink-0 md:size-13" />
              ) : (
                <div className="w-10 shrink-0 md:w-13" />
              ))}
            <div className={`flex max-w-[75%] min-w-0 flex-col ${mine ? "items-end" : "items-start"}`}>
              {first && !mine && <span className="mb-1 text-xs text-zinc-400">{m.from?.name ?? "나간 사람"}</span>}
              <div className={`flex items-end gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
                {m.image ? (
                  // 사진 폭은 늘 240px (옆에 시간이 붙어도 사진이 줄지 않게 shrink-0). 아주 긴 사진은 위아래를 잘라 보여 준다
                  <button type="button" onClick={() => openImage(m)} className="shrink-0 cursor-zoom-in">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.image} alt="보낸 사진" onLoad={toBottom} className="max-h-72 w-60 rounded-2xl bg-zinc-800 object-cover" />
                  </button>
                ) : (
                  <p
                    className={`min-w-0 rounded-2xl px-3 py-2 break-words whitespace-pre-wrap ${
                      mine ? "bg-indigo-600" : "bg-zinc-800"
                    } ${first ? (mine ? "rounded-tr-sm" : "rounded-tl-sm") : ""}`}
                  >
                    <Linkified text={m.message} />
                  </p>
                )}
                {last && <span className="shrink-0 text-[11px] text-zinc-500">{chatTime(m.timestamp)}</span>}
              </div>
              {link && <LinkPreview url={link} onLoad={toBottom} />}
            </div>
          </div>
        );
      })}
      <div ref={bottom} />

      <dialog
        ref={viewer}
        onClose={() => setShown(null)}
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
        className="m-auto max-h-none max-w-none overflow-visible bg-transparent p-0 outline-none backdrop:bg-black/80"
      >
        {shown?.image && (
          // 화면의 80% 안에 들어가게. 오른쪽 위에 저장, 닫기
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown.image} alt="보낸 사진 크게 보기" className="max-h-[80vh] max-w-[80vw] rounded-xl object-contain" />
            <div className="absolute top-2 right-2 flex gap-2">
              <a
                href={shown.image}
                download={`dolive-${shown.id.slice(-6)}.${shown.imageType?.split("/")[1]?.replace("jpeg", "jpg") ?? "png"}`}
                aria-label="사진 저장"
                className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-5">
                  <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                </svg>
              </a>
              <button
                type="button"
                onClick={() => viewer.current?.close()}
                aria-label="닫기"
                className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden className="size-5">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

// 맨 아래 항상 보이는 입력칸. 보낸 뒤에도 입력칸에 그대로 머물러 휴대폰 자판이 닫히지 않는다.
// 줄바꿈: PC는 Shift+Enter (Enter는 보내기), 휴대폰은 자판의 줄바꿈 키 (보내기는 비행기 버튼)
// 사진을 복사해서 입력칸에 붙여 넣으면(Ctrl+V) 입력칸 위에 작게 올려 두고, 보내기(비행기·Enter)를 눌러야 보낸다
function ChatInput({
  send,
  sendImage,
  className,
}: {
  send: Chat["send"];
  sendImage: (f: File) => void;
  className: string;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // 붙여 넣고 아직 안 보낸 사진 (url: 입력칸 위에 보여 줄 작은 그림)
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);
  function dropPending() {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
  }

  // 글이 길어지면 입력칸이 4줄까지 늘어난다 (그 뒤로는 칸 안에서 밀어서 본다)
  useEffect(() => {
    const t = box.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, [text]);

  function submit() {
    if (pending) {
      sendImage(pending.file);
      dropPending();
    }
    if (text.trim()) {
      send(text.trim());
      setText("");
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      // 아래 여백: 브라우저 맨 아래에 붙지 않게 (아이폰 홈 바 자리도 비움)
      className={`${className} flex shrink-0 items-end gap-2 border-t border-zinc-800 px-3 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {pending && (
          <div className="relative w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pending.url} alt="보낼 사진" className="max-h-28 rounded-xl" />
            <button
              type="button"
              onClick={dropPending}
              onPointerDown={(e) => e.preventDefault()}
              aria-label="사진 빼기"
              data-tip="사진 빼기"
              className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/70 hover:bg-black"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden className="size-3.5">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        )}
        <textarea
          ref={box}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
            if (!file) return; // 사진이 아니면 평소처럼 글자 붙여넣기
            e.preventDefault();
            if (pending) URL.revokeObjectURL(pending.url); // 다시 붙이면 새 사진으로 바꾼다
            setPending({ file, url: URL.createObjectURL(file) });
          }}
          onKeyDown={(e) => {
            // 한글을 조합하는 중에 누른 Enter는 건너뛴다 (안 그러면 마지막 글자가 한 번 더 보내진다)
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            if (matchMedia("(pointer: coarse)").matches) return; // 휴대폰: 줄바꿈
            e.preventDefault();
            submit();
          }}
          placeholder="메시지 입력"
          className="max-h-32 w-full resize-none rounded-3xl bg-zinc-800 px-5 py-3 text-base leading-6 outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <button
        type="submit"
        disabled={!text.trim() && !pending}
        onPointerDown={(e) => e.preventDefault()} // 눌러도 입력칸에서 손이 안 떨어지게
        aria-label="보내기"
        data-tip="보내기"
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40"
      >
        {/* 위로 날아오르는 종이비행기 */}
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-[22px] translate-x-px -translate-y-px -rotate-[35deg]">
          <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </button>
    </form>
  );
}
