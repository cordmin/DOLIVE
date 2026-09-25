// 켜기/끄기 토글 스위치 (켜지면 초록, 꺼지면 회색)
export function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex items-center gap-2 rounded-full bg-zinc-800 py-1.5 pr-4 pl-1.5 text-sm hover:bg-zinc-700"
    >
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-green-600" : "bg-zinc-600"}`}>
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : ""}`}
        />
      </span>
      {label}
    </button>
  );
}
