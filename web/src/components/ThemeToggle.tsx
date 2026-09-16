"use client";

import { useId } from "react";
import { Tooltip } from "./Tooltip";

/**
 * 月亮图形（亮色主题下显示，点击进入暗色）——蓝紫渐变。
 * 渐变 id 由 useId 传入：同一页面可渲染多个 ThemeToggle（标题栏 / 首页 / 设置页），
 * 若用固定 id 会互相覆盖渐变定义。
 */
function MoonGlyph({ size, id }: { size: number; id: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--theme-moon-from)" />
          <stop offset="100%" stopColor="var(--theme-moon-to)" />
        </linearGradient>
      </defs>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill={`url(#${id})`} />
    </svg>
  );
}

/** 太阳图形（暗色主题下显示，点击回到亮色）——金黄渐变。 */
function SunGlyph({ size, id }: { size: number; id: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--theme-sun-from)" />
          <stop offset="100%" stopColor="var(--theme-sun-to)" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="4" fill={`url(#${id})`} />
      <g stroke="var(--theme-sun-to)" strokeWidth="2" strokeLinecap="round">
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </g>
    </svg>
  );
}

/**
 * 彩色主题切换按钮：亮色显示金黄太阳的对应面（月亮）、暗色显示太阳。
 * 尺寸走 `.icon-btn`（32px 阶梯，见 DESIGN.md §5.12）；图标大小由 size 控制。
 */
export function ThemeToggle({
  theme,
  onToggle,
  size = 16,
  className = "",
}: {
  theme: "light" | "dark";
  onToggle: () => void;
  size?: number;
  className?: string;
}) {
  const uid = useId();
  const moonId = `${uid}-moon`;
  const sunId = `${uid}-sun`;

  return (
    <Tooltip content={theme === "light" ? "切换到暗色主题" : "切换到亮色主题"}>
      <button
        onClick={onToggle}
        aria-label="切换主题"
        className={`icon-btn shrink-0 text-muted hover:text-text ${className}`}
      >
        {theme === "light" ? (
          <MoonGlyph size={size} id={moonId} />
        ) : (
          <SunGlyph size={size} id={sunId} />
        )}
      </button>
    </Tooltip>
  );
}