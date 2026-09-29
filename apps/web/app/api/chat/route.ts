import { keepImage, post, store, whoSent } from "@/lib/chat";
import { CHAT_MAX, IMAGE_MAX, IMAGE_TYPES } from "@/lib/dolive";

// 방에 들어온 사람만: 서버가 켜진 뒤의 채팅 기록 전부
export async function GET(req: Request) {
  if (!(await whoSent(req))) return new Response(null, { status: 401 });
  return Response.json(store.messages);
}

// 채팅 보내기. 글은 JSON { message }, 사진은 사진 파일 그대로 (Content-Type 이 사진 종류)
export async function POST(req: Request) {
  const who = await whoSent(req);
  if (!who) return new Response(null, { status: 401 });
  const type = req.headers.get("content-type") ?? "";

  if (IMAGE_TYPES.includes(type)) {
    if (Number(req.headers.get("content-length")) > IMAGE_MAX) return new Response(null, { status: 413 });
    const data = new Uint8Array(await req.arrayBuffer());
    if (!data.length || data.length > IMAGE_MAX) return new Response(null, { status: 413 });
    const id = crypto.randomUUID();
    keepImage(id, type, data);
    return Response.json(await post({ ...who, message: "", image: `/api/chat/${id}`, imageType: type }, id));
  }

  const { message } = await req.json().catch(() => ({}));
  const text = typeof message === "string" ? message.trim() : "";
  if (!text || text.length > CHAT_MAX) return new Response(null, { status: 400 });
  return Response.json(await post({ ...who, message: text }));
}
