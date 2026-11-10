import { statusView } from "@/lib/status";

// 상태 페이지(/status) 내용 (누구나). 방송 안 관리자용 서버 칸(api/status)과는 다르다. ?brief=1 이면 입장 화면 로고 옆 점에 쓰는 전체 상태만
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const view = statusView();
  const brief = new URL(req.url).searchParams.has("brief");
  return Response.json(brief ? { lv: view.lv, text: view.text } : view, { headers: { "cache-control": "no-store" } });
}
