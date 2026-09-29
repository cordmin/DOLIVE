import { AccessToken } from "livekit-server-sdk";
import { isAdmin } from "@/lib/admin";
import { keepImage } from "@/lib/chat";
import { AVATARS, CUSTOM, ROOM, isAvatar } from "@/lib/dolive";
import { MIC_ONLY } from "@/lib/share";

const JPEG = "data:image/jpeg;base64,";

export async function POST(req: Request) {
  const { name, avatar, photo } = await req.json().catch(() => ({}));
  const nickname = typeof name === "string" ? name.trim() : "";
  if (!isAvatar(avatar) || nickname.length < 1 || nickname.length > 20) {
    return Response.json({ error: "잘못된 입장 정보" }, { status: 400 });
  }

  // 내 사진은 서버 메모리에 두고(채팅 사진과 같은 곳) 그 주소를 입장권에 적는다. 서버를 끄면 사라진다.
  // 방을 나가도 남아 있어서, 나중에 들어온 사람도 지난 채팅에서 그 사람 사진을 본다
  let face = avatar;
  if (avatar === CUSTOM) {
    const jpeg = typeof photo === "string" && photo.startsWith(JPEG) ? Buffer.from(photo.slice(JPEG.length), "base64") : null;
    face = AVATARS[0]; // 사진이 없거나 너무 크면 첫 사진으로
    if (jpeg?.length && jpeg.length <= 300 * 1024) {
      const id = crypto.randomUUID();
      keepImage(id, "image/jpeg", jpeg);
      face = `/api/chat/${id}`;
    }
  }

  const admin = isAdmin(req);
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: `${nickname}#${crypto.randomUUID().slice(0, 4)}`,
    name: nickname,
    attributes: { avatar: face, admin: admin ? "1" : "" },
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
