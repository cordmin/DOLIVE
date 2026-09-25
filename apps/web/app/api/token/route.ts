import { AccessToken } from "livekit-server-sdk";
import { ROOM, isAvatar } from "@/lib/dolive";

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1", "::ffff:127.0.0.1"];

// 방장 = 서버 PC에서 localhost로 직접 들어온 사람.
// Caddy를 거치면 Host가 도메인이고 X-Forwarded-For에 바깥 IP가 붙으므로 걸러진다.
function isAdmin(req: Request) {
  const host = new URL(`http://${req.headers.get("host")}`).hostname;
  const forwarded = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  return LOOPBACK.includes(host) && forwarded.every((ip) => LOOPBACK.includes(ip));
}

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
    canUpdateOwnMetadata: true,
  });

  // 3단계(바깥 접속)에서 LIVEKIT_PUBLIC_URL=wss://<도메인> 을 넣는다. 방장은 항상 localhost.
  const url =
    !admin && process.env.LIVEKIT_PUBLIC_URL ? process.env.LIVEKIT_PUBLIC_URL : "ws://localhost:7880";

  return Response.json({ token: await at.toJwt(), url, isAdmin: admin });
}
