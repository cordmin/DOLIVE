import { ROOM } from "@/lib/dolive";
import { MIC_ONLY, WITH_SCREEN, isAdmin, rooms } from "@/lib/server";

// 방장만: 그 사람에게 화면공유를 허락(allow: true)하거나 도로 거둔다(allow: false)
export async function POST(req: Request) {
  if (!isAdmin(req)) return Response.json({ error: "방장만 할 수 있어요" }, { status: 403 });
  const { identity, allow } = await req.json().catch(() => ({}));
  if (typeof identity !== "string") return Response.json({ error: "잘못된 요청" }, { status: 400 });

  try {
    // 권한은 통째로 바뀌므로 나머지 권한도 같이 적는다
    await rooms.updateParticipant(ROOM, identity, {
      permission: {
        canSubscribe: true,
        canPublish: true,
        canPublishData: true,
        canPublishSources: allow ? WITH_SCREEN : MIC_ONLY,
      },
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "그 사람을 찾을 수 없어요" }, { status: 404 });
  }
}
