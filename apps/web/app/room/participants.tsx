import { useIsMuted, useIsSpeaking, useParticipantAttributes, useRoomContext } from "@livekit/components-react";
import { Track, type Participant } from "livekit-client";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { avatarOf } from "@/lib/dolive";
import { MENU_ITEM, NO_SELECT, PopMenu, useHoldMenu } from "./menu";
import { SCREEN_SHARE_SOURCE } from "./share";

function useAvatarOf(p: Participant) {
  useParticipantAttributes({ participant: p });
  return avatarOf(p.attributes?.avatar);
}

// 방장은 다른 사람 줄을 오른쪽 클릭(휴대폰은 꾹 누르기)하면 메뉴가 뜬다 (말풍선 메뉴와 같은 모양):
// [공유 권한 주기](요청 없이 바로. 이미 있으면 [공유 권한 거두기], 다른 방장은 원래 있어서 안 보임) [마이크 끄기] [카메라 끄기](켜져 있을 때만) [강퇴하기].
// 서버(api/share·mute·kick)가 방장인지 다시 확인한다. 바로 받은 공유 권한도 승인받은 것과 같아서, 공유를 끝내면 도로 거둔다 (share.tsx)
const PERSON_ACTIONS = {
  share: { url: "/api/share", fail: "공유 권한을 바꾸지 못했어요." },
  mute: { url: "/api/mute", fail: "마이크를 끄지 못했어요." },
  cam: { url: "/api/mute", fail: "카메라를 끄지 못했어요." },
  kick: { url: "/api/kick", fail: "내보내지 못했어요." },
  owner: { url: "/api/owner", fail: "방장을 넘기지 못했어요. 그 사람이 이미 만든 방이 있을 수 있어요." },
};
export function PersonRow({ p, isAdmin, isOwner, token }: { p: Participant; isAdmin: boolean; isOwner: boolean; token: string }) {
  const speaking = useIsSpeaking(p);
  const muted = useIsMuted({ participant: p, source: Track.Source.Microphone });
  const camOff = useIsMuted({ participant: p, source: Track.Source.Camera });
  const room = useRoomContext();
  const [menuAt, setMenuAt] = useState<Element | null>(null);
  const hold = useHoldMenu();
  const hasMenu = isAdmin && !p.isLocal;
  const otherAdmin = p.attributes?.roomAdmin === "1";
  const canShare = !!p.permissions?.canPublishSources.includes(SCREEN_SHARE_SOURCE);

  async function act(what: keyof typeof PERSON_ACTIONS) {
    setMenuAt(null);
    const { url, fail } = PERSON_ACTIONS[what];
    const body = { room: room.name, identity: p.identity, ...(what === "share" ? { allow: !canShare } : {}), ...(what === "cam" ? { camera: true } : {}) };
    const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    if (!r.ok) alert(fail);
  }

  return (
    // 사진 + 이름. 마이크는 사진 구석 점, 말하는 중은 초록 테두리.
    // PC 맨 위 줄: 평소 사진은 38px, 펼치면 47px. 이름은 오른쪽 버튼 설명과 같은 11px
    // 휴대폰 목록: 나는 사진 아래에 걸친 ME (이름 옆에 붙이면 이름이 잘려서). PC 는 내 닉네임을 금색으로 표시
    <div
      {...(hasMenu ? hold(setMenuAt) : {})}
      className={`${hasMenu ? NO_SELECT : ""} flex items-center gap-2 rounded p-1 hover:bg-zinc-800 md:w-[4.5rem] md:shrink-0 md:flex-col md:gap-1.5`}
    >
      <div className="relative shrink-0">
        <Avatar
          id={useAvatarOf(p)}
          talking={speaking && !muted}
          mic={!muted}
          px={47}
          className="w-10 md:w-[38px] md:transition-[width] md:duration-300 md:ease-out md:strip-open:w-[47px]"
        />
        {p.isLocal && (
          <span className="absolute -bottom-1.5 left-1/2 md:hidden -translate-x-1/2 rounded-full bg-indigo-600 px-1 text-[10px] leading-[14px] font-bold ring-2 ring-zinc-900">
            ME
          </span>
        )}
      </div>
      {/* PC 는 내 닉네임만 호박빛 금색으로 구분한다 */}
      <div
        className={`min-w-0 truncate text-sm md:w-full md:text-center md:text-[11px] ${p.isLocal ? "md:text-[#e8b46a]" : "md:text-[#a39f98]"}`}
      >
        {p.name}
      </div>
      {hasMenu && (
        <PopMenu at={menuAt} onClose={() => setMenuAt(null)}>
          {!otherAdmin && (
            <button type="button" onClick={() => act("share")} className={MENU_ITEM}>
              {canShare ? "공유 권한 거두기" : "공유 권한 주기"}
            </button>
          )}
          {!muted && (
            <button type="button" onClick={() => act("mute")} className={MENU_ITEM}>
              마이크 끄기
            </button>
          )}
          {!camOff && (
            <button type="button" onClick={() => act("cam")} className={MENU_ITEM}>
              카메라 끄기
            </button>
          )}
          {/* 방 주인만, 도름스 회원에게만 (비회원은 다음에 알아볼 수가 없어서) */}
          {isOwner && !!p.attributes?.dorms && (
            <button type="button" onClick={() => act("owner")} className={MENU_ITEM}>
              방장 넘기기
            </button>
          )}
          <button type="button" onClick={() => act("kick")} className={`${MENU_ITEM} text-red-400`}>
            강퇴하기
          </button>
        </PopMenu>
      )}
    </div>
  );
}
