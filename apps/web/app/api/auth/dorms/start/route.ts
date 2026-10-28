import { NextResponse, type NextRequest } from "next/server";
import { DormsAuthError, FLOW_COOKIE, safeDormsNext, sessionCookieOptions } from "../../../../../lib/dormsLogin";
import { beginDonationLogin, donationCookieOptions, DONATION_LOGIN_FLOW_COOKIE } from "../../../../../lib/dormsDonation";
// 바깥 주소 (Caddy 뒤라 request.url 은 localhost 로 나온다. lib/server.ts)
import { publicUrl } from "@/lib/server";

export const dynamic = "force-dynamic";
async function start(request: NextRequest) {
  try {
    const { authorizeUrl, cookie, donationFlow } = await beginDonationLogin(publicUrl(request), request.nextUrl.searchParams.get("next"));
    const response = NextResponse.redirect(authorizeUrl, 302);
    response.cookies.set(cookie.name, cookie.value, sessionCookieOptions(cookie.maxAge));
    response.cookies.set(DONATION_LOGIN_FLOW_COOKIE, donationFlow ?? "", donationCookieOptions(donationFlow ? 600 : 0));
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    const url = new URL("/dorms-denied", publicUrl(request));
    url.searchParams.set("reason", error instanceof DormsAuthError ? error.reason : "temporarily_unavailable");
    url.searchParams.set("next", safeDormsNext(request.nextUrl.searchParams.get("next")));
    const response = NextResponse.redirect(url, 302);
    response.cookies.set(FLOW_COOKIE, "", { path: "/", maxAge: 0 });
    response.cookies.set(DONATION_LOGIN_FLOW_COOKIE, "", donationCookieOptions(0));
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
export const GET = start;
export const POST = start;
