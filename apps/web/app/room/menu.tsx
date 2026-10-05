import { useLayoutEffect, useRef, type ReactNode } from "react";

// 말풍선 메뉴(chat.tsx)와 참여자 메뉴(page.tsx PersonRow)가 같이 쓰는 작은 메뉴

// 메뉴 한 칸. 칸 사이(9px)의 한가운데에 짧은 세로선 (첫 칸 빼고 왼쪽에 before 로 그린다)
export const MENU_ITEM =
  "relative rounded-md px-4 py-2 whitespace-nowrap outline-none hover:bg-zinc-700 focus-visible:bg-zinc-700 not-first:before:absolute not-first:before:top-1/2 not-first:before:-left-[5px] not-first:before:h-4 not-first:before:w-px not-first:before:-translate-y-1/2 not-first:before:bg-zinc-600";

// 휴대폰에서 꾹 누를 때 글자 선택·아이폰 길게 누르기 창이 뜨지 않게
export const NO_SELECT = "pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]";

// 메뉴 여는 법: PC 는 오른쪽 클릭, 휴대폰은 꾹(0.5초) 누르기. hold(open) 이 누를 자리에 붙일 이벤트들을 준다 (open 에 누른 요소를 넘긴다)
export function useHoldMenu() {
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const touching = useRef(false); // 손가락으로 누르는 중 (마우스는 오른쪽 클릭으로 연다)
  const held = useRef(false); // 꾹 눌러서 메뉴를 띄웠다 → 손을 뗄 때 따라오는 클릭(사진 크게 보기·링크 열기)은 무시
  return (open: (el: Element) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      touching.current = e.pointerType !== "mouse";
      held.current = false;
      const el = e.currentTarget;
      if (touching.current)
        pressTimer.current = setTimeout(() => {
          held.current = true;
          open(el);
        }, 500);
    },
    // 손을 떼거나, 밀어서 목록을 움직이면(브라우저가 가져가면 cancel) 취소
    onPointerUp: () => clearTimeout(pressTimer.current),
    onPointerCancel: () => clearTimeout(pressTimer.current),
    onPointerLeave: () => clearTimeout(pressTimer.current),
    onClickCapture: (e: React.MouseEvent) => {
      if (!held.current) return;
      held.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    // 브라우저 메뉴 대신 이 메뉴 (휴대폰은 위의 꾹 누르기가 띄운다)
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      if (!touching.current) open(e.currentTarget);
    },
  });
}

// 메뉴 창: at(누른 요소)이 생기면 그 바로 아래 가운데에 뜨고, 꼬리가 그 가운데를 가리킨다. 아래에 자리가 없으면 위로 뒤집고(꼬리도 아래를 향함),
// 창 가장자리에 걸리면 메뉴 몸통만 옆으로 밀고 꼬리는 그대로 가운데를 가리킨다. 바깥을 누르거나(오른쪽 클릭도) Esc 면 닫힌다(onClose). 바탕은 투명.
// 칸을 고르면 부르는 쪽이 at 을 null 로 바꿔서 닫는다
export function PopMenu({ at, onClose, children }: { at: Element | null; onClose: () => void; children: ReactNode }) {
  const menu = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const d = menu.current;
    if (!d) return;
    if (!at) return d.close();
    d.showModal();
    d.focus(); // 첫 줄에 불이 들어온 채로 뜨지 않게 (키보드는 Tab 으로 고른다)
    const win = d.ownerDocument.defaultView!;
    const r = at.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = d;
    const gap = 10;
    const below = r.bottom + gap + h <= win.innerHeight - 4 || r.top - gap - h < 4;
    const x = r.left + r.width / 2;
    const left = Math.max(4, Math.min(x - w / 2, win.innerWidth - w - 4));
    const top = below ? r.bottom + gap : r.top - gap - h;
    d.style.left = `${left}px`;
    d.style.top = `${Math.max(4, Math.min(top, win.innerHeight - h - 4))}px`; // 화면보다 긴 말풍선이면 메뉴가 말풍선 위에 겹쳐도 화면 안에
    d.style.setProperty("--tail", `${Math.max(12, Math.min(x - left, w - 12))}px`);
    d.dataset.below = String(below);
  }, [at]);
  return (
    <dialog
      ref={menu}
      tabIndex={-1}
      onClose={onClose}
      onPointerDown={(e) => e.target === e.currentTarget && e.currentTarget.close()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.currentTarget.close();
      }}
      className="group m-0 overflow-visible rounded-lg outline-none bg-zinc-800 p-1 text-sm text-zinc-100 shadow-xl shadow-black/50 ring-1 ring-zinc-700 backdrop:bg-transparent"
    >
      {/* 꼬리: 아래에 뜨면 위를, 위로 뒤집히면 아래를 가리킨다 */}
      <span className="absolute -bottom-1.5 left-(--tail) size-2.5 -translate-x-1/2 rotate-[225deg] border-t border-l border-zinc-700 bg-zinc-800 group-data-[below=true]:-top-1.5 group-data-[below=true]:bottom-auto group-data-[below=true]:rotate-45" />
      {at && <div className="relative flex gap-[9px]">{children}</div>}
    </dialog>
  );
}
