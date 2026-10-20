import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DormsAuthError, getDormsUser } from "@/lib/dormsLogin";
import { isLocal } from "@/lib/server";
import { askYeonsuEntry, kstTime, liveYeonsuRooms, registerYeonsuRoom, yeonsuIdOfRef, yeonsuRefKind, yeonsuRoomName, yeonsuSlug, type YeonsuVerdict } from "@/lib/yeonsu";
import { EnterYeonsu } from "./enter";

// 도름스 연수 방 입장 화면. 주소는 두 가지이고 둘 다 이 화면을 쓴다.
//  - dolive.site/<짧은 연수 번호>  (app/[slug]) : 도름스 연수 소개의 'DoLive 방 들어가기'와 입장 화면 목록이 쓰는 주소
//  - dolive.site/yeonsu/<연수 id>  (app/yeonsu/[id]) : 예전에 나눠 준 주소. 그대로 열린다
// 도름스 로그인 → 도름스에 이 연수에 들어와도 되는지 묻기 → 되면 그 자리에서 방 화면을 그린다(주소가 그대로 남는다), 안 되면 까닭을 알려 준다.
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

// sessionRef: 연수 id 또는 주소에 쓰는 짧은 연수 번호(앞 8자)
export async function YeonsuEntryScreen({ sessionRef }: { sessionRef: string }) {
  const full = yeonsuRefKind(sessionRef) === "id";
  const dormsHref = full ? `https://dorms.school/learn/yeonsu?id=${sessionRef}` : "https://dorms.school/learn/yeonsu";
  const next = full ? `/yeonsu/${sessionRef}` : `/${sessionRef.toLowerCase()}`;
  // 서버 PC(마스터)는 확인 없이 들어간다 (다른 방과 같다). 짧은 번호로는 연수 id 를 알 수 없어 옛 주소로만 들어간다
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

  if (local) {
    // 짧은 번호로 왔으면 지금 열린 연수 목록에서 그 연수를 찾는다
    const mine = full ? sessionRef.toLowerCase() : (await liveYeonsuRooms()).find((r) => yeonsuSlug(r.id) === sessionRef.toLowerCase())?.id;
    if (mine) return <EnterYeonsu room={yeonsuRoomName(mine)} name="마스터" picture={null} />;
  }
  const v: YeonsuVerdict = local ? { ok: false, reason: "not_found" } : await askYeonsuEntry(sessionRef, user!.id);
  const id = local ? null : await yeonsuIdOfRef(sessionRef, v);
  if (!v.ok || !id) {
    const opens = v.ok ? "" : v.reason === "too_early" ? kstTime(v.opensAt) : "";
    const message = !v.ok && v.reason === "too_early"
      ? { title: "아직 들어갈 수 없어요", text: `연수 시작 10분 전${opens ? `인 ${opens}` : ""}부터 들어올 수 있어요. 그때 이 화면을 새로 고쳐 주세요.` }
      : (!v.ok && DENY[v.reason]) || DENY.unavailable;
    return (
      <main style={box}>
        {!v.ok && v.title ? <p style={{ fontSize: 14, color: "#a1a1aa", margin: "0 0 6px" }}>{v.title}</p> : null}
        <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>{message.title}</h1>
        <p style={{ fontSize: 15, lineHeight: 1.7, margin: "0 0 20px", color: "#d4d4d8" }}>{message.text}</p>
        <a href={dormsHref} style={back}>도름스 연수 일정으로</a>
      </main>
    );
  }
  const room = yeonsuRoomName(id);
  registerYeonsuRoom(room, { title: v.title, owner: v.hostId, endsAt: v.endsAt });
  const name = (user!.name || user!.handle || "선생님").trim().slice(0, 20);
  return <EnterYeonsu room={room} name={name} picture={user!.picture?.startsWith("https://") ? user!.picture : null} />;
}
