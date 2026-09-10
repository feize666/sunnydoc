"use client";

import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Mark, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Markdown } from "tiptap-markdown";
import { Tooltip } from "./Tooltip";
import {
  CodeIcon,
  CodeBlockIcon,
  ListUlIcon,
  ListOlIcon,
  QuoteIcon,
  ImageIcon,
  MinusIcon,
  LinkIcon,
} from "./icons";

/* ---------- 自写扩展（不引第三方，@tiptap/core 已内置） ---------- */

const Underline = Mark.create({
  name: "underline",
  parseHTML() {
    return [{ tag: "u" }, { style: "text-decoration: underline" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["u", mergeAttributes(HTMLAttributes), 0];
  },
});

const Highlight = Mark.create({
  name: "highlight",
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes, { style: "background-color: #fde68a" }), 0];
  },
});

const Color = Mark.create({
  name: "color",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).style.color || null,
        renderHTML: (attrs) => (attrs.color ? { style: `color: ${attrs.color}` } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span", getAttrs: (el) => ((el as HTMLElement).style.color ? {} : false) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

const COLORS = ["#111827", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#2563eb", "#9333ea"];

function ToolBtn({
  title,
  shortcut,
  onClick,
  active,
  children,
}: {
  title: string;
  shortcut?: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={shortcut ? `${title}（${shortcut}）` : title}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={`flex h-9 min-w-[34px] items-center justify-center rounded-md px-2 text-muted transition-colors ${
          active ? "bg-active text-accent" : "hover:bg-hover hover:text-text"
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function ToolDivider() {
  return <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden />;
}

/** 所见即所得 Markdown 编辑器（TipTap），内置工具栏。 */
export function RichEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
}) {
  const [colorOpen, setColorOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Underline,
      Highlight,
      Color,
      Link.configure({ openOnClick: false }),
      Image,
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: "-",
        linkify: true,
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "开始输入内容…",
      }),
    ],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const markdown = (editor.storage as { markdown?: { getMarkdown(): string } })
        .markdown?.getMarkdown();
      if (markdown != null) onChange(markdown);
    },
  });

  if (!editor) {
    return (
      <div className="min-h-[calc(100vh-300px)] flex-1 rounded-lg border border-line bg-background" />
    );
  }

  const setLink = () => {
    const url = window.prompt("输入链接地址", "https://");
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const setImage = () => {
    const url = window.prompt("输入图片地址", "https://");
    if (url && url.trim()) {
      editor.chain().focus().setImage({ src: url.trim() }).run();
    }
  };

  const headingValue = editor.isActive("heading", { level: 1 })
    ? "1"
    : editor.isActive("heading", { level: 2 })
    ? "2"
    : editor.isActive("heading", { level: 3 })
    ? "3"
    : editor.isActive("heading", { level: 4 })
    ? "4"
    : "p";

  const setHeading = (v: string) => {
    if (v === "p") editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level: Number(v) as 1 | 2 | 3 | 4 }).run();
  };

  const currentColor = (COLORS.find((c) => editor.isActive("color", { color: c })) ?? "");

  return (
    <div className="flex min-h-[calc(100vh-300px)] flex-col rounded-lg border border-line bg-background">
      {/* 格式工具栏 */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1.5">
        {/* 标题下拉 */}
        <select
          value={headingValue}
          onChange={(e) => setHeading(e.target.value)}
          onMouseDown={(e) => e.preventDefault()}
          className="h-8 w-[86px] cursor-pointer rounded-md border border-line bg-background px-1.5 text-[13px] text-text outline-none hover:bg-hover"
          title="标题"
        >
          <option value="p">正文</option>
          <option value="1">标题 1</option>
          <option value="2">标题 2</option>
          <option value="3">标题 3</option>
          <option value="4">标题 4</option>
        </select>

        <ToolDivider />

        <ToolBtn title="加粗" shortcut="⌘B" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")}>
          <span className="text-[16px] font-bold leading-none">B</span>
        </ToolBtn>
        <ToolBtn title="斜体" shortcut="⌘I" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")}>
          <span className="font-serif text-[16px] italic leading-none">I</span>
        </ToolBtn>
        <ToolBtn title="下划线" shortcut="⌘U" onClick={() => editor.chain().focus().toggleMark("underline").run()} active={editor.isActive("underline")}>
          <span className="text-[16px] leading-none underline underline-offset-2">U</span>
        </ToolBtn>
        <ToolBtn title="删除线" shortcut="⌘⇧X" onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")}>
          <span className="text-[16px] leading-none line-through">S</span>
        </ToolBtn>
        <ToolBtn title="行内代码" shortcut="⌘E" onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")}>
          <CodeIcon size={16} />
        </ToolBtn>

        <ToolDivider />

        {/* 文字颜色 */}
        <div className="relative">
          <Tooltip content="文字颜色">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setColorOpen((v) => !v)}
              className={`flex h-9 min-w-[34px] items-center justify-center rounded-md px-2 transition-colors ${
                currentColor ? "text-accent" : "text-muted hover:bg-hover hover:text-text"
              }`}
            >
              <span className="text-[16px] leading-none">
                A
                <span className="ml-0.5 inline-block h-[3px] w-[16px] rounded-sm align-middle" style={{ background: currentColor || "currentColor" }} />
              </span>
            </button>
          </Tooltip>
          {colorOpen && (
            <div className="menu-panel absolute left-0 top-full z-30 mt-1 flex items-center gap-1 p-1.5" onMouseLeave={() => setColorOpen(false)}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    editor.chain().focus().setMark("color", { color: c }).run();
                    setColorOpen(false);
                  }}
                  className={`h-5 w-5 rounded-full border border-line ${editor.isActive("color", { color: c }) ? "ring-2 ring-accent ring-offset-1" : ""}`}
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          )}
        </div>
        <ToolBtn title="高亮" onClick={() => editor.chain().focus().toggleMark("highlight").run()} active={editor.isActive("highlight")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l-3.5 3.5a1.5 1.5 0 0 0 2 2L11 13" />
            <path d="M13 15l3.5-3.5a1.5 1.5 0 0 0-2-2L11 13" />
            <path d="M3 21h18" />
          </svg>
        </ToolBtn>

        <ToolDivider />

        <ToolBtn title="无序列表" shortcut="⌘⇧8" onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")}>
          <ListUlIcon size={17} />
        </ToolBtn>
        <ToolBtn title="有序列表" shortcut="⌘⇧7" onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")}>
          <ListOlIcon size={17} />
        </ToolBtn>

        <ToolDivider />

        <ToolBtn title="引用" shortcut="⌘⇧B" onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")}>
          <QuoteIcon size={17} />
        </ToolBtn>
        <ToolBtn title="代码块" shortcut="⌥⌘C" onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")}>
          <CodeBlockIcon size={17} />
        </ToolBtn>
        <ToolBtn title="分割线" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <MinusIcon size={17} />
        </ToolBtn>

        <ToolDivider />

        <ToolBtn title="链接" shortcut="⌘K" onClick={setLink} active={editor.isActive("link")}>
          <LinkIcon size={17} />
        </ToolBtn>
        <ToolBtn title="图片" onClick={setImage}>
          <ImageIcon size={17} />
        </ToolBtn>

        <ToolDivider />

        <ToolBtn title="撤销" shortcut="⌘Z" onClick={() => editor.chain().focus().undo().run()} active={false}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
          </svg>
        </ToolBtn>
        <ToolBtn title="重做" shortcut="⌘⇧Z" onClick={() => editor.chain().focus().redo().run()} active={false}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
          </svg>
        </ToolBtn>
      </div>

      <EditorContent
        editor={editor}
        className="md-body rich-editor flex-1 px-4 py-3"
      />
    </div>
  );
}
