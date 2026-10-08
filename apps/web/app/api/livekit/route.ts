import { WebhookReceiver } from "livekit-server-sdk";
import { clearEmptyRoom } from "@/lib/chat";
import { dropUserRoom } from "@/lib/server";

// 통화 서버가 보내는 퇴장 소식. 서명을 확인한 뒤 빈 방을 치운다 (채팅 기록을 지우고, 사람들이 만든 방이면 목록에서도 없앤다).
export async function POST(req: Request) {
  const receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  const event = await receiver.receive(await req.text(), req.headers.get("authorization") ?? undefined).catch(() => null);
  if (!event) return new Response(null, { status: 401 });
  const room = event.room?.name;
  if (room && ["participant_left", "participant_connection_aborted", "room_finished"].includes(event.event)) {
    if (await clearEmptyRoom(room)) dropUserRoom(room);
  }
  return new Response(null, { status: 204 });
}
