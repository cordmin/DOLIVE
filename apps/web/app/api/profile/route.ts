import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR } from "@/lib/files";

// 입장 화면이 240x300 JPEG로 줄여서 보낸다 (보통 20KB 안팎). 그 밖의 것은 받지 않는다.
const MAX = 300 * 1024;

// ponytail: 올린 사진은 지우지 않고 쌓인다. 폴더가 커지면 오래된 파일을 지우는 정리 작업을 추가.
export async function POST(req: Request) {
  const bad = () => Response.json({ error: "사진만 올릴 수 있어요" }, { status: 400 });
  if (Number(req.headers.get("content-length")) > MAX) return bad();
  const img = new Uint8Array(await req.arrayBuffer());
  const jpeg = img[0] === 0xff && img[1] === 0xd8 && img[2] === 0xff;
  if (!jpeg || img.length > MAX) return bad();

  const id = `u-${crypto.randomUUID()}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, `${id}.jpg`), img);
  return Response.json({ id });
}
