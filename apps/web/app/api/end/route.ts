import { dropRoom } from "@/lib/chat";
import { adminDeny, rooms } from "@/lib/server";

// 방장만(이 PC에서): 방송 방을 닫는다. { room } 이 있으면 그 방만(서버 켜기 창 [채팅방 관리]에서 방을 지울 때. 채팅 기록도 지운다),
// 없으면 열린 방 모두(서버를 끌 때 scripts/start_dolive.ps1 -Stop 이 끄기 직전에 부른다).
// 방에 있던 사람은 모두 '방이 닫혔다'는 이유로 바로 끊기고, 다시 붙으려 하지 않고 "방송이 끝났어요"를 본다 (app/room/page.tsx)
export async function POST(req: Request) {
  const no = await adminDeny(req);
  if (no) return no;
  const { room } = await req.json().catch(() => ({}));
  if (typeof room === "string") dropRoom(room);
  const names = typeof room === "string" ? [room] : (await rooms.listRooms().catch(() => [])).map((r) => r.name);
  await Promise.all(names.map((n) => rooms.deleteRoom(n).catch(() => {}))); // 방이 이미 없어도 괜찮다
  return new Response(null, { status: 204 });
}
