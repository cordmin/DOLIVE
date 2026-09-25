import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { AVATARS } from "@/lib/dolive";

// 기본 프로필 사진(프로젝트 루트의 assets/profile)을 보여준다. 사진을 바꿔 넣으면 바로 반영.
// ?w=폭 을 붙이면 그 폭으로 곱게 줄여서 보낸다 (작은 동그라미 사진을 브라우저가 크게 줄이면 거칠어져서).
const DIR = path.join(process.cwd(), "..", "..", "assets", "profile");

export async function GET(req: Request, ctx: RouteContext<"/profile/[id]">) {
  const { id } = await ctx.params;
  if (!AVATARS.includes(id)) return new Response(null, { status: 404 });
  const w = Number(new URL(req.url).searchParams.get("w"));
  try {
    let img = await readFile(path.join(DIR, `${id}.webp`));
    if (Number.isInteger(w) && w >= 16 && w < 240) img = await sharp(img).resize({ width: w }).webp({ quality: 90 }).toBuffer();
    return new Response(new Uint8Array(img), {
      headers: { "content-type": "image/webp", "cache-control": "no-cache", "x-content-type-options": "nosniff" },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
