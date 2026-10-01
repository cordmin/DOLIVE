import { useDataChannel } from "@livekit/components-react";
import { useState } from "react";

// 하트·ㅋ·헐 날리기. 기록은 남기지 않고, 그 순간 방에 있는 사람 화면에만 띄운다
const REACT_TOPIC = "dolive-react";
const REACTS = ["heart", "k", "hul"] as const;
export type Reaction = (typeof REACTS)[number];
export type Float = { id: number; kind: Reaction; x: number; delay: number };
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
  function burst(kind: Reaction) {
    const fresh = Array.from({ length: 7 }, (_, i) => ({
      id: floatId++,
      kind,
      x: 3 + Math.random() * 88,
      delay: i * 0.25 + Math.random() * 0.2,
    }));
    setFloats((f) => [...f, ...fresh].slice(-70));
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
  return { floats, react };
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
            f.kind === "heart" ? "top-full animate-[float-up_2.5s_ease-out_both]" : "-top-12 animate-[float-down_2.5s_ease-in_both]"
          }`}
        >
          {f.kind === "heart" ? (
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
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}
