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
      <head>
        {/* 防止浏览器/CDN 缓存入口 HTML，避免 chunk hash 变更后页面拉取旧 HTML 引用不存在的 chunk */}
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
