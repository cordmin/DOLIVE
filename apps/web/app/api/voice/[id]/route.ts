import { store } from "@/lib/chat";
import { dormsCheck } from "@/lib/server";
import { replay } from "@/lib/voice";

// "/글" 음성 다시 듣기. 소리를 저장해 두지 않아서 누를 때마다 다시 읽어 준다 (1초쯤).
// 받은 사람 브라우저가 기억해 두고, 또 누르면 도름스 허용만 다시 확인한 뒤(304) 기억한 소리를 바로 낸다.
// 주소(id)는 아무도 짐작할 수 없는 긴 번호라서, 채팅을 본 사람만 안다 (채팅 사진과 같음)
export async function GET(req: Request, ctx: RouteContext<"/api/voice/[id]">) {
  const { deny } = await dormsCheck(req);
  if (deny) return deny;
  const id = (await ctx.params).id;
  const m = [...store.messages.values()].flat().find((x) => x.id === id && x.tts);
  if (!m) return new Response(null, { status: 404 });
  const etag = `"${id}"`;
  const headers = { etag, "cache-control": "private, no-cache", "x-content-type-options": "nosniff" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  const wav = await replay(m.message, m.voice ?? "F2").catch(() => null);
  if (!wav) return new Response(null, { status: 500 });
  return new Response(new Uint8Array(wav), { headers: { ...headers, "content-type": "audio/wav" } });
}
