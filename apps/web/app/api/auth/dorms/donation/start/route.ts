import { checkDonationApproval } from "@/lib/donation";
import { publicUrl } from "@/lib/server";
import { NextResponse, type NextRequest } from "next/server";
import { beginDonation, donationCookieOptions, DONATION_FLOW_COOKIE, DormsDonationError } from "../../../../../../lib/dormsDonation";
import { DormsAuthError } from "../../../../../../lib/dormsLogin";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    await checkDonationApproval(publicUrl(request));
    const flow = await beginDonation(publicUrl(request), request.nextUrl.searchParams.get("next"));
    const response = NextResponse.redirect(flow.authorizeUrl, 302);
    response.cookies.set(DONATION_FLOW_COOKIE, flow.flow, donationCookieOptions(600));
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    const known = error instanceof DormsDonationError || error instanceof DormsAuthError;
    const target = new URL("/dorms-donation-denied", publicUrl(request));
    target.searchParams.set("reason", known ? error.reason : "temporarily_unavailable");
    return NextResponse.redirect(target, { status: 302, headers: { "Cache-Control": "no-store" } });
  }
}
