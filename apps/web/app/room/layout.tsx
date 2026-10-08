import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DormsAuthError, getDormsUser } from "@/lib/dormsLogin";
import { isLocal } from "@/lib/server";

// 채팅방은 도름스 회원만 (서버 PC는 빼고, 비회원은 "비회원도" 방만).
// (여기서 도름스 로그인으로 보내면, 도름스에 로그인돼 있는 브라우저는 묻지 않고 다시 로그인돼서 로그아웃이 풀린다. 로그인은 입장 화면 [로그인]으로만).
// 허용이 끊겼거나 도름스 연결이 안 되면 안내 화면(app/dorms-denied)으로 간다.
// 진짜 문은 입장권(api/token)과 채팅(api/chat)에서 매번 다시 확인한다
export default async function RoomLayout({ children }: { children: React.ReactNode }) {
  if (isLocal({ headers: await headers() })) return children;
  // 로그인 안 한 사람(비회원)도 일단 들인다. "비회원도" 방이 아니면 입장권(api/token)이 막아서 입장 화면으로 돌아간다
  try {
    await getDormsUser();
  } catch (e) {
    if (!(e instanceof DormsAuthError)) throw e;
    redirect(`/dorms-denied?reason=${e.reason}&next=/room`);
  }
  return children;
}
