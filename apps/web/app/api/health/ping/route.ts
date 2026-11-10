// 상태 점검(lib/status.ts)이 바깥 주소로 불러 보는 곳. Caddy·인증서·웹이 모두 살아 있으면 ok
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
