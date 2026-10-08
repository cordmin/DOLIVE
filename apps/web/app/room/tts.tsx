import { useEffect, useRef, useState } from "react";
import { Knob } from "@/components/Knob";
import { TTS_MODES, VOICES, playOnly, saveTts, savedTts, type TtsSettings } from "@/lib/dolive";

const ROW = "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-700/60";
const RADIO = "size-4 accent-indigo-500";
// 끄기: 안 읽음, 항상: 내 채팅을 모두 읽음, /입력: "/" 로 시작하는 글만 읽음
const MODE_TEXT: Record<TtsSettings["mode"], string> = { off: "끄기", always: "항상", slash: "/입력" };

// 위 줄 마이크 스위치 왼쪽의 TTS 버튼. 누르면 내 음성 설정 창 (입력 방식, 목소리). 관리자도 똑같다.
// 이 브라우저에만 기억하고, 글을 보낼 때마다 같이 보내서(chat.tsx) 저장하자마자 다음 글부터 적용된다
export function TtsButton() {
  const box = useRef<HTMLDialogElement>(null);
  const [now, setNow] = useState<TtsSettings | null>(null);
  const [mode, setMode] = useState<TtsSettings["mode"]>("off");
  useEffect(() => setMode(savedTts().mode), []);

  function open() {
    setNow(savedTts());
    box.current?.showModal();
  }
  const voiceRow = (v: (typeof VOICES)[number]) => (
    <label key={v.id} className={ROW}>
      <input type="radio" name="voice" value={v.id} defaultChecked={now?.voice === v.id} className={RADIO} />
      <span className="flex-1">{v.name}</span>
      <button
        type="button"
        onClick={() => playOnly(`/api/tts?listen=${v.id}`).catch((e) => e.name !== "AbortError" && alert("미리 듣기를 하지 못했어요."))}
        aria-label={`${v.name} 미리 듣기`}
        className="rounded p-1 text-zinc-400 hover:bg-zinc-600 hover:text-zinc-100"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-3.5">
          <path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      </button>
    </label>
  );

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="TTS 설정"
        data-tip="TTS 설정"
        className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-800 text-[11px] font-extrabold tracking-wide hover:bg-zinc-700 md:hidden"
      >
        TTS
      </button>
      {/* PC: 동그란 기계 버튼 (share.tsx 의 다른 버튼들과 같은 모양) */}
      <Knob
        className="hidden md:flex"
        label="TTS"
        aria-label="TTS 설정"
        led={mode !== "off" ? "green" : undefined}
        onClick={open}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-[17px]">
            <path d="M3 5h9M7.5 5v14M16 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12" />
          </svg>
        }
      />
      {/* 채팅의 글 고치기·지우기 확인 창과 같은 모양 */}
      <dialog
        ref={box}
        onClose={() => setNow(null)}
        className="m-auto w-96 max-w-[calc(100%-2rem)] rounded-xl bg-zinc-800 p-5 text-sm text-zinc-100 ring-1 ring-zinc-700 backdrop:bg-black/60"
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
            <p className="mb-4 text-center text-base font-semibold">TTS 설정</p>

            <p className="mb-1 font-semibold text-zinc-300">TTS 입력 방식</p>
            <div className="grid grid-cols-3 gap-x-2">
              {TTS_MODES.map((m) => (
                <label key={m} className={ROW}>
                  <input type="radio" name="mode" value={m} defaultChecked={now.mode === m} className={RADIO} />
                  {MODE_TEXT[m]}
                </label>
              ))}
            </div>

            <p className="mt-4 mb-1 font-semibold text-zinc-300">TTS 음성 종류</p>
            <div className="grid grid-cols-2 gap-x-2">
              {/* 왼쪽 줄은 여자, 오른쪽 줄은 남자 목소리 */}
              <div>{VOICES.filter((v) => v.woman).map(voiceRow)}</div>
              <div>{VOICES.filter((v) => !v.woman).map(voiceRow)}</div>
            </div>

            <div className="mt-5 flex gap-2">
              <button className="flex-1 rounded-lg bg-indigo-600 py-2 font-semibold hover:bg-indigo-500">저장</button>
              <button type="button" onClick={() => box.current?.close()} className="flex-1 rounded-lg bg-zinc-700 py-2 hover:bg-zinc-600">
                취소
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
