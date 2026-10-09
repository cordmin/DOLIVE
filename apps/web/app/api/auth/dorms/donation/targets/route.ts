import { whoSent } from "@/lib/chat";
import { donationTargets } from "@/lib/donationTargets";

export async function GET(request: Request) {
  const sender = await whoSent(request);
  if (sender.deny) return sender.deny;
  const targets = (await donationTargets(sender.room)).filter((p) => p.recipientId !== sender.owner);
  return Response.json(targets, { headers: { "Cache-Control": "no-store" } });
}
