import { notFound } from "next/navigation";
import { isYeonsuSlug } from "@/lib/yeonsu";
import { YeonsuEntryScreen } from "../yeonsu/screen";

// 연수 방 주소 dolive.site/<짧은 연수 번호> (연수 id 앞 8자). 도름스 연수 소개의 링크와 입장 화면 목록이 이 주소를 쓴다.
// 방에 들어가도 이 주소가 주소창에 그대로 남는다 (app/yeonsu/screen.tsx 가 그 자리에서 방 화면을 그린다).
// 연수 번호 모양이 아닌 주소는 없는 쪽(404)으로 보낸다. 정해진 주소(/room, /profile/…, /yeonsu/… )가 먼저다.
export const dynamic = "force-dynamic";

export default async function YeonsuShort({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isYeonsuSlug(slug)) notFound();
  return <YeonsuEntryScreen sessionRef={slug.toLowerCase()} />;
}
