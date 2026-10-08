import { TrackSource } from "livekit-server-sdk";
import { endRoom } from "@/lib/chat";
import { canEditRoom, dormsCheck, findRoom, isLocal, roomDeny, roomList, rooms, saveFixedRooms, userRooms, type RoomDef } from "@/lib/server";

// 방송 목록: 방 이름, 비밀번호 방인지, 비회원도 들어오는지, 방송 중인지(ON AIR), 내가 고칠 수 있는 방인지.
// ON AIR = 그 방의 방장(마스터·운영진·만든 사람)이 들어와 있거나 누가 화면공유 중. 비밀번호는 고칠 수 있는 사람(만든 사람·마스터)에게만 보낸다
export async function GET(req: Request) {
  const { user } = await dormsCheck(req);
  const list = await Promise.all(
    roomList().map(async (r) => {
      const people = await rooms.listParticipants(r.name).catch(() => []); // 아직 아무도 안 들어온 방은 통화 서버에 없다
      const onAir = people.some((p) => p.attributes?.roomAdmin === "1" || p.tracks.some((t) => t.source === TrackSource.SCREEN_SHARE && !t.muted));
      const canEdit = canEditRoom(req, user, r);
      return { name: r.name, locked: !!r.password, guest: r.guest, onAir, canEdit, ...(canEdit ? { password: r.password } : {}) };
    }),
  );
  return Response.json(list, { headers: { "cache-control": "no-store" } });
}

// 비밀번호 확인 { room, password }: 입장 화면 비밀번호 창이 [입장] 전에 묻는다 (틀리면 창에서 바로 알려 주려고).
// 진짜 문은 입장권(api/token)이 다시 확인한다
export async function POST(req: Request) {
  const { room, password } = await req.json().catch(() => ({}));
  const { deny } = await dormsCheck(req);
  if (deny && !(deny.status === 401 && findRoom(room)?.guest)) return deny;
  return roomDeny(room, password, false) ?? new Response(null, { status: 204 });
}

// 방 이름·비밀번호·비회원 허용을 읽어서 고친다. 이름은 1~40자, 탭·줄바꿈 없이, 다른 방과 겹치지 않게
async function readRoom(req: Request, except?: string): Promise<RoomDef | Response> {
  const { name, password, guest } = await req.json().catch(() => ({}));
  const n = typeof name === "string" ? name.trim() : "";
  const pw = typeof password === "string" ? password : "";
  if (!n || n.length > 40 || /[\t\r\n]/.test(n + pw) || pw.length > 40) return Response.json({ error: "방 이름을 확인해 주세요" }, { status: 400 });
  if (n !== except && roomList().some((r) => r.name.toLowerCase() === n.toLowerCase()))
    return Response.json({ error: "같은 이름의 방이 있어요", reason: "taken" }, { status: 409 });
  return { name: n, password: pw, guest: guest === true };
}

// 방 만들기 { name, password, guest }: 마스터가 만들면 고정 방(파일에 남는다, 개수 제한 없음),
// 도름스 회원이 만들면 그 사람의 방 (한 사람에 하나, 모두 나가면 없어진다). 비회원은 못 만든다
export async function PUT(req: Request) {
  const { user, deny } = await dormsCheck(req);
  if (deny) return deny;
  const local = isLocal(req);
  if (!local && userRooms.some((r) => r.owner === user!.id))
    return Response.json({ error: "방은 한 사람에 하나만 만들 수 있어요", reason: "limit" }, { status: 409 });
  const r = await readRoom(req);
  if (r instanceof Response) return r;
  if (local) {
    saveFixedRooms([...roomList().filter((x) => !x.owner), r]);
  } else {
    userRooms.push({ ...r, owner: user!.id });
    // 만들고 아무도 안 들어오면(입장 실패 등) 2분 뒤 치운다. 들어온 뒤에는 모두 나갈 때 치운다 (api/livekit)
    setTimeout(async () => {
      const people = await rooms.listParticipants(r.name).catch(() => []);
      if (!people.length && userRooms.find((x) => x.name === r.name)?.owner === user!.id) userRooms.splice(userRooms.findIndex((x) => x.name === r.name), 1);
    }, 120_000).unref?.();
  }
  return new Response(null, { status: 201 });
}

// 방 고치기 { room, name, password, guest }: 만든 사람은 자기 방, 마스터는 모든 방. 이름을 바꾸면 옛 이름 방은 닫는다 (안에 있던 사람은 나가진다)
export async function PATCH(req: Request) {
  const { user, deny } = await dormsCheck(req);
  if (deny) return deny;
  const old = findRoom(new URL(req.url).searchParams.get("room"));
  if (!old) return Response.json({ error: "없는 방송이에요", reason: "no_room" }, { status: 404 });
  if (!canEditRoom(req, user, old)) return new Response(null, { status: 403 });
  const r = await readRoom(req, old.name);
  if (r instanceof Response) return r;
  const before = old.name;
  if (old.owner) Object.assign(old, r); // (사람들이 만든 방은 목록에 있는 그 방을 바로 고친다)
  else saveFixedRooms(roomList().filter((x) => !x.owner).map((x) => (x.name === before ? r : x)));
  if (r.name !== before) await endRoom(before);
  return new Response(null, { status: 204 });
}

// 방 지우기 (?room=): 만든 사람은 자기 방, 마스터는 모든 방. 안에 있던 사람은 바로 나가진다
export async function DELETE(req: Request) {
  const { user, deny } = await dormsCheck(req);
  if (deny) return deny;
  const r = findRoom(new URL(req.url).searchParams.get("room"));
  if (!r) return new Response(null, { status: 204 });
  if (!canEditRoom(req, user, r)) return new Response(null, { status: 403 });
  if (r.owner) userRooms.splice(userRooms.indexOf(userRooms.find((x) => x.name === r.name)!), 1);
  else saveFixedRooms(roomList().filter((x) => !x.owner && x.name !== r.name));
  await endRoom(r.name);
  return new Response(null, { status: 204 });
}
