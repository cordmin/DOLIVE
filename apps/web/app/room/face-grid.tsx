import { VideoTrack, useIsSpeaking, useParticipantAttributes, type TrackReference } from "@livekit/components-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { isPhone, camWidth } from "@/lib/dolive";
import { gridFit, pageOf, rowFit } from "@/lib/faces";

// 얼굴 칸들: 바둑판, 공유 화면 아래 한 줄, 공유 화면 구석 얼굴 (stage.tsx 에서 나눔)

// 한 사람이 동시에 받는 얼굴 수. 서버 인터넷 300Mbps 기준 (page.tsx ROOM_OPTIONS). 작은 칸은 작은 화질로 받는다
const MAX_ROW = 6; // 공유 화면 아래 줄 (+ 공유하는 사람 얼굴 1)
const MAX_GRID = 9; // 공유가 없을 때 바둑판
const MAX_PHONE = 4; // 휴대폰 얼굴 바둑판
const MAX_PHONE_ROW = 5; // 휴대폰 공유 화면 아래 줄
const GAP = 8;
const phone = () => typeof window !== "undefined" && isPhone();
// 칸 크기를 재는 상자 (창 크기·채팅 폭이 바뀌면 다시 잰다)
function useBoxSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// 얼굴 한 칸: 칸에 맞게 가운데를 잘라 꽉 채운다. 좌우 반전은 그 사람이 카메라 설정에서 고른 대로 모두(나 포함) 같게. 말하는 중은 초록 테두리
// className 에는 자리 잡는 법(relative/absolute)까지 넣는다 (둘 다 붙으면 어느 쪽이 이길지 몰라서)
export function Face({ cam, style, className = "relative", round = "rounded-lg", name = true, speakingBorder = true }: { cam: TrackReference; style?: CSSProperties; className?: string; round?: string; name?: boolean; speakingBorder?: boolean }) {
  const speaking = useIsSpeaking(cam.participant);
  const mirror = useParticipantAttributes({ participant: cam.participant }).attributes?.camMirror === "1";
  return (
    <div style={style} className={`shrink-0 overflow-hidden bg-zinc-800 ${round} ${className}`}>
      {/* 엣지·크롬이 영상 위에 저절로 붙이는 "화면 속 화면" 버튼은 안 띄운다 */}
      <VideoTrack trackRef={cam} disablePictureInPicture className={`size-full object-cover ${mirror ? "-scale-x-100" : ""}`} />
      {speakingBorder && speaking && <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-green-500 ring-inset" />}
      {name && (
        <span className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/60 px-1.5 text-[11px] leading-4 text-zinc-100">
          {cam.participant.name}
        </span>
      )}
    </div>
  );
}

// 칸이 모자랄 때 마지막 칸. 누르면 다음 얼굴들
function More({ more, next, style }: { more: number; next: () => void; style: CSSProperties }) {
  return (
    <button type="button" onClick={next} style={style} data-tip="다른 얼굴 보기" className="shrink-0 rounded-lg bg-zinc-800 text-sm text-zinc-200 hover:bg-zinc-700">
      +{more}명
    </button>
  );
}

// 공유 화면 아래 한 줄: 모든 칸이 줄 높이를 다 쓰고, 폭은 16:9 까지만 넓어진다. PC와 휴대폰 모두 왼쪽부터 놓는다
// PC 줄 높이: 16:9 공유 화면이 폭에 꽉 차고 남는 높이를 다 쓴다 (빈 여백 대신 얼굴을 크게). 최소 84px(또는 칸 높이의 14%), 최대 180px
export function FaceRow({ cams }: { cams: TrackReference[] }) {
  const [ref, { w, h }] = useBoxSize();
  const [page, setPage] = useState(0);
  const next = () => setPage(page + 1);
  const { shown, tw } = rowFit(Math.min(cams.length, phone() ? MAX_PHONE_ROW : MAX_ROW), w, h, GAP);
  const { faces, more } = pageOf(cams, shown, page);
  return (
    <div ref={ref} className="flex h-16 shrink-0 justify-start gap-2 md:h-[clamp(max(84px,14cqh),calc(100cqh-100cqw*9/16-8px),180px)] phone-land:hidden">
      {w > 0 && faces.map((c) => <Face key={c.participant.identity} cam={c} style={{ width: tw }} />)}
      {w > 0 && more > 0 && <More more={more} next={next} style={{ width: tw }} />}
    </div>
  );
}

// 공유가 없을 때: 얼굴 바둑판. 사람 수에 맞춰 한 줄 칸 수와 칸 모양(3:4 ~ 16:9)을 골라 자리를 꽉 채운다 (lib/faces.ts)
// 휴대폰은 "LIVE 방송 준비 중" 과 같은 16:9 칸 안에
export function FaceGrid({ cams }: { cams: TrackReference[] }) {
  const [ref, { w, h }] = useBoxSize();
  const [page, setPage] = useState(0);
  const next = () => setPage(page + 1);
  const { faces, more } = pageOf(cams, phone() ? MAX_PHONE : MAX_GRID, page);
  const { tw, th } = gridFit(faces.length + (more ? 1 : 0), w, h, GAP);
  const size = { width: tw, height: th };
  return (
    <div ref={ref} className="flex aspect-video min-h-0 w-full flex-wrap content-center justify-center gap-2 md:aspect-auto md:flex-1">
      {w > 0 && faces.map((c) => <Face key={c.participant.identity} cam={c} style={size} />)}
      {w > 0 && more > 0 && <More more={more} next={next} style={size} />}
    </div>
  );
}

// 화면공유하는 사람 얼굴을 공유 화면 구석에 (방송인처럼). 자리·모양은 그 사람이 카메라 메뉴에서 고른 대로 (api/cam)
// 공유 화면 크기에 맞춰 같이 커지고 줄어서, 전체화면이나 휴대폰에서도 같은 자리·같은 비율로 보인다. 화면 누르기·쓸기는 그대로 통과
const CORNER: Record<string, string> = { br: "right-[2%] bottom-[2%]", bl: "left-[2%] bottom-[2%]", tr: "right-[2%] top-[2%]", tl: "left-[2%] top-[2%]" };
export function FaceOverlay({ cam }: { cam: TrackReference }) {
  const a = useParticipantAttributes({ participant: cam.participant }).attributes;
  const circle = a?.camShape === "circle";
  return (
    <Face
      cam={cam}
      name={false}
      speakingBorder={false}
      round={circle ? "rounded-full" : "rounded-lg"}
      style={{ width: `${camWidth(Number(a?.camSize), circle)}%` }}
      className={`pointer-events-none absolute z-[5] shadow-lg shadow-black/50 ${CORNER[a?.camPos ?? ""] ?? CORNER.br} ${circle ? "aspect-square" : "aspect-video"}`}
    />
  );
}

// 공유 화면. 휴대폰은 유튜브처럼 위로 쓸어 올리면 전체화면, 전체화면에서 아래로 쓸어 내리면 원래대로.
// 휴대폰 가로에서 한 번 누르면 채팅 열기 버튼만 표시한다 (room/page.tsx).
// 전체화면은 늘 가로. 왼쪽·오른쪽 어느 쪽으로 눕혀도 그 방향에 맞게 돌고, 눕혔다가 다시 세우면 끝난다 (안드로이드만)
