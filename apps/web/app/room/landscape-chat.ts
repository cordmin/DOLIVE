import { useEffect, useRef, useState } from "react";

// 채팅을 접어도 영상·통화 연결은 그대로 둔다. 영상 한 번 누르기 = 채팅 버튼 표시.
export function useLandscapeChat() {
  const [hidden, setHidden] = useState(false);
  const [buttonVisible, setButtonVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clear = () => clearTimeout(timer.current);
  useEffect(() => clear, []);

  function hide() {
    clear();
    setHidden(true);
    setButtonVisible(false);
  }
  function wake() {
    if (!document.documentElement.hasAttribute("data-phone-land")) return;
    if (!hidden && !document.fullscreenElement?.hasAttribute("data-share-view")) return;
    clear();
    setButtonVisible(true);
    timer.current = setTimeout(() => setButtonVisible(false), 2500);
  }
  function open() {
    clear();
    setHidden(false);
    setButtonVisible(false);
    // 영상 요소만 전체화면이었다면 방 전체로 바꿔 채팅도 함께 표시한다.
    if (document.fullscreenElement?.hasAttribute("data-share-view")) {
      document.documentElement.requestFullscreen().catch(() => document.exitFullscreen().catch(() => {}));
    }
  }
  return { hidden, buttonVisible, hide, wake, open };
}
