import { useDataChannel, useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { CHAT_MAX, CHAT_TOPIC, IMAGE_MAX, IMAGE_TYPES, TTS_MAX, avatarOf, isPhone, leaveForDorms, playOnly, savedTts, type ChatMsg } from "@/lib/dolive";
import { MENU_ITEM, NO_SELECT, PopMenu, useHoldMenu } from "./menu";
import { Heart, STICKER_TEXT, type Reaction } from "./reactions";
import { DonationFace } from "@/components/DonationMascot";

// 이 탭에서 내가 썼던 identity 들. 나갔다가 다시 들어오면 identity 가 새로 바뀌어서, 예전 내 글도 내 글로 보이게 모아 둔다
const MY_IDS = "dolive-my-ids";
const DORMS_DOWN = "도름스에서 확인하지 못했어요. 잠시 뒤 다시 보내 주세요.";
function myIds(): string[] {
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

// "오전 12:03"
// 글마다 시각을 여러 번 쓰므로 바꾸는 틀은 한 번만 만든다 (toLocaleTimeString 은 부를 때마다 새로 만들어서 느리다)
const TIME = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });
const chatTime = (t: number) => TIME.format(t);

// 채팅 글 속 링크 (http:// 또는 https:// 로 시작). 끝에 붙은 마침표·괄호 같은 것은 링크에서 뺀다
const LINK = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

// 글 속 링크를 누르면 새 탭으로 열리게
function Linkified({ text }: { text: string }) {
  return text.split(LINK).map((part, i) =>
    i % 2 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all underline">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

// 링크 미리보기 카드 (제목·설명·그림). 서버(/api/preview)가 대신 읽어 오고, 이 탭에서 한 번 읽은 건 다시 안 묻는다
type Preview = { title: string; description?: string; image?: string; site: string } | null;
const previews = new Map<string, Promise<Preview>>();

function LinkPreview({ url, onLoad }: { url: string; onLoad: () => void }) {
  const [p, setP] = useState<Preview>(null);
  const [noImage, setNoImage] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!previews.has(url))
      previews.set(
        url,
        fetch(`/api/preview?url=${encodeURIComponent(url)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      );
    previews.get(url)!.then((v) => alive && setP(v));
    return () => {
      alive = false;
    };
  }, [url]);
  useEffect(() => {
    if (p) onLoad();
  }, [p, onLoad]);
  if (!p) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 block w-72 max-w-full overflow-hidden rounded-xl bg-zinc-800 hover:bg-zinc-700"
    >
      {p.image && !noImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.image}
          alt=""
          referrerPolicy="no-referrer"
          onLoad={onLoad}
          onError={() => setNoImage(true)}
          className="aspect-video w-full bg-zinc-900 object-cover"
        />
      )}
      <div className="p-2.5">
        <div className="truncate text-xs text-zinc-400">{p.site}</div>
        <div className="line-clamp-2 font-semibold">{p.title}</div>
        {p.description && <div className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{p.description}</div>}
      </div>
    </a>
  );
}

// 카카오톡처럼: 남의 말은 왼쪽(사진·이름 + 회색 말풍선), 내 말은 오른쪽(보라색 말풍선).
// 같은 사람이 같은 분에 이어 보낸 말은 한 묶음이라 사진·이름은 첫 말에만, 시간은 마지막 말에만 붙인다.
// 링크가 있으면 말풍선 아래에 첫 링크의 미리보기 카드, 사진은 말풍선 대신 사진 그대로 (누르면 화면 위에 크게)
// memo: 하트가 날거나 누가 말할 때마다 방 화면이 다시 그려지는데, 채팅 글이 그대로면 긴 채팅 목록은 다시 그리지 않는다
export const ChatLog = memo(function ChatLog({
  messages,
  className,
  isAdmin,
  remove,
  edit,
}: {
  messages: ChatMsg[];
  className: string;
  isAdmin: boolean; // 관리자는 누구 메시지든 지울 수 있다
  remove: (id: string) => void;
  edit: (id: string, message: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const mineIds = myIds();

  // 메시지 메뉴 (복사·수정·삭제): PC 는 메시지에 오른쪽 클릭, 휴대폰은 꾹(0.5초) 누르기. 누른 말풍선 바로 아래에 뜨고, 꼬리가 말풍선 가운데를 가리킨다.
  // 휴대폰은 꾹 누를 때 브라우저의 글자 선택·복사 메뉴가 같이 떠서, 말풍선 글자는 선택되지 않게 막고(noSelect) 복사는 이 메뉴로 한다.
  // 지울 수 있는 것: 내가 보낸 것(이 탭 이름표, 또는 같은 도름스 계정 = mine), 관리자는 전부. 고칠 수 있는 것: 내가 보낸 글만 (사진·음성 글 빼고). 서버가 다시 확인한다
  const askDel = useRef<HTMLDialogElement>(null);
  const [delTarget, setDelTarget] = useState<string | null>(null);
  const canDelete = (m: ChatMsg) => isAdmin || !!m.mine || mineIds.includes(m.identity);
  const canEdit = (m: ChatMsg) => (!!m.mine || mineIds.includes(m.identity)) && !m.image && !m.tts;
  const hasMenu = (m: ChatMsg) => !m.image || canDelete(m); // 남의 사진은 메뉴가 없어서 브라우저 메뉴(사진 저장 등) 그대로
  function ask(id: string) {
    setDelTarget(id);
    askDel.current?.showModal();
  }
  const [menuAt, setMenuAt] = useState<{ m: ChatMsg; el: Element } | null>(null);
  function copy(m: ChatMsg) {
    const win = list.current!.ownerDocument.defaultView!; // 채팅분리 창이면 그 창의 클립보드
    const picked = win.getSelection()?.toString(); // PC 에서 글자 일부를 골라 둔 채 오른쪽 클릭했으면 고른 부분만
    win.navigator.clipboard?.writeText(picked || m.message).catch(() => alert("복사하지 못했어요."));
  }
  function pick(label: "복사" | "수정" | "삭제") {
    const m = menuAt!.m;
    setMenuAt(null);
    if (label === "복사") copy(m);
    else if (label === "수정") setEditing(m);
    else ask(m.id);
  }
  const editBox = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<ChatMsg | null>(null);
  useLayoutEffect(() => {
    if (editing) editBox.current?.showModal();
  }, [editing]);
  function saveEdit(text: string) {
    if (editing && text.trim() && text.trim() !== editing.message) edit(editing.id, text.trim());
    editBox.current?.close();
  }

  const hold = useHoldMenu();
  const openMenu = (m: ChatMsg) => (hasMenu(m) ? hold((el) => setMenuAt({ m, el })) : {});

  // 사진 크게 보기: 브라우저 기본 모달(dialog). ESC로 닫히는 것도 브라우저가 해 준다. 바깥 어두운 곳을 눌러도 닫힌다
  const viewer = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState<ChatMsg | null>(null);
  function openImage(m: ChatMsg) {
    setShown(m);
    viewer.current?.showModal();
  }

  // 맨 아래를 보고 있을 때만 새 글·늦게 뜬 사진·미리보기를 따라 내려간다.
  // 지난 글을 보려고 위로 올려 둔 동안에는 누가 글을 써도 그 자리 그대로 (내가 보낸 글이면 내려간다)
  const atBottom = useRef(true);
  const toBottom = useCallback(() => {
    const el = list.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, []);
  const lastMine = mineIds.includes(messages.at(-1)?.identity ?? "");
  useEffect(() => {
    if (lastMine) atBottom.current = true;
    toBottom();
  }, [messages.length, lastMine, toBottom]);

  return (
    <div
      ref={list}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
      data-chat-log // 입력칸의 "맨 아래로" 버튼이 이 목록을 찾는다 (ChatInput)
      className={`overflow-y-auto p-3 text-sm ${className}`}
    >
      {messages.map((m, i) => {
        const same = (o?: ChatMsg) => !!o && o.identity === m.identity && chatTime(o.timestamp) === chatTime(m.timestamp);
        const first = !same(messages[i - 1]);
        const last = !same(messages[i + 1]);
        const mine = mineIds.includes(m.identity);
        const link = m.message.match(LINK)?.[0];
        return (
          <div key={m.id} className={`flex gap-2 ${mine ? "justify-end" : ""} ${first ? "mt-3" : "mt-1"}`}>
            {!mine &&
              (first ? (
                <Avatar id={avatarOf(m.avatar)} px={52} className="size-10 shrink-0 md:size-13" />
              ) : (
                <div className="w-10 shrink-0 md:w-13" />
              ))}
            <div className={`flex max-w-[75%] min-w-0 flex-col ${mine ? "items-end" : "items-start"}`}>
              {first && !mine && <span className="mb-1 text-xs text-zinc-400">{m.name}</span>}
              <div className={`flex items-end gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
                {m.image ? (
                  // 사진 폭은 늘 240px (옆에 시간이 붙어도 사진이 줄지 않게 shrink-0). 아주 긴 사진은 위아래를 잘라 보여 준다.
                  // loading="lazy": 화면 가까이 왔을 때만 받는다 (늦게 들어온 사람이 지난 사진을 한꺼번에 다 받지 않게)
                  <button type="button" onClick={() => openImage(m)} {...openMenu(m)} className={`shrink-0 cursor-zoom-in ${hasMenu(m) ? NO_SELECT : ""}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.image} alt="보낸 사진" loading="lazy" onLoad={toBottom} className="max-h-72 w-60 rounded-2xl bg-zinc-800 object-cover" />
                  </button>
                ) : (
                  <p
                    {...openMenu(m)}
                    className={`${NO_SELECT} min-w-0 rounded-2xl px-3 py-2 break-words whitespace-pre-wrap ${
                      mine ? "bg-indigo-600" : "bg-zinc-800"
                    } ${first ? (mine ? "rounded-tr-sm" : "rounded-tl-sm") : ""}`}
                  >
                    {m.tts && (
                      // "/글" 음성 글: 앞의 작은 스피커를 누르면 다시 듣는다 (보낸 사람도). 처음엔 서버가 다시 읽느라 1초쯤 걸린다
                      <button
                        type="button"
                        onClick={() => playOnly(`/api/voice/${m.id}`).catch(() => {})}
                        aria-label="음성 다시 듣기"
                        data-tip="다시 듣기"
                        className="mr-1 inline-flex align-[-2px] opacity-70 hover:opacity-100"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-3.5">
                          <path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
                        </svg>
                      </button>
                    )}
                    <Linkified text={m.message} />
                  </p>
                )}
                {m.edited && <span className="shrink-0 text-[11px] text-zinc-500">수정됨</span>}
                {last && <span className="shrink-0 text-[11px] text-zinc-500">{chatTime(m.timestamp)}</span>}
              </div>
              {link && <LinkPreview url={link} onLoad={toBottom} />}
            </div>
          </div>
        );
      })}

      {/* 메시지 메뉴 */}
      <PopMenu at={menuAt?.el ?? null} onClose={() => setMenuAt(null)}>
        {menuAt && (
          <>
            {!menuAt.m.image && (
              <button type="button" onClick={() => pick("복사")} className={MENU_ITEM}>
                복사
              </button>
            )}
            {canEdit(menuAt.m) && (
              <button type="button" onClick={() => pick("수정")} className={MENU_ITEM}>
                수정
              </button>
            )}
            {canDelete(menuAt.m) && (
              <button type="button" onClick={() => pick("삭제")} className={`${MENU_ITEM} text-red-400`}>
                삭제
              </button>
            )}
          </>
        )}
      </PopMenu>

      {/* 글 고치기 (지우기 확인 창과 같은 모양). PC 는 Enter 로 저장, Shift+Enter 는 줄바꿈 */}
      <dialog
        ref={editBox}
        onClose={() => setEditing(null)}
        className="m-auto w-80 max-w-[calc(100%-2rem)] rounded-xl bg-zinc-800 p-5 text-zinc-100 ring-1 ring-zinc-700 backdrop:bg-black/60"
      >
        {editing && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit(new FormData(e.currentTarget).get("text") as string);
            }}
          >
            <p className="mb-3 text-center font-semibold">메시지 수정</p>
            <textarea
              name="text"
              defaultValue={editing.message}
              maxLength={CHAT_MAX}
              rows={4}
              autoFocus
              onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)} // 커서는 글 끝에
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                if (matchMedia("(pointer: coarse)").matches) return; // 휴대폰: 줄바꿈
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }}
              className="mb-4 block w-full resize-none rounded-xl bg-zinc-900 p-3 text-base outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex gap-2">
              <button className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold hover:bg-indigo-500">저장</button>
              <button type="button" onClick={() => editBox.current?.close()} className="flex-1 rounded-lg bg-zinc-700 py-2 text-sm hover:bg-zinc-600">
                취소
              </button>
            </div>
          </form>
        )}
      </dialog>

      {/* 지우기 확인 (채팅방 나가기 창과 같은 모양, 화면 가운데) */}
      <dialog
        ref={askDel}
        onClose={() => setDelTarget(null)}
        className="m-auto w-72 rounded-xl bg-zinc-800 p-5 text-zinc-100 ring-1 ring-zinc-700 backdrop:bg-black/60"
      >
        <p className="mb-10 text-center font-semibold">메시지를 삭제할까요?</p>
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (delTarget) remove(delTarget);
              askDel.current?.close();
            }}
            className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold hover:bg-red-500"
          >
            삭제
          </button>
          <button onClick={() => askDel.current?.close()} className="flex-1 rounded-lg bg-zinc-700 py-2 text-sm hover:bg-zinc-600">
            취소
          </button>
        </div>
      </dialog>

      <dialog
        ref={viewer}
        onClose={() => setShown(null)}
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
        className="m-auto max-h-none max-w-none overflow-visible bg-transparent p-0 outline-none backdrop:bg-black/80"
      >
        {shown?.image && (
          // 화면의 80% 안에 들어가게. 오른쪽 위에 저장, 닫기
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown.image} alt="보낸 사진 크게 보기" className="max-h-[80vh] max-w-[80vw] rounded-xl object-contain" />
            <div className="absolute top-2 right-2 flex gap-2">
              <a
                href={shown.image}
                download={`dolive-${shown.id.slice(-6)}.${shown.imageType?.split("/")[1]?.replace("jpeg", "jpg") ?? "png"}`}
                aria-label="사진 저장"
                className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-5">
                  <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                </svg>
              </a>
              <button
                type="button"
                onClick={() => viewer.current?.close()}
                aria-label="닫기"
                className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden className="size-5">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
});

// 맨 아래 항상 보이는 입력칸. 보낸 뒤에도 입력칸에 그대로 머물러 휴대폰 자판이 닫히지 않는다.
// 줄바꿈: PC는 Shift+Enter (Enter는 보내기), 휴대폰은 자판의 줄바꿈 키 (보내기는 비행기 버튼)
// 사진을 복사해서 입력칸에 붙여 넣거나(Ctrl+V) 왼쪽 + 버튼으로 고르면 입력칸 위에 작게 올려 두고, 보내기(비행기·Enter)를 눌러야 보낸다
export function ChatInput({
  send,
  sendImage,
  react,
  donate,
  className,
}: {
  send: (text: string) => void;
  sendImage: (f: File) => void;
  react: (kind: Reaction) => void;
  donate?: () => void;
  className: string;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // 붙여 넣고 아직 안 보낸 사진 (url: 입력칸 위에 보여 줄 작은 그림)
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);
  function dropPending() {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
  }
  function stage(file: File) {
    if (pending) URL.revokeObjectURL(pending.url); // 다시 고르면 새 사진으로 바꾼다
    setPending({ file, url: URL.createObjectURL(file) });
  }
  const filePicker = useRef<HTMLInputElement>(null);
  // 휴대폰은 사진 고르는 창이 열리면 브라우저가 전체화면을 풀어 버린다 (막을 방법이 없다).
  // 그래서 돌아와서 화면을 처음 누를 때 다시 전체화면으로 (브라우저는 사람이 누른 순간에만 전체화면을 허락한다)
  function pickFile() {
    const doc = box.current!.ownerDocument;
    if (doc.fullscreenElement === doc.documentElement) {
      const back = () => {
        if (!doc.fullscreenElement) doc.documentElement.requestFullscreen?.().catch(() => {});
      };
      doc.addEventListener("pointerup", back, { once: true });
    }
    filePicker.current?.click();
  }

  // 휴대폰에서 뒤로가기로 자판만 닫으면 입력칸이 선택된 채(커서 깜빡임) 남아서, 자판이 내려가면 선택도 푼다.
  // 자판이 내려가면 보이는 화면 높이가 확 늘어나는 걸로 안다 (자판 위 추천 단어 줄이 생기고 없어지는 정도는 무시)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !isPhone()) return;
    let last = vv.height;
    const onResize = () => {
      if (vv.height - last > 100 && document.activeElement === box.current) box.current?.blur();
      last = vv.height;
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // 채팅 목록을 위로 올려 보고 있으면 보내기 버튼 바로 위에 "맨 아래로" 버튼 (카카오톡처럼).
  // 목록은 같은 문서(채팅분리 창이면 그 창)에 하나뿐이라 찾아서 쓴다
  const log = useRef<HTMLElement | null>(null);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = (log.current = box.current!.ownerDocument.querySelector<HTMLElement>("[data-chat-log]"));
    if (!el) return;
    const onScroll = () => setAway(el.scrollHeight - el.scrollTop - el.clientHeight >= 60);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // 하트 버튼을 누르면 헐·ㅋ·하트 버튼이 위로 펼쳐지고, 다시 누르면 접힌다
  const [picking, setPicking] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  // 펼쳐져 있을 때 버튼 말고 다른 곳을 눌러도 접힌다 (채팅분리 창에서도 되게 그 창의 문서에 단다)
  useEffect(() => {
    if (!picking) return;
    const doc = picker.current!.ownerDocument;
    const close = (e: PointerEvent) => {
      if (!picker.current?.contains(e.target as Node)) setPicking(false);
    };
    doc.addEventListener("pointerdown", close);
    return () => doc.removeEventListener("pointerdown", close);
  }, [picking]);

  // 글이 길어지면 입력칸이 4줄까지 늘어난다 (그 뒤로는 칸 안에서 밀어서 본다)
  useEffect(() => {
    const t = box.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, [text]);

  function submit() {
    if (pending) {
      sendImage(pending.file);
      dropPending();
    }
    if (text.trim()) {
      send(text.trim());
      setText("");
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      // 아래 여백: 브라우저 맨 아래에 붙지 않게 (아이폰 홈 바 자리도 비움)
      // --down-gap: "맨 아래로" 버튼과 경계선 사이. 휴대폰은 경계선(위 테두리 1px)을 사이에 두고 보내기 버튼과 위아래 대칭 (위 여백 12px + 선 1px)
      className={`${className} relative flex shrink-0 items-end gap-2 border-t border-zinc-800 px-3 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {pending && (
          <div className="relative w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pending.url} alt="보낼 사진" className="max-h-28 rounded-xl" />
            <button
              type="button"
              onClick={dropPending}
              onPointerDown={(e) => e.preventDefault()}
              aria-label="사진 빼기"
              data-tip="사진 빼기"
              className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/70 hover:bg-black"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden className="size-3.5">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        )}
        <div className="relative">
          <textarea
            ref={box}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
              if (!file) return; // 사진이 아니면 평소처럼 글자 붙여넣기
              e.preventDefault();
              stage(file);
            }}
            onKeyDown={(e) => {
              // 한글을 조합하는 중에 누른 Enter는 건너뛴다 (안 그러면 마지막 글자가 한 번 더 보내진다)
              if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
              if (matchMedia("(pointer: coarse)").matches) return; // 휴대폰: 줄바꿈
              e.preventDefault();
              submit();
            }}
            maxLength={CHAT_MAX}
            placeholder="메시지 입력"
            className="block max-h-32 w-full resize-none rounded-3xl bg-zinc-800 py-3 pr-14 pl-12 text-base leading-6 outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-inset"
          />
          {/* 입력칸 왼쪽 안쪽 + 버튼: 사진 파일 고르기. 동그라미는 30px, 입력칸(48px) 세로 가운데 */}
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={pickFile}
            aria-label="사진 올리기"
            data-tip="사진 올리기"
            className="absolute bottom-[9px] left-[9px] flex size-7.5 items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden className="size-4">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <input
            ref={filePicker}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // 같은 사진을 다시 골라도 알 수 있게
              if (file) stage(file);
            }}
          />
          {/* 입력칸 오른쪽 안쪽 하트 버튼. 누르면 헐·ㅋ·하트가 위로 하나씩 펼쳐진다 (위에서부터 헐, ㅋ, 하트) */}
          <div ref={picker} className="pointer-events-none absolute right-1 bottom-1 flex flex-col items-center gap-2">
            {donate && <button type="button" tabIndex={picking ? 0 : -1} aria-label="도름네이션" aria-hidden={!picking} onClick={() => { setPicking(false); donate(); }} className={`flex size-10 items-center justify-center rounded-full bg-zinc-700 ring-1 ring-zinc-600 hover:bg-zinc-600 ${picking ? "pointer-events-auto" : "hidden"}`}><DonationFace /></button>}
            {(
              [
                ["hul", "헐 날리기", <span key="hul" className={STICKER_TEXT.hul}>헐</span>],
                ["k", "ㅋ 날리기", <span key="k" className={STICKER_TEXT.k}>ㅋ</span>],
                ["heart", "하트 날리기", <Heart key="h" className="size-5 text-red-500" />],
              ] as const
            ).map(([kind, label, face], i) => (
              <button
                key={kind}
                type="button"
                tabIndex={picking ? 0 : -1}
                onPointerDown={(e) => e.preventDefault()} // 눌러도 입력칸에서 손이 안 떨어지게 (휴대폰 자판이 닫히지 않게)
                onClick={() => react(kind)}
                aria-label={label}
                aria-hidden={!picking}
                // 접혀 있을 땐 하트 버튼 자리로 들어가 숨는다. 아래쪽(하트 버튼에 가까운 것)부터 차례로 펼쳐진다
                style={{ transitionDelay: `${(picking ? 2 - i : i) * 40}ms`, translate: picking ? undefined : `0 ${(3 - i) * 3}rem` }}
                className={`flex size-10 items-center justify-center rounded-full bg-zinc-700 text-lg font-black text-amber-300 ring-1 ring-zinc-600 transition-[translate,opacity,scale] duration-200 ease-out hover:bg-zinc-600 ${
                  picking ? "pointer-events-auto" : "scale-50 opacity-0"
                }`}
              >
                {face}
              </button>
            ))}
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setPicking(!picking)}
              aria-expanded={picking}
              aria-label="감정 스티커"
              data-tip="감정 스티커"
              // 동그라미는 30px. 펼쳐지는 스티커(40px) 줄 가운데에 서고, 아래를 5px 띄워 입력칸 세로 가운데에 맞춘다
              className={`pointer-events-auto mb-[5px] flex size-7.5 items-center justify-center rounded-full hover:bg-zinc-600 ${picking ? "bg-zinc-600" : "bg-zinc-700"}`}
            >
              <Heart className="size-4 text-red-500" />
            </button>
          </div>
        </div>
      </div>
      {away && (
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()} // 눌러도 입력칸에서 손이 안 떨어지게 (휴대폰 자판이 닫히지 않게)
          onClick={() => log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" })}
          aria-label="맨 아래로"
          data-tip="맨 아래로"
          // 보내기 버튼과 같은 크기·같은 세로줄(right-3 = 입력줄 오른쪽 여백)
          className="absolute right-3 bottom-[calc(100%+var(--down-gap,13px))] flex size-12 items-center justify-center rounded-full bg-zinc-700 shadow-lg shadow-black/40 ring-1 ring-zinc-600 hover:bg-zinc-600"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-6">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      )}
      <button
        type="submit"
        disabled={!text.trim() && !pending}
        onPointerDown={(e) => e.preventDefault()} // 눌러도 입력칸에서 손이 안 떨어지게
        aria-label="보내기"
        data-tip="보내기"
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40"
      >
        {/* 위로 날아오르는 종이비행기 */}
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-[22px] translate-x-px -translate-y-px -rotate-[35deg]">
          <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </button>
    </form>
  );
}
