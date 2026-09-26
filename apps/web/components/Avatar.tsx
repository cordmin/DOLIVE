// 프로필 사진(동그라미, round={false}면 사진 비율 4:5 네모 그대로. 사진은 모두 240x300). 말하면 초록 테두리. mic를 주면 오른쪽 아래에 마이크 켜짐(초록)/꺼짐(빨강) 점.
// id: 기본 사진 번호, 또는 내가 고른 사진의 주소(data:/blob:), 또는 ""(아직 못 받음 = 빈 회색).
// px: 작게 보여 줄 때 화면에 나오는 최대 폭. 기본 사진이면 서버가 그 크기(화면 밀도별 1~3배)로 줄여 보내서 PC에서도 곱게 보인다.
export function Avatar({
  id,
  talking = false,
  mic,
  round = true,
  px,
  className = "",
}: {
  id: string;
  talking?: boolean;
  mic?: boolean; // 안 주면 점 없음
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
          className={`size-full object-cover ${round ? "rounded-full" : ""} bg-zinc-700 ${talking ? "ring-2 ring-green-500" : ""}`}
        />
      )}
      {!id && <div className={`size-full bg-zinc-700 ${round ? "rounded-full" : ""}`} />}
      {/* 마이크: 켜짐 초록 점, 꺼짐 빨간 점 (사진을 가리지 않게 작게) */}
      {mic !== undefined && (
        <span
          className={`absolute ${round ? "right-0 bottom-0 size-2.5" : "right-1.5 bottom-1.5 size-3"} rounded-full ring-2 ring-zinc-900 ${
            mic ? "bg-green-500" : "bg-[#EB6B6B]"
          }`}
          title={mic ? "마이크 켜짐" : "마이크 꺼짐"}
          aria-label={mic ? "마이크 켜짐" : "마이크 꺼짐"}
        />
      )}
    </div>
  );
}
