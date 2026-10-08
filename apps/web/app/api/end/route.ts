import { endRoom } from "@/lib/chat";
import { adminDeny, rooms } from "@/lib/server";

// 방장만(이 PC에서): 열린 방송 방을 모두 닫는다 (서버를 끌 때 scripts/start_dolive.ps1 -Stop 이 끄기 직전에 부른다).
// { room } 이 있으면 그 방만. 방에 있던 사람은 모두 "방송이 끝났어요"를 본다 (lib/chat.ts endRoom)
export async function POST(req: Request) {
  const no = await adminDeny(req);
  if (no) return no;
  const { room } = await req.json().catch(() => ({}));
  const names = typeof room === "string" ? [room] : (await rooms.listRooms().catch(() => [])).map((r) => r.name);
  await Promise.all(names.map(endRoom));
  return new Response(null, { status: 204 });
}
