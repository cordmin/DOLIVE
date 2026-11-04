"use client";

import { useEffect, useRef } from "react";
import { isSafari } from "@/lib/safari";

// DOLIVE 는 크롬 기준으로 만들어서 사파리에서는 불안정할 때가 많다. 사파리로 들어오면 탭마다 한 번 크롬을 권한다 (막지는 않는다).
// 입장 화면·연수 주소·방 주소 어디로 들어와도 보이게 app/layout.tsx 에 둔다
const SEEN = "safari-notice";

export function SafariNotice() {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!isSafari(navigator.userAgent)) return;
    try {
      if (sessionStorage.getItem(SEEN)) return;
      sessionStorage.setItem(SEEN, "1");
    } catch {}
    dlg.current?.showModal();
  }, []);
  return (
    <dialog ref={dlg} className="m-auto w-72 rounded-xl bg-zinc-800 p-5 text-zinc-100 ring-1 ring-zinc-700 backdrop:bg-black/60">
      <p className="mb-10 text-center font-semibold">크롬 브라우저로 접속하는 것을 권장합니다</p>
      <button onClick={() => dlg.current?.close()} className="dolive-button dolive-primary w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold hover:bg-indigo-500">
        <span className="dolive-button-cap">확인</span>
      </button>
    </dialog>
  );
}
