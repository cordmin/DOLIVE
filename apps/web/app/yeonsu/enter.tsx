"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AvatarPicker } from "@/components/AvatarPicker";
import { AVATARS, CUSTOM, DORMS } from "@/lib/dolive";
import { ROOM_ENTRY_KEY } from "@/lib/roomHistory";

// 연수 방 들어가기: 먼저 입장 창(연수 제목, 프로필 사진, 닉네임)을 띄우고, [입장하기]를 누르면 그 자리에서 방 화면을 그린다.
// 도름스 링크로 바로 오면 이 페이지에서 한 번도 누른 적이 없어 브라우저가 방 소리를 막는다. [입장하기]를 한 번 누르게 해서 소리가 처음부터 나오게 한다.
// 다른 주소로 옮겨 가지 않아서 주소창에 연수 주소(dolive.site/<짧은 번호>)가 그대로 남는다 (2026-10-20 사용자 지시).
// 이름은 도름스 닉네임, 사진은 도름스 사진(없으면 첫 사진)을 미리 골라 두고 바꿀 수 있다. 연수 방은 비밀번호가 없다.
// 입장 창 모양: 시안 C-1, [입장하기]는 빨간 몸체 (2026-11-10 사용자 선택)
// 방 화면은 브라우저에서만 그린다(ssr: false): 화면 크기·마이크처럼 브라우저에만 있는 것을 읽는다.
const RoomPage = dynamic(() => import("@/app/room/page"), {
  ssr: false,
  loading: () => <p style={{ margin: "auto", padding: 24, color: "#d4d4d8" }}>연수 방에 들어가는 중…</p>,
});

export type YeonsuInfo = { title: string; hostName: string; time: string };

export function EnterYeonsu({ room, name, picture, info, dormsHref }: { room: string; name: string; picture: string | null; info?: YeonsuInfo; dormsHref: string }) {
  const [entered, setEntered] = useState(false);
  const [nick, setNick] = useState(name);
  const [avatar, setAvatar] = useState(picture ? DORMS : AVATARS[0]);
  const [custom, setCustom] = useState<string>(); // 전에 올린 내 사진 (이 브라우저에 남아 있다)
  useEffect(() => {
    try {
      const photo = localStorage.getItem("photo");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (photo) setCustom(photo);
    } catch {}
  }, []);

  function enter() {
    if (!nick.trim()) return;
    // 방 화면이 이 값으로 입장권을 받는다 (입장 화면 app/page.tsx 의 go() 와 같은 값)
    sessionStorage.setItem("name", nick.trim());
    sessionStorage.setItem("avatar", avatar);
    if (avatar === CUSTOM && custom) sessionStorage.setItem("photo", custom);
    else sessionStorage.removeItem("photo");
    sessionStorage.setItem("room", room);
    sessionStorage.setItem("password", "");
    sessionStorage.setItem(ROOM_ENTRY_KEY, "1");
    setEntered(true);
  }

  if (entered) return <RoomPage />;
  return (
    <div className="fixed inset-0 flex overflow-y-auto p-4">
      {/* form 으로 감싸지 않는다: 사진 자리 맞추기 창(PhotoCrop)의 버튼이 [입장하기]처럼 눌려 버린다 */}
      <div className="m-auto w-[min(380px,100%)] rounded-[14px] bg-[#141416] px-3.5 pt-6 pb-5 text-center text-white shadow-[0_0_0_1px_#000,0_0_0_2px_#ffffff14,0_12px_30px_#000a]"
      >
        <p className="mb-3.5 text-2xl leading-none font-bold">
          DO<span className="text-red-500">LIVE</span>
        </p>
        {info && (
          <div className="mx-1 rounded-[10px] bg-[#0e0e10] px-3 py-3.5 shadow-[inset_0_1px_3px_#0009,0_1px_0_#ffffff0d] [overflow-wrap:anywhere] [word-break:keep-all]">
            <p className="text-lg leading-snug font-bold">{info.title}</p>
            <p className="mt-2 text-[13px] text-zinc-400">
              <b className="font-semibold text-[#d1b77f]">{info.hostName}</b> 선생님{info.time && ` · ${info.time}`}
            </p>
          </div>
        )}
        <section className="mx-1 mt-[18px] text-left">
          <span className="mb-2 block text-[13px] text-zinc-400">프로필 사진</span>
          <AvatarPicker avatar={avatar} onAvatar={setAvatar} custom={custom} onCustom={setCustom} dormsPicture={picture} />
        </section>
        <label className="mx-1 mt-[18px] block text-left">
          <span className="mb-2 block text-[13px] text-zinc-400">닉네임</span>
          <input
            value={nick}
            onChange={(e) => setNick(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enter()}
            maxLength={20}
            placeholder="입력 필수"
            className="w-full rounded-lg bg-zinc-800 px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <div className="mt-[22px] flex gap-[21px]">
          <a href={dormsHref} className="dolive-button flex flex-1 items-center justify-center py-2 text-sm">
            <span className="dolive-button-cap">도름스로</span>
          </a>
          <button onClick={enter} disabled={!nick.trim()} className="dolive-button dolive-danger flex-1 py-2 text-sm">
            <span className="dolive-button-cap">입장하기</span>
          </button>
        </div>
      </div>
    </div>
  );
}
