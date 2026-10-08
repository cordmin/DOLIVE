import { whoSent } from "@/lib/chat";
import { MIC_ONLY, WITH_SCREEN, findRoom, rooms, userRooms } from "@/lib/server";

// 방장 넘기기 { room, identity }: 방을 만든 사람만, 그 방 안의 도름스 회원에게 (비회원은 다음에 알아볼 수가 없어서 안 된다).
// 넘기면 그 사람이 방 주인이 된다 (나갔다 들어와도 방장, 방 설정·지우기도 그 사람). 옛 주인은 일반 참여자가 된다 (마스터·운영진이면 방장 노릇은 그대로)
export async function POST(req: Request) {
  const { room, identity } = await req.json().catch(() => ({}));
  if (typeof identity !== "string" || typeof room !== "string") return Response.json({ error: "잘못된 요청" }, { status: 400 });
  const sender = await whoSent(req);
  if (sender.deny) return sender.deny;
  const r = findRoom(room);
  if (sender.room !== room || !r?.owner || r.owner !== sender.user?.id) return Response.json({ error: "방 주인만 넘길 수 있어요" }, { status: 403 });
  const to = await rooms.getParticipant(room, identity).catch(() => null);
  const next = to?.attributes.dorms;
  if (!next) return Response.json({ error: "도름스 회원에게만 넘길 수 있어요" }, { status: 400 });
  if (next === r.owner) return new Response(null, { status: 204 });
  if (userRooms.some((x) => x.owner === next)) return Response.json({ error: "그 사람은 이미 만든 방이 있어요", reason: "limit" }, { status: 409 });
  const prev = r.owner;
  r.owner = next;
  // 같은 사람이 여러 창으로 들어와 있을 수 있어서, 그 방의 옛 주인·새 주인 창을 모두 바꾼다 (권한은 통째로 바뀌므로 나머지 권한도 같이 적는다)
  for (const p of await rooms.listParticipants(room)) {
    const dorms = p.attributes.dorms;
    if (dorms !== prev && dorms !== next) continue;
    const isNext = dorms === next;
    const staff = p.attributes.admin === "1"; // 마스터·운영진은 원래 다 보낼 수 있고 방장 노릇도 그대로
    await rooms.updateParticipant(room, p.identity, {
      attributes: { owner: isNext ? "1" : "", roomAdmin: isNext || staff ? "1" : "" },
      ...(staff ? {} : { permission: { canSubscribe: true, canPublish: true, canPublishData: true, canPublishSources: isNext ? WITH_SCREEN : MIC_ONLY } }),
    });
  }
  return new Response(null, { status: 204 });
}
