import { MIC_CAM, WITH_SCREEN, rooms } from "@/lib/server";
import { roomAdminDeny } from "@/lib/chat";

// 방장만: 그 사람에게 화면공유를 허락(allow: true)하거나 도로 거둔다(allow: false)
export async function POST(req: Request) {
  const { room, identity, allow } = await req.json().catch(() => ({}));
  if (typeof identity !== "string" || typeof room !== "string") return Response.json({ error: "잘못된 요청" }, { status: 400 });
  const no = await roomAdminDeny(req, room);
  if (no) return no;

  try {
    // 권한은 통째로 바뀌므로 나머지 권한도 같이 적는다
    await rooms.updateParticipant(room, identity, {
      permission: {
        canSubscribe: true,
        canPublish: true,
        canPublishData: true,
        canPublishSources: allow ? WITH_SCREEN : MIC_CAM,
      },
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "그 사람을 찾을 수 없어요" }, { status: 404 });
  }
}
