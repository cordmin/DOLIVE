"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { PhotoCrop } from "@/components/PhotoCrop";
import { AVATARS, CUSTOM, DORMS, isPhone, leaveForDorms, savedAvatar } from "@/lib/dolive";

// 방송 목록 한 줄 (api/rooms GET)
type Broadcast = { name: string; locked: boolean; onAir: boolean };

// 입장 화면: 프로필 사진(기본 9장 + 도름스 사진 + 내 사진) + 닉네임 + 방송 고르기 → LIVE 입장 (도름스 회원만. 서버 PC는 빼고)
// 방송 목록은 서버 켜기 창 톱니바퀴 [채팅방 관리]에서 만든 방들 (api/rooms). 비밀번호 방은 [LIVE 입장]을 누르면 비밀번호 창이 뜬다 (방장·운영진은 안 묻는다)
// 내 사진은 이 브라우저(localStorage "photo")에 남겨 두어 다음에 와도 그대로고, 입장할 때 서버 메모리에 올린다 (서버를 끄면 서버에선 사라진다).
// (마이크는 꺼진 채로 들어가고, 방 안 위쪽 스위치로 켠다)
export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [custom, setCustom] = useState<string>(); // 내가 올린 사진 (data: 주소, 이 브라우저에 남는다)
  const [picked, setPicked] = useState<File>(); // 자리 맞추기 중인 사진
  const picker = useRef<HTMLInputElement>(null);
  const needLogin = useRef<HTMLDialogElement>(null); // "로그인을 먼저 해주세요" 창 (채팅방의 나가기 창과 같은 모양, 화면 가운데)
  const askPw = useRef<HTMLDialogElement>(null); // 비밀번호 방 비밀번호 묻는 창 (모양은 위 창과 같게)
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState("");
  // 방송 목록과 고른 방송. ON AIR(방장·운영진이 들어가 있음)가 바뀌는 걸 보여 주려고 10초마다 다시 묻는다
  const [rooms, setRooms] = useState<Broadcast[]>(); // 받아 오기 전엔 비워 둔다 ("열린 방송이 없어요"가 잠깐 보이지 않게)
  const [room, setRoom] = useState("");
  useEffect(() => {
    const load = () =>
      fetch("/api/rooms", { cache: "no-store" })
        .then((r) => r.json())
        .then((list: Broadcast[]) => {
          setRooms(list);
          // 고른 방이 목록에서 사라졌으면 이 탭에서 전에 고른 방, 그것도 없으면 첫 방
          setRoom((cur) => [cur, sessionStorage.getItem("room")].find((n) => list.some((x) => x.name === n)) ?? list[0]?.name ?? "");
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  // 오른쪽 위: 서버 PC(방장)면 아무것도 없고, 나머지는 도름스 칸 (로그인했으면 도름스 프로필 사진(없으면 이름) + [로그아웃], 아니면 [로그인]).
  // 도름스 회원만 채팅방에 들어간다. 운영진(서버 켜기 창 톱니바퀴에 적은 도름스 닉네임)은 방에서 방장 권한을 받는다 (lib/server.ts isStaff)
  const [me, setMe] = useState<{ local: boolean; admin: boolean; dorms: string | null; picture: string | null; dormsReason: string | null }>();
  // 도름스로 로그인돼 있으면 입장 화면을 열 때마다 닉네임 칸에 도름스 닉네임을 넣어 둔다 (이 탭에서 전에 쓴 닉네임보다 우선. 고쳐 쓸 수는 있다)
  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((m) => {
        setMe(m);
        if (m.dorms) setName(m.dorms.slice(0, 20));
        if (!m.picture) setAvatar((a) => (a === DORMS ? AVATARS[0] : a)); // 도름스 사진이 없으면 그 칸은 못 고른다
      })
      .catch(() => {});
  }, []);

  // sessionStorage는 브라우저에만 있어서 화면이 뜬 뒤(effect)에 읽어야 서버 화면과 어긋나지 않는다
  useEffect(() => {
    // 닉네임은 다시 꺼내 쓰지 않는다 (로그인하면 도름스 닉네임, 로그아웃이면 빈칸. 예전에 쓴 닉네임이 남아 보이지 않게).
    // sessionStorage "name" 은 입장할 때 채팅방(app/room)에 넘겨주는 용도로만 쓴다
    let photo: string | null = null;
    try {
      photo = localStorage.getItem("photo");
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (photo) setCustom(photo);
    const saved = savedAvatar();
    setAvatar(saved === CUSTOM && !photo ? AVATARS[0] : saved);
  }, []);

  function choosePhoto(jpeg: Blob) {
    setPicked(undefined);
    const reader = new FileReader();
    reader.onload = () => {
      // 새로 올리면 내 사진 칸의 사진이 바뀐다. 다음에 와도 남게 이 브라우저에 저장 (못 하면 이번에만 쓴다)
      setCustom(reader.result as string);
      setAvatar(CUSTOM);
      try {
        localStorage.setItem("photo", reader.result as string);
      } catch {}
    };
    reader.readAsDataURL(jpeg);
  }

  function enter() {
    if (!name.trim() || !room) return;
    sessionStorage.setItem("name", name.trim());
    sessionStorage.setItem("avatar", avatar);
    if (avatar === CUSTOM && custom) sessionStorage.setItem("photo", custom);
    // 도름스 로그인 전이면 들어가지 않고 [로그인]부터 누르게 한다 (여기서 바로 도름스로 보내면, 도름스에 로그인돼 있는 브라우저는
    // 묻지 않고 다시 로그인돼서 로그아웃했는데도 들어가지는 것처럼 보인다). 허용이 끊겼거나 도름스가 안 되면 안내 화면.
    // 진짜 문은 서버(app/room/layout.tsx, api/token)가 다시 확인한다
    if (me && !me.local && !me.dorms) {
      if (me.dormsReason === "access_denied" || me.dormsReason === "temporarily_unavailable")
        location.href = `/dorms-denied?reason=${me.dormsReason}&next=/room`;
      else needLogin.current?.showModal();
      return;
    }
    if (rooms?.find((r) => r.name === room)?.locked && !me?.admin) {
      setPw("");
      setPwError("");
      askPw.current?.showModal();
      return;
    }
    go("");
  }

  // 비밀번호 창 [입장]: 서버에 맞는지 먼저 물어보고, 틀리면 창에 그대로 두고 알려 준다
  async function checkPw() {
    const r = await fetch("/api/rooms", { method: "POST", body: JSON.stringify({ room, password: pw }) }).catch(() => null);
    if (r?.ok) return go(pw);
    const reason = (await r?.json().catch(() => null))?.reason;
    if (leaveForDorms(reason)) return;
    setPwError(reason === "password" ? "비밀번호가 틀렸어요" : reason === "no_room" ? "닫힌 방송이에요" : "들어가지 못했어요. 다시 해 주세요");
  }

  // 고른 방송과 비밀번호를 채팅방(app/room)에 넘겨주고 들어간다 (채팅방이 입장권을 받을 때 같이 보낸다)
  function go(password: string) {
    sessionStorage.setItem("room", room);
    sessionStorage.setItem("password", password);
    // 휴대폰은 입장하면서 주소창·아래 버튼 줄·시계 줄을 모두 숨긴다 (누른 순간에만 허락돼서 여기서. 아이폰은 막혀 있어 그냥 넘어간다).
    // 시계 줄만 남기는 설정(navigationUI "show")은 시계 줄은 그대로 숨기고 아래 버튼 줄만 화면 위에 덮어 입력칸을 가려서 안 쓴다
    if (isPhone()) document.documentElement.requestFullscreen?.().catch(() => {});
    router.push("/room");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">
          DO<span className="text-red-500">LIVE</span>
        </h1>
        {!me || me.local ? null : me.dorms ? (
          <div className="flex items-center gap-3">
            {me.picture ? (
              // 도름스 프로필 사진. 동그라미 지름 = 옆 [로그아웃] 버튼 높이(36px). 마우스를 올리면 닉네임
              // eslint-disable-next-line @next/next/no-img-element -- 도름스가 주는 바깥 사진 주소라 그대로 쓴다
              <img src={me.picture} alt={me.dorms} title={me.dorms} referrerPolicy="no-referrer" className="size-9 rounded-full object-cover" />
            ) : (
              <span className="text-sm text-zinc-400">{me.dorms}</span>
            )}
            {/* 이 사이트의 도름스 로그인만 끝낸다 (같은 사이트에서 보내는 POST 만 받는다) */}
            <form method="post" action="/api/auth/dorms/logout">
              <button className="rounded-lg bg-zinc-700 px-3 py-2 text-sm font-semibold hover:bg-zinc-600">로그아웃</button>
            </form>
          </div>
        ) : (
          // 도름스 로그인 (끝나면 이 화면으로 돌아온다). 모양은 다른 버튼들과 같게
          <form method="post" action="/api/auth/dorms/start?next=/">
            <button className="rounded-lg bg-zinc-700 px-3 py-2 text-sm font-semibold hover:bg-zinc-600">로그인</button>
          </form>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <span className="text-sm text-zinc-400">프로필 사진 선택</span>
        {/* 2줄 x 6칸 (PC, 휴대폰 같음): 기본 사진 9장, 도름스 사진, 내 사진, [+] 사진 올리기 */}
        <div className="grid grid-cols-6 gap-2">
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
          {/* 도름스 프로필 사진 칸. 로그인 전이거나 도름스에 사진이 없으면 점선 빈 원 */}
          {me?.picture ? (
            <button
              onClick={() => setAvatar(DORMS)}
              aria-label="도름스 프로필 사진"
              className={`rounded-full p-1 ${avatar === DORMS ? "bg-indigo-600" : "hover:bg-zinc-700"}`}
            >
              <Avatar id={me.picture} className="w-full" />
            </button>
          ) : (
            <span className="p-1">
              <span className="flex aspect-square w-full items-center justify-center rounded-full border-2 border-dashed border-zinc-500 bg-zinc-800 text-zinc-300" />
            </span>
          )}
          {/* 내 사진 칸: 올리기 전엔 점선 빈 원(눌러도 올리기), 올린 뒤엔 그 사진 */}
          <button
            onClick={() => (custom ? setAvatar(CUSTOM) : picker.current?.click())}
            aria-label={custom ? "내 사진" : "내 사진 올리기"}
            className={`rounded-full p-1 ${avatar === CUSTOM ? "bg-indigo-600" : "hover:bg-zinc-700"}`}
          >
            {custom ? <Avatar id={custom} className="w-full" /> : <span className="flex aspect-square w-full items-center justify-center rounded-full border-2 border-dashed border-zinc-500 bg-zinc-800 text-zinc-300 hover:bg-zinc-700" />}
          </button>
          {/* 마지막 칸: 사진 올리기 (새로 올리면 내 사진 칸이 바뀐다) */}
          <button onClick={() => picker.current?.click()} aria-label="사진 올리기" className="rounded-full p-1 hover:bg-zinc-700">
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
          // Enter 를 여기서 끝낸다 (안 그러면 "로그인을 먼저 해주세요" 창이 열리자마자 같은 Enter 가 창의 [확인]을 눌러 바로 닫힌다)
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            enter();
          }}
          maxLength={20}
          placeholder="입력 필수"
          className="rounded-lg bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </label>

      <section className="flex flex-col gap-2">
        <span className="text-sm text-zinc-400">방송 목록</span>
        {!rooms ? null : rooms.length ? (
          // 여러 개 중 하나를 고르는 칸이라는 게 보이게, 바탕 없이 테두리만 + 왼쪽 동그라미 (아래 [LIVE 입장] 버튼과 다르게). 고른 줄만 보라 테두리.
          // (보라 테두리는 안쪽으로 그려서 스크롤 칸 가장자리에 잘리지 않는다) 많으면 이 칸 안에서 스크롤.
          // 이름 옆 ON AIR = 방장·운영진이 들어가 있음, 오른쪽 자물쇠 = 비밀번호 방
          <div role="radiogroup" aria-label="방송 목록" className="flex max-h-60 flex-col gap-1.5 overflow-y-auto">
            {rooms.map((r) => (
              <button
                key={r.name}
                role="radio"
                aria-checked={room === r.name}
                onClick={() => setRoom(r.name)}
                className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-left ${room === r.name ? "border-indigo-500 bg-indigo-500/10 text-white ring-1 ring-indigo-500 ring-inset" : "border-zinc-700 text-zinc-300 hover:border-zinc-500"}`}
              >
                <span
                  className={`mr-1 size-[18px] shrink-0 rounded-full border-2 ${room === r.name ? "border-indigo-400 bg-indigo-400 shadow-[inset_0_0_0_3px_#18181b]" : "border-zinc-500"}`}
                />
                <span className="truncate">{r.name}</span>
                {r.onAir && <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold tracking-wider">ON AIR</span>}
                {r.locked && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label="비밀번호" className="ml-auto size-4 shrink-0 text-zinc-400">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-zinc-700 px-4 py-3 text-zinc-400">열린 방송이 없어요</p>
        )}
      </section>

      <button
        onClick={enter}
        disabled={!name.trim() || !room}
        className="rounded-lg bg-indigo-600 px-4 py-4 text-xl font-semibold hover:bg-indigo-500 disabled:opacity-40"
      >
        LIVE 입장
      </button>
      {/* Esc 나 [확인]으로 닫힌다 */}
      <dialog
        ref={needLogin}
        className="m-auto w-72 rounded-xl bg-zinc-800 p-5 text-zinc-100 ring-1 ring-zinc-700 backdrop:bg-black/60"
      >
        <p className="mb-10 text-center font-semibold">로그인을 먼저 해주세요</p>
        <button
          onClick={() => needLogin.current?.close()}
          className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold hover:bg-indigo-500"
        >
          확인
        </button>
      </dialog>
      {/* 비밀번호 방: Esc 나 [취소]로 닫힌다. Enter 는 [입장] */}
      <dialog
        ref={askPw}
        className="m-auto w-72 rounded-xl bg-zinc-800 p-5 text-zinc-100 ring-1 ring-zinc-700 backdrop:bg-black/60"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            checkPw();
          }}
          className="flex flex-col gap-3"
        >
          <p className="truncate text-center font-semibold">{room}</p>
          <input
            type="password"
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
              setPwError("");
            }}
            autoFocus
            placeholder="비밀번호"
            className="rounded-lg bg-zinc-900 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="h-4 text-center text-xs text-red-400">{pwError}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => askPw.current?.close()} className="flex-1 rounded-lg bg-zinc-700 py-2 text-sm font-semibold hover:bg-zinc-600">
              취소
            </button>
            <button disabled={!pw} className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40">
              입장
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
