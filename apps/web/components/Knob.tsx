import type { ButtonHTMLAttributes, ReactNode } from "react";

// PC 방 화면 오른쪽 위 버튼: 위에 작은 불빛, 가운데 동그란 검정 버튼, 아래 이름 (myboard.my 의 템플릿 버튼처럼. globals.css 의 hw-*).
// 휴대폰에서는 불빛과 이름 대신 버튼 둘레의 초록 링으로 켜짐을 표시한다.
export function Knob({ label, led, icon, compactMobile = false, className = "", ...rest }: { label: ReactNode; led?: "green" | "amber"; icon: ReactNode; compactMobile?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={typeof label === "string" ? label : undefined} {...rest} className={`group flex shrink-0 flex-col items-center disabled:opacity-60 ${compactMobile ? "min-w-9 gap-0 md:min-w-14 md:gap-1.5" : "min-w-14 gap-1.5"} ${className}`}>
      <span className={`hw-led ${compactMobile ? "hidden md:block" : ""} ${led === "green" ? "hw-led-green" : led === "amber" ? "hw-led-amber" : ""}`} />
      <span className={`hw-cap transition group-hover:brightness-125 group-active:translate-y-px group-disabled:brightness-100 ${compactMobile ? "max-md:size-[34px]" : ""} ${compactMobile && led === "green" ? "max-md:outline max-md:outline-1 max-md:outline-green-400/60" : ""}`}>{icon}</span>
      <span className={`text-[11px] whitespace-nowrap text-[#a39f98] ${compactMobile ? "hidden md:block" : ""}`}>{label}</span>
    </button>
  );
}
