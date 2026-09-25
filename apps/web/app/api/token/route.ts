import { AccessToken } from "livekit-server-sdk";
import { isAdmin } from "@/lib/admin";
import { ROOM, isAvatar } from "@/lib/dolive";
import { MIC_ONLY } from "@/lib/share";

export async function POST(req: Request) {
  const { name, avatar } = await req.json().catch(() => ({}));
  const nickname = typeof name === "string" ? name.trim() : "";
  if (!isAvatar(avatar) || nickname.length < 1 || nickname.length > 20) {
    return Response.json({ error: "잘못된 입장 정보" }, { status: 400 });
  }

  const admin = isAdmin(req);
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: `${nickname}#${crypto.randomUUID().slice(0, 4)}`,
    name: nickname,
    attributes: { avatar, admin: admin ? "1" : "" },
    ttl: "12h",
  });
  at.addGrant({
    roomJoin: true,
    room: ROOM,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    // 방장은 다 보낼 수 있고, 나머지는 마이크만 (화면공유는 방장이 허락하면 /api/share 가 풀어 준다)
    ...(admin ? {} : { canPublishSources: MIC_ONLY }),
  });

  // 3단계(바깥 접속)에서 LIVEKIT_PUBLIC_URL=wss://<도메인> 을 넣는다. 방장은 항상 localhost.
  const url =
    !admin && process.env.LIVEKIT_PUBLIC_URL ? process.env.LIVEKIT_PUBLIC_URL : "ws://localhost:7880";

  return Response.json({ token: await at.toJwt(), url, isAdmin: admin });
}
