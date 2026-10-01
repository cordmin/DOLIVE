"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 말풍선 툴팁. data-tip="글" 을 단 것 위에 마우스를 올리면 그 위에 말풍선이 뜬다 (위에 자리가 없으면 아래).
// 한 곳에서 화면 전체를 지켜보다가 맨 위에 그려서, 스크롤 칸 안에 있어도 잘리지 않는다. 손가락(휴대폰)에서는 안 뜬다.
// doc: 채팅분리 창처럼 다른 창에 띄울 때 그 창의 문서
type Tip = { text: string; x: number; y: number; below: boolean };

export function Tooltips({ doc }: { doc?: Document }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0); // 창 가장자리에서 잘리지 않게 옆으로 민 만큼

  useEffect(() => {
    const d = doc ?? document;
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      // 펼친 고르는 칸(화질)의 목록 위에서는 안 띄운다 (목록이 맨 위에 그려져서 말풍선이 그 뒤에 숨고, 목록보다 넓어서 목록이 넓어진 것처럼 보인다).
      // 항목 위는 option 으로, 항목 사이 틈·가장자리는 고르는 칸 자체로 잡히니 마우스가 정말 그 칸 안에 있을 때만 띄운다
      const el = (e.target as Element).closest?.("[data-tip]");
      if (!el || (e.target as Element).closest("option")) return setTip(null);
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return setTip(null);
      // 세로로 긴 것(채팅 폭 손잡이)은 마우스가 있는 높이에 띄운다
      const top = r.height > 100 ? e.clientY - 8 : r.top;
      const below = top < 48;
      setTip({ text: el.getAttribute("data-tip") ?? "", x: r.left + r.width / 2, y: below ? r.bottom : top, below });
    };
    const hide = () => setTip(null);
    d.addEventListener("pointerover", over);
    d.addEventListener("pointerdown", hide);
    d.documentElement.addEventListener("pointerleave", hide);
    d.addEventListener("scroll", hide, true);
    return () => {
      d.removeEventListener("pointerover", over);
      d.removeEventListener("pointerdown", hide);
      d.documentElement.removeEventListener("pointerleave", hide);
      d.removeEventListener("scroll", hide, true);
    };
  }, [doc]);

  useLayoutEffect(() => {
    const b = bubble.current;
    if (!tip || !b) return setShift(0);
    const r = b.getBoundingClientRect();
    const w = b.ownerDocument.defaultView?.innerWidth ?? 0;
    setShift(Math.min(0, w - 8 - (r.right - shift)) + Math.max(0, 8 - (r.left - shift)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 말풍선이 바뀔 때만 다시 잰다
  }, [tip]);

  if (!tip?.text) return null;
  return createPortal(
    <div
      ref={bubble}
      role="tooltip"
      style={{ left: tip.x + shift, top: tip.y }}
      className={`pointer-events-none fixed z-[100] -translate-x-1/2 animate-[tip-in_0.12s_ease-out] rounded-xl bg-zinc-100 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-zinc-900 shadow-lg shadow-black/40 ${
        tip.below ? "mt-2.5" : "-mt-2.5 -translate-y-full"
      }`}
    >
      {tip.text}
      {/* 말풍선 꼬리 */}
      <span
        style={{ left: `calc(50% - ${shift}px)` }}
        className={`absolute size-2.5 -translate-x-1/2 rotate-45 bg-zinc-100 ${tip.below ? "-top-1" : "-bottom-1"}`}
      />
    </div>,
    (doc ?? document).body,
  );
}
