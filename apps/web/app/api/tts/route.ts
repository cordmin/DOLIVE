import { VOICES, isVoice } from "@/lib/dolive";
import { accessCheck } from "@/lib/server";
import { replay } from "@/lib/voice";

// 목소리 미리 듣기 (?listen=F1, WAV). 방에 들어올 수 있는 사람이면 누구나 (비회원은 비회원 방에 들어가 있을 때). 목소리 선택 버튼을 누르면 재생한다.
export async function GET(req: Request) {
  const { deny } = await accessCheck(req);
  if (deny) return deny;
  const id = new URL(req.url).searchParams.get("listen");
  if (!isVoice(id)) return new Response(null, { status: 404 });
  const name = VOICES.find((v) => v.id === id)!.name;
  const batchim = (name.charCodeAt(name.length - 1) - 0xac00) % 28 > 0; // 받침이 있으면 "하은이에요", 없으면 "수아예요"
  const wav = await replay(`안녕하세요, 저는 ${name}${batchim ? "이에요" : "예요"}. 오늘 방송도 재미있게 즐겨 주세요!`, id!).catch(() => null);
  if (!wav) return new Response(null, { status: 500 });
  return new Response(new Uint8Array(wav), { headers: { "content-type": "audio/wav", "cache-control": "private, max-age=3600" } });
}
