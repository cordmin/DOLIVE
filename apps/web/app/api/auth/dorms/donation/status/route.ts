import { publicUrl } from "@/lib/server";
import { checkDonationApproval } from "@/lib/donation";
import { NextResponse } from "next/server";
import { getDonationStatus, DormsDonationError } from "../../../../../../lib/dormsDonation";
import { DormsAuthError } from "../../../../../../lib/dormsLogin";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { await checkDonationApproval(publicUrl(request)); return NextResponse.json(await getDonationStatus(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const known = error instanceof DormsDonationError || error instanceof DormsAuthError;
    return NextResponse.json({ reason: known ? error.reason : "temporarily_unavailable" }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
