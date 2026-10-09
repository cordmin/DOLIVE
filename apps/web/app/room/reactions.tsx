"use client";
import { useDataChannel } from "@livekit/components-react";
import { useRef, useState } from "react";
import { DonationMascot, DONATION_STYLES, type DonationStyle } from "@/components/DonationMascot";

// 하트·ㅋ·헐 날리기. 기록은 남기지 않고, 그 순간 방에 있는 사람 화면에만 띄운다
const REACT_TOPIC = "dolive-react";
const REACTS = ["heart", "k", "hul"] as const;
export type Reaction = (typeof REACTS)[number];
export type Float = { id: number; kind: Reaction | "donation"; x: number; delay: number; variant?: DonationStyle; sway?: number; phase?: number };
let floatId = 0;
// 헐은 노란 글자에 검은 테두리, ㅋ는 검은 글자에 흰 테두리 (버튼과 떨어지는 글자 모두).
// 테두리를 글자 뒤에 그려서(paint-order) 글자가 가늘어지지 않게. 굵기는 글자 크기에 맞춰 늘어난다(em)
export const STICKER_TEXT = {
  hul: "text-amber-300 [-webkit-text-stroke:0.16em_black] [paint-order:stroke_fill]",
  k: "text-black [-webkit-text-stroke:0.16em_white] [paint-order:stroke_fill]",
};

// floats: 지금 화면에 떠 있는 것들, react: 내가 날리기 (방 안 모두에게 보내고 내 화면에도 띄운다)
export function useReactions() {
  // 한 번 누르면 7개가 여기저기서 조금씩 늦게 차례로 올라간다. 마구 눌러도 한꺼번에 70개까지만
  const [floats, setFloats] = useState<Float[]>([]);
  const seen = useRef(new Set<string>());
  function donation(result: { transferId: string; amount: number }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.transferId) || ![1, 2, 3].includes(result.amount) || seen.current.has(result.transferId)) return;
    seen.current.add(result.transferId);
    if (seen.current.size > 2000) seen.current.delete(seen.current.values().next().value!);
    // 무작위 보내기 번호를 써서 같은 도름이는 모든 사람에게 같은 모습으로 보인다.
    const choice = parseInt(result.transferId.slice(-2), 16);
    const rhythm = parseInt(result.transferId.slice(-4, -2), 16) / 255;
    // 보낸 도름 하나당 한 마리. 같은 보내기 알림이 다시 와도 무리를 두 번 만들지 않는다.
    const fresh: Float[] = Array.from({ length: result.amount }, (_, i) => ({ id: floatId++, kind: "donation", x: 15 + Math.random() * 60, delay: i * 0.18,
      variant: DONATION_STYLES[(choice + i) % DONATION_STYLES.length].id, sway: 3 + rhythm * 1.5, phase: (rhythm * 3 + i * 0.7) % 3.6 }));
    setFloats((items) => [...items, ...fresh]);
    setTimeout(() => setFloats((items) => items.filter((item) => !fresh.includes(item))), 10000);
  }
  useDataChannel("dolive-donation", (msg) => {
    // 사람 브라우저가 보낸 가짜 성공 알림은 받지 않는다.
    if (msg.from) return;
    try { donation(JSON.parse(new TextDecoder().decode(msg.payload))); } catch { /* 잘못된 알림은 건너뛴다. */ }
  });
  function burst(kind: Reaction) {
    const fresh: Float[] = Array.from({ length: 7 }, (_, i) => ({
      id: floatId++,
      kind,
      x: 3 + Math.random() * 88,
      delay: i * 0.25 + Math.random() * 0.2,
    }));
    setFloats((f) => [...f.filter((item) => item.kind === "donation"), ...f.filter((item) => item.kind !== "donation").concat(fresh).slice(-70)]);
    setTimeout(() => setFloats((f) => f.filter((x) => !fresh.includes(x))), 5000);
  }
  const { send } = useDataChannel(REACT_TOPIC, (msg) => {
    const kind = new TextDecoder().decode(msg.payload) as Reaction;
    if (msg.from && REACTS.includes(kind)) burst(kind);
  });
  function react(kind: Reaction) {
    send(new TextEncoder().encode(kind), { reliable: false });
    burst(kind); // 보낸 나한테는 돌아오지 않아서 내 화면에도 직접 띄운다
  }
  return { floats, react, donation };
}

// 부모 칸 안에서 하트는 맨 아래에서 위로 올라가고, ㅋ·헐은 맨 위에서 아래로 내려오며 사라진다
export function Floats({ floats }: { floats: Float[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {floats.map((f) => (
        <span
          key={f.id}
          style={{ left: `${f.x}%`, animationDelay: `${f.delay}s` }}
          className={`absolute drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)] ${
            f.kind === "donation" ? "-top-40 animate-[donation-fall_9s_linear_both]" : f.kind === "heart" ? "top-full animate-[float-up_2.5s_ease-out_both]" : "-top-12 animate-[float-down_2.5s_ease-in_both]"
          }`}
        >
          {f.kind === "donation" ? <span style={{ animationDelay: `-${f.phase ?? (f.id * 0.37) % 3.6}s`, animationDuration: `${f.sway ?? 3.6}s` }} className="inline-block animate-[donation-sway_3.6s_ease-in-out_infinite]"><DonationMascot variant={f.variant} /></span> : f.kind === "heart" ? (
            <Heart className="size-[1.8rem] text-red-500" />
          ) : (
            <span className={`text-4xl font-black whitespace-nowrap ${STICKER_TEXT[f.kind]}`}>{f.kind === "k" ? "ㅋ" : "헐"}</span>
          )}
        </span>
      ))}
    </div>
  );
}

export function Heart({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="black" strokeWidth="4.8" strokeLinejoin="round" style={{ paintOrder: "stroke fill", overflow: "visible" }} aria-hidden className={className}>
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}
