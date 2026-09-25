// 프로필 사진(동그라미, round={false}면 사진 비율 4:5 네모 그대로. 사진은 모두 240x300). 말하면 초록 테두리, 음소거면 어둡게 + 빨간 마이크 꺼짐 표시.
// id: 기본 사진 번호, 또는 내가 고른 사진의 주소(data:/blob:), 또는 ""(아직 못 받음 = 빈 회색).
// px: 작게 보여 줄 때 화면에 나오는 최대 폭. 기본 사진이면 서버가 그 크기(화면 밀도별 1~3배)로 줄여 보내서 PC에서도 곱게 보인다.
export function Avatar({
  id,
  talking = false,
  muted = false,
  round = true,
  px,
  className = "",
}: {
  id: string;
  talking?: boolean;
  muted?: boolean;
  round?: boolean;
  px?: number;
  className?: string;
}) {
  const own = id.includes(":"); // 내가 고른 사진 (주소 그대로)
  return (
    <div className={`relative ${round ? "aspect-square" : "aspect-[4/5]"} ${className}`}>
      {id && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={own ? id : `/profile/${id}${px ? `?w=${px}` : ""}`}
          srcSet={px && !own ? [1, 2, 3].map((x) => `/profile/${id}?w=${px * x} ${x}x`).join(", ") : undefined}
          alt=""
          className={`size-full object-cover ${round ? "rounded-full" : ""} bg-zinc-700 ${talking ? "ring-2 ring-green-500" : ""} ${
            muted ? "brightness-50" : ""
          }`}
        />
      )}
      {!id && <div className={`size-full bg-zinc-700 ${round ? "rounded-full" : ""}`} />}
      {muted && (
        <span
          className={`absolute ${round ? "right-0 bottom-0" : "right-1 bottom-1"} rounded-full bg-red-600 p-1 text-white`}
          title="음소거"
          aria-label="음소거"
        >
          {/* 마이크에 빗금 */}
          <svg
            viewBox="0 0 24 24"
            className="size-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16" />
          </svg>
        </span>
      )}
    </div>
  );
}
