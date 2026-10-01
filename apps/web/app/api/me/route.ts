import { dormsCheck, isLocal } from "@/lib/server";

// 입장 화면(app/page.tsx)이 묻는 내 상태: 서버 PC인지(서버 PC는 늘 방장이라 도름스 로그인이 필요 없다)와 도름스 로그인 상태
// (dorms: 로그인한 이름, dormsReason: 막힌 까닭 authentication_required·access_denied·temporarily_unavailable)
export async function GET(req: Request) {
  const { user, deny } = await dormsCheck(req);
  return Response.json({
    local: isLocal(req),
    dorms: user ? (user.name ?? user.handle ?? "도름스 회원") : null,
    dormsReason: deny ? (await deny.json()).reason : null,
  });
}
