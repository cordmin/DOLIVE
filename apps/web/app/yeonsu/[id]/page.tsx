import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DormsAuthError, getDormsUser } from "@/lib/dormsLogin";
import { isLocal } from "@/lib/server";
import { askYeonsuEntry, isYeonsuId, kstTime, registerYeonsuRoom, yeonsuRoomName } from "@/lib/yeonsu";
import { EnterYeonsu } from "./enter";

export const dynamic = "force-dynamic";

// 도름스 연수 방 입장 화면 (/yeonsu/<연수 id>). 도름스 연수 소개의 'DoLive 방 들어가기'가 여기로 온다.
// 도름스 로그인 → 도름스에 이 연수에 들어와도 되는지 묻기 → 되면 [연수 방 들어가기], 안 되면 까닭을 알려 준다.
// 신청하지 않은 선생님도 지금 열린 연수면 들어온다 (lib/yeonsu.ts askYeonsuEntry, 2026-10-20 사용자 지시).
// 들어가는 진짜 문은 입장권(api/token)이 도름스에 한 번 더 묻는다.
const DENY: Record<string, { title: string; text: string }> = {
  not_found: { title: "닫혔거나 없는 연수예요", text: "도름스 연수 일정에서 연수가 그대로 있는지 확인해 주세요." },
  not_applied: { title: "신청한 선생님만 들어올 수 있어요", text: "도름스 연수 일정에서 이 연수를 신청해 주세요. 신청이 확정되면 들어올 수 있어요." },
  not_confirmed: { title: "아직 신청이 확정되지 않았어요", text: "여는 선생님이 승인하면 도름스 알림으로 알려 드려요. 그 뒤에 다시 들어와 주세요." },
  blocked: { title: "지금은 이 연수에 들어올 수 없어요", text: "계정 상태나 연수 입장 범위가 바뀌었어요. 궁금한 점은 여는 선생님께 도름스 쪽지로 물어 주세요." },
  ended: { title: "끝난 연수예요", text: "다음 연수는 도름스 연수 일정에서 찾아보세요." },
  unavailable: { title: "잠시 뒤 다시 들어와 주세요", text: "도름스에서 이 연수에 들어올 수 있는지 확인하지 못했어요." },
};

const box = { maxWidth: 480, margin: "0 auto", padding: "48px 20px", wordBreak: "keep-all", overflowWrap: "anywhere" } as const;
const back = { display: "inline-flex", minHeight: 44, alignItems: "center", padding: "10px 16px", borderRadius: 10, border: "1px solid #52525b", color: "#e4e4e7", textDecoration: "none", fontWeight: 600 } as const;

export default async function YeonsuEntry({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isYeonsuId(id)) notFound();
  const dormsHref = `https://dorms.school/learn/yeonsu?id=${id}`;
  const next = `/yeonsu/${id}`;
  // 서버 PC(마스터)는 확인 없이 들어간다 (다른 방과 같다)
  const local = isLocal({ headers: await headers() });
  let user;
  try {
    user = local ? null : await getDormsUser();
  } catch (e) {
    if (!(e instanceof DormsAuthError)) throw e;
    redirect(`/dorms-denied?reason=${e.reason}&next=${encodeURIComponent(next)}`);
  }
  // 도름스에서 링크를 누르고 왔으니 로그인부터 이어서 한다 (도름스에 로그인돼 있으면 묻지 않고 돌아온다)
  if (!local && !user) redirect(`/api/auth/dorms/start?next=${encodeURIComponent(next)}`);

  const room = yeonsuRoomName(id);
  if (local) {
    return (
      <main style={box}>
        <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>도름스 연수 방</h1>
        <EnterYeonsu room={room} name="마스터" picture={null} />
      </main>
    );
  }
  const v = await askYeonsuEntry(id, user!.id);
  if (!v.ok) {
    const opens = v.reason === "too_early" ? kstTime(v.opensAt) : "";
    const message = v.reason === "too_early"
      ? { title: "아직 들어갈 수 없어요", text: `연수 시작 10분 전${opens ? `인 ${opens}` : ""}부터 들어올 수 있어요. 그때 이 화면을 새로 고쳐 주세요.` }
      : DENY[v.reason] ?? DENY.unavailable;
    return (
      <main style={box}>
        {v.title ? <p style={{ fontSize: 14, color: "#a1a1aa", margin: "0 0 6px" }}>{v.title}</p> : null}
        <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>{message.title}</h1>
        <p style={{ fontSize: 15, lineHeight: 1.7, margin: "0 0 20px", color: "#d4d4d8" }}>{message.text}</p>
        <a href={dormsHref} style={back}>도름스 연수 일정으로</a>
      </main>
    );
  }
  registerYeonsuRoom(room, { title: v.title, owner: v.hostId, endsAt: v.endsAt });
  const name = (user!.name || user!.handle || "선생님").trim().slice(0, 20);
  return (
    <main style={box}>
      <p style={{ fontSize: 14, color: "#a1a1aa", margin: "0 0 6px" }}>도름스 연수 · {kstTime(v.startsAt)} – {kstTime(v.endsAt)}</p>
      <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>{v.title}</h1>
      <p style={{ fontSize: 15, lineHeight: 1.7, margin: "0 0 24px", color: "#d4d4d8" }}>
        {v.role === "host"
          ? "내가 여는 연수예요. 들어가면 이 방의 방장이에요. 도름스 선생님이면 누구나 들어올 수 있어요."
          : `${v.hostName} 선생님의 연수예요. 바로 들어갈 수 있어요.`}
      </p>
      <EnterYeonsu room={room} name={name} picture={user!.picture?.startsWith("https://") ? user!.picture : null} />
      <p style={{ marginTop: 16 }}><a href={dormsHref} style={{ color: "#a1a1aa" }}>도름스 연수 소개 보기</a></p>
    </main>
  );
}
