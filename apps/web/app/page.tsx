"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { PhotoCrop } from "@/components/PhotoCrop";
import { AVATARS, CUSTOM, isPhone, savedAvatar } from "@/lib/dolive";

// 입장 화면: 프로필 사진(기본 11장 + 내 사진) + 닉네임 → 채팅방 입장
// 내 사진은 이 브라우저(sessionStorage "photo")에 두었다가 입장할 때 서버 메모리에 올린다 (서버를 끄면 사라진다).
// (마이크는 꺼진 채로 들어가고, 방 안 위쪽 스위치로 켠다)
export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [custom, setCustom] = useState<string>(); // 내가 고른 사진 (data: 주소, 새로고침하면 없어진다)
  const [picked, setPicked] = useState<File>(); // 자리 맞추기 중인 사진
  const picker = useRef<HTMLInputElement>(null);
  // 오른쪽 위: 서버 PC(방장)면 로그인된 부방장 기기 수 + [전체기기 로그아웃], 부방장이면 [로그아웃], 나머지는 [관리자 로그인]
  // ([관리자 로그인]은 휴대폰에선 숨긴다. 관리자가 필요한 화면공유를 휴대폰에선 못 해서)
  // (부방장 = 다른 컴퓨터에서 비밀번호로 로그인한 운영진. 방장과 같은 권한, 12시간 뒤 저절로 로그아웃. app/api/login)
  const [me, setMe] = useState<{ local: boolean; count: number; loggedIn: boolean }>();
  const [password, setPassword] = useState<string | null>(null); // null = 비밀번호 칸 닫힘
  const loadMe = () =>
    fetch("/api/login", { cache: "no-store" })
      .then((r) => r.json())
      .then(setMe)
      .catch(() => {});

  // 부방장이 다른 곳에서 로그인하면 따라가게 10초마다 다시 센다
  useEffect(() => {
    loadMe();
    const t = setInterval(loadMe, 10000);
    return () => clearInterval(t);
  }, []);

  // 다른 컴퓨터에서 로그인한 부방장(운영진)을 모두 로그아웃시킨다. 방에 있던 부방장도 나가진다 (app/api/login)
  async function logoutAll() {
    if (!confirm("부방장 전체 기기를 로그아웃할까요? 방에 있는 부방장도 방에서 나가져요.")) return;
    await fetch("/api/login", { method: "DELETE" });
    loadMe();
    alert("부방장 전체 기기를 로그아웃했어요.");
  }

  async function login() {
    const r = await fetch("/api/login", { method: "POST", body: JSON.stringify({ password }) });
    if (!r.ok) {
      setPassword("");
      return alert((await r.json()).error);
    }
    setPassword(null);
    loadMe();
  }

  // 부방장 본인 로그아웃
  async function logout() {
    await fetch("/api/login", { method: "DELETE" });
    loadMe();
  }

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
    // 휴대폰은 입장하면서 주소창·아래 버튼 줄·시계 줄을 모두 숨긴다 (누른 순간에만 허락돼서 여기서. 아이폰은 막혀 있어 그냥 넘어간다).
    // 시계 줄만 남기는 설정(navigationUI "show")은 시계 줄은 그대로 숨기고 아래 버튼 줄만 화면 위에 덮어 입력칸을 가려서 안 쓴다
    if (isPhone()) document.documentElement.requestFullscreen?.().catch(() => {});
    router.push("/room");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">
          DO<span className="text-red-500">LIVE</span>
        </h1>
        {me?.local ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-400">{me.count ? `부방장 ${me.count}대 로그인 중` : "로그인된 부방장 없음"}</span>
            <button onClick={logoutAll} className="rounded-lg bg-zinc-700 px-3 py-2 text-sm font-semibold hover:bg-zinc-600">
              전체기기 로그아웃
            </button>
          </div>
        ) : me?.loggedIn ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-400">
              <span className="text-green-400">●</span> 관리자로 로그인됨
            </span>
            <button onClick={logout} className="rounded-lg bg-zinc-700 px-3 py-2 text-sm font-semibold hover:bg-zinc-600">
              로그아웃
            </button>
          </div>
        ) : !me || isPhone() ? null : password === null ? (
          <button onClick={() => setPassword("")} className="rounded-lg bg-zinc-700 px-3 py-2 text-sm font-semibold hover:bg-zinc-600">
            관리자 로그인
          </button>
        ) : (
          // Enter 로 로그인, Esc 나 빈 채로 다른 곳을 누르면 닫힌다
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => (e.key === "Enter" && password ? login() : e.key === "Escape" && setPassword(null))}
            onBlur={() => !password && setPassword(null)}
            autoFocus
            placeholder="비밀번호 입력 후 Enter"
            className="w-48 rounded-lg bg-zinc-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        )}
      </div>

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
