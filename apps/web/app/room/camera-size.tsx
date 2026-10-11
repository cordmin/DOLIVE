import type { PointerEvent } from "react";
import { CAM_SIZES } from "@/lib/dolive";

// 화면공유에 겹치는 얼굴만 조절한다. 돌리기·눈금 누르기·방향키를 모두 쓸 수 있다.
export function CameraSize({ value, disabled, change }: { value: number; disabled: boolean; change: (size: number) => void }) {
  function turn(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    if (Math.hypot(x, y) < 8) return;
    const angle = Math.atan2(x, -y) * 180 / Math.PI;
    change(Math.max(2, Math.min(4, Math.round(angle / 67.5) + 3)));
  }
  return <div className={`flex flex-col items-center gap-1.5 ${disabled ? "opacity-35" : ""}`}>
    <div role="slider" aria-label="크기" aria-valuemin={2} aria-valuemax={4} aria-valuenow={value} aria-valuetext={value === 2 ? "작게" : value === 4 ? "크게" : "기본"} aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0} className="camera-size relative -mt-[13px] -mb-[13px] size-16 touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#719af7]"
      onPointerDown={e => { if (disabled || e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); turn(e); }}
      onPointerMove={e => { if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) turn(e); }}
      onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onKeyDown={e => {
        if (disabled) return;
        const next = e.key === "Home" ? 2 : e.key === "End" ? 4 : ["ArrowUp", "ArrowRight"].includes(e.key) ? Math.min(4, value + 1) : ["ArrowDown", "ArrowLeft"].includes(e.key) ? Math.max(2, value - 1) : undefined;
        if (next !== undefined) { e.preventDefault(); change(next); }
      }}>
      {CAM_SIZES.map(n => {
        const angle = (n - 3) * 67.5 * Math.PI / 180;
        const on = !disabled && n === value;
        return <span key={n} aria-hidden="true" className="pointer-events-none absolute size-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: 32 + Math.sin(angle) * 29, top: 32 - Math.cos(angle) * 29, background: on ? "#e6b85c" : "#494640", boxShadow: on ? "0 0 3px #e6b85c, 0 0 7px #e6b85c66" : "inset 0 1px 1px #0009" }} />;
      })}
      <span aria-hidden="true" className="camera-size-knob absolute inset-[13px] rounded-full">
        {/* 원래 어두운 색을 유지하고, 작은 버튼에서 구분되는 간격으로 홈을 그린다. */}
        <svg viewBox="0 0 38 38" className="absolute inset-0 size-full" fill="none" stroke="#252527" strokeWidth="1.8">
          {Array.from({ length: 28 }, (_, i) => <path key={i} d="M19 1.5v3" transform={`rotate(${i * 360 / 28} 19 19)`} />)}
        </svg>
        <span className="camera-size-cap absolute inset-[5px] rounded-full" style={{ transform: `rotate(${(value - 3) * 67.5}deg)` }}><span className="camera-size-needle absolute top-[3px] left-1/2 h-[11px] w-[2px] -translate-x-1/2 rounded-full" /></span>
      </span>
    </div>
    <span className="text-[11px] text-[#a39f98]">크기</span>
  </div>;
}
