import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  // Next.js 16 默认只信任 localhost，用 127.0.0.1 访问会被判为跨域并拦截
  // /_next/hmr，导致 HMR WebSocket 握手失败、React 不水合（页面卡在「加载中…」）。
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
