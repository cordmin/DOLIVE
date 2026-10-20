"use client";

import dynamic from "next/dynamic";
import { AVATARS, DORMS } from "@/lib/dolive";
import { ROOM_ENTRY_KEY } from "@/lib/roomHistory";

// 연수 방 들어가기: 입장 화면(app/page.tsx)의 go() 와 같은 값을 남기고, 그 자리에서 방 화면을 그린다.
// 다른 주소로 옮겨 가지 않아서 주소창에 연수 주소(dolive.site/<짧은 번호>)가 그대로 남는다 (2026-10-20 사용자 지시).
// 이름은 도름스 닉네임, 사진은 도름스 사진(없으면 첫 사진). 연수 방은 비밀번호가 없다.
// 방 화면은 브라우저에서만 그린다(ssr: false): 화면 크기·마이크처럼 브라우저에만 있는 것을 읽는다.
const RoomPage = dynamic(() => import("@/app/room/page"), {
  ssr: false,
  loading: () => <p style={{ margin: "auto", padding: 24, color: "#d4d4d8" }}>연수 방에 들어가는 중…</p>,
});

export function EnterYeonsu({ room, name, picture }: { room: string; name: string; picture: string | null }) {
  // 방 화면이 읽기 전에 미리 넣는다 (방 화면은 그려진 뒤 이 값으로 입장권을 받는다)
  if (typeof window !== "undefined") {
    sessionStorage.setItem("name", name);
    sessionStorage.setItem("avatar", picture ? DORMS : AVATARS[0]);
    sessionStorage.removeItem("photo");
    sessionStorage.setItem("room", room);
    sessionStorage.setItem("password", "");
    sessionStorage.setItem(ROOM_ENTRY_KEY, "1");
  }
  return <RoomPage />;
}
