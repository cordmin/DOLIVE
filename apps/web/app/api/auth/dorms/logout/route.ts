import { NextResponse, type NextRequest } from "next/server";

import { FLOW_COOKIE, SESSION_COOKIE } from "../../../../../lib/dormsLogin";
// 바깥 주소 (Caddy 뒤라 request.url 은 localhost 로 나온다. lib/server.ts)
import { publicUrl } from "@/lib/server";

export const dynamic = "force-dynamic";

/** 이 사이트의 로그인만 끝낸다(도름스 자체 로그인은 그대로). 다른 사이트가 링크로 로그아웃시키지 못하게 POST + 같은 출처만 받는다. */
export async function POST(request: NextRequest) {
  const origin = new URL(publicUrl(request)).origin;
  let from = request.headers.get("origin");
  try { from ??= request.headers.get("referer") ? new URL(request.headers.get("referer")!).origin : null; }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (from !== origin || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const response = NextResponse.redirect(new URL("/", publicUrl(request)), 303);
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(FLOW_COOKIE, "", { path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** GET 은 아무것도 바꾸지 않고 홈으로만 보낸다(옛 링크 호환). */
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/", publicUrl(request)), 303);
}
