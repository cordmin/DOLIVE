import { AccessToken } from "livekit-server-sdk";
import { clearEmptyRoom, keepImage } from "@/lib/chat";
import { AVATARS, CUSTOM, DORMS, isAvatar } from "@/lib/dolive";
import { GUEST_COOKIE, MIC_ONLY, WITH_SCREEN, dormsCheck, findRoom, isLocal, isStaff, roomDeny } from "@/lib/server";

const JPEG = "data:image/jpeg;base64,";

export async function POST(req: Request) {
  const { name, avatar, photo, room, password } = await req.json().catch(() => ({}));
  // 도름스 회원만 입장권을 받는다 (서버 PC는 빼고). 비회원(로그인 안 함)은 "비회원도" 방에만
  const { user, deny } = await dormsCheck(req);
  const r = findRoom(room);
  if (deny && !(deny.status === 401 && r?.guest)) return deny;
  const nickname = typeof name === "string" ? name.trim() : "";
  if (!isAvatar(avatar) || nickname.length < 1 || nickname.length > 20) {
    return Response.json({ error: "잘못된 입장 정보" }, { status: 400 });
  }
  const local = isLocal(req);
  const admin = local || isStaff(user); // 마스터(서버 PC), 또는 운영진 목록에 있는 도름스 회원
  const owner = !!user && r?.owner === user.id; // 이 방을 만든 사람 (나갔다 들어와도 계속 방장)
  // 방송 목록에 있는 방만. 비밀번호 방은 비밀번호가 맞아야 한다 (방장 노릇 하는 사람은 안 묻는다)
  const no = roomDeny(room, password, admin || owner);
  if (no) return no;
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
    // roomAdmin: 이 방에서 방장 노릇(마스터·운영진·만든 사람), owner: 만든 사람(방장 넘기기 메뉴가 보인다. 넘기면 api/owner 가 바꾼다)
    attributes: { avatar: face, admin: admin ? "1" : "", dorms: user?.id ?? "", roomAdmin: admin || owner ? "1" : "", owner: owner ? "1" : "" },
    ttl: "12h",
  });
  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    // 마스터·운영진은 다 보낼 수 있고, 만든 사람은 화면공유까지, 나머지는 마이크만 (화면공유는 방장이 허락하면 /api/share 가 풀어 준다)
    ...(admin ? {} : { canPublishSources: owner ? WITH_SCREEN : MIC_ONLY }),
  });

  // 3단계(바깥 접속)에서 LIVEKIT_PUBLIC_URL=wss://<도메인> 을 넣는다. 서버 PC에서 들어온 사람만 localhost.
  const url =
    !local && process.env.LIVEKIT_PUBLIC_URL ? process.env.LIVEKIT_PUBLIC_URL : "ws://localhost:7880";

  const token = await at.toJwt();
  const res = Response.json({ token, url, isAdmin: admin });
  // 비회원은 입장권을 쿠키로도 받는다: 채팅 사진·다시 듣기처럼 입장권을 같이 못 보내는 요청이 이걸로 확인한다 (lib/server.ts accessCheck)
  if (!user && !local) res.headers.append("set-cookie", `${GUEST_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure`);
  return res;
}
