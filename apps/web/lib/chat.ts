import { DataPacket_Kind, TokenVerifier } from "livekit-server-sdk";
import { CHAT_TOPIC, ROOM, type ChatMsg } from "@/lib/dolive";
import { dormsCheck, isLocal, isStaff, rooms } from "@/lib/server";

// 서버가 켜진 뒤의 채팅 전부. 서버 메모리에만 두고 파일로는 저장하지 않아서, 서버를 끄면 사라진다.
// (개발 중 코드를 고쳐 다시 읽혀도 안 사라지게 globalThis 에 둔다)
type Store = { messages: ChatMsg[]; images: Map<string, { type: string; data: Uint8Array }>; imageBytes: number };
const g = globalThis as unknown as { doliveChat?: Store };
export const store: Store = (g.doliveChat ??= { messages: [], images: new Map(), imageBytes: 0 });
// 메시지 id → 보낸 사람 (도름스 회원 id, 서버 PC 는 그때 이름표). 지우기 권한 확인용이라 다른 사람에게 보내지 않는다
const g2 = globalThis as unknown as { doliveOwners?: Map<string, string> };
const owners = (g2.doliveOwners ??= new Map<string, string>());

// ponytail: 사진은 합쳐서 300MB까지만 기억하고, 넘치면 오래된 사진부터 지운다 (그 말풍선은 빈 사진). 더 필요하면 디스크에 저장
const IMAGE_TOTAL = 300 * 1024 * 1024;
export function keepImage(id: string, type: string, data: Uint8Array) {
  store.images.set(id, { type, data });
  store.imageBytes += data.length;
  for (const [old, img] of store.images) {
    if (store.imageBytes <= IMAGE_TOTAL) break;
    store.images.delete(old);
    store.imageBytes -= img.data.length;
  }
}

// 방에 들어올 때 받은 입장권(토큰)으로 누가 보냈는지 확인한다 (이름·사진을 속일 수 없게).
// 그리고 지금도 도름스가 허용하는지, 입장권을 받은 그 도름스 회원(sub)인지 매번 확인한다. 막히면 deny 를 그대로 돌려준다
export async function whoSent(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  const c = token
    ? await new TokenVerifier(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!).verify(token).catch(() => null)
    : null;
  if (!c?.sub) return { deny: new Response(null, { status: 401 }) };
  const { user, deny } = await dormsCheck(req, c.sub);
  if (deny) return { deny };
  if ((user?.id ?? "") !== (c.attributes?.dorms ?? "")) return { deny: new Response(null, { status: 403 }) };
  return {
    who: { identity: c.sub, name: c.name ?? "", avatar: c.attributes?.avatar ?? "" },
    owner: user?.id ?? c.sub, // 보낸 사람 표시: 같은 도름스 계정이면 방을 나갔다 들어와도 같다
    admin: isLocal(req) || isStaff(user), // 남의 메시지도 지울 수 있다
  };
}

// 기록에 쌓고 방 안 모두에게 보낸다 (보낸 사람 = 서버라서, 받는 쪽은 사람이 보낸 가짜 채팅을 걸러 낼 수 있다)
export async function post(msg: Omit<ChatMsg, "id" | "n" | "timestamp">, owner: string, id = crypto.randomUUID()) {
  const m: ChatMsg = { ...msg, id, n: store.messages.length, timestamp: Date.now() };
  store.messages.push(m);
  owners.set(id, owner);
  await rooms
    .sendData(ROOM, new TextEncoder().encode(JSON.stringify(m)), DataPacket_Kind.RELIABLE, { topic: CHAT_TOPIC })
    .catch(() => {}); // 못 보내도 기록엔 남아서, 들어올 때 다시 받는다
  return m;
}

// 내가 보낸 메시지인지 (같은 도름스 계정이면 다른 탭·다시 들어온 뒤에도)
export const isOwner = (id: string, owner: string) => owners.get(id) === owner;

// 메시지 지우기: 기록에서 빼고(사진이면 사진도) 방 안 모두에게 { deleted: id } 를 보낸다. 나중에 들어온 사람은 기록에 없어서 못 본다
export async function remove(id: string) {
  const i = store.messages.findIndex((m) => m.id === id);
  if (i < 0) return false;
  store.messages.splice(i, 1);
  owners.delete(id);
  const img = store.images.get(id);
  if (img) {
    store.images.delete(id);
    store.imageBytes -= img.data.length;
  }
  await rooms
    .sendData(ROOM, new TextEncoder().encode(JSON.stringify({ deleted: id })), DataPacket_Kind.RELIABLE, { topic: CHAT_TOPIC })
    .catch(() => {}); // 못 보내도 기록에선 빠져서, 다시 들어오면 안 보인다
  return true;
}
