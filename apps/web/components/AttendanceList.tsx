import { duration, kstClock, type AttendSummary } from "@/lib/attendanceCore";

// 연수 참석 기록 목록 (방 안의 '참석 기록' 창과 dolive.site/<짧은 연수 번호>/attendance 가 같이 쓴다).
// 한 사람 한 줄: 이름(입장 이름과 도름스 이름이 다르면 둘 다) / 들어온 시각 – 나간 시각 · 머문 시간 · 여러 번 들어왔으면 횟수
export function AttendanceList({ view }: { view: AttendSummary }) {
  if (!view.rows.length) return <p className="py-6 text-center text-[13px] text-[#a39f98]">아직 들어온 사람이 없어요</p>;
  return (
    <ul className="divide-y divide-white/[.04]">
      {view.rows.map((r, i) => (
        <li key={i} className="flex items-center gap-3 py-2 text-[13px]">
          <span className={`hw-led shrink-0 ${r.here ? "hw-led-green" : ""}`} aria-label={r.here ? "지금 있음" : "나감"} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-[#d6d3cd]">
              {r.name}
              {r.dormsName && r.dormsName !== r.name && <span className="font-normal text-[#a39f98]"> · 도름스 {r.dormsName}</span>}
              {r.host && <span className="ml-1.5 rounded-[3px] border border-[#e8b46a]/40 px-1 text-[10px] font-normal text-[#e8b46a]">여는 선생님</span>}
            </p>
            <p className="text-xs text-[#a39f98]">
              {kstClock(r.first)} – {r.here ? "지금 있음" : kstClock(r.last)}
              {r.visits > 1 && ` · ${r.visits}번 들어옴`}
            </p>
          </div>
          <span className="shrink-0 text-right text-[13px] font-semibold whitespace-nowrap text-[#e4c691]">{duration(r.ms)}</span>
        </li>
      ))}
    </ul>
  );
}
