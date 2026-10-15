"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, {
  SuggestionPluginKey,
  type SuggestionOptions,
  type SuggestionProps,
} from "@tiptap/suggestion";

/**
 * 输入 `/` 唤起的块命令菜单（语雀 / Notion 手感）。
 *
 * 设计纪律：
 * 1. **命令动作必须与工具栏同源** —— 全部走 `editor.chain()` 的现成命令，
 *    不另写一套「插入块」逻辑。工具栏改了行为，这里自然跟随。
 * 2. **中文输入法（IME）是最大的坑，必须显式兜三处**：
 *    - `@tiptap/suggestion` 的 `handleKeyDown` **没有 composing 守卫**
 *      （读源码 `dist/index.js:125-144`：只要插件 active 就把事件交给回调）。
 *      组字时按 Enter 是「上屏候选词」，若被当成「确认命令」会插入一个
 *      用户根本没选的块 —— 灾难级缺陷，故 `onKeyDown` 第一行就拦。
 *    - 组字期间不弹菜单：`allow` 里检查 `editor.view.composing`。
 *    - 组字中的 query 是拼音串（如 "biaoti"），会命中别名而弹出误导性菜单。
 * 3. **不劫持 `/` 的普通文本用法**：只有行首或空白之后的 `/` 才触发
 *    （suggestion 默认 `allowedPrefixes: [" "]`），
 *    「https://a.com/b」这类 URL 里的斜杠不会弹菜单。
 * 4. 菜单行一律复用全站 `.menu-item` 规格（13px / 无手写行高），与 DESIGN.md 一致。
 */

export interface SlashItem {
  /** 英文动作名，供英文/拼音输入匹配。 */
  key: string;
  /** 中文标签，同时作为主要搜索词（支持直接输入中文过滤）。 */
  label: string;
  /** 右侧说明。 */
  desc: string;
  /** 额外别名（拼音全拼、英文同义词）。 */
  aliases?: string[];
  /** 图标路径（`|` 分隔多段 path）。 */
  icon: string;
  /** 执行插入 / 切换。 */
  run: (editor: Editor, range: Range) => void;
}

/**
 * 菜单项定义。顺序即展示顺序：标题 → 正文 → 列表 → 引用/代码 → 插入物，
 * 与常见块菜单的分组习惯一致。
 */
export const SLASH_ITEMS: SlashItem[] = [
  {
    key: "h1",
    label: "一级标题",
    desc: "大标题",
    aliases: ["h1", "yijibiaoti", "title1", "biaoti"],
    icon: "M4 6v12M12 6v12M4 12h8M17 18V8l-2 1.5",
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 1 }).run(),
  },
  {
    key: "h2",
    label: "二级标题",
    desc: "中标题",
    aliases: ["h2", "erjibiaoti", "title2", "biaoti"],
    icon: "M4 6v12M12 6v12M4 12h8M16 8h4l-4 5h4",
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 2 }).run(),
  },
  {
    key: "h3",
    label: "三级标题",
    desc: "小标题",
    aliases: ["h3", "sanjibiaoti", "title3", "biaoti"],
    icon: "M4 6v12M12 6v12M4 12h8M16 8h3l-3 3h3l-3 3h3",
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 3 }).run(),
  },
  {
    key: "h4",
    label: "四级标题",
    desc: "更小标题",
    aliases: ["h4", "sijibiaoti", "title4", "biaoti"],
    icon: "M4 6v12M12 6v12M4 12h8M17 7v6M15 13h5l-3 5",
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 4 }).run(),
  },
  {
    key: "text",
    label: "正文",
    desc: "普通段落",
    aliases: ["p", "zhengwen", "paragraph", "text"],
    icon: "M4 6h16M4 12h12M4 18h8",
    run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run(),
  },
  {
    key: "bullet",
    label: "无序列表",
    desc: "圆点列表",
    aliases: ["ul", "wuxuliebiao", "bullet", "list", "liebiao"],
    icon: "M4 6h.01M4 12h.01M4 18h.01M8 6h12M8 12h12M8 18h12",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    key: "ordered",
    label: "有序列表",
    desc: "数字列表",
    aliases: ["ol", "youxuliebiao", "ordered", "number", "liebiao"],
    icon: "M4 5h1v5M3 14h3l-3 4h3M9 6h11M9 12h11M9 18h11",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    key: "task",
    label: "任务列表",
    desc: "待办清单",
    aliases: ["todo", "renwuliebiao", "task", "check", "daiban"],
    icon: "M3 5h14v14H3z|M6 12l3 3 5-6",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
  },
  {
    key: "quote",
    label: "引用",
    desc: "引用段落",
    aliases: ["quote", "yinyong", "blockquote"],
    icon: "M6 8h4v8H6zM14 8h4v8h-4z",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    key: "code",
    label: "代码块",
    desc: "等宽代码 / 高亮",
    aliases: ["code", "daimakuai", "codeblock"],
    icon: "M9 6l-5 6 5 6M15 6l5 6-5 6",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    key: "divider",
    label: "分割线",
    desc: "水平分隔",
    aliases: ["hr", "fengexian", "divider", "line", "fgx"],
    icon: "M4 12h16",
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
  {
    key: "table",
    label: "表格",
    desc: "3×3 表格",
    aliases: ["table", "biaoge", "grid"],
    icon: "M3 3h18v18H3z|M3 9h18M3 15h18M9 3v18M15 3v18",
    run: (e, r) => {
      // 与工具栏「插入表格」保持 3×3（首行为表头），不自造结构。
      const header = Array.from({ length: 3 }, () => ({
        type: "tableHeader",
        content: [{ type: "paragraph" }],
      }));
      const rows = Array.from({ length: 2 }, () => ({
        type: "tableRow",
        content: Array.from({ length: 3 }, () => ({
          type: "tableCell",
          content: [{ type: "paragraph" }],
        })),
      }));
      e.chain()
        .focus()
        .deleteRange(r)
        .insertContent({ type: "table", content: [{ type: "tableRow", content: header }, ...rows] })
        .run();
    },
  },
];

/** 过滤：中文标签包含 或 key/别名 前缀/包含匹配。空 query 返回全部。 */
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (it) =>
      it.label.includes(q) ||
      it.key.startsWith(q) ||
      it.aliases?.some((a) => a.startsWith(q) || a.includes(q)),
  );
}

/** portal 标记：让父级「点击外部关闭」逻辑放行菜单内的点击。 */
export const SLASH_MENU_ATTR = "data-slash-menu";

/** 供测试断言：当前是否弹着 slash 菜单。 */
export function isSlashMenuOpen(): boolean {
  return typeof document !== "undefined" && !!document.querySelector(`[${SLASH_MENU_ATTR}]`);
}

export interface SlashMenuHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const SlashMenu = forwardRef<SlashMenuHandle, { items: SlashItem[]; command: (item: SlashItem) => void }>(
  function SlashMenu({ items, command }, ref) {
    const [active, setActive] = useState(0);

    // 过滤结果变化时把高亮拉回第一项 —— 否则索引越界，回车会插错块。
    useEffect(() => setActive(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        // ⚠️ IME 守卫（第一优先）：组字期间 Enter 是「上屏候选词」，
        // 绝不能当成「确认命令」。keyCode 229 是组字中的 keydown 特征。
        if (event.isComposing || event.keyCode === 229) return false;
        if (event.key === "ArrowUp") {
          setActive((i) => (items.length ? (i + items.length - 1) % items.length : 0));
          return true;
        }
        if (event.key === "ArrowDown") {
          setActive((i) => (items.length ? (i + 1) % items.length : 0));
          return true;
        }
        if (event.key === "Enter") {
          const it = items[active];
          if (it) command(it);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="slash-menu" role="listbox" aria-label="插入块">
          <div className="slash-empty">没有匹配的命令</div>
        </div>
      );
    }

    return (
      <div className="slash-menu" role="listbox" aria-label="插入块">
        {items.map((it, i) => (
          <button
            key={it.key}
            type="button"
            role="option"
            aria-selected={i === active}
            // mousedown 而非 click：click 前编辑器会失焦、选区塌陷，
            // 命令执行时 range 已失效（与工具栏同款处理）。
            onMouseDown={(ev) => {
              ev.preventDefault();
              command(it);
            }}
            onMouseEnter={() => setActive(i)}
            className={`menu-item slash-item ${i === active ? "is-active" : ""}`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="slash-icon"
            >
              {it.icon.split("|").map((p, k) => (
                <path key={k} d={p} />
              ))}
            </svg>
            <span className="slash-label">{it.label}</span>
            <span className="slash-desc">{it.desc}</span>
          </button>
        ))}
      </div>
    );
  },
);

/** 菜单尺寸常量（与 CSS 保持一致，定位时用）。 */
const MENU_W = 280;
const MENU_MAX_H = 320;
const MARGIN = 8;

const SlashCommand = Extension.create<{
  suggestion: Partial<SuggestionOptions<SlashItem, SlashItem>>;
}>({
  name: "slashCommand",
  addOptions() {
    return {
      suggestion: {
        char: "/",
        pluginKey: SuggestionPluginKey,
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }: { query: string }) => filterSlashItems(query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
          props.run(editor, range);
        },
        /**
         * IME 守卫 ②：组字期间不激活菜单。
         * 另加长度上限，防止误在超长行内触发。
         */
        allow: ({ editor, range }: { editor: Editor; range: Range }) => {
          if (editor.view.composing) return false;
          return range.to - range.from <= 24;
        },
        render: () => {
          let component: ReactRenderer<SlashMenuHandle> | null = null;
          let el: HTMLElement | null = null;

          const position = (props: SuggestionProps<SlashItem, SlashItem>) => {
            if (!el) return;
            const rect = props.clientRect?.();
            if (!rect) return;
            let left = rect.left;
            let top = rect.bottom + 6;
            if (left + MENU_W > window.innerWidth - MARGIN) left = window.innerWidth - MENU_W - MARGIN;
            if (left < MARGIN) left = MARGIN;
            // 下方空间不足则向上展开（菜单不会跑出视口）
            if (top + MENU_MAX_H > window.innerHeight - MARGIN) {
              top = Math.max(MARGIN, rect.top - MENU_MAX_H - 6);
            }
            el.style.left = `${left}px`;
            el.style.top = `${top}px`;
          };

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, { props, editor: props.editor });
              el = component.element as HTMLElement;
              el.classList.add("slash-menu-anchor");
              el.setAttribute(SLASH_MENU_ATTR, "");
              // 挂到 body：编辑器工具条是 overflow 容器，inside 会被裁掉。
              document.body.appendChild(el);
              position(props);
            },
            onUpdate: (props) => {
              component?.updateProps(props);
              position(props);
            },
            onKeyDown: (props) => {
              // IME 守卫（与菜单内部重复一道：这里能拦住「还没渲染出参考」的边界）
              if (props.event.isComposing || props.event.keyCode === 229) return false;
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              el?.remove();
              component?.destroy();
              el = null;
              component = null;
            },
          };
        },
      },
    };
  },
  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },
});

/** 供外部显式关闭（如文档切换时）。 */
export function closeSlashMenu(editor: Editor | null) {
  if (!editor) return;
  try {
    editor.view.dispatch(editor.state.tr.setMeta(SuggestionPluginKey, { exit: true }));
  } catch {
    /* 编辑器已销毁：忽略 */
  }
}

export default SlashCommand;