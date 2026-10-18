"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useModalFocus } from "@/lib/useModalFocus";
import { CloseIcon } from "./icons";

/**
 * 给「HTML 渲染出来的正文」挂图片放大（单击 / 双击都可以）。
 *
 * 预览态与分享页走 `dangerouslySetInnerHTML`（见 Editor.tsx / ShareView.tsx），
 * 里面的 `<img>` 是浏览器解析出来的原生元素，**没有 React 事件**，
 * 因此只能在容器上做事件委托。
 *
 * 为什么**单击**也生效（编辑态只认双击）：只读态没有「点一下选中图片」的语义，
 * 单击不会和任何操作冲突，保留它更易被发现；双击同样生效是为了和编辑态一致 ——
 * 用户不会去记「阅读态要点两下还是点一下」。
 *
 * 🔴 监听挂在 `document` 上（捕获阶段），**不是**挂在 rootRef.current 上：
 *   ① 首次渲染时 `doc` 还是 null，正文容器根本没挂载 → 挂不上去；
 *   ② 切换文档 / 换主题 / 渐进渲染都会重建正文 DOM → 挂在旧节点上的监听全部失效。
 *   曾因为「依赖是 ref 对象（恒定）→ effect 只跑一次 + 首帧拿不到容器就 return」
 *   导致**阅读态的放大整个失效**（单击双击都毫无反应），而旧的真机脚本只覆盖了
 *   编辑态，27 项断言全绿也没抓到。挂 document、在事件发生时再解析 root，
 *   对上述两种重建天然免疫。
 *
 * 用法（容器通常已有自己的 ref，故由外部传入）：
 *   const lightbox = useImageZoom(contentRef);
 *   <div ref={contentRef} className="md-body md-zoomable" dangerouslySetInnerHTML={…} />
 *   {lightbox}
 */
export function useImageZoom(rootRef: React.RefObject<HTMLElement | null>) {
  const [src, setSrc] = useState<string | null>(null);
  const [alt, setAlt] = useState("");

  useEffect(() => {
    const onActivate = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.tagName !== "IMG") return;
      // 容器在**事件发生时**才解析（见上方 🔴 说明）
      const root = rootRef.current;
      if (!root || !root.contains(t)) return;
      const img = t as HTMLImageElement;
      // 只放大正文里的图片：排除头像、图标等装饰性小图
      if (img.naturalWidth && img.naturalWidth < 60) return;
      e.preventDefault();
      e.stopPropagation();
      setAlt(img.alt || "");
      setSrc(img.currentSrc || img.src);
    };
    // 捕获阶段：先于容器自身的 wikilink / 代码块复制等 onClick 处理，避免误触
    document.addEventListener("click", onActivate, true);
    return () => document.removeEventListener("click", onActivate, true);
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
 * - 双击图片 / 点浮条「放大」/ 预览态单击图片 → 打开
 * - Esc / 点「关闭」按钮 / 点图片外的遮罩 → 关闭
 * - 滚轮或 +/- 缩放；拖动平移；「适应窗口」回到初始
 * - 打开时禁止背后页面滚动（否则滚轮会滚正文而不是缩放图片）
 */

/**
 * 开场宽限期（ms）。
 *
 * 🔴 为什么必须有：阅读态是「单击图片即打开」，而遮罩是「点任意处关闭」——
 * 用户按编辑态习惯**双击**时，click#1 打开 lightbox，click#2 落在刚铺满屏幕的
 * 遮罩上 → 刚打开就被自己第二下点掉了。视觉上就是「双击毫无反应」，
 * 而且**只有双击会踩到**，单击一切正常，极易被当成「双击没做」。
 * 忽略紧跟打开的那一小段点击即可；比系统双击阈值（~500ms）略短，
 * 既覆盖真实双击节奏，又不影响用户打开后主动点关闭。
 */
const OPEN_GUARD_MS = 400;

/** 认定为「拖动视图」而非「点击」的最小位移（px） */
const DRAG_SLOP = 5;

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
  /** 打开时刻：用于开场宽限期（见 OPEN_GUARD_MS） */
  const openedAt = useRef(0);
  /** 本次指针交互是否发生了位移：拖完松手不该被当成「点击关闭」 */
  const pressAt = useRef({ x: 0, y: 0 });
  const dragMoved = useRef(false);
  const wasOpen = useRef(false);

  /**
   * 开场时间必须在**渲染期间**记，不能放 effect。
   *
   * effect 在浏览器绘制之后才跑，而双击的第二次 click 可能在 40ms 内就到了 ——
   * 若那时 openedAt 仍是 0，宽限期判定 `now - 0` 恒为极大值 → 守卫失效。
   * 渲染期赋值严格早于后续任何事件。
   */
  if (open && !wasOpen.current) {
    openedAt.current = Date.now();
    dragMoved.current = false;
  }
  wasOpen.current = open;

  // 每次打开重置视图（否则上一张的缩放位置会带过来）
  useEffect(() => {
    if (!open) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [open, src]);

  /**
   * 「点遮罩关闭」的收口。两种误关都要挡在这里，而不是直接调 onClose：
   *   ① 双击的第二下（见 OPEN_GUARD_MS）
   *   ② 拖动平移后松手 —— 用户正是想看清细节，松手却把查看器关了最难受
   * Esc 与「关闭」按钮**不走**这里（那是明确意图，必须立刻生效）。
   */
  const requestClose = useCallback(() => {
    if (Date.now() - openedAt.current < OPEN_GUARD_MS) return;
    if (dragMoved.current) {
      dragMoved.current = false;
      return;
    }
    onClose();
  }, [onClose]);

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
      // 位移超过阈值才算「拖动」（松手不该关掉查看器，见 requestClose）
      if (
        Math.abs(e.clientX - pressAt.current.x) > DRAG_SLOP ||
        Math.abs(e.clientY - pressAt.current.y) > DRAG_SLOP
      ) {
        dragMoved.current = true;
      }
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
      onClick={requestClose}
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

      {/* 图片区：拖动平移。点空白处（target 就是本容器）→ 关闭；
          点图片本身不关闭（图片自己负责拖动平移）。
          🔴 不能无脑 stopPropagation：本容器 flex-1 铺满整屏、与工具条合起来
          覆盖了整块遮罩，一旦吞掉冒泡，遮罩的 onClick 就**永远收不到事件**，
          「点任意处关闭」变成死代码（原实现即如此，注释宣称能关但实际关不掉）。 */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 pb-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) requestClose();
        }}
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
            dragMoved.current = false;
            pressAt.current = { x: e.clientX, y: e.clientY };
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