import { TrackSource, WebhookReceiver } from "livekit-server-sdk";
import { clearEmptyRoom } from "@/lib/chat";
import { rememberDonationParticipant } from "@/lib/donationTargets";
import { rooms } from "@/lib/server";

// 통화 서버가 보내는 퇴장 소식. 서명을 확인한 뒤 빈 방의 채팅 기록을 지운다 (방은 지우기 전까지 목록에 남는다).
export async function POST(req: Request) {
  const receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  const event = await receiver.receive(await req.text(), req.headers.get("authorization") ?? undefined).catch(() => null);
  if (!event) return new Response(null, { status: 401 });
  const room = event.room?.name;
  if (room && event.participant && (event.event === "participant_joined" || (event.event === "track_published" && event.track?.source === TrackSource.SCREEN_SHARE))) {
    const p = await rooms.getParticipant(room, event.participant.identity).catch(() => null);
    // 예전 입장 알림으로 새 입장이나 닫힌 방송의 기록을 만들지 않는다.
    if (p && p.sid === event.participant.sid) rememberDonationParticipant(room, p, event.event === "track_published");
  }
  if (room && ["participant_left", "participant_connection_aborted", "room_finished"].includes(event.event)) {
    await clearEmptyRoom(room);
  }
  return new Response(null, { status: 204 });
}
