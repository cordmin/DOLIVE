import { useRef, useState } from "react";
import { VOICES, type TtsSettings } from "@/lib/dolive";

const ROW = "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-700/60";
const RADIO = "size-4 accent-indigo-500";

// 위 줄의 "관리자" 배지. 누르면 음성 설정 창 (TTS 입력 방식, 목소리). 저장하면 방 모두에게 바로 적용된다 (서버가 정한다)
export function AdminButton() {
  const box = useRef<HTMLDialogElement>(null);
  const [now, setNow] = useState<TtsSettings | null>(null);

  async function open() {
    const r = await fetch("/api/tts").catch(() => null);
    if (!r?.ok) return alert("설정을 불러오지 못했어요.");
    setNow(await r.json());
    box.current?.showModal();
  }
  async function save(f: FormData) {
    const r = await fetch("/api/tts", { method: "POST", body: JSON.stringify({ mode: f.get("mode"), voice: f.get("voice") }) }).catch(() => null);
    if (!r?.ok) return alert("저장하지 못했어요.");
    box.current?.close();
  }
  const voiceRow = (v: (typeof VOICES)[number]) => (
    <label key={v.id} className={ROW}>
      <input type="radio" name="voice" value={v.id} defaultChecked={now?.voice === v.id} className={RADIO} />
      <span className="flex-1">{v.name}</span>
      <button
        type="button"
        onClick={() => new Audio(`/api/tts?listen=${v.id}`).play().catch(() => alert("미리 듣기를 하지 못했어요."))}
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
      <button type="button" onClick={open} className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-black hover:bg-amber-400">
        관리자
      </button>
      {/* 글 고치기·지우기 확인 창과 같은 모양 */}
      <dialog
        ref={box}
        onClose={() => setNow(null)}
        className="m-auto w-96 max-w-[calc(100%-2rem)] rounded-xl bg-zinc-800 p-5 text-sm text-zinc-100 ring-1 ring-zinc-700 backdrop:bg-black/60"
      >
        {now && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save(new FormData(e.currentTarget));
            }}
          >
            <p className="mb-4 text-center text-base font-semibold">음성 설정</p>

            <p className="mb-1 font-semibold text-zinc-300">TTS 입력 방식</p>
            <label className={ROW}>
              <input type="radio" name="mode" value="off" defaultChecked={now.mode === "off"} className={RADIO} />
              끄기 <span className="text-zinc-400">음성으로 읽지 않아요</span>
            </label>
            <label className={ROW}>
              <input type="radio" name="mode" value="slash" defaultChecked={now.mode === "slash"} className={RADIO} />
              /입력 <span className="text-zinc-400">/ 로 시작하는 글만 읽어요</span>
            </label>

            <p className="mt-4 mb-1 font-semibold text-zinc-300">TTS 음성 종류</p>
            <div className="grid grid-cols-2 gap-x-2">
              <div>
                <p className="px-2 pb-1 text-xs text-zinc-500">여자 목소리</p>
                {VOICES.filter((v) => v.woman).map(voiceRow)}
              </div>
              <div>
                <p className="px-2 pb-1 text-xs text-zinc-500">남자 목소리</p>
                {VOICES.filter((v) => !v.woman).map(voiceRow)}
              </div>
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
