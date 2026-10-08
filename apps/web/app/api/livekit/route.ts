import { WebhookReceiver } from "livekit-server-sdk";
import { clearEmptyRoom, pickHost } from "@/lib/chat";

// 통화 서버가 보내는 입장·퇴장 소식. 서명을 확인한 뒤 빈 방을 치우고, "누구나" 방은 운영 권한을 받을 사람을 다시 고른다.
export async function POST(req: Request) {
  const receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  const event = await receiver.receive(await req.text(), req.headers.get("authorization") ?? undefined).catch(() => null);
  if (!event) return new Response(null, { status: 401 });
  const room = event.room?.name;
  if (room && ["participant_left", "participant_connection_aborted", "room_finished"].includes(event.event)) {
    if (!(await clearEmptyRoom(room))) await pickHost(room).catch(() => {});
  }
  if (room && event.event === "participant_joined") await pickHost(room).catch(() => {});
  return new Response(null, { status: 204 });
}
