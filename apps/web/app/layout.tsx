import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DOLIVE",
  description: "AI 동호회 음성 모임방",
};

// 안드로이드: 자판이 올라오면 화면을 밀어 올리지 말고 화면 높이를 줄인다
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-900 text-zinc-100">{children}</body>
    </html>
  );
}
