"use client";

import { useTrackVolume } from "@livekit/components-react";
import { createLocalAudioTrack, type LocalAudioTrack } from "livekit-client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Switch } from "@/components/Switch";
import { AVATARS, savedAvatar } from "@/lib/dolive";

// 입장 화면: 캐릭터 + 닉네임 + 마이크 미리 켜서 확인 → 채팅방 입장
export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0].id);
  const [micOn, setMicOn] = useState(true);
  const [mic, setMic] = useState<LocalAudioTrack>();
  const [error, setError] = useState("");
  const volume = useTrackVolume(mic);
  const talking = volume > 0.05;

  // sessionStorage는 브라우저에만 있어서 화면이 뜬 뒤(effect)에 읽어야 서버 화면과 어긋나지 않는다
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(sessionStorage.getItem("name") ?? "");
    setAvatar(savedAvatar());
    setMicOn(sessionStorage.getItem("mic") !== "0");
  }, []);

  // 켜져 있는 동안만 마이크를 잡고, 끄거나 입장하면 놓는다
  useEffect(() => {
    if (!micOn) return;
    let track: LocalAudioTrack | undefined;
    let gone = false;
    createLocalAudioTrack()
      .then((t) => (gone ? t.stop() : setMic((track = t))))
      .catch(() => {
        setMicOn(false);
        setError("마이크를 쓸 수 없어요. 주소창 왼쪽 아이콘을 눌러 권한을 '허용'으로 바꿔 주세요.");
      });
    return () => {
      gone = true;
      track?.stop();
      setMic(undefined);
    };
  }, [micOn]);

  function enter() {
    if (!name.trim()) return;
    sessionStorage.setItem("name", name.trim());
    sessionStorage.setItem("avatar", avatar);
    sessionStorage.setItem("mic", micOn ? "1" : "0");
    router.push("/room");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-8">
      <h1 className="text-3xl font-bold">
        DO<span className="text-red-500">LIVE</span>
      </h1>

      <section className="flex flex-col gap-2">
        <span className="text-sm text-zinc-400">캐릭터 선택</span>
        <div className="grid grid-cols-4 gap-2">
          {AVATARS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAvatar(a.id)}
              aria-label={a.label}
              className={`rounded-lg p-2 ${avatar === a.id ? "bg-indigo-600" : "bg-zinc-800 hover:bg-zinc-700"}`}
            >
              <Avatar id={a.id} className="w-full" />
            </button>
          ))}
        </div>
      </section>

      <label className="flex flex-col gap-2">
        <span className="text-sm text-zinc-400">닉네임 입력</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enter()}
          maxLength={20}
          placeholder="입력 필수"
          className="rounded-lg bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </label>

      {/* 닉네임 칸 → 카드 → 입장 버튼 간격 35px (기본 24px + 11px) */}
      <section className="mt-[11px] flex flex-col gap-2">
        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-zinc-800">
          <Avatar id={avatar} talking={talking} className="mt-8 h-1/2 sm:h-2/3" />
          {micOn && (
            <div className="absolute inset-x-4 bottom-3 h-1.5 overflow-hidden rounded-full bg-black/50">
              <div
                className="h-full bg-green-500 transition-[width] duration-75"
                style={{ width: `${Math.min(100, volume * 300)}%` }}
              />
            </div>
          )}
          <div className="absolute top-2 right-2">
            <Switch
              label="마이크"
              on={micOn}
              onChange={() => {
                setError("");
                setMicOn(!micOn);
              }}
            />
          </div>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      <button
        onClick={enter}
        disabled={!name.trim()}
        className="mt-[11px] rounded-lg bg-indigo-600 px-4 py-4 text-xl font-semibold hover:bg-indigo-500 disabled:opacity-40"
      >
        채팅방 입장
      </button>
    </main>
  );
}
