import { NextResponse, type NextRequest } from "next/server";
import { beginDormsLogin, DormsAuthError, FLOW_COOKIE, safeDormsNext, sessionCookieOptions } from "../../../../../lib/dormsLogin";
// 바깥 주소 (Caddy 뒤라 request.url 은 localhost 로 나온다. lib/server.ts)
import { publicUrl } from "@/lib/server";

export const dynamic = "force-dynamic";
async function start(request: NextRequest) {
  try {
    const { authorizeUrl, cookie } = await beginDormsLogin(publicUrl(request), request.nextUrl.searchParams.get("next"));
    const response = NextResponse.redirect(authorizeUrl, 302);
    response.cookies.set(cookie.name, cookie.value, sessionCookieOptions(cookie.maxAge));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const url = new URL("/dorms-denied", publicUrl(request));
    url.searchParams.set("reason", error instanceof DormsAuthError ? error.reason : "temporarily_unavailable");
    url.searchParams.set("next", safeDormsNext(request.nextUrl.searchParams.get("next")));
    const response = NextResponse.redirect(url, 302);
    response.cookies.set(FLOW_COOKIE, "", { path: "/", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
export const GET = start;
export const POST = start;
