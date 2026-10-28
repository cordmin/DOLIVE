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
  }
  async function enter() {
    hide();
    try {
      // 사용자가 전체화면 버튼이나 위 쓸기를 선택했을 때만 진입한다.
      await document.documentElement.requestFullscreen();
      await (window.screen.orientation as unknown as { lock?: (mode: "landscape") => Promise<void> }).lock?.("landscape");
    } catch { /* 미지원 브라우저에서는 기기 방향에 맞춘 일반 화면을 유지한다. */ }
  }
  return { hidden, buttonVisible, hide, wake, open, enter };
}
