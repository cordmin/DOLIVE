import type { ButtonHTMLAttributes, ReactNode } from "react";

// PC 방 화면 오른쪽 위 버튼: 위에 작은 불빛, 가운데 동그란 검정 버튼, 아래 이름 (myboard.my 의 템플릿 버튼처럼. globals.css 의 hw-*).
// 휴대폰에서는 불빛과 이름 대신 초록 링(켜짐)과 빨간 링(꺼짐)을 쓴다.
export function Knob({ label, led, icon, compactMobile = false, mobileRing = true, className = "", ...rest }: { label: ReactNode; led?: "green" | "amber" | "red"; icon: ReactNode; compactMobile?: boolean; mobileRing?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={typeof label === "string" ? label : undefined} {...rest} data-compact-mobile={compactMobile || undefined} data-mobile-ring={compactMobile && mobileRing ? led : undefined} className={`group flex shrink-0 cursor-pointer flex-col items-center disabled:opacity-60 ${compactMobile ? "min-w-9 gap-0 md:min-w-14 md:gap-1.5" : "min-w-14 gap-1.5"} ${className}`}>
      <span className={`hw-led ${compactMobile ? "hidden md:block" : ""} ${led === "green" ? "hw-led-green" : led === "amber" ? "hw-led-amber" : ""}`} />
      <span className={`hw-cap transition group-hover:brightness-125 group-active:translate-y-px group-disabled:brightness-100 ${compactMobile ? "max-md:size-[34px]" : ""} ${compactMobile && mobileRing && (led === "green" || led === "red") ? `max-md:outline max-md:outline-1 ${led === "red" ? "max-md:outline-[#e42b20]" : "max-md:outline-[#69c893]"}` : ""}`}>{icon}</span>
      <span className={`text-[11px] whitespace-nowrap text-[#a39f98] ${compactMobile ? "hidden md:block" : ""}`}>{label}</span>
    </button>
  );
}
