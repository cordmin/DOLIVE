import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
const names = ["기본을 깔끔하게", "더 낮고 간결하게", "여백을 넉넉하게", "숫자와 단위를 한 줄로", "조절 버튼에도 음영", "부드러운 둥근 모양"];

export default function Concepts() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main className="mx-auto w-full max-w-[1500px] p-7 text-zinc-200">
    <h1 className="text-xl font-bold">안쪽으로 들어간 금액 조절부 · 새 시안 6가지</h1>
    <p className="mt-2 mb-7 text-sm text-zinc-500">고른 5번을 다듬었어요. 잔액과 오늘 남은 한도 표시는 모두 뺐습니다.</p>
    <div className="grid grid-cols-1 gap-x-8 gap-y-7 md:grid-cols-2 xl:grid-cols-3">{names.map((name, kind) => <section key={name}>
      <h2 className="mb-3 flex items-center gap-3 text-sm"><span className="text-[#cdb27d]">0{kind + 1}</span>{name}</h2>
      <div className="flex h-[330px] items-center justify-center rounded-2xl bg-[#1b1b1e] p-6">
        <div className={`w-full max-w-[330px] border border-zinc-700/70 bg-[#262629] px-6 shadow-xl ${kind === 5 ? "rounded-3xl py-7" : kind === 2 ? "rounded-2xl py-8" : "rounded-2xl py-6"}`}>
          <h3 className="text-center text-[15px] font-semibold">코코로님에게 도름네이션 해요!</h3>
          <div className={`flex items-center justify-between bg-[#1c1c1f] px-5 shadow-[inset_0_2px_5px_rgb(0_0_0/0.45)] ${kind === 5 ? "my-6 rounded-full py-5" : kind === 1 ? "my-5 rounded-xl py-3" : kind === 2 ? "my-8 rounded-2xl py-6" : "my-6 rounded-2xl py-5"}`}>
            {[0, 1, 2].map((position) => position === 1 ? <div key={position} className={kind === 3 ? "flex items-baseline gap-2" : "text-center"}><div className={`${kind === 1 ? "text-4xl" : "text-5xl"} font-light text-[#e4c996]`}>1</div><div className={`${kind === 3 ? "" : "mt-2"} text-[11px] text-zinc-500`}>도름</div></div> : <span key={position} className={`flex items-center justify-center rounded-full text-xl text-zinc-200 ${position === 0 ? "opacity-40" : ""} ${kind === 4 ? "size-9 border border-zinc-600/50 bg-[#303034] shadow-[inset_0_1px_1px_rgb(255_255_255/0.08),0_2px_4px_rgb(0_0_0/0.6)]" : kind === 1 ? "size-7 bg-zinc-700" : kind === 3 ? "size-8 border border-zinc-600 bg-transparent" : "size-8 bg-zinc-700"}`}>{position === 0 ? "−" : "+"}</span>)}
          </div>
          {kind === 2 ? <div><span className="block rounded-lg bg-[#cdb27d] py-3 text-center text-sm font-semibold text-[#29231a]">보내기</span><span className="mt-4 block text-center text-xs text-zinc-500">닫기</span></div> : <div className="flex items-center gap-4"><span className="flex-1 text-center text-sm text-zinc-500">닫기</span><span className={`flex-[2] bg-[#cdb27d] py-2.5 text-center text-sm font-semibold text-[#29231a] ${kind === 5 ? "rounded-full" : "rounded-lg"}`}>보내기</span></div>}
        </div>
      </div>
    </section>)}</div>
  </main>;
}
