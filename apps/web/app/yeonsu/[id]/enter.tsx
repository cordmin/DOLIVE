"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AVATARS, DORMS } from "@/lib/dolive";
import { ROOM_ENTRY_KEY } from "@/lib/roomHistory";

// [연수 방 들어가기]: 입장 화면(app/page.tsx)의 go() 와 같은 값을 남기고 방으로 들어간다.
// 이름은 도름스 닉네임, 사진은 도름스 사진(없으면 첫 사진). 연수 방은 비밀번호가 없다
// 들어올 수 있는 선생님에게는 이 화면이 열리자마자 저절로 들어간다 (도름스 연수 소개에서 한 번 누르면 바로 방까지. 2026-10-20).
// 화면 기록은 바꿔 치기(replace)라 방에서 뒤로 가면 연수 입장 화면으로 돌아와 다시 들어가지 않는다.
// 브라우저가 저절로 옮겨 가지 못했을 때를 위해 단추는 그대로 두고, 누르면 다시 시도한다
export function EnterYeonsu({ room, name, picture }: { room: string; name: string; picture: string | null }) {
  const router = useRouter();
  const went = useRef(false);
  const [entering, setEntering] = useState(false);
  function enter() {
    sessionStorage.setItem("name", name);
    sessionStorage.setItem("avatar", picture ? DORMS : AVATARS[0]);
    sessionStorage.removeItem("photo");
    sessionStorage.setItem("room", room);
    sessionStorage.setItem("password", "");
    sessionStorage.setItem(ROOM_ENTRY_KEY, "1");
    setEntering(true);
    router.replace("/room");
  }
  useEffect(() => {
    if (went.current) return; // 개발 중 두 번 실행되어도 한 번만
    went.current = true;
    enter();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 화면이 열릴 때 한 번만
  }, []);
  return (
    <button onClick={enter} className="dolive-button dolive-entry flex h-16 w-full items-center justify-center rounded-lg px-4 py-4 text-xl font-semibold">
      <span className="dolive-button-cap text-white">{entering ? "연수 방에 들어가는 중…" : "연수 방 들어가기"}</span>
    </button>
  );
}
