"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// 상태 페이지의 움직이는 부분: 1분마다 새 내용 받기(화면을 보고 있을 때만), 막대·물음표에 올리거나 누르면 설명 띄우기
export function StatusLive() {
  const router = useRouter();
  const [tip, setTip] = useState<{ text: string; x: number; y: number }>();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60_000);
    const onVisible = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  useEffect(() => {
    const target = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>("[data-tip]");
    const show = (el: HTMLElement, x: number, y: number) => setTip({ text: el.dataset.tip ?? "", x, y });
    const over = (e: PointerEvent) => { const el = target(e); if (el) show(el, e.clientX, e.clientY); };
    const move = (e: PointerEvent) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t));
    const out = (e: PointerEvent) => { const el = target(e); if (el && !el.contains(e.relatedTarget as Node)) setTip(undefined); };
    const focus = (e: FocusEvent) => { const el = target(e); if (!el) return; const r = el.getBoundingClientRect(); show(el, r.left, r.bottom); };
    const hide = () => setTip(undefined);
    document.addEventListener("pointerover", over);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, { passive: true });
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide);
    };
  }, []);

  // 화면 밖으로 나가지 않게 붙일 자리를 고른다
  useEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const r = el.getBoundingClientRect();
    let left = tip.x + 14, top = tip.y + 14;
    if (left + r.width > innerWidth - 8) left = tip.x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = tip.y - r.height - 14;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
  }, [tip]);

  return tip ? <div ref={box} className="st-tip" role="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>{tip.text}</div> : null;
}
