"use client";

import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/lib/markdown";

/**
 * 图片扩展：在默认 Image 之上补三件事（**不引第三方 resize 扩展** —— 本项目
 * 装 tiptap 扩展踩过 peer 冲突，且行为要自己可控）。
 *
 * 1. **宽度**：拖动右下角手柄调整（按百分比存，换主题/换屏宽时比例不变；
 *    存像素则在窄屏会溢出）。
 * 2. **对齐**：左 / 中 / 右 —— 用 `textAlign` 的思路不行（img 是 inline 元素、
 *    父块对齐会影响整段），因此用 margin 自动值表达，只影响图片自身。
 * 3. **选中即浮出工具条**：替代方案「固定工具栏里点图片按钮」需要用户先选中
 *    再回工具栏，多一步；浮条贴在图片上更直接。
 *
 * 属性全部落进 HTML（`width` / `data-align`），经 `tiptap-markdown` 的
 * `html: true` 原样保存在 markdown 里，**往返不丢**。
 */

export type ImageAlign = "left" | "center" | "right";

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

/** 拖动手柄的组件：鼠标按下后按水平位移换算百分比。 */
function ResizeHandle({
  onDrag,
}: {
  onDrag: (deltaPercent: number, phase: "move" | "end") => void;
}) {
  const startX = useRef(0);
  const dragging = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      // 按窗口宽度换算 —— 图片宽度本身就是容器的百分比，用窗口宽度做基准
      // 会让「拖 100px」在宽窄窗下效果不一致；但拿容器宽度需要 ref，
      // 这里用 800 作为典型正文宽度近似，够直观且无额外 DOM 依赖。
      onDrag(((e.clientX - startX.current) / 800) * 100, "move");
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      onDrag(0, "end");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onDrag]);

  return (
    <span
      data-testid="img-resize-handle"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startX.current = e.clientX;
        dragging.current = true;
      }}
      title="拖动调整宽度"
      className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-accent shadow"
    />
  );
}

function ImageNodeView({ node, updateAttributes, selected, deleteNode, editor }: NodeViewProps) {
  // 拖动中的临时宽度：避免每一帧都写回文档（那会产生大量 undo 步骤）
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  // 未显式设过宽度时：按图片**原始尺寸**显示，但不超过容器宽度。
  // 不能用 100%（会无条件拉满：一张 200×100 的小图被拉到正文整宽、
  // 高度按比例放大到几百像素，既失真又占满一屏）。
  const width = dragWidth ?? (node.attrs.width as number | null);
  const align = ((node.attrs.align as ImageAlign) || "left") as ImageAlign;

  const onDrag = (delta: number, phase: "move" | "end") => {
    // 拖动起点：没设过宽度时按 100% 起算（此时图片是原始尺寸，
    // 但用户一拖就是要显式指定宽度，从满宽开始最符合直觉）
    const base = width ?? 100;
    if (phase === "move") {
      setDragWidth(Math.max(MIN_W, Math.min(100, base + delta)));
    } else {
      // 松手才落库 —— 一次拖动 = 一步 undo
      if (dragWidth !== null) updateAttributes({ width: dragWidth });
      setDragWidth(null);
    }
  };

  const margin =
    align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : undefined;

  // 只读态不显示手柄与工具条
  const editable = editor.isEditable;

  return (
    <NodeViewWrapper
      as="div"
      className="doc-image-wrap relative my-2"
      style={{ display: "flex", justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start" }}
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
        <img
          src={mediaUrl(node.attrs.src as string)}
          alt={(node.attrs.alt as string) || ""}
          title={(node.attrs.title as string) || undefined}
          draggable={false}
          style={{ maxWidth: "100%", height: "auto" }}
          className={`block rounded-md ${selected ? "ring-2 ring-accent" : ""}`}
        />
        {editable && selected && (
          <>
            <ResizeHandle onDrag={onDrag} />
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