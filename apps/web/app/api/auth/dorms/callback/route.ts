import { NextResponse, type NextRequest } from "next/server";
import { DormsAuthError, finishDormsLogin, parseFlowCookie, safeDormsNext, sessionCookieOptions, FLOW_COOKIE, SESSION_COOKIE } from "../../../../../lib/dormsLogin";
// 바깥 주소 (Caddy 뒤라 request.url 은 localhost 로 나온다. lib/server.ts)
import { publicUrl } from "@/lib/server";

export const dynamic = "force-dynamic";
function fail(request: NextRequest, reason: string, next = "/") {
  const url = new URL("/dorms-denied", publicUrl(request));
  url.searchParams.set("reason", reason);
  url.searchParams.set("next", safeDormsNext(next));
  const response = NextResponse.redirect(url, 302);
  response.cookies.set(FLOW_COOKIE, "", { path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const flow = parseFlowCookie(request.cookies.get(FLOW_COOKIE)?.value);
  if (!flow || params.get("state") !== flow.state) return fail(request, "authentication_required");
  if (params.has("error")) return fail(request, params.get("error") === "temporarily_unavailable" ? "temporarily_unavailable" : "access_denied", flow.next);
  const code = params.get("code");
  if (!code) return fail(request, "authentication_required", flow.next);
  try {
    const { idToken, expiresAt } = await finishDormsLogin({ code, verifier: flow.verifier, nonce: flow.nonce, requestUrl: publicUrl(request) });
    const target = new URL(safeDormsNext(flow.next), publicUrl(request));
    const response = NextResponse.redirect(target.origin === new URL(publicUrl(request)).origin ? target : new URL("/", publicUrl(request)), 302);
    response.cookies.set(SESSION_COOKIE, idToken, sessionCookieOptions(expiresAt - Math.floor(Date.now() / 1000)));
    response.cookies.set(FLOW_COOKIE, "", { path: "/", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) { return fail(request, error instanceof DormsAuthError ? error.reason : "temporarily_unavailable", flow.next); }
}
