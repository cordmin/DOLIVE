"use client";

import { useRouter } from "next/navigation";
import { AVATARS, DORMS } from "@/lib/dolive";
import { ROOM_ENTRY_KEY } from "@/lib/roomHistory";

// [연수 방 들어가기]: 입장 화면(app/page.tsx)의 go() 와 같은 값을 남기고 방으로 들어간다.
// 이름은 도름스 닉네임, 사진은 도름스 사진(없으면 첫 사진). 연수 방은 비밀번호가 없다
export function EnterYeonsu({ room, name, picture }: { room: string; name: string; picture: string | null }) {
  const router = useRouter();
  function enter() {
    sessionStorage.setItem("name", name);
    sessionStorage.setItem("avatar", picture ? DORMS : AVATARS[0]);
    sessionStorage.removeItem("photo");
    sessionStorage.setItem("room", room);
    sessionStorage.setItem("password", "");
    sessionStorage.setItem(ROOM_ENTRY_KEY, "1");
    router.push("/room");
  }
  return (
    <button onClick={enter} className="dolive-button dolive-entry flex h-16 w-full items-center justify-center rounded-lg px-4 py-4 text-xl font-semibold">
      <span className="dolive-button-cap text-white">연수 방 들어가기</span>
    </button>
  );
}
