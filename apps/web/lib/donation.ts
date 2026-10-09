import "server-only";
import { DataPacket_Kind } from "livekit-server-sdk";
import { getDormsUser, callbackUrl } from "./dormsLogin";
import { DormsDonationError, sendDonation } from "./dormsDonation";
import { chatOf, post, store, whoSent } from "./chat";
import type { ChatMsg } from "./dolive";
import { rooms } from "./server";
import { donationTargets } from "./donationTargets";

// 승인과 잔액은 도름스가 정한다. 이 앱에서는 한도를 따로 계산하지 않는다.
export async function checkDonationApproval(requestUrl: string) {
  const api = process.env.NODE_ENV !== "production" && /^https?:\/\/localhost(:\d+)?$/.test(process.env.DORMS_API_ORIGIN_DEV ?? "") ? process.env.DORMS_API_ORIGIN_DEV! : "https://dorms.school";
  const url = new URL(`/api/sso/clients/${encodeURIComponent(process.env.DORMS_CLIENT_ID!)}/configuration`, api);
  // 승인 상태는 등록된 사이트 주소로 확인한다. 수정용 서버 주소는 등록 주소가 아니다.
  url.searchParams.set("redirect_uri", callbackUrl(process.env.DORMS_SITE_URL ?? requestUrl));
  let body;
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error();
    body = await response.json();
  } catch { throw new DormsDonationError("temporarily_unavailable"); }
  if (body.active !== true) throw new DormsDonationError("access_denied", 403);
  const state = body.donations?.status;
  if (state !== "approved") throw new DormsDonationError(state === "pending" ? "approval_pending" : state === "suspended" ? "approval_suspended" : "approval_required", 403);
}

type Intent = { recipientId: string; identity: string; amount: number; room: string; senderName: string; recipientName: string; history: WeakRef<ChatMsg[]>; expires: number; noticeId?: string; announced?: string };
const intents = new Map<string, Intent>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function donateToSharer(request: Request, input: { recipientId: string; identity: string; amount: number; requestId: string }) {
  if (!uuid.test(input.recipientId) || !uuid.test(input.requestId) || typeof input.identity !== "string" || input.identity.length > 256 || !Number.isInteger(input.amount) || input.amount < 1 || input.amount > 3) throw new DormsDonationError("invalid_request", 400);
  const user = await getDormsUser();
  if (!user) throw new DormsDonationError("authentication_required", 401);
  if (user.id === input.recipientId) throw new DormsDonationError("self_donation", 400);
  const sender = await whoSent(request);
  if (sender.deny || !sender.room) throw new DormsDonationError("access_denied", 403);
  const key = `${user.id}:${input.requestId}`;
  for (const [id, intent] of intents) if (intent.expires < Date.now()) intents.delete(id);
  let intent = intents.get(key);
  if (intent) {
    if (intent.recipientId !== input.recipientId || intent.amount !== input.amount || intent.identity !== input.identity || intent.room !== sender.room) throw new DormsDonationError("idempotency_conflict", 409);
  } else {
    // 방 주인과 서버가 기억한 공유자만 받는다. 운영진 권한이나 화면에서 보낸 닉네임은 믿지 않는다.
    const recipient = (await donationTargets(sender.room)).find((p) => p.recipientId === input.recipientId && p.identity === input.identity);
    if (!recipient) throw new DormsDonationError("recipient_unavailable", 409);
    // 결과를 못 받은 요청은 같은 회원·금액으로만 재시도한다. 기록은 메모리에만 둔다.
    if (intents.size >= 5000) throw new DormsDonationError("temporarily_unavailable");
    intent = { ...input, room: sender.room, senderName: sender.who.name, recipientName: recipient.name, history: new WeakRef(chatOf(sender.room)), expires: Date.now() + 86400000 };
    intents.set(key, intent);
  }
  const result = await sendDonation({ recipientId: intent.recipientId, amount: intent.amount, requestId: input.requestId });
  // 보내기에 성공했을 때만 기록한다. 그사이 방송이 끝났으면 새 방송에 옛 알림을 올리지 않는다.
  const history = intent.history.deref();
  if (!intent.noticeId && history && history === store.messages.get(intent.room)) {
    intent.noticeId = result.transferId;
    await post(intent.room, {
      identity: "dolive-donation", name: "", avatar: "",
      message: `${intent.senderName}님이 ${intent.recipientName}님에게 ${result.amount}도름을 도름네이션 하셨습니다`,
      donation: { senderName: intent.senderName, recipientName: intent.recipientName, amount: result.amount },
    }, "", `donation:${result.transferId}`);
  }
  if (intent.announced !== result.transferId) {
    intent.announced = result.transferId;
    await rooms.sendData(intent.room, new TextEncoder().encode(JSON.stringify({ transferId: result.transferId, amount: result.amount })), DataPacket_Kind.RELIABLE, { topic: "dolive-donation" }).catch(() => { intent!.announced = undefined; });
  }
  return result;
}
