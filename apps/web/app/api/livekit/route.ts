import { WebhookReceiver } from "livekit-server-sdk";
import { clearEmptyRoom } from "@/lib/chat";

// 통화 서버가 보내는 퇴장 소식. 서명을 확인한 뒤 빈 방을 치운다.
export async function POST(req: Request) {
  const receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  const event = await receiver.receive(await req.text(), req.headers.get("authorization") ?? undefined).catch(() => null);
  if (!event) return new Response(null, { status: 401 });
  if (event.room?.name && ["participant_left", "participant_connection_aborted", "room_finished"].includes(event.event)) {
    await clearEmptyRoom(event.room.name);
  }
  return new Response(null, { status: 204 });
}
