import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * 统一悬浮提示，替代原生 title。
 * JS 控制显示 + createPortal 渲染到 body + fixed 定位。
 * 与旧的纯 CSS 实现相比，本实现不受任何祖先 overflow 容器（工具栏的
 * overflow-x-auto 等）裁剪，tooltip 始终完整可见。
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
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const anchorRef = useRef({ x: 0, y: 0, side });
  const timerRef = useRef<number | null>(null);

  const show = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      anchorRef.current = {
        x: r.left + r.width / 2,
        y: side === "top" ? r.top : r.bottom,
        side,
      };
      setOpen(true);
    }, 120);
  };

  const hide = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  };

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  // 气泡渲染后，根据实际尺寸计算位置并做视口溢出校正
  useLayoutEffect(() => {
    if (!open) return;
    const bubble = bubbleRef.current;
    if (!bubble) return;
    const r = bubble.getBoundingClientRect();
    const { x, y, side } = anchorRef.current;
    const GAP = 8;
    let top = side === "top" ? y - r.height - GAP : y + GAP;
    let left = x - r.width / 2;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (left < 8) left = 8;
    if (left + r.width > vw - 8) left = vw - r.width - 8;
    if (top < 8) top = y + GAP; // 上方空间不足，翻到下方
    if (top + r.height > vh - 8) top = y - r.height - GAP; // 下方空间不足，翻到上方
    setStyle({ top: Math.max(4, top), left });
  }, [open, content]);

  return (
    <>
      <span
        ref={triggerRef}
        className={`inline-flex ${className}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={bubbleRef}
              role="tooltip"
              style={style}
              className="tooltip-bubble fixed left-0 top-0 z-[10000] whitespace-nowrap"
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
