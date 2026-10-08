import type { ButtonHTMLAttributes, ReactNode } from "react";

// PC 방 화면 오른쪽 위 버튼: 위에 작은 불빛, 가운데 동그란 검정 버튼, 아래 이름 (myboard.my 의 템플릿 버튼처럼. globals.css 의 hw-*).
// led: 켜진 불빛 색 (없으면 꺼진 어두운 점). 휴대폰은 쓰지 않는다
export function Knob({ label, led, icon, className = "", ...rest }: { label: ReactNode; led?: "green" | "amber"; icon: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={`group flex min-w-14 flex-col items-center gap-1.5 disabled:opacity-60 ${className}`}>
      <span className={`hw-led ${led === "green" ? "hw-led-green" : led === "amber" ? "hw-led-amber" : ""}`} />
      <span className="hw-cap transition group-hover:brightness-125 group-active:translate-y-px group-disabled:brightness-100">{icon}</span>
      <span className="text-[11px] whitespace-nowrap text-[#a39f98]">{label}</span>
    </button>
  );
}
