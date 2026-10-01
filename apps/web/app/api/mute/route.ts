import { TrackSource } from "livekit-server-sdk";
import { ROOM } from "@/lib/dolive";
import { isAdmin, rooms } from "@/lib/server";

// 방장만: 다른 사람 마이크를 강제로 끈다. (그 사람이 스스로 다시 켜는 것은 막지 않는다)
export async function POST(req: Request) {
  if (!isAdmin(req)) return Response.json({ error: "방장만 할 수 있어요" }, { status: 403 });
  const { identity } = await req.json().catch(() => ({}));
  if (typeof identity !== "string") return Response.json({ error: "잘못된 요청" }, { status: 400 });

  try {
    const p = await rooms.getParticipant(ROOM, identity);
    const mic = p.tracks.find((t) => t.source === TrackSource.MICROPHONE);
    if (mic && !mic.muted) await rooms.mutePublishedTrack(ROOM, identity, mic.sid, true);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "그 사람을 찾을 수 없어요" }, { status: 404 });
  }
}
