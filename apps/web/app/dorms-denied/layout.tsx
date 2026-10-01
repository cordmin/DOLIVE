// 도름스 안내 화면(page.tsx, dorms-login 도구가 넣은 파일이라 고치지 않는다)은 밝은 바탕에 맞춘 글씨색이라,
// DOLIVE 의 어두운 바탕 위에서는 안 보인다. 이 화면만 밝은 바탕을 깐다
export default function DormsDeniedLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 bg-stone-50">{children}</div>;
}
