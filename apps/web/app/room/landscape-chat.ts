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
  async function open() {
    clear();
    setHidden(false);
    setButtonVisible(false);
    // 영상 요소만 전체화면이었다면 방 전체로 바꿔 채팅도 함께 표시한다.
    if (document.fullscreenElement?.hasAttribute("data-share-view")) {
      try {
        // 영상을 남겨 둔 채 상위 요소를 전체화면으로 만들면 영상이 채팅을 계속 가린다.
        await document.exitFullscreen();
        await document.documentElement.requestFullscreen();
      } catch { /* 전체화면을 지원하지 않더라도 일반 화면에서 채팅을 표시한다. */ }
    }
  }
  return { hidden, buttonVisible, hide, wake, open };
}
