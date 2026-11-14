import { statusView } from "@/lib/status";

// 상태 페이지(/status)와 방송 상태 창(app/room/status.tsx)의 서비스 상태 칸이 쓰는 내용 (누구나). 방송 안 관리자용 서버 칸(api/status)과는 다르다
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(statusView(), { headers: { "cache-control": "no-store" } });
}
