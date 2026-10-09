import { DataPacket_Kind, TokenVerifier } from "livekit-server-sdk";
import { CHAT_TOPIC, VOICE_BOT, type ChatMsg } from "@/lib/dolive";
import { dormsCheck, findRoom, isRoomAdmin, rooms } from "@/lib/server";
import { clearDonationTargets } from "./donationTargets";

// 사람이 남아 있는 동안의 채팅 전부. 방이 비거나 서버를 끄면 지운다. 파일로 저장하지 않는다.
// (개발 중 코드를 고쳐 다시 읽혀도 안 사라지게 globalThis 에 둔다)
type Store = { messages: Map<string, ChatMsg[]>; images: Map<string, { type: string; data: Uint8Array }>; imageBytes: number };
const g = globalThis as unknown as { doliveChats?: Store };
export const store: Store = (g.doliveChats ??= { messages: new Map(), images: new Map(), imageBytes: 0 });
export const chatOf = (room: string) => store.messages.get(room) ?? store.messages.set(room, []).get(room)!;
// 방송을 닫을 때(api/end) 그 방 채팅과 사진도 지운다
export function dropRoom(room: string) {
  clearDonationTargets(room);
  for (const m of store.messages.get(room) ?? []) {
    dropImage(m.id);
    owners.delete(m.id);
    if (m.avatar.startsWith("/api/chat/")) dropImage(m.avatar.slice("/api/chat/".length));
  }
  store.messages.delete(room);
}

// 통화 서버에 확인한다. 읽어 주는 참여자만 남아 있어도 빈 방으로 본다.
export async function clearEmptyRoom(room: string) {
  const people = await rooms.listParticipants(room);
  if (people.some((p) => p.identity !== VOICE_BOT)) return false;
  dropRoom(room);
  if (people.some((p) => p.identity === VOICE_BOT)) await rooms.removeParticipant(room, VOICE_BOT).catch(() => {});
  return true;
}

// 방 닫기 (방을 지우거나 이름을 바꿀 때, 서버를 끌 때): 채팅 기록·사진을 지우고 통화 방을 없앤다.
// 안에 있던 사람은 '방이 닫혔다'는 이유로 바로 끊기고 "방송이 끝났어요"를 본다 (app/room/page.tsx)
export async function endRoom(room: string) {
  dropRoom(room);
  await rooms.deleteRoom(room).catch(() => {}); // 방이 이미 없어도 괜찮다
}
function dropImage(id: string) {
  const img = store.images.get(id);
  if (!img) return;
  store.images.delete(id);
  store.imageBytes -= img.data.length;
}
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
// 그리고 지금도 도름스가 허용하는지, 입장권을 받은 그 도름스 회원(sub)인지, 그 방송이 아직 목록에 있는지 매번 확인한다. 막히면 deny 를 그대로 돌려준다.
// 비회원(입장권의 dorms 가 빈칸)은 "비회원도" 방에서만 도름스 로그인 없이 통과한다
export async function whoSent(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  const c = token
    ? await new TokenVerifier(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!).verify(token).catch(() => null)
    : null;
  const room = c?.video?.room;
  if (!c?.sub || !room) return { deny: new Response(null, { status: 401 }) };
  const { user, deny } = await dormsCheck(req, { room, identity: c.sub });
  const r = findRoom(room);
  if (deny && !(deny.status === 401 && r?.guest && !c.attributes?.dorms)) return { deny };
  if ((user?.id ?? "") !== (c.attributes?.dorms ?? "") || !r) return { deny: new Response(null, { status: 403 }) };
  // 나간 뒤에 옛 입장권으로 기록을 읽거나 쓰지 못하게 한다.
  if (!(await rooms.getParticipant(room, c.sub).catch(() => null))) return { deny: new Response(null, { status: 403 }) };
  return {
    room,
    who: { identity: c.sub, name: c.name ?? "", avatar: c.attributes?.avatar ?? "" },
    owner: user?.id ?? c.sub, // 보낸 사람 표시: 같은 도름스 계정이면 방을 나갔다 들어와도 같다
    admin: isRoomAdmin(req, user, r), // 그 방의 방장 노릇 (방장을 넘기면 바로 바뀐다)
    user,
  };
}

// 화면공유 허락·강퇴·마이크 끄기: 지금 그 방 안에 있고, 그 방에서 운영 권한을 받은 사람만.
export async function roomAdminDeny(req: Request, room: string) {
  const sender = await whoSent(req);
  if (sender.deny) return sender.deny;
  return sender.room === room && sender.admin ? null : Response.json({ error: "이 방의 운영 권한이 필요해요" }, { status: 403 });
}

// 기록에 쌓고 방 안 모두에게 보낸다 (보낸 사람 = 서버라서, 받는 쪽은 사람이 보낸 가짜 채팅을 걸러 낼 수 있다)
export async function post(room: string, msg: Omit<ChatMsg, "id" | "n" | "timestamp">, owner: string, id = crypto.randomUUID()) {
  const list = chatOf(room);
  const previous = list.find((m) => m.id === id);
  if (previous) return previous; // 같은 보내기를 다시 확인해도 알림은 한 번만 쌓는다.
  const m: ChatMsg = { ...msg, id, n: list.length, timestamp: Date.now() };
  list.push(m);
  owners.set(id, owner);
  await rooms
    .sendData(room, new TextEncoder().encode(JSON.stringify(m)), DataPacket_Kind.RELIABLE, { topic: CHAT_TOPIC })
    .catch(() => {}); // 못 보내도 기록엔 남아서, 들어올 때 다시 받는다
  return m;
}

// 내가 보낸 메시지인지 (같은 도름스 계정이면 다른 탭·다시 들어온 뒤에도)
export const isOwner = (id: string, owner: string) => owners.get(id) === owner;

// 메시지 지우기: 기록에서 빼고(사진이면 사진도) 방 안 모두에게 { deleted: id } 를 보낸다. 나중에 들어온 사람은 기록에 없어서 못 본다
export async function remove(room: string, id: string) {
  const list = chatOf(room);
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  owners.delete(id);
  dropImage(id);
  await rooms
    .sendData(room, new TextEncoder().encode(JSON.stringify({ deleted: id })), DataPacket_Kind.RELIABLE, { topic: CHAT_TOPIC })
    .catch(() => {}); // 못 보내도 기록에선 빠져서, 다시 들어오면 안 보인다
  return true;
}

// 글 고치기 (보낸 사람만, 글 메시지만. 사진·음성 글은 못 고친다): 기록을 바꾸고 방 안 모두에게 { edit: 고친 메시지 } 를 보낸다
export async function edit(room: string, id: string, message: string) {
  const m = chatOf(room).find((x) => x.id === id);
  if (!m || m.image || m.tts || m.donation) return null;
  Object.assign(m, { message, edited: true });
  await rooms
    .sendData(room, new TextEncoder().encode(JSON.stringify({ edit: m })), DataPacket_Kind.RELIABLE, { topic: CHAT_TOPIC })
    .catch(() => {}); // 못 보내도 기록은 바뀌어서, 다시 들어오면 고친 글이 보인다
  return m;
}
