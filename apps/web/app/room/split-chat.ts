import { useEffect, useState } from "react";

export function useSplitChat(sharing: boolean, isAdmin: boolean) {
  // 채팅분리: 화면공유 하는 사람은 다른 프로그램을 보여 주느라 이 창을 못 보니까,
  // 늘 맨 위에 떠 있는 작은 창(크롬·엣지 PC만 됨)에 채팅을 띄운다.
  // 창 제목 줄의 주소와 창 투명도는 브라우저가 정하는 거라 바꿀 수 없다
  const docPip = typeof window !== "undefined" ? (window as { documentPictureInPicture?: DocPip }).documentPictureInPicture : undefined;
  const [pip, setPip] = useState<Window | null>(null);
  async function togglePip(on: boolean) {
    if (!on || !docPip) { pip?.close(); return true; }
    if (pip && !pip.closed) return true;
    const w = await docPip.requestWindow({ width: 360, height: 560, disallowReturnToOpener: true }).catch(() => null);
    if (!w) { alert("채팅 창을 띄울 수 없어요."); return false; }
    copyStyles(w);
    w.addEventListener("pagehide", () => setPip(null)); // 작은 창의 X를 눌러 닫았을 때
    setPip(w);
    return true;
  }
  useEffect(() => () => pip?.close(), [pip]); // 방을 나가면 작은 창도 닫는다
  // 버튼은 PC 방장이 화면공유 중일 때만 보이고 (일반 참여자는 쓸 일이 없어서), 공유를 끝내면 작은 창도 닫는다
  useEffect(() => {
    if (!sharing || !isAdmin) pip?.close(); // 방장을 넘겨도 닫힌다
  }, [sharing, isAdmin, pip]);
  return { pip, docPip, togglePip };
}

type DocPip = { requestWindow(size: { width: number; height: number; disallowReturnToOpener?: boolean }): Promise<Window> };

// 작은 창은 빈 페이지라서, 이 페이지의 꾸밈(색·글꼴·배치)을 그대로 옮겨 준다
function copyStyles(w: Window) {
  for (const s of document.styleSheets) {
    try {
      const el = w.document.createElement("style");
      el.textContent = [...s.cssRules].map((r) => r.cssText).join("\n");
      w.document.head.append(el);
    } catch {
      // 다른 주소에서 온 꾸밈은 내용을 못 읽어서 주소째 붙인다
      const el = w.document.createElement("link");
      el.rel = "stylesheet";
      el.href = s.href ?? "";
      w.document.head.append(el);
    }
  }
  w.document.documentElement.className = document.documentElement.className;
  w.document.body.className = document.body.className;
  // 작은 창 자체는 넘치지 않게 하고, 채팅 내용만 안에서 스크롤한다.
  Object.assign(w.document.documentElement.style, { height: "100%", overflow: "hidden" });
  Object.assign(w.document.body.style, { margin: "0", height: "100%", minHeight: "0", overflow: "hidden" });
}
