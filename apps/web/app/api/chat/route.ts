import { isOwner, keepImage, post, store, whoSent } from "@/lib/chat";
import { CHAT_MAX, IMAGE_MAX, IMAGE_TYPES, TTS_MAX, TTS_MODES, VOICES, isVoice } from "@/lib/dolive";
import { say } from "@/lib/voice";

// 음성은 한 사람당 5초에 한 번만 (장난으로 계속 보내서 서버가 바빠지지 않게)
const lastSpoke = new Map<string, number>();

// 방에 들어온 도름스 회원만: 서버가 켜진 뒤의 채팅 기록 전부 (내가 보낸 것엔 mine 표시 → 지우기 버튼)
export async function GET(req: Request) {
  const { owner, deny } = await whoSent(req);
  if (deny) return deny;
  return Response.json(store.messages.map((m) => (isOwner(m.id, owner) ? { ...m, mine: true } : m)));
}

// 채팅 보내기. 글은 JSON { message, mode, voice } (mode·voice = 보낸 사람이 고른 음성 설정, lib/dolive.ts savedTts), 사진은 사진 파일 그대로 (Content-Type 이 사진 종류)
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

  const { message, mode: m, voice: v } = await req.json().catch(() => ({}));
  const text = typeof message === "string" ? message.trim() : "";
  if (!text || text.length > CHAT_MAX) return new Response(null, { status: 400 });

  // "/글" 은 서버가 읽어서 방 모두에게 들려준다 (lib/voice.ts). 말풍선에는 "/" 를 뺀 글이 보인다.
  // 보낸 사람이 "항상" 으로 해 두면 보통 글도 읽는다. 다만 그때 너무 길거나 5초 안에 또 보낸 글은 막지 않고 글로만 올린다.
  // "끄기" 면 "/글" 도 보낸 그대로 글로만 올린다
  const mode = TTS_MODES.includes(m) ? m : "slash";
  const voice = isVoice(v) ? (v as string) : VOICES[0].id;
  const slash = mode !== "off" && text.startsWith("/");
  const said = slash ? text.slice(1).trim() : mode === "always" ? text : "";
  if (said) {
    const tooLong = said.length > TTS_MAX;
    const tooSoon = Date.now() - (lastSpoke.get(who.identity) ?? 0) < 5000;
    if (slash && tooLong) return new Response(null, { status: 413 });
    if (slash && tooSoon) return new Response(null, { status: 429 });
    if (!tooLong && !tooSoon) {
      lastSpoke.set(who.identity, Date.now());
      say(said, voice).catch((e) => console.error("음성 실패", e));
      return Response.json(await post({ ...who, message: said, tts: true, voice }, owner));
    }
  }
  return Response.json(await post({ ...who, message: text }, owner));
}
