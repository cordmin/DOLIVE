// 도름이 원본 © 아인T, CC BY-NC 4.0. 사용자가 고른 네 가지 그림만 사용한다.
export const DONATION_STYLES = [
  { id: "01", name: "입체 고급형" },
  { id: "02", name: "투명 우산" },
  { id: "04", name: "애니메이션" },
  { id: "06", name: "가을 나뭇잎" },
] as const;
export type DonationStyle = (typeof DONATION_STYLES)[number]["id"];

// 작은 버튼에서도 원본의 눈·입·볼이 또렷하게 보이도록 그린다.
export function DonationFace() {
  return <svg viewBox="0 0 40 40" className="size-8" fill="none" aria-hidden>
    <circle cx="20" cy="20" r="18" fill="#f3f3ff" stroke="#bbc1d5" strokeWidth="1.5" />
    <ellipse cx="14.5" cy="17" rx="1.7" ry="2.8" fill="#222222" />
    <ellipse cx="25.5" cy="17" rx="1.7" ry="2.8" fill="#222222" />
    <ellipse cx="9.5" cy="23" rx="2.6" ry="1.3" fill="#eebdc8" />
    <ellipse cx="30.5" cy="23" rx="2.6" ry="1.3" fill="#eebdc8" />
    <path d="M16 23.5Q20 26 24 23.5" fill="none" stroke="#222222" strokeWidth="1" strokeLinecap="round" />
  </svg>;
}

export function DonationMascot({ small = false, variant = "01" }: { small?: boolean; variant?: DonationStyle }) {
  const name = DONATION_STYLES.find((style) => style.id === variant)?.name ?? "입체 고급형";
  return <span className={`inline-block ${small ? "size-8" : "size-40"}`}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/doreumi/donation/${variant}.webp`} alt={`${name} 우산을 손에 쥔 도름이`} width={512} height={512} className="size-full object-contain" />
  </span>;
}
