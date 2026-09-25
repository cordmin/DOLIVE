"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { AVATARS, ROOMS, savedAvatar } from "@/lib/dolive";

// 첫 화면: 닉네임 + 캐릭터 고르고 방 선택
export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0].id);
  const [wantedRoom, setWantedRoom] = useState<string | null>(null);

  // sessionStorage는 브라우저에만 있어서 화면이 뜬 뒤(effect)에 읽어야 서버 화면과 어긋나지 않는다
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(sessionStorage.getItem("name") ?? "");
    setAvatar(savedAvatar());
    setWantedRoom(new URLSearchParams(location.search).get("room"));
  }, []);

  function enter(roomId: string) {
    if (!name.trim()) return;
    sessionStorage.setItem("name", name.trim());
    sessionStorage.setItem("avatar", avatar);
    router.push(`/room/${roomId}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-8">
      <h1 className="text-3xl font-bold">
        DO<span className="text-red-500">LIVE</span>
      </h1>

      <label className="flex flex-col gap-2">
        <span className="text-sm text-zinc-400">닉네임</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="모임에서 쓸 이름"
          className="rounded-lg bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </label>

      <section className="flex flex-col gap-2">
        <span className="text-sm text-zinc-400">캐릭터</span>
        <div className="grid grid-cols-4 gap-2">
          {AVATARS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAvatar(a.id)}
              className={`flex flex-col items-center gap-1 rounded-lg p-2 ${
                avatar === a.id ? "bg-indigo-600" : "bg-zinc-800 hover:bg-zinc-700"
              }`}
            >
              <Avatar id={a.id} className="w-full" />
              <span className="text-xs">{a.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <span className="text-sm text-zinc-400">방 들어가기</span>
        <div className="grid grid-cols-2 gap-2">
          {ROOMS.map((r) => (
            <button
              key={r.id}
              onClick={() => enter(r.id)}
              disabled={!name.trim()}
              className={`rounded-lg px-4 py-4 text-lg font-semibold disabled:opacity-40 ${
                wantedRoom === r.id ? "bg-indigo-600" : "bg-zinc-700 hover:bg-zinc-600"
              }`}
            >
              # {r.label}
            </button>
          ))}
        </div>
        {!name.trim() && <p className="text-sm text-zinc-500">닉네임을 먼저 적어 주세요.</p>}
      </section>
    </main>
  );
}
