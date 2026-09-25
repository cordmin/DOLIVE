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
import {
  Participant,
  RoomOptions,
  ScreenSharePresets,
  Track,
  VideoPresets,
  type TrackPublication,
} from "livekit-client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { AVATARS, ROOMS, savedAvatar } from "@/lib/dolive";

// 20명 대비: 웹캠은 540p, 화면공유만 1080p. 안 보이는 영상은 받지 않음(adaptiveStream).
const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: { resolution: VideoPresets.h540.resolution },
  publishDefaults: { screenShareEncoding: ScreenSharePresets.h1080fps30.encoding },
};

type Conn = { token: string; url: string; isAdmin: boolean };

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const [conn, setConn] = useState<Conn>();

  useEffect(() => {
    const name = sessionStorage.getItem("name");
    if (!name) {
      router.replace(`/?room=${roomId}`);
      return;
    }
    fetch("/api/token", {
      method: "POST",
      body: JSON.stringify({ room: roomId, name, avatar: savedAvatar() }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setConn)
      .catch(() => router.replace("/"));
  }, [roomId, router]);

  if (!conn) return <p className="m-auto text-zinc-400">들어가는 중...</p>;

  return (
    <LiveKitRoom
      serverUrl={conn.url}
      token={conn.token}
      connect
      audio
      options={ROOM_OPTIONS}
      onDisconnected={() => router.push("/")}
      onError={(e) => alert(`연결 오류: ${e.message}`)}
      onMediaDeviceFailure={() =>
        alert("마이크나 카메라를 쓸 수 없어요. 주소창 왼쪽 아이콘을 눌러 권한을 '허용'으로 바꿔 주세요.")
      }
      className="flex h-dvh flex-col"
    >
      <RoomAudioRenderer />
      <StartAudio
        label="🔊 여기를 눌러 소리 켜기"
        className="fixed inset-x-0 top-14 z-20 mx-auto w-fit rounded-lg bg-indigo-600 px-4 py-2"
      />
      <RoomView roomId={roomId} isAdmin={conn.isAdmin} />
    </LiveKitRoom>
  );
}

function RoomView({ roomId, isAdmin }: { roomId: string; isAdmin: boolean }) {
  const participants = useParticipants();
  const [panel, setPanel] = useState<"people" | "chat" | null>(null); // 휴대폰에서 열린 옆칸
  const toggle = (p: "people" | "chat") => setPanel(panel === p ? null : p);
  const label = ROOMS.find((r) => r.id === roomId)?.label ?? roomId;

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 overflow-x-auto border-b border-zinc-800 px-3 text-sm whitespace-nowrap">
        <b className="hidden text-base sm:inline">
          DO<span className="text-red-500">LIVE</span>
        </b>
        <span className="text-zinc-400"># {label}</span>
        <button onClick={() => toggle("people")} className="text-zinc-400 md:pointer-events-none">
          👥 {participants.length}명
        </button>
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-black">방장</span>
          )}
          <button onClick={() => toggle("chat")} className="rounded bg-zinc-800 px-2 py-1 lg:hidden">
            💬
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <aside
          className={`${panel === "people" ? "absolute inset-y-0 left-0 z-10 flex" : "hidden"} w-56 flex-col gap-1 overflow-y-auto border-r border-zinc-800 bg-zinc-900 p-2 md:static md:flex`}
        >
          {participants.map((p) => (
            <PersonRow key={p.identity} p={p} />
          ))}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <Stage participants={participants} />
          <Controls />
        </main>

        <aside
          className={`${panel === "chat" ? "absolute inset-y-0 right-0 z-10 flex" : "hidden"} w-72 flex-col border-l border-zinc-800 bg-zinc-900 lg:static lg:flex`}
        >
          <Chat />
        </aside>
      </div>
    </>
  );
}

function useAvatarOf(p: Participant) {
  return useParticipantAttributes({ participant: p }).attributes?.avatar ?? AVATARS[0].id;
}

function PersonRow({ p }: { p: Participant }) {
  const speaking = useIsSpeaking(p);
  const muted = useIsMuted({ participant: p, source: Track.Source.Microphone });
  return (
    <div className="flex items-center gap-2 rounded p-1 hover:bg-zinc-800">
      <Avatar id={useAvatarOf(p)} talking={speaking && !muted} muted={muted} className="w-9 shrink-0" />
      <div className="min-w-0">
        <div className="truncate text-sm">
          {p.name}
          {p.isLocal && <span className="text-zinc-500"> (나)</span>}
        </div>
        <div className="text-xs text-zinc-500">{muted ? "음소거" : speaking ? "말하는 중" : "대기 중"}</div>
      </div>
    </div>
  );
}

// 가운데: 화면공유가 있으면 크게, 아래에 참여자 칸. 없으면 참여자 칸(캠 또는 아바타)만.
function Stage({ participants }: { participants: Participant[] }) {
  const screens = useTracks([Track.Source.ScreenShare]);
  const cams = useTracks([Track.Source.Camera]).filter((t) => !t.publication.isMuted);
  const camOf = (p: Participant) => cams.find((t) => t.participant.identity === p.identity);
  const screen = screens[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      {screen && (
        <div className="relative min-h-0 flex-1 rounded-lg bg-black">
          <VideoTrack trackRef={screen} className="size-full object-contain" />
          <span className="absolute top-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs">
            🖥️ {screen.participant.name}님의 화면
          </span>
        </div>
      )}
      <div
        className={
          screen
            ? "flex shrink-0 gap-2 overflow-x-auto"
            : "grid flex-1 auto-rows-min content-center gap-2 overflow-y-auto [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]"
        }
      >
        {participants.map((p) => (
          <Tile key={p.identity} p={p} cam={camOf(p)?.publication} small={!!screen} />
        ))}
      </div>
    </div>
  );
}

function Tile({ p, cam, small }: { p: Participant; cam?: TrackPublication; small: boolean }) {
  const speaking = useIsSpeaking(p);
  const muted = useIsMuted({ participant: p, source: Track.Source.Microphone });
  const avatar = useAvatarOf(p);
  return (
    <div
      className={`relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-zinc-800 ${
        small ? "w-40 shrink-0" : ""
      } ${speaking && !muted ? "ring-2 ring-green-500" : ""}`}
    >
      {cam ? (
        <VideoTrack
          trackRef={{ participant: p, publication: cam, source: Track.Source.Camera }}
          className="size-full object-cover"
        />
      ) : (
        <Avatar id={avatar} talking={speaking && !muted} muted={muted} className="h-3/4" />
      )}
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-xs">{p.name}</span>
    </div>
  );
}

function Controls() {
  const room = useRoomContext();
  const { localParticipant: me, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant();
  const myAvatar = useAvatarOf(me);
  const canShare = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

  async function run(action: () => Promise<unknown>, fail: string) {
    try {
      await action();
    } catch (e) {
      // 화면공유 창에서 '취소'를 누른 경우는 조용히 넘어간다
      if ((e as Error).name !== "NotAllowedError" || fail !== "화면공유") alert(`${fail}를 켤 수 없어요.`);
    }
  }

  function changeAvatar(id: string) {
    sessionStorage.setItem("avatar", id);
    me.setAttributes({ avatar: id });
  }

  const btn = (on: boolean) =>
    `rounded-full px-4 py-2 text-sm ${on ? "bg-zinc-700 hover:bg-zinc-600" : "bg-red-700 hover:bg-red-600"}`;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-zinc-800 p-2">
      <button
        className={btn(isMicrophoneEnabled)}
        onClick={() => run(() => me.setMicrophoneEnabled(!isMicrophoneEnabled), "마이크")}
      >
        {isMicrophoneEnabled ? "🎙️ 마이크" : "🔇 마이크 꺼짐"}
      </button>
      <button
        className={btn(isCameraEnabled)}
        onClick={() => run(() => me.setCameraEnabled(!isCameraEnabled), "카메라")}
      >
        {isCameraEnabled ? "📷 캠 끄기" : "📷 캠 켜기"}
      </button>
      {canShare && (
        <button
          className={btn(true) + (isScreenShareEnabled ? " !bg-indigo-600" : "")}
          onClick={() =>
            run(
              () =>
                me.setScreenShareEnabled(!isScreenShareEnabled, {
                  audio: true,
                  resolution: ScreenSharePresets.h1080fps30.resolution,
                  contentHint: "detail",
                }),
              "화면공유",
            )
          }
        >
          🖥️ {isScreenShareEnabled ? "공유 중지" : "화면공유"}
        </button>
      )}
      <select
        value={myAvatar}
        onChange={(e) => changeAvatar(e.target.value)}
        className="rounded-full bg-zinc-700 px-3 py-2 text-sm"
        aria-label="캐릭터 변경"
      >
        {AVATARS.map((a) => (
          <option key={a.id} value={a.id}>
            🎭 {a.label}
          </option>
        ))}
      </select>
      <button onClick={() => room.disconnect()} className="rounded-full bg-red-600 px-4 py-2 text-sm hover:bg-red-500">
        나가기
      </button>
    </div>
  );
}

function Chat() {
  const { chatMessages, send, isSending } = useChat();
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [chatMessages.length]);

  return (
    <>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
        {chatMessages.map((m) => (
          <div key={m.id}>
            <span className="text-xs text-zinc-500">
              [{new Date(m.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}]
            </span>{" "}
            <b>{m.from?.name}</b>
            <p className="break-words whitespace-pre-wrap">{m.message}</p>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          send(text.trim());
          setText("");
        }}
        className="border-t border-zinc-800 p-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={isSending}
          placeholder="메시지 보내기"
          className="w-full rounded bg-zinc-800 px-3 py-2 text-sm outline-none"
        />
      </form>
    </>
  );
}
