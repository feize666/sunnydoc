import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/** 判断子树里是否含可见文本（用于识别「图标按钮」：无文本才需要 aria-label） */
function hasVisibleText(node: unknown): boolean {
  if (typeof node === "string" || typeof node === "number") return true;
  if (Array.isArray(node)) return node.some(hasVisibleText);
  if (isValidElement(node)) return hasVisibleText((node.props as { children?: unknown })?.children);
  return false;
}

/**
 * 统一悬浮提示，替代原生 title。
 * JS 控制显示 + createPortal 渲染到 body + fixed 定位。
 * 与旧的纯 CSS 实现相比，本实现不受任何祖先 overflow 容器（工具栏的
 * overflow-x-auto 等）裁剪，tooltip 始终完整可见。
 * 用法：<Tooltip content="提示文字"><button>…</button></Tooltip>
 *
 * 可访问性：气泡 role="tooltip" 只是视觉提示，屏幕阅读器不会把它当可访问名。
 * 因此当子元素是「无文本的图标按钮」且自身没有 aria-label / aria-labelledby /
 * title 时，自动把 content 注入为其 aria-label —— 一处改动覆盖全部调用点。
 * 有可见文本、或已自带可访问名的子元素一律不覆盖，避免改变其语义。
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
  const bubbleId = `${useId()}-tooltip`;

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

  // 给「无文本且无自带可访问名」的图标子元素补 aria-label，
  // 并把气泡与触发元素用 aria-describedby 关联（气泡仅在打开时存在）。
  const child = Children.count(children) === 1 ? Children.only(children) : null;
  const trigger =
    child && isValidElement(child)
      ? (() => {
          const el = child as ReactElement<Record<string, unknown>>;
          const p = el.props;
          const named =
            p["aria-label"] || p["aria-labelledby"] || p["title"] || hasVisibleText(p["children"]);
          const extra: Record<string, unknown> = {};
          if (!named) extra["aria-label"] = content;
          if (open) extra["aria-describedby"] = bubbleId;
          return Object.keys(extra).length ? cloneElement(el, extra) : el;
        })()
      : children;

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
        {trigger}
      </span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={bubbleRef}
              id={bubbleId}
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
