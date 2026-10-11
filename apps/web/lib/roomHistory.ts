// 닉네임과 방 선택은 남기되, 퇴장한 방에 이동 기록만으로 다시 들어가지는 않는다.
export const ROOM_ENTRY_KEY = "dolive-room-active";
const GUARD = "doliveRoomGuard";

export function watchRoomBack(show: () => void, hide: () => void) {
  let wentBack = false;
  const addGuard = () => history.pushState({ ...history.state, [GUARD]: true }, "");
  // 다시 실행되어도 확인창용 기록은 한 칸만 둔다.
  if (!history.state?.[GUARD]) addGuard();
  const onBack = () => {
    if (sessionStorage.getItem(ROOM_ENTRY_KEY) !== "1") return;
    wentBack = !history.state?.[GUARD];
    if (wentBack) show();
    else hide();
  };
  window.addEventListener("popstate", onBack);
  return {
    stay() {
      hide();
      if (wentBack) addGuard();
      wentBack = false;
    },
    dispose() { window.removeEventListener("popstate", onBack); },
  };
}

export function leaveRoomHistory(replaceHome: () => void) {
  sessionStorage.removeItem(ROOM_ENTRY_KEY);
  if (history.state?.[GUARD]) {
    // 로고로 나갈 때도 확인창용 한 칸을 먼저 되돌린 뒤, 방 기록을 메인으로 바꾼다.
    window.addEventListener("popstate", replaceHome, { once: true });
    history.back();
  } else replaceHome();
}
