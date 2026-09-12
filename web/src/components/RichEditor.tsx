"use client";

import { useState, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Mark, Node, Extension, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Markdown } from "tiptap-markdown";
import { uploadImage, aiAssist } from "@/lib/api";
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
  SearchReplaceIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  CloseIcon,
  TranslateIcon,
  FormatPaintIcon,
  ClearFormatIcon,
  IndentIcon,
  OutdentIcon,
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

const BackgroundColor = Mark.create({
  name: "backgroundColor",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).style.backgroundColor || null,
        renderHTML: (attrs) => (attrs.color ? { style: `background-color: ${attrs.color}` } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span", getAttrs: (el) => ((el as HTMLElement).style.backgroundColor ? {} : false) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

/* ---------- 表格（自写，GFM 序列化由 tiptap-markdown 支持） ---------- */

const TableCell = Node.create({
  name: "tableCell",
  content: "block+",
  parseHTML() {
    return [{ tag: "td" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["td", mergeAttributes(HTMLAttributes), 0];
  },
});

const TableHeader = Node.create({
  name: "tableHeader",
  content: "block+",
  parseHTML() {
    return [{ tag: "th" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["th", mergeAttributes(HTMLAttributes), 0];
  },
});

const TableRow = Node.create({
  name: "tableRow",
  content: "(tableCell | tableHeader)*",
  parseHTML() {
    return [{ tag: "tr" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["tr", mergeAttributes(HTMLAttributes), 0];
  },
});

const Table = Node.create({
  name: "table",
  content: "tableRow+",
  group: "block",
  parseHTML() {
    return [{ tag: "table" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["table", mergeAttributes(HTMLAttributes), ["tbody", 0]];
  },
});

/* ---------- 任务列表（自写） ---------- */

const TaskItem = Node.create({
  name: "taskItem",
  content: "paragraph block*",
  defining: true,
  addAttributes() {
    return {
      checked: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-checked") === "true",
        renderHTML: (attrs) => ({ "data-checked": attrs.checked }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "li[data-type='taskItem']" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "li",
      mergeAttributes(HTMLAttributes, { "data-type": "taskItem" }),
      [
        "label",
        ["input", { type: "checkbox", checked: node.attrs.checked, contenteditable: "false" }],
        ["span", 0],
      ],
    ];
  },
});

const TaskList = Node.create({
  name: "taskList",
  content: "taskItem+",
  group: "block list",
  parseHTML() {
    return [{ tag: "ul[data-type='taskList']" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ul", mergeAttributes(HTMLAttributes, { "data-type": "taskList" })];
  },
  addCommands() {
    return {
      toggleTaskList:
        () =>
        ({ commands }: { commands: { toggleList: (l: string, i: string) => boolean } }) =>
          commands.toggleList("taskList", "taskItem"),
    };
  },
});

/* ---------- 文本对齐（左/中/右，作用于段落和标题） ---------- */

const TextAlign = Extension.create({
  name: "textAlign",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).style.textAlign || null,
            renderHTML: (attrs) => (attrs.textAlign ? { style: `text-align: ${attrs.textAlign}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setTextAlign:
        (align: string) =>
        ({ commands }: { commands: { updateAttributes: (t: string, a: object) => boolean } }) => {
          // 同时作用于段落和标题，不用 every（会因某个 type 不在选区而短路）
          const a = commands.updateAttributes("paragraph", { textAlign: align });
          const b = commands.updateAttributes("heading", { textAlign: align });
          return a || b;
        },
      unsetTextAlign:
        () =>
        ({ commands }: { commands: { resetAttributes: (t: string, a: string) => boolean } }) => {
          const a = commands.resetAttributes("paragraph", "textAlign");
          const b = commands.resetAttributes("heading", "textAlign");
          return a || b;
        },
    } as unknown as Partial<Record<string, unknown>>;
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    setTextAlign: (align: string) => ReturnType;
    unsetTextAlign: () => ReturnType;
  }
}

const COLORS = ["#111827", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#2563eb", "#9333ea"];

// 代码块支持的语言（与 lib/markdown.ts 中 shiki 注册的语言保持一致）
const CODE_LANGS = [
  "text",
  "javascript",
  "typescript",
  "python",
  "json",
  "bash",
  "shell",
  "sql",
  "css",
  "html",
  "xml",
  "markdown",
  "yaml",
  "java",
  "go",
  "rust",
] as const;

function ToolBtn({
  title,
  shortcut,
  onClick,
  active,
  disabled,
  tone,
  children,
}: {
  title: string;
  shortcut?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={shortcut ? `${title}（${shortcut}）` : title}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        disabled={disabled}
        className={`flex h-9 min-w-[34px] shrink-0 items-center justify-center rounded-md px-2 transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
          active
            ? "bg-active text-accent"
            : tone
              ? `${tone} hover:bg-hover`
              : "text-muted hover:bg-hover hover:text-text"
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
  // 背景色（填充）
  const [bgColorOpen, setBgColorOpen] = useState(false);
  // 链接弹窗
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  // 图片弹窗
  const [imageOpen, setImageOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  // 查找替换
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findIdx, setFindIdx] = useState(0);
  // 格式刷：暂存复制的 marks（null 表示未启用）
  const [painterMarks, setPainterMarks] = useState<Record<string, unknown> | null>(null);
  // 翻译进行中
  const [translating, setTranslating] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Underline,
      Highlight,
      Color,
      BackgroundColor,
      Table,
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem,
      TextAlign,
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
    editorProps: {
      handleKeyDown: (view, event) => {
        if (!editor) return false;
        const mod = event.metaKey || event.ctrlKey;
        if (!mod) return false;
        const key = event.key;
        // ⌘1-6 标题
        if (key >= "1" && key <= "6" && !event.shiftKey && !event.altKey) {
          editor.chain().focus().toggleHeading({ level: Number(key) as 1 | 2 | 3 | 4 }).run();
          return true;
        }
        // ⌘0 正文
        if (key === "0" && !event.shiftKey && !event.altKey) {
          editor.chain().focus().setParagraph().run();
          return true;
        }
        // ⌘⇧K 代码块（Typora）
        if (key === "K" && event.shiftKey) {
          editor.chain().focus().toggleCodeBlock().run();
          return true;
        }
        // ⌘T 表格（Typora）
        if (key.toLowerCase() === "t" && !event.shiftKey && !event.altKey) {
          const rows = 3;
          const cols = 3;
          const headerCells = Array.from({ length: cols }, () => ({ type: "tableHeader", content: [{ type: "paragraph" }] }));
          const bodyRows = Array.from({ length: rows - 1 }, () => ({
            type: "tableRow",
            content: Array.from({ length: cols }, () => ({ type: "tableCell", content: [{ type: "paragraph" }] })),
          }));
          editor
            .chain()
            .focus()
            .insertContent({ type: "table", content: [{ type: "tableRow", content: headerCells }, ...bodyRows] })
            .run();
          return true;
        }
        // ⌘⇧I 图片
        if (key === "I" && event.shiftKey) {
          setImageUrl("");
          setImageOpen(true);
          return true;
        }
        // ⌘⇧L 无序列表（Typora）
        if (key === "L" && event.shiftKey) {
          editor.chain().focus().toggleBulletList().run();
          return true;
        }
        // ⌘⇧U 有序列表
        if (key === "U" && event.shiftKey) {
          editor.chain().focus().toggleOrderedList().run();
          return true;
        }
        // ⌘] 缩进
        if (key === "]") {
          editor.chain().focus().sinkListItem("listItem").run();
          return true;
        }
        // ⌘[ 反缩进
        if (key === "[") {
          editor.chain().focus().liftListItem("listItem").run();
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              uploadImage(file)
                .then((url) => {
                  const { state, dispatch } = view;
                  const node = state.schema.nodes.image.create({ src: url });
                  dispatch(state.tr.replaceSelectionWith(node));
                })
                .catch(() => {
                  /* 上传失败静默忽略 */
                });
            }
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const markdown = (editor.storage as { markdown?: { getMarkdown(): string } })
        .markdown?.getMarkdown();
      if (markdown != null) onChange(markdown);
    },
  });

  // 任务列表 checkbox 点击切换（必须放在 early return 之前，避免 conditional hook 触发 React #310）
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onClick = (e: MouseEvent) => {
      const input = (e.target as HTMLElement).closest("input[type='checkbox']");
      if (!input) return;
      const li = (input as HTMLElement).closest("li[data-type='taskItem']");
      if (!li) return;
      const pos = editor.view.posAtDOM(li, 0);
      const node = editor.state.doc.nodeAt(pos);
      if (node && node.type.name === "taskItem") {
        editor
          .chain()
          .focus()
          .updateAttributes("taskItem", { checked: !node.attrs.checked })
          .run();
      }
    };
    dom.addEventListener("click", onClick);
    return () => dom.removeEventListener("click", onClick);
  }, [editor]);

  // 全局快捷键：⌘F / Ctrl+F 打开查找替换
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
        const sel = editor?.state.selection;
        if (sel && sel.from !== sel.to) {
          setFindText(editor.state.doc.textBetween(sel.from, sel.to, " "));
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor]);

  // 格式刷：启用后，用户拖动选中目标文字时应用复制的 marks
  useEffect(() => {
    if (!editor || !painterMarks) return;
    const handler = () => {
      const { from, to } = editor.state.selection;
      if (from === to) return;
      const chain = editor.chain().focus();
      for (const [name, attrs] of Object.entries(painterMarks)) {
        chain.setMark(name, (attrs as Record<string, unknown>) || {});
      }
      chain.run();
      setPainterMarks(null);
    };
    editor.on("selectionUpdate", handler);
    return () => {
      editor.off("selectionUpdate", handler);
    };
  }, [editor, painterMarks]);

  if (!editor) {
    return (
      <div className="min-h-[calc(100vh-300px)] flex-1 rounded-lg border border-line bg-background" />
    );
  }

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    setLinkUrl(prev ?? "");
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkOpen(false);
  };

  const setImage = () => {
    setImageUrl("");
    setImageOpen(true);
  };

  const applyImage = () => {
    const url = imageUrl.trim();
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
    setImageOpen(false);
  };

  const insertTable = () => {
    const rows = 3;
    const cols = 3;
    const headerCells: { type: string; content: { type: string }[] }[] = Array.from(
      { length: cols },
      () => ({ type: "tableHeader", content: [{ type: "paragraph" }] }),
    );
    const bodyRows: { type: string; content: { type: string; content: { type: string }[] }[] }[] =
      Array.from({ length: rows - 1 }, () => ({
        type: "tableRow",
        content: Array.from({ length: cols }, () => ({
          type: "tableCell",
          content: [{ type: "paragraph" }],
        })),
      }));
    editor
      .chain()
      .focus()
      .insertContent({
        type: "table",
        content: [{ type: "tableRow", content: headerCells }, ...bodyRows],
      })
      .run();
  };

  // 查找光标所在的表格
  const findTable = () => {
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name === "table") {
        return { pos: $from.before(d), node: $from.node(d) };
      }
    }
    return null;
  };

  const addTableRow = () => {
    const t = findTable();
    if (!t) return;
    const cols = t.node.firstChild?.childCount ?? 2;
    const rowNode = {
      type: "tableRow",
      content: Array.from({ length: cols }, () => ({
        type: "tableCell",
        content: [{ type: "paragraph" }],
      })),
    };
    const insertPos = t.pos + t.node.nodeSize - 2;
    editor.chain().focus().insertContentAt(insertPos, rowNode).run();
  };

  const addTableCol = () => {
    const t = findTable();
    if (!t) return;
    const tr = editor.state.tr;
    const rows: { pos: number; header: boolean }[] = [];
    let offset = t.pos + 1;
    t.node.forEach((child) => {
      if (child.type.name === "tableRow") {
        const header = child.firstChild?.type.name === "tableHeader";
        rows.push({ pos: offset + child.nodeSize - 1, header });
      }
      offset += child.nodeSize;
    });
    rows.reverse().forEach(({ pos, header }) => {
      const cell = editor.state.schema.nodes[header ? "tableHeader" : "tableCell"].create(
        null,
        editor.state.schema.nodes.paragraph.create(),
      );
      tr.insert(pos, cell);
    });
    editor.view.dispatch(tr);
  };

  const deleteTable = () => {
    const t = findTable();
    if (!t) return;
    editor.chain().focus().deleteRange({ from: t.pos, to: t.pos + t.node.nodeSize }).run();
  };

  const deleteTableRow = () => {
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      if (node.type.name === "tableRow") {
        const pos = $from.before(d);
        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
        return;
      }
    }
  };

  const deleteTableCol = () => {
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d >= 0; d--) {
      const cell = $from.node(d);
      if (cell.type.name === "tableCell" || cell.type.name === "tableHeader") {
        const cellIndex = $from.index(d - 1);
        const tableDepth = d - 2;
        const tableNode = $from.node(tableDepth);
        const tablePos = $from.before(tableDepth);
        const tr = editor.state.tr;
        const deletions: { from: number; to: number }[] = [];
        let rowPos = tablePos + 1;
        tableNode.forEach((child, offset) => {
          if (child.type.name === "tableRow") {
            const rowStart = rowPos;
            let cellPos = rowStart + 1;
            child.forEach((c, cOffset) => {
              if (cOffset === cellIndex) {
                deletions.push({ from: cellPos, to: cellPos + c.nodeSize });
              }
              cellPos += c.nodeSize;
            });
            void offset;
          }
          rowPos += child.nodeSize;
        });
        deletions.reverse().forEach(({ from, to }) => tr.delete(from, to));
        editor.view.dispatch(tr);
        return;
      }
    }
  };

  // 设置当前代码块语言
  const currentCodeLang = (() => {
    if (!editor.isActive("codeBlock")) return "text";
    return (editor.getAttributes("codeBlock").language as string) || "text";
  })();

  const setCodeLang = (lang: string) => {
    editor.chain().focus().updateAttributes("codeBlock", { language: lang === "text" ? null : lang }).run();
  };

  // 查找替换：在编辑器文档中检索所有命中位置
  const findMatches = (): { from: number; to: number }[] => {
    const text = findText;
    if (!text) return [];
    const results: { from: number; to: number }[] = [];
    const doc = editor.state.doc;
    doc.descendants((node, pos) => {
      if (!node.isText) return;
      const value = node.text ?? "";
      let idx = value.indexOf(text);
      while (idx !== -1) {
        results.push({ from: pos + idx, to: pos + idx + text.length });
        idx = value.indexOf(text, idx + 1);
      }
    });
    return results;
  };

  const matches = findMatches();

  const jumpToMatch = (index: number) => {
    if (matches.length === 0) return;
    const m = matches[(index + matches.length) % matches.length];
    setFindIdx((index + matches.length) % matches.length);
    editor
      .chain()
      .focus()
      .setTextSelection({ from: m.from, to: m.to })
      .scrollIntoView()
      .run();
  };

  const replaceCurrent = () => {
    if (matches.length === 0) return;
    const m = matches[findIdx % matches.length];
    editor
      .chain()
      .focus()
      .setTextSelection({ from: m.from, to: m.to })
      .insertContent(replaceText)
      .run();
    setFindIdx(0);
  };

  const replaceAll = () => {
    if (matches.length === 0) return;
    const text = findText;
    const replacement = replaceText;
    const { tr, doc } = editor.state;
    const positions: { from: number; to: number }[] = [];
    doc.descendants((node, pos) => {
      if (!node.isText) return;
      const value = node.text ?? "";
      let idx = value.indexOf(text);
      while (idx !== -1) {
        positions.push({ from: pos + idx, to: pos + idx + text.length });
        idx = value.indexOf(text, idx + 1);
      }
    });
    // 从后往前替换，避免位置偏移
    for (let i = positions.length - 1; i >= 0; i--) {
      tr.replaceWith(positions[i].from, positions[i].to, editor.schema.text(replacement));
    }
    editor.view.dispatch(tr);
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

  // 格式刷：复制当前光标/选区起始位置的 marks（再点一次取消）
  const copyFormat = () => {
    if (painterMarks) {
      setPainterMarks(null);
      return;
    }
    const marks = editor.state.selection.$from.marks();
    const m: Record<string, unknown> = {};
    for (const mark of marks) {
      m[mark.type.name] = mark.attrs as Record<string, unknown>;
    }
    setPainterMarks(Object.keys(m).length ? m : null);
  };

  // 翻译：选中文字，智能中英互译并原地替换
  const translate = async () => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, " ");
    if (!text.trim()) return;
    setTranslating(true);
    try {
      const hasCjk = /[\u4e00-\u9fff]/.test(text);
      const result = await aiAssist(hasCjk ? "translate_en" : "translate_zh", text);
      editor.chain().focus().insertContentAt({ from, to }, result).run();
    } catch (e) {
      alert(`翻译失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setTranslating(false);
    }
  };

  // 清除格式：移除所有 marks，段落/标题降为正文
  const clearFormat = () => {
    editor.chain().focus().unsetAllMarks().clearNodes().run();
  };

  const currentColor = (COLORS.find((c) => editor.isActive("color", { color: c })) ?? "");
  const currentBgColor = (COLORS.find((c) => editor.isActive("backgroundColor", { color: c })) ?? "");

  return (
    <div className="flex min-h-[calc(100vh-300px)] flex-col rounded-lg border border-line bg-background">
      {/* 格式工具栏（sticky 固定，向下滚动时不滚走） */}
      <div className="sticky top-0 z-20 flex items-center gap-0.5 overflow-x-auto border-b border-line bg-background px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* 标题下拉 */}
        <Tooltip content="段落格式">
          <select
            value={headingValue}
            onChange={(e) => setHeading(e.target.value)}
            className="h-8 w-[80px] shrink-0 cursor-pointer rounded-md border border-line bg-background px-1.5 text-[13px] text-text outline-none hover:bg-hover"
          >
            <option value="p">正文</option>
            <option value="1">标题 1</option>
            <option value="2">标题 2</option>
            <option value="3">标题 3</option>
            <option value="4">标题 4</option>
          </select>
        </Tooltip>

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
        <ToolBtn title="行内代码" shortcut="⌘E" tone="text-accent" onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")}>
          <CodeIcon size={16} />
        </ToolBtn>

        <ToolDivider />

        {/* 文字颜色 */}
        <div className="relative shrink-0">
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
              {/* 自定义颜色 */}
              <label
                className="relative grid h-5 w-5 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed border-line"
                title="自定义颜色"
                onMouseDown={(e) => e.preventDefault()}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <input
                  type="color"
                  onChange={(e) => {
                    editor.chain().focus().setMark("color", { color: e.target.value }).run();
                    setColorOpen(false);
                  }}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
              {/* 取消颜色 */}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor.chain().focus().unsetMark("color").run();
                  setColorOpen(false);
                }}
                className="ml-0.5 grid h-5 place-items-center rounded px-1 text-[11px] text-muted hover:text-text"
                title="清除颜色"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>
        {/* 背景色（填充） */}
        <div className="relative shrink-0">
          <Tooltip content="背景色（填充）">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setBgColorOpen((v) => !v)}
              className={`flex h-9 min-w-[34px] items-center justify-center rounded-md px-2 transition-colors ${
                editor.isActive("backgroundColor") ? "text-accent" : "text-muted hover:bg-hover hover:text-text"
              }`}
            >
              <span className="text-[16px] leading-none">
                A
                <span className="ml-0.5 inline-block h-[14px] w-[16px] rounded-sm border border-line align-middle" style={{ background: currentBgColor || "transparent" }} />
              </span>
            </button>
          </Tooltip>
          {bgColorOpen && (
            <div className="menu-panel absolute left-0 top-full z-30 mt-1 flex items-center gap-1 p-1.5" onMouseLeave={() => setBgColorOpen(false)}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    editor.chain().focus().setMark("backgroundColor", { color: c }).run();
                    setBgColorOpen(false);
                  }}
                  className={`h-5 w-5 rounded-sm border border-line ${editor.isActive("backgroundColor", { color: c }) ? "ring-2 ring-accent ring-offset-1" : ""}`}
                  style={{ background: c }}
                  title={c}
                />
              ))}
              <label
                className="relative grid h-5 w-5 cursor-pointer place-items-center overflow-hidden rounded-sm border border-dashed border-line"
                title="自定义背景色"
                onMouseDown={(e) => e.preventDefault()}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <input
                  type="color"
                  onChange={(e) => {
                    editor.chain().focus().setMark("backgroundColor", { color: e.target.value }).run();
                    setBgColorOpen(false);
                  }}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor.chain().focus().unsetMark("backgroundColor").run();
                  setBgColorOpen(false);
                }}
                className="ml-0.5 grid h-5 place-items-center rounded px-1 text-[11px] text-muted hover:text-text"
                title="清除背景色"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>
        <ToolBtn title="高亮" tone="text-warning" onClick={() => editor.chain().focus().toggleMark("highlight").run()} active={editor.isActive("highlight")}>
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

        <ToolBtn title="引用" shortcut="⌘⇧B" tone="text-warning" onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")}>
          <QuoteIcon size={17} />
        </ToolBtn>
        <ToolBtn title="代码块" shortcut="⌥⌘C" tone="text-accent" onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")}>
          <CodeBlockIcon size={17} />
        </ToolBtn>
        {/* 代码块语言选择（仅光标在代码块内时显示） */}
        {editor.isActive("codeBlock") && (
          <Tooltip content="代码块语言">
            <select
              value={currentCodeLang}
              onChange={(e) => setCodeLang(e.target.value)}
              className="h-8 w-[72px] shrink-0 cursor-pointer rounded-md border border-line bg-background px-1 text-[12px] text-muted outline-none hover:bg-hover"
            >
              {CODE_LANGS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Tooltip>
        )}
        <ToolBtn title="分割线" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <MinusIcon size={17} />
        </ToolBtn>

        <ToolDivider />

        <div className="relative shrink-0">
          <ToolBtn title="链接" shortcut="⌘K" tone="text-accent" onClick={setLink} active={editor.isActive("link")}>
            <LinkIcon size={17} />
          </ToolBtn>
          {linkOpen && (
            <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-line bg-surface p-3 shadow-lg">
              <div className="mb-1 text-[12px] font-medium text-text">链接地址</div>
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyLink(); if (e.key === "Escape") setLinkOpen(false); }}
                placeholder="https://"
                autoFocus
                className="mb-2 h-8 w-full rounded-md border border-line bg-background px-2 text-[13px] text-text outline-none focus:border-accent"
              />
              <div className="flex justify-end gap-1.5">
                {editor.isActive("link") && (
                  <button
                    type="button"
                    onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkOpen(false); }}
                    className="h-7 rounded-md px-2 text-[12px] text-danger hover:bg-hover"
                  >
                    移除链接
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setLinkOpen(false)}
                  className="h-7 rounded-md px-2 text-[12px] text-muted hover:bg-hover"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={applyLink}
                  className="h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-white hover:opacity-90"
                >
                  确定
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="relative shrink-0">
          <ToolBtn title="图片" tone="text-success" onClick={setImage} active={imageOpen}>
            <ImageIcon size={17} />
          </ToolBtn>
          {imageOpen && (
            <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-line bg-surface p-3 shadow-lg">
              <div className="mb-1 text-[12px] font-medium text-text">图片地址</div>
              <input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyImage(); if (e.key === "Escape") setImageOpen(false); }}
                placeholder="https://…（也可直接粘贴截图，⌘V）"
                autoFocus
                className="mb-2 h-8 w-full rounded-md border border-line bg-background px-2 text-[13px] text-text outline-none focus:border-accent"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setImageOpen(false)}
                  className="h-7 rounded-md px-2 text-[12px] text-muted hover:bg-hover"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={applyImage}
                  className="h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-white hover:opacity-90"
                >
                  插入
                </button>
              </div>
            </div>
          )}
        </div>
        <ToolBtn title="表格" tone="text-accent" onClick={insertTable}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="1" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
        </ToolBtn>
        <ToolBtn title="任务列表" tone="text-success" onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive("taskList")}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="14" height="14" rx="2" />
            <path d="M6 12l3 3 5-6" />
          </svg>
        </ToolBtn>

        <ToolDivider />

        <ToolBtn title="左对齐" onClick={() => (editor.chain().focus() as any).setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h10M4 18h16" />
          </svg>
        </ToolBtn>
        <ToolBtn title="居中对齐" onClick={() => (editor.chain().focus() as any).setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M8 12h8M4 18h16" />
          </svg>
        </ToolBtn>
        <ToolBtn title="右对齐" onClick={() => (editor.chain().focus() as any).setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M14 12h6M4 18h16" />
          </svg>
        </ToolBtn>
        <ToolBtn title="增加缩进" onClick={() => editor.chain().focus().sinkListItem("listItem").run()} active={false}>
          <IndentIcon size={17} />
        </ToolBtn>
        <ToolBtn title="减少缩进" onClick={() => editor.chain().focus().liftListItem("listItem").run()} active={false}>
          <OutdentIcon size={17} />
        </ToolBtn>

        {/* 表格行列操作（仅光标在表格内时显示） */}
        {findTable() && (
          <>
            <ToolDivider />
            <ToolBtn title="添加行" onClick={addTableRow}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </ToolBtn>
            <ToolBtn title="添加列" onClick={addTableCol}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9 3h6M9 21h6M12 3v18" />
              </svg>
            </ToolBtn>
            <ToolBtn title="删除行" onClick={deleteTableRow}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 12h14" />
              </svg>
            </ToolBtn>
            <ToolBtn title="删除列" onClick={deleteTableCol}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14" />
              </svg>
            </ToolBtn>
            <ToolBtn title="删除表格" onClick={deleteTable}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="16" rx="1" />
                <path d="M3 9h18M9 5v16M15 5v16M7 7l10 12" />
              </svg>
            </ToolBtn>
          </>
        )}

        <ToolDivider />

        <ToolBtn title="撤销" shortcut="⌘Z" onClick={() => editor.chain().focus().undo().run()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
          </svg>
        </ToolBtn>
        <ToolBtn title="重做" shortcut="⌘⇧Z" onClick={() => editor.chain().focus().redo().run()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
          </svg>
        </ToolBtn>

        <ToolDivider />

        <ToolBtn title="格式刷" tone="text-accent" onClick={copyFormat} active={painterMarks !== null}>
          <FormatPaintIcon size={17} />
        </ToolBtn>
        <ToolBtn title="清除格式" onClick={clearFormat}>
          <ClearFormatIcon size={17} />
        </ToolBtn>
        <ToolBtn title="翻译（中英互译）" tone="text-success" onClick={translate} disabled={translating}>
          {translating ? (
            <span className="animate-pulse text-[12px] leading-none">…</span>
          ) : (
            <TranslateIcon size={17} />
          )}
        </ToolBtn>

        <ToolDivider />

        <ToolBtn title="查找替换" shortcut="⌘F" onClick={() => { setFindOpen((v) => !v); if (!findOpen) setFindText(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ")); }} active={findOpen}>
          <SearchReplaceIcon size={17} />
        </ToolBtn>
      </div>

      {/* 查找替换面板 */}
      {findOpen && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface px-3 py-2">
          <input
            value={findText}
            onChange={(e) => { setFindText(e.target.value); setFindIdx(0); }}
            placeholder="查找"
            className="h-8 w-44 rounded-md border border-line bg-background px-2 text-[13px] text-text outline-none focus:border-accent"
          />
          <input
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="替换为"
            className="h-8 w-44 rounded-md border border-line bg-background px-2 text-[13px] text-text outline-none focus:border-accent"
          />
          <span className="min-w-[52px] text-center text-[12px] text-muted">
            {findText ? `${matches.length > 0 ? findIdx + 1 : 0}/${matches.length}` : "0/0"}
          </span>
          <button
            type="button"
            onClick={() => jumpToMatch(findIdx - 1)}
            disabled={matches.length === 0}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-text disabled:opacity-40"
            title="上一个"
          >
            <ChevronUpIcon size={15} />
          </button>
          <button
            type="button"
            onClick={() => jumpToMatch(findIdx + 1)}
            disabled={matches.length === 0}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-text disabled:opacity-40"
            title="下一个"
          >
            <ChevronDownIcon size={15} />
          </button>
          <button
            type="button"
            onClick={replaceCurrent}
            disabled={matches.length === 0}
            className="h-7 rounded-md border border-line px-2 text-[12px] text-text hover:bg-hover disabled:opacity-40"
          >
            替换
          </button>
          <button
            type="button"
            onClick={replaceAll}
            disabled={matches.length === 0}
            className="h-7 rounded-md border border-line px-2 text-[12px] text-text hover:bg-hover disabled:opacity-40"
          >
            全部替换
          </button>
          <button
            type="button"
            onClick={() => setFindOpen(false)}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-text"
            title="关闭"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      {/* 链接弹窗已移至工具栏链接按钮内 */}

      <EditorContent
        editor={editor}
        className="md-body rich-editor flex-1 px-4 py-3"
      />
    </div>
  );
}
