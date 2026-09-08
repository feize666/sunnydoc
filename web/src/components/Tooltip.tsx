import type { ReactNode } from "react";

/**
 * 统一悬浮提示，替代原生 title。
 * 纯 CSS 实现（Tailwind named group），无额外 JS 状态；hover 延迟约 150ms 出现。
 * 用法：<Tooltip content="提示文字"><button>…</button></Tooltip>
 */
export function Tooltip({
  content,
  side = "top",
  className = "",
  children,
}: {
  content: string;
  side?: "top" | "bottom";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`group/tip relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`tooltip-bubble pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap opacity-0 transition-opacity delay-150 duration-150 group-hover/tip:opacity-100 ${
          side === "top"
            ? "tooltip-bubble--top bottom-full mb-2"
            : "tooltip-bubble--bottom top-full mt-2"
        }`}
      >
        {content}
      </span>
    </span>
  );
}
