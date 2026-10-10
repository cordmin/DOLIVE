import { whoSent } from "@/lib/chat";
import { rooms } from "@/lib/server";
import { CAM_POS, CAM_SHAPE } from "@/lib/dolive";

// 화면공유 시 얼굴 위치·모양, 좌우 반전 { pos, shape, mirror } (카메라 설정 창, app/room/camera.tsx).
// 참여자 표시(attributes)는 본인이 직접 못 바꾸게 막아 둬서(방장 표시를 속일 수 있어서) 서버가 대신 적는다. 모두가 같은 자리에 보게 된다
export async function POST(req: Request) {
  const { pos, shape, mirror } = await req.json().catch(() => ({}));
  if (!CAM_POS.includes(pos) || !CAM_SHAPE.includes(shape) || typeof mirror !== "boolean") return Response.json({ error: "잘못된 요청" }, { status: 400 });
  const sender = await whoSent(req);
  if (sender.deny) return sender.deny;
  await rooms.updateParticipant(sender.room!, sender.who!.identity, { attributes: { camPos: pos, camShape: pos === "row" ? "rect" : shape, camMirror: mirror ? "1" : "0" } });
  return new Response(null, { status: 204 });
}
