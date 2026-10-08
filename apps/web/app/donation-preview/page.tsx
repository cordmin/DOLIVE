import { notFound } from "next/navigation";
import { Floats, type Float } from "../room/reactions";
import { randomInt } from "node:crypto";
import { DONATION_STYLES } from "@/components/DonationMascot";
export const dynamic = "force-dynamic";
export default function Preview() {
  if (process.env.NODE_ENV !== "development") notFound();
  const floats: Float[] = Array.from({ length: 10 }, (_, i) => ({ id: i, kind: "donation", x: 13 + i * 7.2, delay: -4 + i * 0.12,
    variant: DONATION_STYLES[randomInt(DONATION_STYLES.length)].id, sway: 3 + randomInt(150) / 100, phase: randomInt(300) / 100 }));
  return <main className="w-full p-6 text-zinc-200"><style>{'.donation-preview [class*="donation-fall"] { animation-iteration-count: infinite; }'}</style><h1 className="mb-2 text-lg font-bold">도름네이션 · 네 가지 도름이가 무작위로 내려와요</h1><p className="mb-4 text-sm text-zinc-400">입체 고급형 · 투명 우산 · 애니메이션 · 가을 나뭇잎. 새로고침하면 다시 섞여요.</p><div className="donation-preview relative h-[78vh] w-full overflow-hidden rounded-xl bg-[#1e1e21] hw-inset"><Floats floats={floats} /></div><p className="mt-3 text-sm text-zinc-400">그림 확인용 열 마리예요. 실제 도름은 보내지 않았어요. 도름이 © 아인T, CC BY-NC 4.0</p></main>;
}
