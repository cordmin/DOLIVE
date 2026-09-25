"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { PhotoCrop } from "@/components/PhotoCrop";
import { AVATARS, CUSTOM, savedAvatar } from "@/lib/dolive";

// 입장 화면: 프로필 사진(기본 11장 + 내 사진) + 닉네임 → 채팅방 입장
// 내 사진은 서버에 올리지 않는다. 이 브라우저(sessionStorage "photo")에만 두었다가 방에서 사람들에게 바로 건넨다.
// (마이크는 꺼진 채로 들어가고, 방 안 위쪽 스위치로 켠다)
export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [custom, setCustom] = useState<string>(); // 내가 고른 사진 (data: 주소, 새로고침하면 없어진다)
  const [picked, setPicked] = useState<File>(); // 자리 맞추기 중인 사진
  const picker = useRef<HTMLInputElement>(null);

  // sessionStorage는 브라우저에만 있어서 화면이 뜬 뒤(effect)에 읽어야 서버 화면과 어긋나지 않는다
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(sessionStorage.getItem("name") ?? "");
    // 내 사진은 새로고침하면 버리고 첫 사진으로
    sessionStorage.removeItem("photo");
    const saved = savedAvatar();
    setAvatar(saved === CUSTOM ? AVATARS[0] : saved);
  }, []);

  function choosePhoto(jpeg: Blob) {
    setPicked(undefined);
    const reader = new FileReader();
    reader.onload = () => {
      setCustom(reader.result as string);
      setAvatar(CUSTOM);
    };
    reader.readAsDataURL(jpeg);
  }

  function enter() {
    if (!name.trim()) return;
    sessionStorage.setItem("name", name.trim());
    sessionStorage.setItem("avatar", avatar);
    if (avatar === CUSTOM && custom) sessionStorage.setItem("photo", custom);
    router.push("/room");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-8">
      <h1 className="text-3xl font-bold">
        DO<span className="text-red-500">LIVE</span>
      </h1>

      <section className="flex flex-col gap-2">
        <span className="text-sm text-zinc-400">프로필 사진 선택</span>
        {/* 3줄 x 4칸 (PC, 휴대폰 같음) */}
        <div className="grid grid-cols-4 gap-3">
          {AVATARS.map((id) => (
            <button
              key={id}
              onClick={() => setAvatar(id)}
              aria-label={`프로필 사진 ${id}`}
              className={`rounded-full p-1 ${avatar === id ? "bg-indigo-600" : "hover:bg-zinc-700"}`}
            >
              <Avatar id={id} className="w-full" />
            </button>
          ))}
          {/* 마지막 칸: 내 사진 올리기. 올린 뒤에는 내 사진이 보이고, 고른 상태에서 다시 누르면 바꾸기 */}
          <button
            onClick={() => (custom && avatar !== CUSTOM ? setAvatar(CUSTOM) : picker.current?.click())}
            aria-label="내 사진 올리기"
            className={`rounded-full p-1 ${avatar === CUSTOM ? "bg-indigo-600" : "hover:bg-zinc-700"}`}
          >
            {custom ? (
              <Avatar id={custom} className="w-full" />
            ) : (
              <span className="flex aspect-square w-full items-center justify-center rounded-full border-2 border-dashed border-zinc-500 bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  aria-hidden
                  className="w-1/2"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
            )}
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // 같은 사진을 다시 골라도 반응하게
              if (file) setPicked(file);
            }}
          />
        </div>
      </section>

      {picked && <PhotoCrop file={picked} onDone={choosePhoto} onCancel={() => setPicked(undefined)} />}

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

      <button
        onClick={enter}
        disabled={!name.trim()}
        className="rounded-lg bg-indigo-600 px-4 py-4 text-xl font-semibold hover:bg-indigo-500 disabled:opacity-40"
      >
        채팅방 입장
      </button>
    </main>
  );
}
