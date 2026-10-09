import { useEffect, useRef, useState } from "react";
import { Knob } from "@/components/Knob";
import { TTS_MODES, VOICES, playOnly, stopPlaying, saveTts, savedTts, type TtsSettings } from "@/lib/dolive";

const TILE = "flex min-h-[38px] items-center justify-center gap-1.5 rounded-[10px] border border-transparent bg-[#2e2e30] px-3 text-[#99969a] transition hover:text-[#e4e0da] peer-checked:border-[#75664b] peer-checked:bg-[#393631] peer-checked:text-[#d1b77f] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#d1b77f] peer-focus-visible:outline-offset-2";
// 끄기: 안 읽음, 항상: 내 채팅을 모두 읽음, /입력: "/" 로 시작하는 글만 읽음
const MODE_TEXT: Record<TtsSettings["mode"], string> = { off: "끄기", always: "항상", slash: "/입력" };

// 위 줄 마이크 스위치 왼쪽의 TTS 버튼. 누르면 내 음성 설정 창 (입력 방식, 목소리). 관리자도 똑같다.
// 이 브라우저에만 기억하고, 글을 보낼 때마다 같이 보내서(chat.tsx) 저장하자마자 다음 글부터 적용된다
export function TtsButton() {
  const box = useRef<HTMLDialogElement>(null);
  const [now, setNow] = useState<TtsSettings | null>(null);
  const [mode, setMode] = useState<TtsSettings["mode"]>("off");
  useEffect(() => setMode(savedTts().mode), []);
  useEffect(() => () => stopPlaying(), []);

  function open() {
    setNow(savedTts());
    box.current?.showModal();
  }
  const voiceRow = (v: (typeof VOICES)[number]) => (
    <label key={v.id} className="relative block cursor-pointer">
      <input type="radio" name="voice" value={v.id} defaultChecked={now?.voice === v.id} onClick={() => playOnly(`/api/tts?listen=${v.id}`).catch((e) => e.name !== "AbortError" && alert("미리 듣기를 하지 못했어요."))} className="peer sr-only" />
      <span className={TILE}>{v.name}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-3.5 opacity-65">
          <path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      </span>
    </label>
  );

  return (
    <>
      <Knob
        compactMobile
        label="TTS"
        aria-label="TTS 설정"
        led={mode !== "off" ? "green" : "red"}
        onClick={open}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-[17px]">
            <path d="M3 5h9M7.5 5v14M16 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12" />
            {mode === "off" && <path className="md:hidden" d="M20 4 4 20" stroke="#ffffff" strokeWidth="2.2" />}
          </svg>
        }
      />
      {/* 안쪽으로 파인 선택판과 금색 선택 표시 */}
      <dialog
        ref={box}
        onClose={() => { stopPlaying(); setNow(null); }}
        className="m-auto w-[350px] max-w-[calc(100%-2rem)] rounded-[18px] border border-[#3d3b3a] bg-[#252526] p-[22px] text-[13px] text-[#d6d3cd] backdrop:bg-black/60"
      >
        {now && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const settings = { mode: f.get("mode") as TtsSettings["mode"], voice: f.get("voice") as string };
              saveTts(settings);
              setMode(settings.mode);
              box.current?.close();
            }}
          >
            <p className="mb-[23px] text-center text-base font-semibold">TTS 설정</p>

            <p className="mb-2.5 text-[11px] font-medium text-[#9f9b95]">TTS 입력 방식</p>
            <div className="grid grid-cols-3 gap-1 rounded-[13px] bg-[#19191b] p-1 shadow-[inset_0_2px_5px_#0006]">
              {TTS_MODES.map((m) => (
                <label key={m} className="relative cursor-pointer">
                  <input type="radio" name="mode" value={m} defaultChecked={now.mode === m} className="peer sr-only" />
                  <span className={`${TILE} min-h-[34px]! bg-transparent! peer-checked:bg-[#393631]!`}>{MODE_TEXT[m]}</span>
                </label>
              ))}
            </div>

            <p className="mt-5 mb-2.5 text-[11px] font-medium text-[#9f9b95]">TTS 음성 종류</p>
            <div className="grid grid-cols-2 gap-[7px]">
              {/* 왼쪽 줄은 여자, 오른쪽 줄은 남자 목소리 */}
              <div className="space-y-[7px]">{VOICES.filter((v) => v.woman).map(voiceRow)}</div>
              <div className="space-y-[7px]">{VOICES.filter((v) => !v.woman).map(voiceRow)}</div>
            </div>

            <div className="mt-6 flex gap-2.5">
              <button type="button" onClick={() => box.current?.close()} className="h-[37px] flex-1 rounded-full border border-[#535154] text-[#b5b0aa] transition hover:bg-white/5 hover:text-zinc-100 active:bg-white/10">
                취소
              </button>
              <button className="h-[37px] flex-1 rounded-full bg-linear-to-b from-[#d6bd8d] to-[#b79b68] font-semibold text-[#29231c] shadow-[inset_0_1px_0_#fff5] transition hover:brightness-110 active:brightness-95">저장</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
