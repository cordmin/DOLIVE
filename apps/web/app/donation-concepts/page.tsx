import { notFound } from "next/navigation";
import { DONATION_STYLES } from "@/components/DonationMascot";
export const dynamic = "force-dynamic";
export default function Concepts() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main className="mx-auto w-full max-w-[1920px] p-6 text-zinc-200">
    <h1 className="text-2xl font-bold">도름네이션에 사용할 네 가지 모습</h1>
    <p className="mt-2 mb-6 text-sm text-zinc-400">보내기가 성공할 때마다 한 모습을 무작위로 골라요. <a href="/donation-preview" className="text-[#e8b46a] underline">섞여 내려오는 모습 보기</a></p>
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{DONATION_STYLES.map(({ name, id }) => {
      const src = `/doreumi/donation/${id}.webp`;
      return <a key={name} href={src} target="_blank" rel="noopener noreferrer" className="overflow-hidden rounded-xl border border-zinc-700/60 bg-[#1e1e21] transition hover:border-amber-400/70 focus:outline-2 focus:outline-amber-400">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${id}번 ${name} 도름네이션 시안`} width={512} height={512} className="aspect-square w-full object-contain" />
        <div className="flex items-center gap-3 px-4 py-3"><span className="font-bold text-[#e8b46a]">{id}</span><h2 className="font-medium">{name}</h2></div>
      </a>;
    })}</div>
    <p className="mt-5 text-xs text-zinc-500">도름이 원본 © 아인T, CC BY-NC 4.0 · 원본을 참고해 만든 그림 시안</p>
  </main>;
}
