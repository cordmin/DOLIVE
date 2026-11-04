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
    dlg.current?.focus(); // 열리자마자 [확인]에 흰 포커스 테두리가 생기지 않게 창 자체에 둔다 (Tab 을 누르면 그대로 보인다)
  }, []);
  return (
    // 글자 크기를 화면 폭에 맞춰 줄여서 작은 휴대폰(320)에서도 문구가 한 줄로 들어간다 (시안 B, 2026-11-04 사용자 선택)
    <dialog ref={dlg} tabIndex={-1} className="m-auto w-[min(380px,calc(100vw-32px))] max-w-none rounded-[14px] outline-none bg-[#141416] px-3.5 pt-6 pb-5 text-center text-white shadow-[0_0_0_1px_#000,0_0_0_2px_#ffffff14,0_12px_30px_#000a] backdrop:bg-black/60">
      <p className="mb-3.5 text-2xl leading-none font-bold">
        DO<span className="text-red-500">LIVE</span>
      </p>
      <p className="text-[clamp(13px,4vw,16px)] font-semibold whitespace-nowrap">크롬 브라우저로 접속하는 것을 권장합니다</p>
      <button onClick={() => dlg.current?.close()} className="dolive-button dolive-primary mt-5.5 w-full py-2 text-sm">
        <span className="dolive-button-cap">확인</span>
      </button>
    </dialog>
  );
}
