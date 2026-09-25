import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { isAvatar, isUpload } from "@/lib/dolive";
import { PROFILE_DIR, UPLOAD_DIR } from "@/lib/files";

// 기본 사진은 assets/profile, 사용자가 올린 사진은 server/uploads 에서 보여준다.
// ?w=폭 을 붙이면 그 폭으로 곱게 줄여서 보낸다 (작은 동그라미 사진을 브라우저가 크게 줄이면 거칠어져서).
export async function GET(req: Request, ctx: RouteContext<"/profile/[id]">) {
  const { id } = await ctx.params;
  if (!isAvatar(id)) return new Response(null, { status: 404 });
  const upload = isUpload(id);
  const w = Number(new URL(req.url).searchParams.get("w"));
  const resize = Number.isInteger(w) && w >= 16 && w < 240;
  try {
    let img = await readFile(upload ? path.join(UPLOAD_DIR, `${id}.jpg`) : path.join(PROFILE_DIR, `${id}.webp`));
    if (resize) img = await sharp(img).resize({ width: w }).webp({ quality: 90 }).toBuffer();
    return new Response(new Uint8Array(img), {
      headers: {
        "content-type": upload && !resize ? "image/jpeg" : "image/webp",
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
