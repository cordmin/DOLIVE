import { headers } from "next/headers";
import { requireDormsUser } from "@/lib/dormsLogin";
import { isLocal } from "@/lib/server";

// 채팅방은 도름스 회원만 (서버 PC는 빼고). 로그인 안 했으면 도름스 로그인 뒤 이 방으로 돌아오고,
// 허용이 끊겼거나 도름스 연결이 안 되면 안내 화면(app/dorms-denied)으로 간다.
// 진짜 문은 입장권(api/token)과 채팅(api/chat)에서 매번 다시 확인한다
export default async function RoomLayout({ children }: { children: React.ReactNode }) {
  if (!isLocal({ headers: await headers() })) await requireDormsUser({ next: "/room" });
  return children;
}
