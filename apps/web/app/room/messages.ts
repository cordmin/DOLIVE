import { useDataChannel, useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_TOPIC, IMAGE_MAX, IMAGE_TYPES, TTS_MAX, leaveForDorms, savedTts, type ChatMsg } from "@/lib/dolive";

// 이 탭에서 내가 썼던 identity 들. 나갔다가 다시 들어오면 identity 가 새로 바뀌어서, 예전 내 글도 내 글로 보이게 모아 둔다
const MY_IDS = "dolive-my-ids";
const DORMS_DOWN = "도름스에서 확인하지 못했어요. 잠시 뒤 다시 보내 주세요.";
export function myIds(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(MY_IDS) ?? "[]");
  } catch {
    return [];
  }
}

// 채팅은 서버(/api/chat)를 거친다. 사람이 남아 있는 동안 글·사진을 기억하고, 새 글은 방 안 모두에게 보낸다.
// 들어올 때(다시 붙을 때도) 기록을 통째로 받아서, 나중에 들어온 사람도 처음부터 다 본다.
// 목록은 서버가 받은 순서(n)대로 (기기마다 시계가 달라도 순서가 섞이지 않게)
export function useMessages(token: string) {
  const room = useRoomContext();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  // 다시 연결한 사이 방이 비었으면 옛 기록을 붙이지 않는다. 기록을 받는 동안의 새 소식은 따로 모은다.
  const loading = useRef<Array<ChatMsg | { deleted: string } | { edit: ChatMsg }> | null>(null);
  const add = useCallback(
    (list: ChatMsg[]) =>
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const fresh = list.filter((m) => !seen.has(m.id));
        // 서버 시계로 잰 시각 순서, 같은 순간이면 받은 번호 순서 (서버를 다시 켜면 번호는 0부터라 시각을 먼저 본다)
        return fresh.length ? [...prev, ...fresh].sort((a, b) => a.timestamp - b.timestamp || a.n - b.n) : prev;
      }),
    [],
  );
  // 고친 메시지로 바꿔 끼운다 (mine 은 기록을 받을 때만 오는 표시라 그대로 둔다)
  const replace = useCallback(
    (m: ChatMsg) => setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...m, mine: x.mine } : x))),
    [],
  );
  // 서버가 보낸 것만 받는다 (사람이 같은 이름표로 보낸 가짜 채팅은 무시). { deleted: id } 는 누가 지운 메시지, { edit: 메시지 } 는 고친 메시지
  useDataChannel(CHAT_TOPIC, (msg) => {
    if (msg.from) return;
    const data = JSON.parse(new TextDecoder().decode(msg.payload));
    loading.current?.push(data);
    if (data.deleted) setMessages((prev) => prev.filter((m) => m.id !== data.deleted));
    else if (data.edit) replace(data.edit);
    else add([data]);
  });

  const auth = { Authorization: `Bearer ${token}` };
  useEffect(() => {
    let alive = true;
    const load = () => {
      const updates: NonNullable<typeof loading.current> = [];
      loading.current = updates;
      const me = room.localParticipant.identity;
      if (!myIds().includes(me)) sessionStorage.setItem(MY_IDS, JSON.stringify([...myIds(), me]));
      fetch("/api/chat", { headers: { Authorization: `Bearer ${token}` } })
        .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json().catch(() => null))?.reason)))
        .then((list: ChatMsg[]) => {
          if (!alive || loading.current !== updates) return;
          loading.current = null;
          const next = new Map(list.map((m) => [m.id, m]));
          for (const update of updates) {
            if ("deleted" in update) next.delete(update.deleted);
            else if ("edit" in update) { if (next.has(update.edit.id)) next.set(update.edit.id, { ...update.edit, mine: next.get(update.edit.id)?.mine }); }
            else if (!next.has(update.id)) next.set(update.id, update);
          }
          setMessages([...next.values()].sort((a, b) => a.timestamp - b.timestamp || a.n - b.n));
        }, (reason) => {
          if (!alive || loading.current !== updates) return;
          loading.current = null;
          if (reason !== "temporarily_unavailable") leaveForDorms(reason);
        }); // 도름스가 잠깐 안 되면 기록만 못 받는다
    };
    // 방에 붙은 뒤에 받아야 그 사이에 올라온 글을 놓치지 않는다 (겹친 글은 add 가 걸러 낸다)
    if (room.state === "connected") load();
    room.on(RoomEvent.Connected, load).on(RoomEvent.Reconnected, load);
    return () => {
      alive = false;
      loading.current = null;
      room.off(RoomEvent.Connected, load).off(RoomEvent.Reconnected, load);
    };
  }, [room, token]);

  async function post(body: BodyInit, type: string) {
    const r = await fetch("/api/chat", { method: "POST", headers: { ...auth, "Content-Type": type }, body });
    if (!r.ok) {
      // 도름스 허용이 끊겼거나 로그인 시간이 지났으면 방을 떠나 안내 화면·로그인으로. 도름스가 잠깐 안 되면 다시 보내 달라고 한다
      const reason = (await r.json().catch(() => null))?.reason;
      if (reason !== "temporarily_unavailable" && leaveForDorms(reason)) return;
      throw new Error(reason === "temporarily_unavailable" ? "503" : String(r.status));
    }
    add([await r.json()]);
  }
  // 내 음성 설정(TTS 버튼)도 같이 보낸다
  const send = (message: string) =>
    post(JSON.stringify({ message, ...savedTts() }), "application/json").catch((e) =>
      alert(
        e.message === "429" ? "음성은 5초에 한 번만 보낼 수 있어요."
        : e.message === "413" ? `음성은 ${TTS_MAX}자까지만 보낼 수 있어요.`
        : e.message === "503" ? DORMS_DOWN
        : "메시지를 보내지 못했어요.",
      ),
    );
  async function sendImage(file: File) {
    if (!IMAGE_TYPES.includes(file.type)) return alert("PNG, JPG, GIF, WEBP 사진만 보낼 수 있어요.");
    const img = await shrink(file);
    if (img.size > IMAGE_MAX) return alert("10MB보다 큰 사진은 보낼 수 없어요.");
    post(img, img.type).catch((e) => alert(e.message === "503" ? DORMS_DOWN : "사진을 보내지 못했어요."));
  }

  // 메시지 지우기 (서버가 내 것인지·관리자인지 다시 확인하고, 방 안 모두에게서 지운다)
  const remove = useCallback(
    async (id: string) => {
      const r = await fetch(`/api/chat/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      if (r?.ok || r?.status === 404) setMessages((prev) => prev.filter((m) => m.id !== id));
      else alert(r?.status === 503 ? DORMS_DOWN.replace("보내", "지워") : "메시지를 지우지 못했어요.");
    },
    [token],
  );

  // 글 고치기 (서버가 내 것인지 다시 확인한다)
  const edit = useCallback(
    async (id: string, message: string) => {
      const r = await fetch(`/api/chat/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      }).catch(() => null);
      if (r?.ok) replace(await r.json());
      else alert(r?.status === 503 ? DORMS_DOWN.replace("보내", "고쳐") : "메시지를 고치지 못했어요.");
    },
    [token, replace],
  );

  return { messages, send, sendImage, remove, edit };
}

// 사진은 보내기 전에 이 브라우저에서 줄인다 (긴 쪽 1600px, webp. webp 를 못 만드는 브라우저는 jpg).
// 방 사람 모두가 서버에서 각자 받아 가서, 줄인 만큼 서버 인터넷이 덜 든다.
// 움직이는 GIF는 멈춘 그림이 되면 안 돼서 그대로. 줄여도 더 크면(이미 작은 사진) 원본 그대로
const SHRINK_PX = 1600;
async function shrink(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, SHRINK_PX / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const blob = (type: string) => new Promise<Blob | null>((r) => c.toBlob(r, type, 0.85));
    let out = await blob("image/webp");
    if (out?.type !== "image/webp") {
      // jpg 는 투명한 곳이 검게 나와서 흰 바탕을 깐다
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      out = await blob("image/jpeg");
    }
    return out && out.size < file.size ? out : file;
  } catch {
    return file; // 브라우저가 못 여는 사진이면 원본 그대로 (서버가 종류를 다시 확인한다)
  }
}
