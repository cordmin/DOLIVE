import { store } from "@/lib/chat";
import { replay } from "@/lib/voice";

// "/글" 음성 다시 듣기. 소리를 저장해 두지 않아서 누를 때마다 다시 읽어 준다 (1초쯤).
// 받은 사람 브라우저가 하루 기억해서, 또 누르면 서버에 묻지 않고 바로 나온다.
// 주소(id)는 아무도 짐작할 수 없는 긴 번호라서, 채팅을 본 사람만 안다 (채팅 사진과 같음)
export async function GET(_req: Request, ctx: RouteContext<"/api/voice/[id]">) {
  const id = (await ctx.params).id;
  const m = store.messages.find((x) => x.id === id && x.tts);
  if (!m) return new Response(null, { status: 404 });
  const wav = await replay(m.message).catch(() => null);
  if (!wav) return new Response(null, { status: 500 });
  return new Response(new Uint8Array(wav), {
    headers: { "content-type": "audio/wav", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" },
  });
}
