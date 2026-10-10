"use client";
import { useState } from "react";
import { Knob } from "@/components/Knob";
import { DonationFace } from "@/components/DonationMascot";

function Plane() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-[22px] translate-x-px -translate-y-px -rotate-[35deg]"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" /></svg>;
}
export default function Example() {
  const [text, setText] = useState("새 버튼을 눌러보세요.");
  const [sent, setSent] = useState<string[]>([]);
  return <main className="mx-auto flex h-dvh w-full max-w-[960px] flex-col gap-4 p-4 text-zinc-200 md:p-6">
    <style>{`nextjs-portal { display: none; }`}</style>
    <h1 className="text-lg font-semibold">메시지 보내기 버튼 시험</h1>
    <p className="text-sm text-zinc-400">실제 채팅은 보내지 않습니다. 버튼을 누른 채로 있다가 손을 떼어보세요.</p>
    <div className="flex justify-end gap-4 rounded-xl bg-[#1e1e21] p-5">
      {["전체화면", "화면공유", "TTS", "마이크"].map((label,i)=><Knob key={label} label={label} compactMobile mobileRing={false} icon={i===2 ? <span className="text-xs">TTS</span> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-[17px]">{i===0 ? <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/> : i===1 ? <><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></> : <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></>}</svg>} />)}
    </div>
    <section className="flex min-h-0 flex-1 flex-col rounded-xl bg-[#1e1e21] hw-inset">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{sent.map((message,i)=><div key={i} className="mb-3 ml-auto w-fit max-w-[85%] rounded-2xl bg-zinc-700 px-4 py-2 text-sm">{message}</div>)}</div>
      <form onSubmit={e=>{e.preventDefault();if(text.trim()){setSent(items=>[...items,text.trim()]);setText("");}}} className="flex items-end gap-2 p-3">
        <div className="relative flex min-h-12 min-w-0 flex-1 items-center rounded-[24px] bg-zinc-800">
          <span className="ml-2 flex size-7.5 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-lg">+</span>
          <input aria-label="메시지 입력" value={text} onChange={e=>setText(e.target.value)} placeholder="메시지 입력" className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm outline-none"/>
          <span className="mr-2 flex size-7.5 shrink-0 items-center justify-center rounded-full bg-zinc-700 [&>svg]:size-5"><DonationFace /></span>
        </div>
        <button type="submit" aria-label="보내기" disabled={!text.trim()} onPointerDown={e=>e.preventDefault()} className="group flex size-[52px] shrink-0 cursor-pointer items-center justify-center disabled:opacity-40">
          <span className="hw-cap size-[44px]! transition group-hover:brightness-125 group-active:translate-y-px group-disabled:brightness-100"><Plane /></span>
        </button>
      </form>
    </section>
    <div className="flex items-center gap-4 text-xs text-zinc-400"><span>현재 버튼</span><span className="flex size-12 items-center justify-center rounded-full bg-indigo-600 text-zinc-100"><Plane /></span><span>새 시험 버튼</span><span className="flex size-[52px] items-center justify-center"><span className="hw-cap size-[44px]!"><Plane /></span></span></div>
  </main>;
}
