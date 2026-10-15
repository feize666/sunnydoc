"use client";

/**
 * 编辑器内 @ 提及 / [[文档引用]] 的 Suggestion 唤起（P2-2）。
 *
 * 复用 `SlashCommand` 的设计纪律 —— 把"三道 IME 守卫"原样搬过来：
 *  1. `allow` 里查 `editor.view.composing`
 *  2. `onKeyDown` 查 `event.isComposing || event.keyCode === 229`
 *  3. 菜单渲染层不强制键盘焦点（IME 候选词面板是浏览器层的）
 *
 * 节点落点：都用 TipTap 的 `Link` 节点，class 区分（mention / wikilink）。
 * 不引入 `@tiptap/extension-mention` —— 已有 Link 足够，且与 markdown 渲染
 * 链路一致（`.wikilink` 已存在于 `markdown.ts` 与 globals.css）。
 *
 * 🔴 一次踩到过的坑：必须用**各自独立**的 `pluginKey`，否则同 editor 上多个
 * Suggestion 会互相覆盖 active 状态（@ 与 [[ 同时挂载会乱）。
 */

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, {
  type SuggestionOptions,
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { searchUsers, searchDocumentsByTitle, type UserBrief } from "@/lib/api";

/* =======================================================================
 * 🔴 `[[` 与 prosemirror-markdown 的转义冲突（本功能最大的坑）
 *
 * `prosemirror-markdown` 的 `MarkdownSerializerState.esc()`（dist/index.js:822）
 * 有一行硬编码：
 *     .replace(/[`*\\~\[\]_]/g, m => "\\" + m)
 * **`[` 就在表里** → 纯文本 `[[WSL安装指南]]` 序列化成 `\[\[WSL安装指南\]\]`，
 * 落库后再也用 markdown 的 wikilink 规则解析不回来（预览 0 个 .wikilink）。
 *
 * 试过但**无效**的路（别再试）：
 *  1. 自定义 Mark 包住文本 —— Mark 的 markdown serialize 只控制 open/close 包装，
 *     节点文本本身仍走 `state.text()` → 照样被 esc。
 *  2. `addStorage().markdown.serialize` 里 `state.text(t, false)` —— 签名不匹配
 *     （Mark 的 spec 是 `{open, close}` 或 prosemirror 函数），运行时报
 *     `value is not a function`。
 *
 * **采用方案**：在保存出口（RichEditor 的 onUpdate）对 `getMarkdown()` 的输出
 * 做一次「反 esc」—— 只把 `\[` 还原成 `[`，且**仅当它是 `[[` 或 `]]` 的一半时**，
 * 避免误伤用户真的想写 `\[` 的场景（那种极少，且用户本意就是字面 `[`）。
 * 这是最小侵入且可验证的做法。
 * ======================================================================= */

/** 保存出口的「反 esc」：`\[\[x\]\]` → `[[x]]`。只在成对出现时还原。 */
export function unescapeWikilinkBrackets(markdown: string): string {
  // 先处理成对：`\[\[ ... \]\]` → `[[ ... ]]`
  let out = markdown.replace(/\\\[\\\[([^\]\n]*?)\\\]\\\]/g, "[[$1]]");
  // 再兜底：单独出现的 `\[\[` / `\]\]`（比如用户只打了一半）
  out = out.replace(/\\\[\\\[/g, "[[").replace(/\\\]\\\]/g, "]]");
  return out;
}

interface MentionUser extends UserBrief {
  mention: string;
}

interface DocPick {
  id: string;
  title: string;
  kb_id?: string | null;
  folder_id?: string | null;
}

export interface PickerItem {
  key: string;
  label: string;
  desc?: string;
  icon: string;
  run: (editor: Editor, range: Range) => void;
}

interface CommonOptions {
  char: string;
  pluginKey: PluginKey;
  minQuery?: number;
  fetch: (query: string) => Promise<PickerItem[]>;
  allow?: (ctx: { editor: Editor; range: Range }) => boolean;
}

function createSuggestExtension(opts: CommonOptions) {
  return Extension.create<{ suggestion: Partial<SuggestionOptions<PickerItem, PickerItem>> }>({
    name: `picker-${opts.char}`,
    addOptions() {
      return {
        suggestion: {
          char: opts.char,
          pluginKey: opts.pluginKey,
          startOfLine: false,
          allowSpaces: false,
          minQuery: opts.minQuery ?? 0,
          items: ({ query }: { query: string }) => opts.fetch(query),
          command: ({ editor, range, props }) => {
            props.run(editor, range);
          },
          allow: ({ editor, range }) => {
            if (editor.view.composing) return false;
            if (range.to - range.from > 24) return false;
            return opts.allow ? opts.allow({ editor, range }) : true;
          },
          render: () => {
            let component: ReactRenderer<PickerListHandle> | null = null;
            let popup: HTMLDivElement | null = null;
            return {
              onStart: (props: SuggestionProps<PickerItem, PickerItem>) => {
                component = new ReactRenderer(PickerList, { props, editor: props.editor });
                popup = document.createElement("div");
                popup.style.position = "fixed";
                popup.style.zIndex = "60";
                popup.appendChild(component.element);
                document.body.appendChild(popup);
                place(popup, props.clientRect?.() ?? null);
              },
              onUpdate: (props: SuggestionProps<PickerItem, PickerItem>) => {
                component?.updateProps(props);
                place(popup, props.clientRect?.() ?? null);
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                // 守卫 3：组字中不接管 Enter
                const ev = props.event as KeyboardEvent;
                if (ev.isComposing || ev.keyCode === 229) return false;
                if (ev.key === "Escape") {
                  popup?.remove();
                  component?.destroy();
                  return true;
                }
                if (component?.ref) return component.ref.onKeyDown(ev);
                return false;
              },
              onExit: () => {
                popup?.remove();
                component?.destroy();
                component = null;
                popup = null;
              },
            };
          },
        },
      };
    },
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
        }),
      ];
    },
  });
}

interface PickerListProps {
  items: PickerItem[];
  command: (item: PickerItem) => void;
  activeIndex?: number;
}

export interface PickerListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const PickerList = forwardRef<PickerListHandle, PickerListProps>(function PickerList(
  { items, command, activeIndex = 0 },
  ref,
) {
  const [hoverIdx, setHoverIdx] = useState(activeIndex);

  useEffect(() => {
    setHoverIdx(activeIndex);
  }, [activeIndex]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHoverIdx((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHoverIdx((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const it = items[hoverIdx];
        if (it) {
          event.preventDefault();
          command(it);
        }
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return <div data-picker-menu className="slash-empty">无匹配</div>;
  }
  return (
    <div data-picker-menu className="slash-menu">
      {items.map((it, i) => (
        <button
          key={it.key}
          type="button"
          className={`slash-item ${i === hoverIdx ? "is-active" : ""}`}
          onMouseEnter={() => setHoverIdx(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            command(it);
          }}
        >
          <span className="slash-icon" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={it.icon} />
            </svg>
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[13px] text-text">{it.label}</span>
            {it.desc && (
              <span className="block truncate text-[11px] text-faint">{it.desc}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
});

export const MentionPluginKey = new PluginKey("mention-picker");

function insertMention(editor: Editor, range: Range, u: MentionUser) {
  // 插入字面 `@昵称` + 空格（`@` 不在 esc 表里，无需特殊处理）。
  // 预览渲染由 markdown.ts 的 mention 规则负责。
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent([{ type: "text", text: "@" + (u.nickname || u.username) }, { type: "text", text: " " }])
    .run();
}

export const MentionCommand = createSuggestExtension({
  char: "@",
  pluginKey: MentionPluginKey,
  fetch: async (q) => {
    try {
      const users = (await searchUsers(q)) as MentionUser[];
      return users.map((u) => ({
        key: "u:" + u.id,
        label: "@" + (u.nickname || u.username),
        desc: "@" + u.username,
        icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
        run: (e: Editor, r: Range) => insertMention(e, r, u),
      }));
    } catch {
      return [];
    }
  },
  // @ 之前必须是空白或行首；URL/邮箱里的 @ 不会误触
  allow: ({ editor, range }) => {
    if (range.from === 0) return true;
    const textBefore = editor.state.doc.textBetween(Math.max(0, range.from - 1), range.from, "\n", "\0");
    return /[\s\n（(「]/.test(textBefore) || textBefore === "";
  },
});

export const WikilinkPluginKey = new PluginKey("wikilink-picker");

function insertWikilink(editor: Editor, range: Range, d: DocPick) {
  // 插入字面 `[[标题]]` + 空格。`[` 会被 prosemirror-markdown 转义成 `\[\[`，
  // 由 RichEditor 保存出口的 `unescapeWikilinkBrackets()` 还原（见本文件顶部说明）。
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent([{ type: "text", text: "[[" + d.title + "]]" }, { type: "text", text: " " }])
    .run();
}

export const WikilinkCommand = createSuggestExtension({
  // 关键：必须用 `[[` 整体作触发字符，TipTap 3 Suggestion 的 `findSuggestionMatch`
  // 用 `escapeForRegEx(char)` 拼正则，单字符 `[` 会被当成字符类起头（regex 报错或不匹配），
  // `[[` 整串则两个 `[` 都被转义为字面，匹配工作正常。**单 `[` 不会触发本扩展**，
  // 用户必须连按两次 —— 这本身就是「避免数组字面量误触」的双保险。
  char: "[[",
  pluginKey: WikilinkPluginKey,
  fetch: async (q) => {
    try {
      const docs = (await searchDocumentsByTitle(q)) as DocPick[];
      return docs.map((d) => ({
        key: "d:" + d.id,
        label: "[[" + d.title + "]]",
        desc: "按 Enter 引用",
        icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
        run: (e: Editor, r: Range) => insertWikilink(e, r, d),
      }));
    } catch {
      return [];
    }
  },
});

function place(popup: HTMLDivElement | null, rect: DOMRect | null) {
  if (!popup || !rect) return;
  const margin = 6;
  const top = rect.bottom + margin;
  popup.style.left = `${rect.left}px`;
  popup.style.top = `${top}px`;
  requestAnimationFrame(() => {
    const r = popup.getBoundingClientRect();
    if (r.bottom > window.innerHeight) {
      popup.style.top = `${Math.max(4, rect.top - r.height - margin)}px`;
    }
    if (r.right > window.innerWidth) {
      popup.style.left = `${Math.max(4, window.innerWidth - r.width - 4)}px`;
    }
  });
}
