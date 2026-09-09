"use client";

import { Tooltip } from "./Tooltip";

/**
 * 彩色主题切换按钮：亮色显示金黄太阳、暗色显示蓝紫月亮。
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
  return (
    <Tooltip content={theme === "light" ? "切换到暗色主题" : "切换到亮色主题"}>
      <button
        onClick={onToggle}
        aria-label="切换主题"
        className={`grid place-items-center rounded-md transition-colors hover:bg-hover ${className}`}
      >
        {theme === "light" ? (
          // 月亮（点击后进入暗色）——蓝紫渐变
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id="moon-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>
            <path
              d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
              fill="url(#moon-grad)"
            />
          </svg>
        ) : (
          // 太阳（点击后进入亮色）——金黄
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id="sun-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#f59e0b" />
              </linearGradient>
            </defs>
            <circle cx="12" cy="12" r="4" fill="url(#sun-grad)" />
            <g stroke="#f59e0b" strokeWidth="2" strokeLinecap="round">
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </g>
          </svg>
        )}
      </button>
    </Tooltip>
  );
}
