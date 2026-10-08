import { AccessToken } from "livekit-server-sdk";
import { clearEmptyRoom, keepImage } from "@/lib/chat";
import { AVATARS, CUSTOM, DORMS, isAvatar } from "@/lib/dolive";
import { MIC_ONLY, WITH_SCREEN, dormsCheck, findRoom, isLocal, isStaff, roomDeny } from "@/lib/server";

const JPEG = "data:image/jpeg;base64,";

export async function POST(req: Request) {
  // 도름스 회원만 입장권을 받는다 (서버 PC는 빼고)
  const { user, deny } = await dormsCheck(req);
  if (deny) return deny;
  const { name, avatar, photo, room, password } = await req.json().catch(() => ({}));
  const nickname = typeof name === "string" ? name.trim() : "";
  if (!isAvatar(avatar) || nickname.length < 1 || nickname.length > 20) {
    return Response.json({ error: "잘못된 입장 정보" }, { status: 400 });
  }
  const local = isLocal(req);
  const admin = local || isStaff(user); // 서버 PC, 또는 운영진 목록에 있는 도름스 회원
  // 방송 목록에 있는 방만. 비밀번호 방은 비밀번호가 맞아야 한다 (방장·운영진은 안 묻는다)
  const no = roomDeny(room, password, admin);
  if (no) return no;
  const adminEveryone = findRoom(room)?.adminEveryone === true;
  const roomAdmin = admin || adminEveryone;
  // 모두 나간 방의 옛 기록은 새로 들어오는 사람에게 주지 않는다.
  await clearEmptyRoom(room);

  // 내 사진은 서버 메모리에 두고(채팅 사진과 같은 곳) 그 주소를 입장권에 적는다. 서버를 끄면 사라진다.
  // 방을 나가도 남아 있어서, 나중에 들어온 사람도 지난 채팅에서 그 사람 사진을 본다
  let face = avatar;
  // 도름스 사진은 도름스가 알려 준 주소 그대로 (https 만). 사진이 없으면 첫 사진으로
  if (avatar === DORMS) face = user?.picture?.startsWith("https://") ? user.picture : AVATARS[0];
  if (avatar === CUSTOM) {
    const jpeg = typeof photo === "string" && photo.startsWith(JPEG) ? Buffer.from(photo.slice(JPEG.length), "base64") : null;
    face = AVATARS[0]; // 사진이 없거나 너무 크면 첫 사진으로
    if (jpeg?.length && jpeg.length <= 300 * 1024) {
      const id = crypto.randomUUID();
      keepImage(id, "image/jpeg", jpeg);
      face = `/api/chat/${id}`;
    }
  }

  const identity = `${nickname}#${crypto.randomUUID().slice(0, 4)}`;
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity,
    name: nickname,
    // dorms: 도름스 회원 id(sub). 채팅할 때 지금 도름스 로그인과 같은 사람인지 맞춰 본다 (lib/chat.ts whoSent). 서버 PC는 빈칸
    attributes: { avatar: face, admin: admin ? "1" : "", dorms: user?.id ?? "", roomAdmin: roomAdmin ? "1" : "" },
    ttl: "12h",
  });
  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    // 그 방에서 운영 권한을 받은 사람은 화면공유도 바로 시작한다. 비밀번호 면제는 방송 관리자만.
    ...(admin ? {} : { canPublishSources: roomAdmin ? WITH_SCREEN : MIC_ONLY }),
  });

  // 3단계(바깥 접속)에서 LIVEKIT_PUBLIC_URL=wss://<도메인> 을 넣는다. 서버 PC에서 들어온 사람만 localhost.
  const url =
    !local && process.env.LIVEKIT_PUBLIC_URL ? process.env.LIVEKIT_PUBLIC_URL : "ws://localhost:7880";

  return Response.json({ token: await at.toJwt(), url, isAdmin: roomAdmin });
}
