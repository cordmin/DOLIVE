import { VOICES } from "@/lib/dolive";
import { adminDeny } from "@/lib/server";
import { isVoice, replay, ttsSettings } from "@/lib/voice";

// 관리자만: 음성 설정 보기. ?listen=F1 이면 그 목소리 미리 듣기 (WAV)
export async function GET(req: Request) {
  const no = await adminDeny(req);
  if (no) return no;
  const id = new URL(req.url).searchParams.get("listen");
  if (id === null) return Response.json(ttsSettings);
  if (!isVoice(id)) return new Response(null, { status: 404 });
  const name = VOICES.find((v) => v.id === id)!.name;
  const batchim = (name.charCodeAt(name.length - 1) - 0xac00) % 28 > 0; // 받침이 있으면 "하은이에요", 없으면 "수아예요"
  const wav = await replay(`안녕하세요, 저는 ${name}${batchim ? "이에요" : "예요"}. 오늘 방송도 재미있게 즐겨 주세요!`, id).catch(() => null);
  if (!wav) return new Response(null, { status: 500 });
  return new Response(new Uint8Array(wav), { headers: { "content-type": "audio/wav", "cache-control": "private, max-age=3600" } });
}

// 관리자만: 음성 설정 바꾸기 { mode, voice }
export async function POST(req: Request) {
  const no = await adminDeny(req);
  if (no) return no;
  const { mode, voice } = await req.json().catch(() => ({}));
  if (!["off", "slash"].includes(mode) || !isVoice(voice))
    return Response.json({ error: "잘못된 요청" }, { status: 400 });
  Object.assign(ttsSettings, { mode, voice });
  return Response.json(ttsSettings);
}
