import { useEffect, useRef, useState } from "react";
import { AttendanceList } from "@/components/AttendanceList";
import type { AttendSummary } from "@/lib/attendanceCore";

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
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(480px,calc(100vw-32px))] max-w-none overflow-y-auto rounded-[14px] bg-[#141416] px-[18px] pt-[22px] pb-[18px] text-[#d6d3cd] shadow-[0_0_0_1px_#000,0_0_0_2px_#ffffff14,0_12px_30px_#000a] outline-none backdrop:bg-black/60"
    >
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[15px] font-semibold">참석 기록</span>
        {view && <span className="text-[13px] text-[#a39f98]">참석 <b className="font-semibold text-[#e4c691]">{view.count}</b>명 · 지금 {view.here}명</span>}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-[#a39f98]">연수를 연 선생님만 볼 수 있어요. 들어오고 나간 시각은 1분쯤 늦게 반영될 수 있어요.</p>
      <section className="hw-inset rounded-[10px] bg-[#1e1e21] px-3.5 py-1">
        {view === undefined && id ? (
          <p className="py-6 text-center text-[13px] text-[#a39f98]">읽는 중이에요</p>
        ) : !view ? (
          <p className="py-6 text-center text-[13px] text-[#a39f98]">참석 기록을 읽지 못했어요</p>
        ) : (
          <AttendanceList view={view} />
        )}
      </section>
      {view && (
        <p className="mt-2.5 flex flex-wrap justify-between gap-x-3 gap-y-1 text-[11px] text-[#a39f98]">
          {/* 방송이 끊기지 않게 새 탭으로 연다 */}
          <a href={`/${slug}/attendance`} target="_blank" rel="noreferrer" className="text-[#e8b46a] hover:underline">끝난 뒤에도 보기 (30일)</a>
          <a href={`/api/yeonsu/attendance?ref=${id}&csv=1`} download className="text-[#e8b46a] hover:underline">표로 내려받기</a>
        </p>
      )}
      <button onClick={() => dlg.current?.close()} className="dolive-button dolive-primary mt-3.5 w-full py-2 text-sm">
        <span className="dolive-button-cap">닫기</span>
      </button>
    </dialog>
  );
}
