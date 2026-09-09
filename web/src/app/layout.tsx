import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "知库 · 文档知识库",
  description: "以文档为核心，支持 AI 问答与引用溯源的私有知识库",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <body className="h-full">{children}</body>
    </html>
  );
}
