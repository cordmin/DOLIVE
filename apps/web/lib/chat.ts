import { DataPacket_Kind, RoomServiceClient, TokenVerifier } from "livekit-server-sdk";
import { CHAT_TOPIC, ROOM, type ChatMsg } from "@/lib/dolive";

// 서버가 켜진 뒤의 채팅 전부. 서버 메모리에만 두고 파일로는 저장하지 않아서, 서버를 끄면 사라진다.
// (개발 중 코드를 고쳐 다시 읽혀도 안 사라지게 globalThis 에 둔다)
type Store = { messages: ChatMsg[]; images: Map<string, { type: string; data: Uint8Array }>; imageBytes: number };
const g = globalThis as unknown as { doliveChat?: Store };
export const store: Store = (g.doliveChat ??= { messages: [], images: new Map(), imageBytes: 0 });

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

// 방에 들어올 때 받은 입장권(토큰)으로 누가 보냈는지 확인한다 (이름·사진을 속일 수 없게)
export async function whoSent(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return null;
  try {
    const c = await new TokenVerifier(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!).verify(token);
    return c.sub ? { identity: c.sub, name: c.name ?? "", avatar: c.attributes?.avatar ?? "" } : null;
  } catch {
    return null;
  }
}

// 기록에 쌓고 방 안 모두에게 보낸다 (보낸 사람 = 서버라서, 받는 쪽은 사람이 보낸 가짜 채팅을 걸러 낼 수 있다)
export async function post(msg: Omit<ChatMsg, "id" | "n" | "timestamp">, id = crypto.randomUUID()) {
  const m: ChatMsg = { ...msg, id, n: store.messages.length, timestamp: Date.now() };
  store.messages.push(m);
  const rooms = new RoomServiceClient("http://localhost:7880", process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
  await rooms
    .sendData(ROOM, new TextEncoder().encode(JSON.stringify(m)), DataPacket_Kind.RELIABLE, { topic: CHAT_TOPIC })
    .catch(() => {}); // 못 보내도 기록엔 남아서, 들어올 때 다시 받는다
  return m;
}
