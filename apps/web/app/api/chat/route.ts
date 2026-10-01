import { isOwner, keepImage, post, store, whoSent } from "@/lib/chat";
import { CHAT_MAX, IMAGE_MAX, IMAGE_TYPES, TTS_MAX } from "@/lib/dolive";
import { say } from "@/lib/voice";

// 음성은 한 사람당 5초에 한 번만 (장난으로 계속 보내서 서버가 바빠지지 않게)
const lastSpoke = new Map<string, number>();

// 방에 들어온 도름스 회원만: 서버가 켜진 뒤의 채팅 기록 전부 (내가 보낸 것엔 mine 표시 → 지우기 버튼)
export async function GET(req: Request) {
  const { owner, deny } = await whoSent(req);
  if (deny) return deny;
  return Response.json(store.messages.map((m) => (isOwner(m.id, owner) ? { ...m, mine: true } : m)));
}

// 채팅 보내기. 글은 JSON { message }, 사진은 사진 파일 그대로 (Content-Type 이 사진 종류)
export async function POST(req: Request) {
  const { who, owner, deny } = await whoSent(req);
  if (deny) return deny;
  const type = req.headers.get("content-type") ?? "";

  if (IMAGE_TYPES.includes(type)) {
    if (Number(req.headers.get("content-length")) > IMAGE_MAX) return new Response(null, { status: 413 });
    const data = new Uint8Array(await req.arrayBuffer());
    if (!data.length || data.length > IMAGE_MAX) return new Response(null, { status: 413 });
    const id = crypto.randomUUID();
    keepImage(id, type, data);
    return Response.json(await post({ ...who, message: "", image: `/api/chat/${id}`, imageType: type }, owner, id));
  }

  const { message } = await req.json().catch(() => ({}));
  const text = typeof message === "string" ? message.trim() : "";
  if (!text || text.length > CHAT_MAX) return new Response(null, { status: 400 });

  // "/글" 은 서버가 읽어서 방 모두에게 들려준다 (lib/voice.ts). 말풍선에는 "/" 를 뺀 글이 보인다
  const said = text.startsWith("/") ? text.slice(1).trim() : "";
  if (said) {
    if (said.length > TTS_MAX) return new Response(null, { status: 413 });
    if (Date.now() - (lastSpoke.get(who.identity) ?? 0) < 5000) return new Response(null, { status: 429 });
    lastSpoke.set(who.identity, Date.now());
    say(said).catch((e) => console.error("음성 실패", e));
    return Response.json(await post({ ...who, message: said, tts: true }, owner));
  }
  return Response.json(await post({ ...who, message: text }, owner));
}
