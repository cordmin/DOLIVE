import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // 카카오톡 미리보기가 사진(app/opengraph-image.jpg)을 찾으려면 전체 주소가 필요하다
  metadataBase: new URL("https://dolive.duckdns.org"),
  title: "DOLIVE",
  description: "DOLIVE 도라이브 방송",
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
