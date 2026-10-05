import { edit, isOwner, remove, store, whoSent } from "@/lib/chat";
import { CHAT_MAX } from "@/lib/dolive";
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

// 메시지 지우기 (id = 메시지 id. 사진 메시지는 사진 id 와 같다). 내가 보낸 것, 또는 관리자(방장·운영진)는 누구 것이든
export async function DELETE(req: Request, ctx: RouteContext<"/api/chat/[id]">) {
  const { room, owner, admin, deny } = await whoSent(req);
  if (deny) return deny;
  const id = (await ctx.params).id;
  if (!admin && !isOwner(id, owner)) return new Response(null, { status: 403 });
  return new Response(null, { status: (await remove(room, id)) ? 204 : 404 });
}

// 글 고치기 { message }. 내가 보낸 것만 (관리자도 남의 글은 못 고친다)
export async function PATCH(req: Request, ctx: RouteContext<"/api/chat/[id]">) {
  const { room, owner, deny } = await whoSent(req);
  if (deny) return deny;
  const id = (await ctx.params).id;
  if (!isOwner(id, owner)) return new Response(null, { status: 403 });
  const { message } = await req.json().catch(() => ({}));
  const text = typeof message === "string" ? message.trim() : "";
  if (!text || text.length > CHAT_MAX) return new Response(null, { status: 400 });
  const m = await edit(room, id, text);
  return m ? Response.json(m) : new Response(null, { status: 404 });
}
