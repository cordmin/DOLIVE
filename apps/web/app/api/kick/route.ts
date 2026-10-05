import { adminDeny, rooms } from "@/lib/server";

// 방장만: 그 사람을 방에서 내보낸다 (참여자 메뉴 [강퇴하기]). 그 사람 화면엔 "방에서 내보내졌어요" (app/room/page.tsx).
// ponytail: 입장 화면에서 다시 들어오는 건 막지 않는다. 다시 못 들어오게 하려면 도름스 회원 id 로 막는 목록이 필요
export async function POST(req: Request) {
  const no = await adminDeny(req); // 서버 PC, 또는 지금도 도름스 허용이 살아 있는 운영진만
  if (no) return no;
  const { room, identity } = await req.json().catch(() => ({}));
  if (typeof identity !== "string" || typeof room !== "string") return Response.json({ error: "잘못된 요청" }, { status: 400 });
  try {
    await rooms.removeParticipant(room, identity);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "그 사람을 찾을 수 없어요" }, { status: 404 });
  }
}
