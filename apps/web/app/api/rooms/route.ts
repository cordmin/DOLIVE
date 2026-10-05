import { dormsCheck, isLocal, isStaff, roomDeny, roomList, rooms } from "@/lib/server";

// 입장 화면의 방송 목록: 방 이름, 비밀번호 방인지(locked), 방장·운영진이 들어가 있는지(onAir, 이름 옆 ON AIR). 비밀번호는 안 보낸다
export async function GET() {
  const list = await Promise.all(
    roomList().map(async (r) => {
      const people = await rooms.listParticipants(r.name).catch(() => []); // 아직 아무도 안 들어온 방은 통화 서버에 없다
      return { name: r.name, locked: !!r.password, onAir: people.some((p) => p.attributes?.admin === "1") };
    }),
  );
  return Response.json(list, { headers: { "cache-control": "no-store" } });
}

// 비밀번호 확인 { room, password }: 입장 화면 비밀번호 창이 [입장] 전에 묻는다 (틀리면 창에서 바로 알려 주려고).
// 진짜 문은 입장권(api/token)이 다시 확인한다
export async function POST(req: Request) {
  const { user, deny } = await dormsCheck(req);
  if (deny) return deny;
  const { room, password } = await req.json().catch(() => ({}));
  return roomDeny(room, password, isLocal(req) || isStaff(user)) ?? new Response(null, { status: 204 });
}
