import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "Sunny · 个人知识库",
  description: "以文档为核心，支持 AI 问答与引用溯源的私有知识库",
  icons: {
    icon: [
      // 现代浏览器优先用 SVG（矢量、任意尺寸清晰）
      { url: "/icon.svg", type: "image/svg+xml" },
      // 🔴 必须显式给出 ICO：老浏览器、部分爬虫、RSS/预览服务只请求 /favicon.ico。
      //    实测该路径原先 **404**（只有 /icon.svg 是 200）→ 这些客户端拿到空白图标。
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
    // iOS 主屏图标：用专门生成的 180×180 PNG（自带浅暖白底，非透明）
    apple: "/apple-icon.png",
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
      <body className="h-full">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
