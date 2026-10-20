import { TrackSource } from "livekit-server-sdk";
import { endRoom } from "@/lib/chat";
import { MAX_ROOMS } from "@/lib/dolive";
import { canEditRoom, dormsCheck, findRoom, isLocal, roomDeny, roomList, rooms, saveRooms } from "@/lib/server";
import { liveYeonsuRooms, yeonsuRoomName, yeonsuSlug } from "@/lib/yeonsu";

// 방송 목록: 방 이름, 비밀번호 방인지, 비회원도 들어오는지, 방송 중인지(ON AIR), 내가 고칠 수 있는 방인지.
// ON AIR = 그 방의 방장(마스터·관리자·만든 사람)이 들어와 있거나 누가 화면공유 중. 비밀번호는 고칠 수 있는 사람(만든 사람·관리자·마스터)에게만 보낸다
// 지금 열린 도름스 연수 방(lib/yeonsu.ts liveYeonsuRooms)도 함께 보낸다: 방 만들기 4개 제한과 별개이고, 고치거나 지울 수 없고,
// 입장은 연수 입장 화면(/<짧은 연수 번호>)이 도름스에 사람마다 다시 물어 판정한다 (yeonsu 칸이 그 주소를 들고 있다).
// 끝 시각이 지난 연수는 아직 사람이 남아 있을 때만 목록에 둔다: 연수가 길어져 이어 하는 방은 계속 보이고, 다 끝난 연수는 목록에서 빠진다.
export async function GET(req: Request) {
  const { user } = await dormsCheck(req);
  const peopleOf = (name: string) => rooms.listParticipants(name).catch(() => []); // 아직 아무도 안 들어온 방은 통화 서버에 없다
  const isOnAir = (people: Awaited<ReturnType<typeof peopleOf>>) =>
    people.some((p) => p.attributes?.roomAdmin === "1" || p.tracks.some((t) => t.source === TrackSource.SCREEN_SHARE && !t.muted));
  const [made, yeonsu] = await Promise.all([
    Promise.all(
      roomList().map(async (r) => {
        const canEdit = canEditRoom(req, user, r);
        return { name: r.name, locked: !!r.password, guest: r.guest, onAir: isOnAir(await peopleOf(r.name)), canEdit, ...(canEdit ? { password: r.password } : {}) };
      }),
    ),
    liveYeonsuRooms()
      .then((list) =>
        Promise.all(
          list.map(async (r) => {
            const people = await peopleOf(yeonsuRoomName(r.id));
            // 끝난 연수는 아직 남아 있는 사람이 있을 때만 (연수가 길어져 이어 하는 중)
            if (!(Date.parse(r.endsAt) > Date.now()) && !people.length) return null;
            return {
              name: r.title,
              locked: false,
              guest: false,
              onAir: isOnAir(people),
              canEdit: false,
              yeonsu: { id: r.id, href: `/${yeonsuSlug(r.id)}`, hostName: r.hostName, startsAt: r.startsAt, endsAt: r.endsAt, access: r.access },
            };
          }),
        ).then((all) => all.filter((r): r is NonNullable<typeof r> => r !== null)),
      )
      .catch(() => []),
  ]);
  return Response.json([...made, ...yeonsu], { headers: { "cache-control": "no-store" } });
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
async function readRoom(req: Request, except?: string) {
  const { name, password, guest } = await req.json().catch(() => ({}));
  const n = typeof name === "string" ? name.trim() : "";
  const pw = typeof password === "string" ? password : "";
  if (!n || n.length > 40 || /[\t\r\n]/.test(n + pw) || pw.length > 40) return Response.json({ error: "방 이름을 확인해 주세요" }, { status: 400 });
  if (n !== except && roomList().some((r) => r.name.toLowerCase() === n.toLowerCase()))
    return Response.json({ error: "같은 이름의 방이 있어요", reason: "taken" }, { status: 409 });
  return { name: n, password: pw, guest: guest === true };
}

// 방 만들기 { name, password, guest }: 마스터가 만들면 고정 방(개수 제한 없음), 도름스 회원(관리자 포함)이 만들면 그 사람의 방 (한 사람에 하나).
// 비회원은 못 만든다. 만든 방은 지우기 전까지 남는다. 방송은 모두 합쳐 MAX_ROOMS 개까지 (마스터도)
export async function PUT(req: Request) {
  const { user, deny } = await dormsCheck(req);
  if (deny) return deny;
  const local = isLocal(req);
  if (roomList().length >= MAX_ROOMS) return Response.json({ error: `방송은 최대 ${MAX_ROOMS}개까지만 지원합니다`, reason: "full" }, { status: 409 });
  if (!local && roomList().some((r) => r.owner === user!.id))
    return Response.json({ error: "방은 한 사람에 하나만 만들 수 있어요", reason: "limit" }, { status: 409 });
  const r = await readRoom(req);
  if (r instanceof Response) return r;
  saveRooms([...roomList(), { ...r, owner: local ? "" : user!.id }]);
  return new Response(null, { status: 201 });
}

// 방 고치기 (?room=, { name, password, guest }): 만든 사람은 자기 방, 관리자·마스터는 모든 방. 이름을 바꾸면 옛 이름 방은 닫는다 (안에 있던 사람은 나가진다)
export async function PATCH(req: Request) {
  const { user, deny } = await dormsCheck(req);
  if (deny) return deny;
  const old = findRoom(new URL(req.url).searchParams.get("room"));
  if (!old) return Response.json({ error: "없는 방송이에요", reason: "no_room" }, { status: 404 });
  if (!canEditRoom(req, user, old)) return new Response(null, { status: 403 });
  const r = await readRoom(req, old.name);
  if (r instanceof Response) return r;
  saveRooms(roomList().map((x) => (x.name === old.name ? { ...r, owner: old.owner } : x)));
  if (r.name !== old.name) await endRoom(old.name);
  return new Response(null, { status: 204 });
}

// 방 지우기 (?room=): 만든 사람은 자기 방, 관리자·마스터는 모든 방. 안에 있던 사람은 바로 나가진다
export async function DELETE(req: Request) {
  const { user, deny } = await dormsCheck(req);
  if (deny) return deny;
  const r = findRoom(new URL(req.url).searchParams.get("room"));
  if (!r) return new Response(null, { status: 204 });
  if (!canEditRoom(req, user, r)) return new Response(null, { status: 403 });
  saveRooms(roomList().filter((x) => x.name !== r.name));
  await endRoom(r.name);
  return new Response(null, { status: 204 });
}
