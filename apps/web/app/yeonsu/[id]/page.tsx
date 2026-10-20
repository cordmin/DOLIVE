import { notFound } from "next/navigation";
import { isYeonsuId } from "@/lib/yeonsu";
import { YeonsuEntryScreen } from "../screen";

// 예전에 나눠 준 연수 방 주소 /yeonsu/<연수 id>. 그대로 열린다 (새 주소는 dolive.site/<짧은 번호>, app/[slug]).
export const dynamic = "force-dynamic";

export default async function YeonsuEntry({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isYeonsuId(id)) notFound();
  return <YeonsuEntryScreen sessionRef={id} />;
}
