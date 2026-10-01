import { ROOM } from "@/lib/dolive";
import { isAdmin, rooms } from "@/lib/server";

// 방장만(이 PC에서): 방송 방을 닫는다. 서버를 끌 때 scripts/start_dolive.ps1 -Stop 이 끄기 직전에 부른다.
// 방에 있던 사람은 모두 '방이 닫혔다'는 이유로 바로 끊기고, 다시 붙으려 하지 않고 "방송이 끝났어요"를 본다 (app/room/page.tsx)
export async function POST(req: Request) {
  if (!isAdmin(req)) return new Response(null, { status: 403 });
  await rooms.deleteRoom(ROOM).catch(() => {}); // 방이 이미 없어도 괜찮다
  return new Response(null, { status: 204 });
}
