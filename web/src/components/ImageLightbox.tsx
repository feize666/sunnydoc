"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useModalFocus } from "@/lib/useModalFocus";
import { CloseIcon } from "./icons";

/**
 * 给「HTML 渲染出来的正文」挂图片点击放大。
 *
 * 预览态与分享页走 `dangerouslySetInnerHTML`（见 Editor.tsx / ShareView.tsx），
 * 里面的 `<img>` 是浏览器解析出来的原生元素，**没有 React 事件**，
 * 因此只能在容器上做事件委托。
 *
 * 为什么这里用**单击**而不是编辑态那样的双击：只读态没有「点一下选中图片」
 * 的语义，单击不会和任何操作冲突；用双击反而让用户以为点不动。
 *
 * 用法（容器通常已有自己的 ref，故由外部传入）：
 *   const lightbox = useImageZoom(contentRef);
 *   <div ref={contentRef} className="md-body" dangerouslySetInnerHTML={…} />
 *   {lightbox}
 */
export function useImageZoom(rootRef: React.RefObject<HTMLElement | null>) {
  const [src, setSrc] = useState<string | null>(null);
  const [alt, setAlt] = useState("");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.tagName !== "IMG") return;
      const img = t as HTMLImageElement;
      // 只放大正文里的图片：排除头像、图标等装饰性小图
      if (img.naturalWidth && img.naturalWidth < 60) return;
      e.preventDefault();
      e.stopPropagation();
      setAlt(img.alt || "");
      setSrc(img.currentSrc || img.src);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
    // rootRef.current 在挂载后才可用；依赖 length 触发重挂（内容变化时 DOM 会重建）
  }, [rootRef]);

  return <ImageLightbox src={src} alt={alt} onClose={() => setSrc(null)} />;
}

/**
 * 图片放大查看（lightbox）。
 *
 * 为什么需要：编辑态图片受正文宽度约束（默认还不超过原始尺寸），
 * 用户没法看清细节；预览/只读态更是连点击都无反应（实测透明）。
 *
 * 交互约定（尽量贴齐用户既有习惯）：
 * - 双击图片 / 点浮条「放大」/ 预览态点图片 → 打开
 * - Esc 或点任意处 → 关闭
 * - 滚轮或 +/- 缩放；拖动平移；「适应窗口」回到初始
 * - 打开时禁止背后页面滚动（否则滚轮会滚正文而不是缩放图片）
 */
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string | null;
  alt?: string;
  onClose: () => void;
}) {
  const open = !!src;
  const panelRef = useModalFocus<HTMLDivElement>(open, onClose, alt ? `查看图片：${alt}` : "查看图片");

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  // 每次打开重置视图（否则上一张的缩放位置会带过来）
  useEffect(() => {
    if (!open) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [open, src]);

  // 锁定背后滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.max(0.2, Math.min(8, s * (e.deltaY > 0 ? 0.9 : 1.1))));
  }, []);

  // 触屏/鼠标统一用 pointer，窗口级监听保证移出图片也不丢
  useEffect(() => {
    if (!open) return;
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      setOffset((o) => ({ x: o.x + (e.clientX - last.current.x), y: o.y + (e.clientY - last.current.y) }));
      last.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      data-testid="img-lightbox"
      className="fixed inset-0 z-[60] flex flex-col bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      onWheel={onWheel}
    >
      {/* 顶部工具条：只响应自己的点击（不让冒泡去关闭） */}
      <div
        className="flex shrink-0 items-center justify-between gap-3 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="min-w-0 truncate text-[13px] text-white/70">{alt || "查看图片"}</span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            data-testid="img-zoom-out"
            onClick={() => setScale((s) => Math.max(0.2, s * 0.9))}
            className="grid h-7 w-7 place-items-center rounded-md bg-white/10 text-white transition-colors hover:bg-white/20"
            title="缩小"
          >
            −
          </button>
          <span className="w-12 text-center font-mono text-[12px] text-white/80">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            data-testid="img-zoom-in"
            onClick={() => setScale((s) => Math.min(8, s * 1.1))}
            className="grid h-7 w-7 place-items-center rounded-md bg-white/10 text-white transition-colors hover:bg-white/20"
            title="放大"
          >
            +
          </button>
          <button
            type="button"
            data-testid="img-zoom-fit"
            onClick={() => {
              setScale(1);
              setOffset({ x: 0, y: 0 });
            }}
            className="rounded-md bg-white/10 px-2 py-1 text-[12px] text-white transition-colors hover:bg-white/20"
            title="适应窗口"
          >
            适应窗口
          </button>
          <button
            type="button"
            data-testid="img-lightbox-close"
            onClick={onClose}
            className="ml-1 grid h-7 w-7 place-items-center rounded-md bg-white/10 text-white transition-colors hover:bg-white/20"
            title="关闭（Esc）"
          >
            <CloseIcon size={14} />
          </button>
        </span>
      </div>

      {/* 图片区：拖动平移 */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          ref={panelRef as unknown as React.Ref<HTMLImageElement>}
          data-testid="img-lightbox-image"
          src={src}
          alt={alt || ""}
          draggable={false}
          onPointerDown={(e) => {
            e.preventDefault();
            dragging.current = true;
            last.current = { x: e.clientX, y: e.clientY };
          }}
          onDoubleClick={onClose}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: dragging.current ? "none" : "transform 120ms ease-out",
            maxWidth: "100%",
            maxHeight: "100%",
          }}
          className="cursor-grab select-none rounded-md shadow-2xl active:cursor-grabbing"
        />
      </div>
    </div>
  );
}