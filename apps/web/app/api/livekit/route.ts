import { TrackSource, WebhookReceiver } from "livekit-server-sdk";
import { attendJoined, attendLeft } from "@/lib/attendance";
import { clearEmptyRoom } from "@/lib/chat";
import { rememberDonationParticipant } from "@/lib/donationTargets";
import { rooms } from "@/lib/server";

// 통화 서버가 보내는 입·퇴장 소식. 서명을 확인한 뒤 빈 방의 채팅 기록을 지운다 (방은 지우기 전까지 목록에 남는다).
// 도름스 연수 방이면 참석 기록도 적는다 (lib/attendance.ts)
export async function POST(req: Request) {
  const receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  const event = await receiver.receive(await req.text(), req.headers.get("authorization") ?? undefined).catch(() => null);
  if (!event) return new Response(null, { status: 401 });
  const room = event.room?.name;
  if (room && event.participant && (event.event === "participant_joined" || (event.event === "track_published" && event.track?.source === TrackSource.SCREEN_SHARE))) {
    const p = await rooms.getParticipant(room, event.participant.identity).catch(() => null);
    // 예전 입장 알림으로 새 입장이나 닫힌 방송의 기록을 만들지 않는다.
    if (p && p.sid === event.participant.sid) {
      rememberDonationParticipant(room, p, event.event === "track_published");
      // 도름스 연수 방 참석 기록 (lib/attendance.ts). 연수 방이 아니면 아무것도 안 한다
      if (event.event === "participant_joined") attendJoined(room, p);
    }
  }
  // 나감: 알림이 만들어진 시각을 나간 시각으로 쓴다. 연결이 처음부터 안 된 사람(aborted)은 들어온 적 없으면 적지 않는다
  if (room && event.participant && (event.event === "participant_left" || event.event === "participant_connection_aborted")) {
    attendLeft(room, event.participant, Number(event.createdAt) * 1000, event.event === "participant_connection_aborted");
  }
  if (room && ["participant_left", "participant_connection_aborted", "room_finished"].includes(event.event)) {
    await clearEmptyRoom(room);
  }
  return new Response(null, { status: 204 });
}
