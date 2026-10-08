import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";

function Icon({ type, off = false, small = false }: { type: "full" | "shrink" | "tts" | "mic"; off?: boolean; small?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={small ? "size-[17px]" : "size-7"}>
    {type === "full" && <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />}
    {type === "shrink" && <path d="M3 8h5V3M16 3v5h5M21 16h-5v5M8 21v-5H3" />}
    {type === "tts" && <path d="M3 5h9M7.5 5v14M16 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12" />}
    {type === "mic" && <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>}
    {off && <path d="M20 4 4 20" stroke="#ffffff" strokeWidth="2.2" />}
  </svg>;
}
function Control({ type, off = false, large = false }: { type: "full" | "shrink" | "tts" | "mic"; off?: boolean; large?: boolean }) {
  const ring = type === "tts" || type === "mic";
  return <span className={`hw-cap shrink-0 ${large ? "size-16!" : "size-[34px]!"}`} style={ring ? { outline: `1px solid ${off ? "#e42b20" : "#69c893"}` } : undefined}><Icon type={type} off={off} small={!large} /></span>;
}
const examples = [
  { name: "1. 기본 화면", full: false, ttsOff: false, micOff: false, note: "전체 화면 꺼짐 · TTS 켜짐 · 마이크 켜짐" },
  { name: "2. 전체 화면 · 둘 다 꺼짐", full: true, ttsOff: true, micOff: true, note: "축소 아이콘 · 빨간 링과 흰 대각선" },
  { name: "3. 전체 화면 · 마이크만 꺼짐", full: true, ttsOff: false, micOff: true, note: "TTS는 초록 링 · 마이크는 빨간 링" },
];
export default function Concepts() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main className="mx-auto w-full max-w-[1340px] p-8 text-[#d6d3cd]">
    <h1 className="text-xl font-semibold">모바일 버튼 · 켜짐과 꺼짐 시안</h1>
    <p className="mt-2 mb-8 text-sm text-zinc-500">실제 화면 크기와 확대 모습을 함께 보여드립니다. 실제 버튼은 아직 바꾸지 않았습니다.</p>
    <div className="grid grid-cols-1 gap-7 xl:grid-cols-3">{examples.map((example) => <section key={example.name}>
      <h2 className="mb-4 text-sm font-medium">{example.name}</h2>
      <div className="overflow-hidden rounded-2xl border border-[#343437] bg-[#18181a]">
        <div className="flex h-12 items-center gap-3 border-b border-[#2b2b2e] px-3">
          <b className="text-base">DO<span className="text-red-500">LIVE</span></b>
          <span className="rounded-full bg-[#29292b] px-3 py-1 text-[13px] whitespace-nowrap">참여자 4명 <span className="ml-1 text-[10px]">⌄</span></span>
          <div className="ml-auto mr-1.5 flex gap-3"><Control type={example.full ? "shrink" : "full"} /><Control type="tts" off={example.ttsOff} /><Control type="mic" off={example.micOff} /></div>
        </div>
        <p className="px-4 py-5 text-center text-xs text-[#8e8c88]">{example.note}</p>
        <div className="mx-4 mb-5 rounded-xl bg-[#121214] px-4 py-6">
          <p className="mb-6 text-center text-[11px] text-[#777573]">확대해서 보기</p>
          <div className="flex justify-center gap-7">{[
            { type: example.full ? "shrink" as const : "full" as const, label: example.full ? "전체 화면 끄기" : "전체 화면 켜기", off: false },
            { type: "tts" as const, label: example.ttsOff ? "TTS 꺼짐" : "TTS 켜짐", off: example.ttsOff },
            { type: "mic" as const, label: example.micOff ? "마이크 꺼짐" : "마이크 켜짐", off: example.micOff },
          ].map((control) => <div key={control.type} className="flex flex-col items-center gap-4"><Control type={control.type} off={control.off} large /><span className="text-[11px] text-[#aaa6a0]">{control.label}</span></div>)}</div>
        </div>
      </div>
    </section>)}</div>
  </main>;
}
