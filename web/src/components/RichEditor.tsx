"use client";

import { useEditor, EditorContent } from "@tiptap/react";
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
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
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

  return (
    <div className="flex min-h-[calc(100vh-300px)] flex-col rounded-lg border border-line bg-background">
      {/* 格式工具栏 */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1.5">
        <ToolBtn title="加粗" shortcut="⌘B" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")}>
          <span className="text-[16px] font-bold leading-none">B</span>
        </ToolBtn>
        <ToolBtn title="斜体" shortcut="⌘I" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")}>
          <span className="font-serif text-[16px] italic leading-none">I</span>
        </ToolBtn>
        <ToolBtn title="删除线" shortcut="⌘⇧X" onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")}>
          <span className="text-[16px] leading-none line-through">S</span>
        </ToolBtn>
        <ToolBtn title="行内代码" shortcut="⌘E" onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")}>
          <CodeIcon size={16} />
        </ToolBtn>

        <ToolDivider />

        <ToolBtn title="一级标题" shortcut="⌥⌘1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })}>
          <span className="text-[15px] font-semibold leading-none">H1</span>
        </ToolBtn>
        <ToolBtn title="二级标题" shortcut="⌥⌘2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })}>
          <span className="text-[15px] font-semibold leading-none">H2</span>
        </ToolBtn>
        <ToolBtn title="三级标题" shortcut="⌥⌘3" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })}>
          <span className="text-[15px] font-semibold leading-none">H3</span>
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
      </div>

      <EditorContent
        editor={editor}
        className="md-body rich-editor flex-1 px-4 py-3"
      />
    </div>
  );
}
