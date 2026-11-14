import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AttendanceList } from "@/components/AttendanceList";
import { attendanceFor } from "@/lib/attendance";
import { kstClock, kstDate } from "@/lib/attendanceCore";
import { DormsAuthError, getDormsUser } from "@/lib/dormsLogin";
import { isLocal } from "@/lib/server";
import { isYeonsuSlug } from "@/lib/yeonsu";

// 연수 참석 기록 dolive.site/<짧은 연수 번호>/attendance. 연수가 끝난 뒤에도 30일 동안 연 선생님만 본다 (lib/attendance.ts).
// 도름스 로그인 → 그 연수를 연 선생님이면 목록, 아니면(운영진·마스터 포함) 같은 안내만 보여 준다
export const dynamic = "force-dynamic";

export default async function YeonsuAttendance({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isYeonsuSlug(slug)) notFound();
  const ref = slug.toLowerCase();
  const next = `/${ref}/attendance`;
  const local = isLocal({ headers: await headers() });
  let user;
  try {
    user = local ? null : await getDormsUser();
  } catch (e) {
    if (!(e instanceof DormsAuthError)) throw e;
    redirect(`/dorms-denied?reason=${e.reason}&next=${encodeURIComponent(next)}`);
  }
  if (!local && !user) redirect(`/api/auth/dorms/start?next=${encodeURIComponent(next)}`);
  const view = user ? attendanceFor(ref, user.id) : null;

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 py-10 break-keep">
      <p className="mb-1 text-sm text-[#a39f98]">
        DO<span className="text-red-500">LIVE</span> 연수 참석 기록
      </p>
      {!view ? (
        <>
          <h1 className="mb-3 text-[22px] font-bold">연수를 연 선생님만 볼 수 있어요</h1>
          <p className="text-[15px] leading-relaxed text-[#d4d4d8]">도름스에서 이 연수를 연 계정으로 로그인했는지 확인해 주세요. 기록은 연수가 끝난 뒤 30일 동안 남아요.</p>
        </>
      ) : (
        <>
          <h1 className="mb-1 text-[22px] font-bold">{view.title}</h1>
          <p className="mb-4 text-sm text-[#a39f98]">
            {Number.isFinite(Date.parse(view.startsAt)) && `${kstDate(Date.parse(view.startsAt))} ${kstClock(Date.parse(view.startsAt))}`}
            {Number.isFinite(Date.parse(view.endsAt)) && ` – ${kstClock(Date.parse(view.endsAt))}`}
            {" · "}참석 <b className="font-semibold text-[#e4c691]">{view.count}</b>명{view.here > 0 && ` · 지금 ${view.here}명`}
          </p>
          <section className="hw-inset rounded-[10px] bg-[#1e1e21] px-3.5 py-1">
            <AttendanceList view={view} />
          </section>
          <p className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-[#a39f98]">
            <span>여는 선생님은 인원에서 뺐어요. 시각은 한국 시간이에요.</span>
            <a href={`/api/yeonsu/attendance?ref=${ref}&csv=1`} download className="text-[#e8b46a] hover:underline">표로 내려받기</a>
          </p>
        </>
      )}
    </main>
  );
}
