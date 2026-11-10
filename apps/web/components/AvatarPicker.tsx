"use client";

import { useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { PhotoCrop } from "@/components/PhotoCrop";
import { AVATARS, CUSTOM, DORMS } from "@/lib/dolive";

// 프로필 사진 고르기 12칸. 입장 화면(app/page.tsx)과 연수 입장 창(app/yeonsu/enter.tsx)이 같이 쓴다.
// 2줄 x 6칸 (PC, 휴대폰 같음): [+] 사진 올리기, 내 사진, 도름스 사진, 기본 사진 9장
// ready 전에는 어떤 사진에도 테두리를 그리지 않는다 (1번에 그렸다가 도름스 사진으로 옮겨 가는 게 보여서)
// 새로 올린 사진은 이 브라우저(localStorage "photo")에 남겨서 다음에 와도 내 사진 칸에 그대로 있다
export function AvatarPicker({
  avatar,
  onAvatar,
  custom,
  onCustom,
  dormsPicture,
  ready = true,
}: {
  avatar: string;
  onAvatar: (id: string) => void;
  custom?: string;
  onCustom: (dataUrl: string) => void;
  dormsPicture?: string | null;
  ready?: boolean;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File>(); // 자리 맞추기 중인 사진
  const ring = (id: string) => (ready && avatar === id ? "bg-indigo-600" : "hover:bg-zinc-700");

  function choosePhoto(jpeg: Blob) {
    setPicked(undefined);
    const reader = new FileReader();
    reader.onload = () => {
      // 새로 올리면 내 사진 칸의 사진이 바뀐다. 다음에 와도 남게 이 브라우저에 저장 (못 하면 이번에만 쓴다)
      onCustom(reader.result as string);
      onAvatar(CUSTOM);
      try {
        localStorage.setItem("photo", reader.result as string);
      } catch {}
    };
    reader.readAsDataURL(jpeg);
  }

  return (
    <>
      <div className="grid grid-cols-6 gap-2">
        {/* 첫 칸: 사진 올리기 (새로 올리면 내 사진 칸이 바뀐다) */}
        <button type="button" onClick={() => picker.current?.click()} aria-label="사진 올리기" className="rounded-full p-1 hover:bg-zinc-700">
          <span className="flex aspect-square w-full items-center justify-center rounded-full border-2 border-dashed border-zinc-500 bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden className="w-1/2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
        </button>
        {/* 내 사진 칸: 올리기 전엔 점선 빈 원(눌러도 올리기), 올린 뒤엔 그 사진 */}
        <button
          type="button"
          onClick={() => (custom ? onAvatar(CUSTOM) : picker.current?.click())}
          aria-label={custom ? "내 사진" : "내 사진 올리기"}
          className={`rounded-full p-1 ${ring(CUSTOM)}`}
        >
          {custom ? <Avatar id={custom} className="w-full" /> : <span className="flex aspect-square w-full items-center justify-center rounded-full border-2 border-dashed border-zinc-500 bg-zinc-800 text-zinc-300 hover:bg-zinc-700" />}
        </button>
        {/* 도름스 프로필 사진 칸. 로그인 전이거나 도름스에 사진이 없으면 점선 빈 원 */}
        {dormsPicture ? (
          <button type="button" onClick={() => onAvatar(DORMS)} aria-label="도름스 프로필 사진" className={`rounded-full p-1 ${ring(DORMS)}`}>
            <Avatar id={dormsPicture} className="w-full" />
          </button>
        ) : (
          <span className="p-1">
            <span className="flex aspect-square w-full items-center justify-center rounded-full border-2 border-dashed border-zinc-500 bg-zinc-800 text-zinc-300" />
          </span>
        )}
        {AVATARS.map((id) => (
          <button type="button" key={id} onClick={() => onAvatar(id)} aria-label={`프로필 사진 ${id}`} className={`rounded-full p-1 ${ring(id)}`}>
            <Avatar id={id} className="w-full" />
          </button>
        ))}
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
      {picked && <PhotoCrop file={picked} onDone={choosePhoto} onCancel={() => setPicked(undefined)} />}
    </>
  );
}
