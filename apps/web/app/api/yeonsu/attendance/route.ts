import type { NextRequest } from "next/server";
import { attendanceFor } from "@/lib/attendance";
import { toCsv } from "@/lib/attendanceCore";
import { dormsCheck } from "@/lib/server";
import { isYeonsuRef } from "@/lib/yeonsu";

// 도름스 연수 참석 기록: 그 연수를 연 선생님(도름스 로그인)만 받는다. 운영진·마스터(서버 PC)도 받지 못한다 (2026-11-12 사용자 지시).
// ?ref=<연수 id 또는 짧은 번호>  → 표(JSON).  &csv=1 → 내려받는 표.
// 기록이 없거나 연 선생님이 아니면 같은 답(403)을 준다 (남의 연수 기록이 있는지도 알려 주지 않는다)
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("ref") ?? "";
  if (!isYeonsuRef(ref)) return Response.json({ error: "잘못된 요청" }, { status: 400 });
  const { user, deny } = await dormsCheck(req);
  if (deny) return deny;
  const view = user ? attendanceFor(ref, user.id) : null;
  if (!view) return Response.json({ error: "연수를 연 선생님만 볼 수 있어요" }, { status: 403, headers: { "cache-control": "no-store" } });
  if (req.nextUrl.searchParams.get("csv") === "1") {
    const name = `참석기록_${view.title.replace(/[\\/:*?"<>|\r\n]/g, " ").slice(0, 40)}.csv`;
    return new Response(toCsv(view), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="attendance.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "no-store",
      },
    });
  }
  return Response.json(view, { headers: { "cache-control": "no-store" } });
}
