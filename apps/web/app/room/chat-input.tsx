import { useEffect, useRef, useState } from "react";
import { CHAT_MAX, IMAGE_TYPES, isPhone } from "@/lib/dolive";
import { Heart, STICKER_TEXT, type Reaction } from "./reactions";
import { DonationFace } from "@/components/DonationMascot";

// 채팅 입력칸 (chat.tsx 에서 나눔)
// 맨 아래 항상 보이는 입력칸. 보낸 뒤에도 입력칸에 그대로 머물러 휴대폰 자판이 닫히지 않는다.
// 줄바꿈: PC는 Shift+Enter (Enter는 보내기), 휴대폰은 자판의 줄바꿈 키 (보내기는 비행기 버튼)
// 사진을 복사해서 입력칸에 붙여 넣거나(Ctrl+V) 왼쪽 + 버튼으로 고르면 입력칸 위에 작게 올려 두고, 보내기(비행기·Enter)를 눌러야 보낸다
export function ChatInput({
  send,
  sendImage,
  react,
  donate,
  className,
}: {
  send: (text: string) => void;
  sendImage: (f: File) => void;
  react: (kind: Reaction) => void;
  donate?: () => void;
  className: string;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // 붙여 넣고 아직 안 보낸 사진 (url: 입력칸 위에 보여 줄 작은 그림)
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);
  function dropPending() {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
  }
  function stage(file: File) {
    if (pending) URL.revokeObjectURL(pending.url); // 다시 고르면 새 사진으로 바꾼다
    setPending({ file, url: URL.createObjectURL(file) });
  }
  const filePicker = useRef<HTMLInputElement>(null);
  // 사진 선택 후 브라우저가 전체화면을 풀면, 사용자가 전체화면 버튼으로 다시 선택한다.
  function pickFile() {
    filePicker.current?.click();
  }

  // 휴대폰에서 뒤로가기로 자판만 닫으면 입력칸이 선택된 채(커서 깜빡임) 남아서, 자판이 내려가면 선택도 푼다.
  // 자판이 내려가면 보이는 화면 높이가 확 늘어나는 걸로 안다 (자판 위 추천 단어 줄이 생기고 없어지는 정도는 무시)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !isPhone()) return;
    let last = vv.height;
    const onResize = () => {
      if (vv.height - last > 100 && document.activeElement === box.current) box.current?.blur();
      last = vv.height;
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // 채팅 목록을 위로 올려 보고 있으면 보내기 버튼 바로 위에 "맨 아래로" 버튼 (카카오톡처럼).
  // 목록은 같은 문서(채팅분리 창이면 그 창)에 하나뿐이라 찾아서 쓴다
  const log = useRef<HTMLElement | null>(null);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = (log.current = box.current!.ownerDocument.querySelector<HTMLElement>("[data-chat-log]"));
    if (!el) return;
    const onScroll = () => setAway(el.scrollHeight - el.scrollTop - el.clientHeight >= 60);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // 얼굴 버튼을 누르면 스티커 목록이 위로 펼쳐지고, 다시 누르면 접힌다.
  const [picking, setPicking] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  // 펼쳐져 있을 때 버튼 말고 다른 곳을 눌러도 접힌다 (채팅분리 창에서도 되게 그 창의 문서에 단다)
  useEffect(() => {
    if (!picking) return;
    const doc = picker.current!.ownerDocument;
    const close = (e: PointerEvent) => {
      if (!picker.current?.contains(e.target as Node)) setPicking(false);
    };
    doc.addEventListener("pointerdown", close);
    return () => doc.removeEventListener("pointerdown", close);
  }, [picking]);

  // 글이 길어지면 입력칸이 4줄까지 늘어난다 (그 뒤로는 칸 안에서 밀어서 본다)
  useEffect(() => {
    const t = box.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, [text]);

  function submit() {
    if (pending) {
      sendImage(pending.file);
      dropPending();
    }
    if (text.trim()) {
      send(text.trim());
      setText("");
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      // 아래 여백: 브라우저 맨 아래에 붙지 않게 (아이폰 홈 바 자리도 비움)
      // --down-gap: "맨 아래로" 버튼과 경계선 사이. 휴대폰은 경계선(위 테두리 1px)을 사이에 두고 보내기 버튼과 위아래 대칭 (위 여백 12px + 선 1px)
      className={`${className} relative flex shrink-0 items-end gap-2 border-t border-zinc-800 px-3 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {pending && (
          <div className="relative w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pending.url} alt="보낼 사진" className="max-h-28 rounded-xl" />
            <button
              type="button"
              onClick={dropPending}
              onPointerDown={(e) => e.preventDefault()}
              aria-label="사진 빼기"
              data-tip="사진 빼기"
              className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/70 hover:bg-black"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden className="size-3.5">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        )}
        <div className="relative">
          <textarea
            ref={box}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
              if (!file) return; // 사진이 아니면 평소처럼 글자 붙여넣기
              e.preventDefault();
              stage(file);
            }}
            onKeyDown={(e) => {
              // 한글을 조합하는 중에 누른 Enter는 건너뛴다 (안 그러면 마지막 글자가 한 번 더 보내진다)
              if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
              if (matchMedia("(pointer: coarse)").matches) return; // 휴대폰: 줄바꿈
              e.preventDefault();
              submit();
            }}
            maxLength={CHAT_MAX}
            placeholder="메시지 입력"
            className="block max-h-32 w-full resize-none rounded-3xl bg-zinc-800 py-3 pr-14 pl-12 text-base leading-6 outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-inset"
          />
          {/* 입력칸 왼쪽 안쪽 + 버튼: 사진 파일 고르기. 동그라미는 30px, 입력칸(48px) 세로 가운데 */}
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={pickFile}
            aria-label="사진 올리기"
            data-tip="사진 올리기"
            className="absolute bottom-[9px] left-[9px] flex size-7.5 items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden className="size-4">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <input
            ref={filePicker}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // 같은 사진을 다시 골라도 알 수 있게
              if (file) stage(file);
            }}
          />
          {/* 입력칸 오른쪽 도름이 얼굴을 누르면 위에서부터 헐·ㅋ·하트·도름이가 펼쳐진다. */}
          <div ref={picker} className="pointer-events-none absolute right-1 bottom-1 flex flex-col items-center gap-2">
            {(
              [
                ["hul", "헐 날리기", <span key="hul" className={STICKER_TEXT.hul}>헐</span>],
                ["k", "ㅋ 날리기", <span key="k" className={STICKER_TEXT.k}>ㅋ</span>],
                ["heart", "하트 날리기", <Heart key="h" className="size-5 text-red-500" />],
              ] as const
            ).map(([kind, label, face], i) => (
              <button
                key={kind}
                type="button"
                tabIndex={picking ? 0 : -1}
                onPointerDown={(e) => e.preventDefault()} // 눌러도 입력칸에서 손이 안 떨어지게 (휴대폰 자판이 닫히지 않게)
                onClick={() => react(kind)}
                aria-label={label}
                aria-hidden={!picking}
                // 접혀 있을 땐 얼굴 버튼 자리로 들어가 숨는다. 아래쪽부터 차례로 펼쳐진다.
                style={{ transitionDelay: `${(picking ? 2 - i + Number(!!donate) : i) * 40}ms`, translate: picking ? undefined : `0 ${(3 - i + Number(!!donate)) * 3}rem` }}
                className={`flex size-10 items-center justify-center rounded-full bg-zinc-700 text-lg font-black text-amber-300 ring-1 ring-zinc-600 transition-[translate,opacity,scale] duration-200 ease-out hover:bg-zinc-600 ${
                  picking ? "pointer-events-auto" : "scale-50 opacity-0"
                }`}
              >
                {face}
              </button>
            ))}
            {donate && <button type="button" tabIndex={picking ? 0 : -1} aria-label="도름네이션" aria-hidden={!picking} onClick={() => { setPicking(false); donate(); }} className={`flex size-10 items-center justify-center rounded-full bg-zinc-700 ring-1 ring-zinc-600 hover:bg-zinc-600 ${picking ? "pointer-events-auto" : "hidden"}`}><DonationFace /></button>}
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setPicking(!picking)}
              aria-expanded={picking}
              aria-label="도름네이션"
              data-tip="도름네이션"
              // 동그라미는 30px. 펼쳐지는 스티커(40px) 줄 가운데에 서고, 아래를 5px 띄워 입력칸 세로 가운데에 맞춘다
              className={`pointer-events-auto mb-[5px] flex size-7.5 items-center justify-center rounded-full hover:bg-zinc-600 ${picking ? "bg-zinc-600" : "bg-zinc-700"}`}
            >
              <span className="[&>svg]:size-5"><DonationFace /></span>
            </button>
          </div>
        </div>
      </div>
      {away && (
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()} // 눌러도 입력칸에서 손이 안 떨어지게 (휴대폰 자판이 닫히지 않게)
          onClick={() => log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" })}
          aria-label="맨 아래로"
          data-tip="맨 아래로"
          // 보내기 버튼과 같은 크기·같은 세로줄(right-3 = 입력줄 오른쪽 여백)
          className="absolute right-3 bottom-[calc(100%+var(--down-gap,13px))] flex size-12 items-center justify-center rounded-full bg-zinc-700 shadow-lg shadow-black/40 ring-1 ring-zinc-600 hover:bg-zinc-600"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-6">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      )}
      <button
        type="submit"
        disabled={!text.trim() && !pending}
        onPointerDown={(e) => e.preventDefault()} // 눌러도 입력칸에서 손이 안 떨어지게
        aria-label="보내기"
        data-tip="보내기"
        className="group flex size-[52px] shrink-0 cursor-pointer items-center justify-center disabled:opacity-40"
      >
        <span className="hw-cap size-[44px]! transition group-hover:brightness-125 group-active:translate-y-px group-disabled:brightness-100">
        {/* 위로 날아오르는 종이비행기 */}
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-[22px] translate-x-px -translate-y-px -rotate-[35deg]">
          <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
        </span>
      </button>
    </form>
  );
}
