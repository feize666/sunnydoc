"use client";

import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/lib/markdown";

/**
 * 图片扩展：在默认 Image 之上补四件事（**不引第三方 resize 扩展** —— 本项目
 * 装 tiptap 扩展踩过 peer 冲突，且行为要自己可控）。
 *
 * 1. **宽度**：拖动右下角手柄调整（按百分比存，换主题/换屏宽时比例不变；
 *    存像素则在窄屏会溢出）。换算基准取**容器实际宽度**，不是近似值 ——
 *    用固定 800 会让「拖 100px」在 600px 与 1200px 宽的正文里效果差一倍。
 * 2. **对齐**：左 / 中 / 右 —— 用 `textAlign` 的思路不行（img 是 inline 元素、
 *    父块对齐会影响整段），因此用 margin 自动值表达，只影响图片自身。
 * 3. **选中即浮出工具条**：替代方案「固定工具栏里点图片按钮」需要用户先选中
 *    再回工具栏，多一步；浮条贴在图片上更直接。
 * 4. **双击看大图**（派发事件给上层 lightbox）。单击已被「选中编辑」占用，
 *    故用双击，且编辑态与只读态一致。
 *
 * 属性全部落进 HTML（`width` / `data-align`），经 `tiptap-markdown` 的
 * `html: true` 原样保存在 markdown 里，**往返不丢**。
 */

export type ImageAlign = "left" | "center" | "right";

/** 放大查看的请求事件名。上层（RichEditor / 预览）监听后开 lightbox。 */
export const IMAGE_PREVIEW_EVENT = "sunny:image-preview";

/** 派发放大请求。用事件而非 Context：NodeView 由 tiptap 创建，跨层拿 Context 不稳。 */
export function requestImagePreview(detail: { src: string; alt?: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(IMAGE_PREVIEW_EVENT, { detail }));
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docImage: {
      /** 设置当前选中图片的宽度（百分比 10~100） */
      setImageWidth: (width: number) => ReturnType;
      /** 设置当前选中图片的对齐方式 */
      setImageAlign: (align: ImageAlign) => ReturnType;
    };
  }
}

const MIN_W = 10;
/** 容器宽度取不到时的兜底（正常情况不会走到） */
const FALLBACK_BASE = 800;

function clamp(n: number) {
  return Math.max(MIN_W, Math.min(100, Math.round(n)));
}

function ImageNodeView({ node, updateAttributes, selected, deleteNode, editor }: NodeViewProps) {
  // 拖动中的临时宽度：**只影响渲染，不落库** —— 每一帧都写回文档会产生
  // 上百条 undo 记录（用户按一次撤销只退回一帧）。
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  /** 挂在 NodeViewWrapper 上 —— 它是 `width: N%` 的**包含块**（见下），量的就是它 */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // 图片加载失败时给出可理解的提示，而不是一片空白
  const [broken, setBroken] = useState(false);
  /** 重试用 key：换 key 会让 React 重建 <img>，从而重新发起加载 */
  const [retryKey, setRetryKey] = useState(0);

  // 拖动状态全部用 ref：事件回调里读 state 会拿到**上一次渲染的旧值**
  // （setState 是异步的），首帧会被误判为「未在拖动」而丢掉。
  const dragging = useRef(false);
  const moved = useRef(false);
  const startX = useRef(0);
  /** 换算基准：`width: N%` 的**包含块宽度**（px） */
  const basePx = useRef(FALLBACK_BASE);
  /** 拖动起始百分比 */
  const startPct = useRef(100);
  /** 拖动过程中的当前百分比（松手用它的最终值落库） */
  const curPct = useRef(100);
  const updateRef = useRef(updateAttributes);
  updateRef.current = updateAttributes;

  // 未显式设过宽度时：按图片**原始尺寸**显示，但不超过容器宽度。
  // 不能用 100%（会无条件拉满：一张 200×100 的小图被拉到正文整宽、
  // 高度按比例放大到几百像素，既失真又占满一屏）。
  const width = dragWidth ?? (node.attrs.width as number | null);
  const align = ((node.attrs.align as ImageAlign) || "left") as ImageAlign;

  /**
   * 拖动换算：像素位移 ÷ **容器实际宽度** = 百分比变化。
   *
   * 之前用硬编码 800 —— 正文实际宽度随窗口尺寸/侧栏折叠在 600~1400px 间变化，
   * 同样的拖动距离在不同环境下宽度变化能差一倍（拖 100px 在窄窗是 17%、
   * 宽窗只有 7%），手感完全不可预期。
   *
   * 监听挂在 window 上而非手柄上：鼠标/手指移出手柄、甚至移出窗口，
   * 拖动都不该中断（挂手柄上要靠 setPointerCapture，兼容性不齐）。
   */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      moved.current = true;
      const deltaPx = e.clientX - startX.current;
      const pct = clamp(startPct.current + (deltaPx / basePx.current) * 100);
      curPct.current = pct;
      setDragWidth(pct);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      // 只是点一下手柄（没拖动）→ 不落库，避免无意义的历史记录
      if (moved.current) updateRef.current({ width: curPct.current });
      setDragWidth(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 🔴 基准必须是**包含块宽度**（NodeViewWrapper），不是图片自己。
    //
    // 为什么：`width: N%` 的百分比是相对**包含块**解析的，而包含块是
    // NodeViewWrapper（正文整宽，实测 1086px），不是被设宽的那个 span。
    // 曾用 span 的宽度（= 图片当前显示宽）当基准 → 拖 150px 时：
    //   错误算法 150/200×100 = 75% → 100-75 = 25%（再被下限夹到 19%）
    //   正确算法 150/1086×100 ≈ 14% → 86%
    // 灵敏度被放大 5 倍多，且拖了半天只动几像素 —— 这才是「拖动不跟手」的真因。
    const wrapEl = wrapRef.current;
    const containerPx = wrapEl?.getBoundingClientRect().width || FALLBACK_BASE;
    const imgEl = wrapEl?.querySelector("img");
    const shownPx = imgEl?.getBoundingClientRect().width || containerPx;
    basePx.current = containerPx;
    // 起点 = 图片**当前显示宽度**占包含块的百分比
    // （未设过宽度时即原始尺寸在此容器里的占比）
    startPct.current = clamp((shownPx / containerPx) * 100);
    curPct.current = startPct.current;
    startX.current = e.clientX;
    moved.current = false;
    dragging.current = true;
    // 立即显示徽标：给用户「已经抓住手柄」的即时反馈
    setDragWidth(startPct.current);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    requestImagePreview({ src: node.attrs.src as string, alt: (node.attrs.alt as string) || "" });
  };

  const margin =
    align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : undefined;

  // 只读态不显示手柄与工具条（但双击放大仍可用）
  const editable = editor.isEditable;

  return (
    <NodeViewWrapper
      as="div"
      ref={wrapRef}
      className="doc-image-wrap relative my-2"
      style={{
        display: "flex",
        justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
      }}
      data-align={align}
    >
      <span
        className="relative inline-block"
        style={{
          // 设过宽度 → 按百分比（换屏宽比例不变）；
          // 没设过 → 不干预，由 img 的 max-width 兜底（保持原始尺寸）。
          ...(width ? { width: `${width}%` } : {}),
          maxWidth: "100%",
          margin,
        }}
      >
        {broken ? (
          <span
            data-testid="img-broken"
            className="flex min-h-[72px] w-[240px] max-w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line bg-surface-2 px-3 py-4 text-[12px] text-faint"
            title={node.attrs.src as string}
          >
            <span>图片加载失败</span>
            <span className="text-[11px] opacity-70">文件可能已被删除，或网络暂时不可用</span>
            <button
              type="button"
              data-testid="img-retry"
              onClick={() => {
                // 先清 broken 再递增 key：换 key 触发 <img> 重建 → 重新加载
                setBroken(false);
                setRetryKey((k) => k + 1);
              }}
              className="rounded px-2 py-0.5 text-[12px] text-accent transition-colors hover:bg-accent-soft"
            >
              重试
            </button>
          </span>
        ) : (
          <img
            key={retryKey}
            src={mediaUrl(node.attrs.src as string)}
            alt={(node.attrs.alt as string) || ""}
            title={(node.attrs.title as string) || "双击放大"}
            draggable={false}
            onError={() => setBroken(true)}
            onDoubleClick={onDoubleClick}
            style={{ maxWidth: "100%", height: "auto" }}
            className={`block rounded-md ${selected ? "ring-2 ring-accent" : ""}`}
          />
        )}
        {editable && selected && !broken && (
          <>
            {/* 手柄：视觉 12px，但热区撑到 24px —— 触屏上 12px 根本按不准 */}
            <span
              data-testid="img-resize-handle"
              onPointerDown={onPointerDown}
              title="拖动调整宽度"
              className="absolute -bottom-2 -right-2 grid h-6 w-6 cursor-nwse-resize touch-none place-items-center"
            >
              <span className="h-3 w-3 rounded-sm border border-white bg-accent shadow" />
            </span>
            {/* 拖动中浮出宽度百分比：不然用户只能凭感觉 */}
            {dragWidth !== null && (
              <span
                data-testid="img-width-badge"
                className="pointer-events-none absolute -bottom-3 left-1/2 -translate-x-1/2 rounded bg-text px-1.5 py-0.5 font-mono text-[11px] text-background shadow"
              >
                {dragWidth}%
              </span>
            )}
            {/* 选中即浮出的操作条：贴在图片上方，不遮挡内容 */}
            <span
              data-testid="img-toolbar"
              className="menu-panel absolute -top-9 left-0 z-20 flex items-center gap-0.5 rounded-lg px-1 py-0.5 shadow-md"
              // 阻止冒泡：否则点击工具条会把选区丢掉，updateAttributes 作用不到图片
              onMouseDown={(e) => e.preventDefault()}
            >
              {(
                [
                  ["left", "左对齐"],
                  ["center", "居中"],
                  ["right", "右对齐"],
                ] as [ImageAlign, string][]
              ).map(([a, label]) => (
                <button
                  key={a}
                  type="button"
                  title={label}
                  data-testid={`img-align-${a}`}
                  onClick={() => updateAttributes({ align: a })}
                  className={`rounded px-1.5 py-0.5 text-[12px] transition-colors ${
                    align === a ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text"
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="mx-0.5 h-3.5 w-px bg-line" />
              <button
                type="button"
                title="恢复原始尺寸"
                data-testid="img-reset-width"
                onClick={() => updateAttributes({ width: null })}
                className="rounded px-1.5 py-0.5 text-[12px] text-muted transition-colors hover:bg-hover hover:text-text"
              >
                原尺寸
              </button>
              <button
                type="button"
                title="放大查看"
                data-testid="img-zoom"
                onClick={() =>
                  requestImagePreview({
                    src: node.attrs.src as string,
                    alt: (node.attrs.alt as string) || "",
                  })
                }
                className="rounded px-1.5 py-0.5 text-[12px] text-muted transition-colors hover:bg-hover hover:text-text"
              >
                放大
              </button>
              <button
                type="button"
                title="删除图片"
                data-testid="img-delete"
                onClick={() => deleteNode()}
                className="rounded px-1.5 py-0.5 text-[12px] text-danger transition-colors hover:bg-danger-soft"
              >
                删除
              </button>
            </span>
          </>
        )}
      </span>
    </NodeViewWrapper>
  );
}

export const DocImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // 百分比宽度。null = 用原始宽度（100%）
      width: {
        default: null,
        parseHTML: (el) => {
          const w = el.getAttribute("data-width");
          const n = w ? Number(w) : NaN;
          return Number.isFinite(n) ? n : null;
        },
        renderHTML: (attrs) => (attrs.width ? { "data-width": attrs.width } : {}),
      },
      align: {
        default: "left",
        parseHTML: (el) => el.getAttribute("data-align") || "left",
        renderHTML: (attrs) => (attrs.align && attrs.align !== "left" ? { "data-align": attrs.align } : {}),
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setImageWidth:
        (width: number) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { width }),
      setImageAlign:
        (align: ImageAlign) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { align }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },

  /**
   * 自定义 markdown 序列化。
   *
   * ⚠️ 必须自己写：`tiptap-markdown` 默认用 prosemirror-markdown 的
   * `nodes.image`，它只输出 `![alt](src)` —— **width / align 会被静默丢弃**，
   * 表现为「编辑态调了宽度、刷新就没了」（数据根本没落库）。
   * markdown 语法本身表达不了图片尺寸，所以带属性时**输出 HTML**：
   * `Markdown.configure({ html: true })` 已开启，markdown-it 解析得回来。
   *
   * 既有约定：无额外属性时仍走标准 markdown 语法（保持文档源干净、
   * 与外部编辑器互通）；只有真的调过宽/对齐才降级为 HTML。
   */
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: Record<string, unknown> }) {
          const src = String(node.attrs.src ?? "");
          const alt = String(node.attrs.alt ?? "");
          const title = node.attrs.title ? String(node.attrs.title) : "";
          const width = node.attrs.width as number | null;
          const align = (node.attrs.align as string) || "left";
          const hasExtra = !!width || align !== "left";
          if (!hasExtra) {
            // 无额外属性 → 标准 markdown（不引入 HTML 噪声）
            state.write(`![${alt}](${src}${title ? ` "${title}"` : ""})`);
            return;
          }
          const style: string[] = [];
          // 与渲染一致：没设宽度才不写 width，其余情况一并带上兜底
          if (width) style.push(`width:${width}%`);
          if (align === "center") style.push("margin:0 auto");
          if (align === "right") style.push("margin-left:auto;margin-right:0");
          const attrs = [
            `src="${src}"`,
            alt ? `alt="${alt}"` : "",
            width ? `data-width="${width}"` : "",
            align !== "left" ? `data-align="${align}"` : "",
            style.length ? `style="${style.join(";")}"` : "",
          ]
            .filter(Boolean)
            .join(" ");
          state.write(`<img ${attrs} />`);
        },
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    // 编辑态与只读态都要把 `/api/v1/media/...` 补成绝对地址
    // （本地前后端分端口时相对路径会 404）；文档源里仍是根绝对路径。
    const { width, align, ...rest } = HTMLAttributes;
    // 与编辑态保持一致：没设过宽度就不干预（保持原始尺寸），
    // 只加 max-width 兜底防溢出。设过则按百分比。
    const styleParts: string[] = ["max-width:100%", "height:auto"];
    if (width) styleParts.push(`width:${width}%`);
    if (align === "center") styleParts.push("margin:0 auto");
    if (align === "right") styleParts.push("margin-left:auto;margin-right:0");
    return [
      "img",
      {
        ...rest,
        ...(width ? { "data-width": width } : {}),
        ...(align && align !== "left" ? { "data-align": align } : {}),
        style: styleParts.join(";"),
        src: mediaUrl(rest.src as string),
      },
    ];
  },
});