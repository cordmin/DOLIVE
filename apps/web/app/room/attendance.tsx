import { useEffect, useRef, useState } from "react";
import { AttendanceList } from "@/components/AttendanceList";
import type { AttendSummary } from "@/lib/attendanceCore";

// 아래 두 단추 (수강이력 조회·이력 다운로드)
const LINK = "dolive-button flex h-9 items-center justify-center gap-1 px-1 text-[13px] whitespace-nowrap";
const ICON = "size-4 shrink-0 fill-none text-[#e8b46a] stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]";

// 연수를 연 선생님에게만 보이는 '참석 기록' 창 (lib/attendance.ts). 30초마다 새로 받는다.
// 서버(api/yeonsu/attendance)가 도름스 로그인으로 연 선생님인지 다시 확인한다. 끝난 뒤에는 dolive.site/<짧은 연수 번호>/attendance 에서 본다

export function AttendanceDialog({ room, close }: { room: string; close: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<AttendSummary | null>(); // 받기 전 undefined, 못 받으면 null
  const id = /^yeonsu-([0-9a-f-]{36})$/.exec(room)?.[1] ?? "";
  const slug = id.slice(0, 8);

  useEffect(() => {
    dlg.current?.showModal();
  }, []);
  useEffect(() => {
    if (!id) return;
    const load = () =>
      fetch(`/api/yeonsu/attendance?ref=${id}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then(setView)
        .catch(() => setView(null));
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [id]);

  return (
    <dialog
      ref={dlg}
      onClose={close}
      onClick={(e) => e.target === e.currentTarget && dlg.current?.close()}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(336px,calc(100vw-32px))] max-w-none overflow-y-auto rounded-[14px] bg-[#141416] px-[18px] pt-[22px] pb-[18px] text-[#d6d3cd] shadow-[0_0_0_1px_#000,0_0_0_2px_#ffffff14,0_12px_30px_#000a] outline-none backdrop:bg-black/60"
    >
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[15px] font-semibold">참석기록</span>
        {view && <span className="text-[13px] text-[#a39f98]">참석 <b className="font-semibold text-[#e4c691]">{view.count}</b>명 · 현재 {view.here}명</span>}
      </div>
      <section className="hw-inset rounded-[10px] bg-[#1e1e21] px-3.5 py-1">
        {view === undefined && id ? (
          <p className="py-6 text-center text-[13px] text-[#a39f98]">읽는 중이에요</p>
        ) : !view ? (
          <p className="py-6 text-center text-[13px] text-[#a39f98]">참석기록을 읽지 못했어요</p>
        ) : (
          <AttendanceList view={view} />
        )}
      </section>
      {view && (
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {/* 방송이 끊기지 않게 새 탭으로 연다 */}
          <a href={`/${slug}/attendance`} target="_blank" rel="noreferrer" className={LINK}>
            <span className="dolive-button-cap">
              <svg viewBox="0 0 24 24" className={ICON} aria-hidden><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
              수강이력 조회
            </span>
          </a>
          <a href={`/api/yeonsu/attendance?ref=${id}&csv=1`} download className={LINK}>
            <span className="dolive-button-cap">
              <svg viewBox="0 0 24 24" className={ICON} aria-hidden><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
              이력 다운로드
            </span>
          </a>
        </div>
      )}
      <button onClick={() => dlg.current?.close()} className="dolive-button dolive-primary mt-3.5 w-full py-2 text-sm">
        <span className="dolive-button-cap">닫기</span>
      </button>
    </dialog>
  );
}
