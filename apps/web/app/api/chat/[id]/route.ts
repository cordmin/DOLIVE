import { store } from "@/lib/chat";

// 채팅 사진. 주소(id)는 아무도 짐작할 수 없는 긴 번호라서, 채팅을 본 사람만 안다
export async function GET(_req: Request, ctx: RouteContext<"/api/chat/[id]">) {
  const img = store.images.get((await ctx.params).id);
  if (!img) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: { "content-type": img.type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" },
  });
}
