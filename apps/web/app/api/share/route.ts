import { MIC_ONLY, WITH_SCREEN, adminDeny, rooms } from "@/lib/server";

// 방장만: 그 사람에게 화면공유를 허락(allow: true)하거나 도로 거둔다(allow: false)
export async function POST(req: Request) {
  const no = await adminDeny(req); // 서버 PC, 또는 지금도 도름스 허용이 살아 있는 운영진만
  if (no) return no;
  const { room, identity, allow } = await req.json().catch(() => ({}));
  if (typeof identity !== "string" || typeof room !== "string") return Response.json({ error: "잘못된 요청" }, { status: 400 });

  try {
    // 권한은 통째로 바뀌므로 나머지 권한도 같이 적는다
    await rooms.updateParticipant(room, identity, {
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
