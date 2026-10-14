import { useRoomContext, type TrackReference } from "@livekit/components-react";
import { useEffect, useRef, useState } from "react";
import { Knob } from "@/components/Knob";
import { canRecord, recordWindow, startRecording } from "@/lib/recording";
import { SharePreview } from "./stage";

// 녹화 파일은 서버에 보내지 않고, 방장이 선택한 이 컴퓨터의 폴더에만 쓴다.
export function RecordKnob({ screen }: { screen?: TrackReference }) {
  const room = useRoomContext();
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quality, setQuality] = useState<"basic" | "clear">("clear");
  const [sound, setSound] = useState(true);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const session = useRef<Awaited<ReturnType<typeof startRecording>>>(undefined);
  const alive = useRef(true);
  const box = useRef<HTMLDialogElement>(null);
  const cancelStart = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; cancelStart.current = true; void session.current?.stop(); };
  }, []);
  useEffect(() => {
    if (open) box.current?.showModal();
  }, [open]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!recording) return;
    const leaving = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, [recording]);
  useEffect(() => {
    cancelStart.current = true;
    if (!session.current) return;
    // 공유자가 바뀌면 이전 녹화를 끝내서, 화면과 다른 사람이 담기지 않게 한다.
    void session.current.stop();
  }, [screen?.publication.trackSid]);
  async function chooseFolder() {
    try {
      const handle = await recordWindow().showDirectoryPicker!({ mode: "readwrite" });
      setFolder(handle); setError("");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("저장할 폴더를 고르지 못했어요. 폴더 권한을 확인해 주세요.");
    }
  }
  async function start() {
    if (busy || !screen || !folder || session.current) return;
    cancelStart.current = false;
    setBusy(true); setError(""); setNotice("");
    try {
      const value = await startRecording(room, screen.participant, folder, quality, sound, (error) => {
        session.current = undefined;
        if (!alive.current) return;
        setRecording(false); setBusy(false);
        if (error) { setError(error); setOpen(true); }
        else setNotice("녹화 파일을 저장했어요.");
      });
      session.current = value;
      if (!alive.current || cancelStart.current) { await value.stop(); return; }
      setRecording(true); setOpen(false);
    } catch (e) { if (alive.current) setError(e instanceof Error && /[가-힣]/.test(e.message) ? e.message : "녹화를 시작하지 못했어요. 폴더 권한을 확인하고 다시 시도해 주세요."); }
    finally { if (alive.current) setBusy(false); }
  }
  async function click() {
    if (session.current) {
      setBusy(true);
      await session.current.stop();
      return;
    }
    if (!screen) { setNotice("먼저 화면공유를 켜 주세요."); return; }
    if (!canRecord()) { setNotice("녹화는 최신 크롬·엣지의 PC 화면에서 사용할 수 있어요."); return; }
    setError(""); setOpen(true);
  }
  const close = () => { if (!busy) { cancelStart.current = true; setOpen(false); } };
  return (
    <>
      <Knob className="hidden md:flex" label="녹화" led={recording ? "green" : undefined} aria-label={recording ? "녹화 끝내기" : "녹화 설정"} aria-pressed={recording} disabled={busy} onClick={click} icon={recording ? <svg viewBox="0 0 24 24" aria-hidden className="size-[17px]"><rect x="6" y="6" width="12" height="12" rx="1.5" fill="#a30e1b" /></svg> : <span className="text-[10px] font-bold tracking-[0.4px]">REC</span>} />
      {notice && <div role="status" className="pointer-events-none fixed top-5 left-1/2 z-50 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border border-[#4c4438] bg-[#252526] px-5 py-3 text-center text-sm whitespace-normal text-[#d6d3cd] shadow-lg">{notice}</div>}
      {open && <dialog ref={box} onClose={close} onCancel={(e) => { e.preventDefault(); close(); }} onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }} className="m-auto max-h-[92dvh] w-[680px] max-w-[calc(100%-2rem)] overflow-y-auto rounded-[18px] border border-[#3d3b3a] bg-[#252526] p-[22px] text-[13px] whitespace-normal text-[#d6d3cd] backdrop:bg-black/60">
        <h2 className="mb-[18px] text-center text-base font-semibold">녹화 설정</h2>
        <div className="flex gap-6">
          <div className="min-w-0 flex-[1.5]">
            <p className="mb-2 text-xs text-[#b5afa5]">녹화할 화면</p>
            <div className="rounded-[13px] bg-[#19191b] p-[7px] shadow-[inset_0_2px_5px_#0009,inset_0_0_0_1px_#383838]">{screen ? <SharePreview screen={screen} /> : <div className="grid aspect-video place-items-center text-xs text-[#a8a29a]">화면공유가 꺼져 있어요.</div>}</div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-xs text-[#b5afa5]">녹화 화질</p>
            <div className="flex gap-1 rounded-[12px] bg-[#19191b] p-1 shadow-[inset_0_2px_5px_#0009,inset_0_0_0_1px_#383838]">
              {(["basic", "clear"] as const).map((value) => <button key={value} type="button" onClick={() => setQuality(value)} aria-pressed={quality === value} className="dolive-button dolive-split-choice h-[34px] flex-1 text-xs"><span className="dolive-button-cap">{value === "basic" ? "기본" : "선명"}</span></button>)}
            </div>
            <div className="mt-5 flex items-start justify-between gap-2">
              <div><p className="text-xs text-[#b5afa5]">소리 함께 녹음</p><p className="mt-1 text-[10px] leading-4 text-[#88827b]">마이크 · 대화 · 공유 소리 · TTS</p></div>
              <button type="button" role="switch" aria-label="소리 함께 녹음" aria-checked={sound} onClick={() => setSound((v) => !v)} className={`relative mt-0.5 h-6 w-[42px] shrink-0 rounded-full border bg-[#1b1a18] shadow-[inset_0_2px_4px_#0008] ${sound ? "border-[#68593f]" : "border-[#44403a]"}`}><span className={`absolute top-[3px] size-4 rounded-full shadow-[0_1px_3px_#0008] ${sound ? "right-[3px] bg-linear-to-b from-[#dbbf8c] to-[#aa8a55]" : "left-[3px] bg-zinc-600"}`} /></button>
            </div>
            <div className="mt-5 border-t border-[#3d3934] pt-3">
              <p className="text-xs text-[#b5afa5]">저장 위치</p>
              <div className="mt-2 flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate text-[11px] text-[#a8a29a]" title={folder?.name}>{folder?.name ?? "선택한 폴더 없음"}</span><button type="button" disabled={busy} onClick={chooseFolder} className="dolive-button h-8 shrink-0 px-3 text-[11px]"><span className="dolive-button-cap">폴더 선택</span></button></div>
            </div>
          </div>
        </div>
        {error && <p role="alert" className="mt-4 text-xs text-amber-300">{error}</p>}
        <div className="mt-6 ml-auto flex w-[248px] max-w-full gap-[18px]">
          <button type="button" onClick={start} disabled={busy || !screen || !folder} className="dolive-button dolive-primary h-[38px] flex-1 rounded-full font-semibold"><span className="dolive-button-cap">{busy ? "준비 중" : "녹화 시작"}</span></button>
          <button type="button" onClick={close} disabled={busy} className="dolive-button dolive-danger h-[38px] flex-1 rounded-full font-semibold"><span className="dolive-button-cap">닫기</span></button>
        </div>
      </dialog>}
    </>
  );
}
