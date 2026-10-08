"use client";
import { useEffect, useState } from "react";
import { DonationDialog } from "../room/donation";
import { Floats, type Float } from "../room/reactions";
import { DONATION_STYLES } from "@/components/DonationMascot";

export default function DonationExample() {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(true), []);
  const [self, setSelf] = useState(false);
  const [scenario, setScenario] = useState<"normal" | "empty" | "limit">("normal");
  const [version, setVersion] = useState(0);
  const [floats, setFloats] = useState<Float[]>([]);
  function show(isSelf: boolean, situation: "normal" | "empty" | "limit" = "normal") {
    setSelf(isSelf); setScenario(situation); setVersion((n) => n + 1); setOpen(true);
  }
  return <main className="w-full p-6 text-zinc-200">
    <h1 className="text-xl font-bold">도름네이션 예시 화면</h1>
    <p className="mt-2 text-sm text-zinc-400">실제 도름은 쓰지 않아요. 1·2·3도름을 고르고 보내기를 눌러보세요.</p>
    <div className="my-5 flex flex-wrap gap-3">
      <button onClick={() => show(false)} className="rounded-lg bg-indigo-600 px-4 py-2">코코로님에게 보내기 예시</button>
      <button onClick={() => show(true)} className="rounded-lg border border-zinc-600 px-4 py-2">본인일 때 예시</button>
      <button onClick={() => show(false, "empty")} className="rounded-lg border border-zinc-600 px-4 py-2">도름이 없을 때</button>
      <button onClick={() => show(false, "limit")} className="rounded-lg border border-zinc-600 px-4 py-2">오늘 한도를 다 썼을 때</button>
    </div>
    <div className="relative h-[70vh] overflow-hidden rounded-xl bg-[#1e1e21] hw-inset">
      <p className="absolute inset-0 flex items-center justify-center text-zinc-500">보내기를 누르면 도름이가 내려와요.</p>
      <Floats floats={floats} />
    </div>
    {open && <DonationDialog key={version} preview previewCase={scenario} token="" room="예시 방송" target={{ recipientId: "예시 코코로", identity: "예시 코코로", name: "코코로", isSelf: self }} close={() => setOpen(false)} success={(result) => {
      const id = Date.now();
      const fresh: Float[] = Array.from({ length: result.amount }, (_, i) => ({ id: id + i, kind: "donation", x: 20 + Math.random() * 55, delay: i * 0.18, variant: DONATION_STYLES[Math.floor(Math.random() * DONATION_STYLES.length)].id, phase: Math.random() * 3 }));
      setFloats((items) => [...items, ...fresh]);
      setOpen(false);
      setTimeout(() => setFloats((items) => items.filter((item) => !fresh.includes(item))), 10000);
    }} />}
  </main>;
}
