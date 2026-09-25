import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DOLIVE",
  description: "AI 동호회 음성·화상 모임방",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-900 text-zinc-100">{children}</body>
    </html>
  );
}
