import { store } from "@/lib/chat";
import { dormsCheck } from "@/lib/server";

// 채팅 사진(+ 내 사진 프로필). 주소(id)는 아무도 짐작할 수 없는 긴 번호라서, 채팅을 본 사람만 안다.
// 도름스 허용도 볼 때마다 확인한다: 브라우저는 매번 서버에 묻고(no-cache), 이미 받은 사진이면 내용 없이 304 만 받는다
export async function GET(req: Request, ctx: RouteContext<"/api/chat/[id]">) {
  const { deny } = await dormsCheck(req);
  if (deny) return deny;
  const id = (await ctx.params).id;
  const img = store.images.get(id);
  if (!img) return new Response(null, { status: 404 });
  const etag = `"${id}"`;
  const headers = { etag, "cache-control": "private, no-cache", "x-content-type-options": "nosniff" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(img.data), { headers: { ...headers, "content-type": img.type } });
}
