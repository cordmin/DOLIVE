import { readFile } from "node:fs/promises";
import path from "node:path";
import { isAvatar } from "@/lib/dolive";

// 프로젝트 루트의 assets/avatars 를 그대로 보여준다. 그림을 넣으면 바로 반영.
const DIR = path.join(process.cwd(), "..", "..", "assets", "avatars");

export async function GET(_req: Request, ctx: RouteContext<"/avatars/[name]/[frame]">) {
  const { name, frame } = await ctx.params;
  if (!isAvatar(name) || (frame !== "idle" && frame !== "talk")) {
    return new Response(null, { status: 404 });
  }
  try {
    const png = await readFile(path.join(DIR, name, `${frame}.png`));
    return new Response(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "no-cache" },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
