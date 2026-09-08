"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { updateDocument } from "@/lib/api";
import type { Doc } from "@/data/docs";
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

type Mode = "preview" | "edit";

// 字体颜色预设（参考语雀）
const COLORS = [
  { name: "红色", value: "#ef4444" },
  { name: "橙色", value: "#f97316" },
  { name: "绿色", value: "#22c55e" },
  { name: "蓝色", value: "#3b82f6" },
  { name: "紫色", value: "#a855f7" },
];

function ToolButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      // 阻止按钮抢走 textarea 焦点，保留选区
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-7 shrink-0 items-center justify-center rounded-md px-1.5 text-muted transition-colors hover:bg-hover hover:text-text"
    >
      {children}
    </button>
  );
}

function ToolDivider() {
  return <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden />;
}

export function Editor({
  doc,
  loading,
  onSaved,
  highlight,
}: {
  doc: Doc | null;
  loading?: boolean;
  onSaved?: (doc: Doc, newTitle: string, newBody: string) => void;
  highlight?: string;
}) {
  const [mode, setMode] = useState<Mode>("preview");
  const [draftTitle, setDraftTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 切换文档时重置为预览模式
  useEffect(() => {
    setMode("preview");
  }, [doc?.key]);

  // Ctrl/Cmd+S 保存
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (mode === "edit" && !saving) handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, draftTitle, draft, saving]);

  if (loading && !doc) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background text-muted">
        <p className="text-sm">正在加载文档…</p>
      </main>
    );
  }

  if (!doc) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background text-muted">
        <p className="text-sm">从左侧选择一个文档开始阅读</p>
      </main>
    );
  }

  const handleSwitch = (m: Mode) => {
    if (m === "edit" && mode !== "edit") {
      setDraftTitle(doc.title);
      setDraft(doc.body);
    }
    setMode(m);
  };

  const handleSave = async () => {
    if (!doc) return;
    const title = draftTitle.trim();
    if (!title) {
      alert("标题不能为空");
      return;
    }
    setSaving(true);
    try {
      await updateDocument(doc.key, title, draft);
      onSaved?.(doc, title, draft);
      setMode("preview");
    } catch (e) {
      alert(`保存失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setSaving(false);
    }
  };

  // —— 选区工具函数 ——

  // 用前后缀包裹选中文本；无选中则插入占位并选中它
  const applyWrap = (prefix: string, suffix: string, placeholder: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selected = draft.slice(start, end);
    const text = selected || placeholder;
    const next = draft.slice(0, start) + prefix + text + suffix + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      ta.focus();
      const selStart = start + prefix.length;
      ta.setSelectionRange(selStart, selStart + text.length);
    });
  };

  // 对选中行（或光标所在行）的每一行行首加前缀（标题/列表/引用）
  const applyLinePrefix = (prefix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const lineStart = draft.lastIndexOf("\n", start - 1) + 1;
    const lineEndIdx = draft.indexOf("\n", end);
    const lineEnd = lineEndIdx === -1 ? draft.length : lineEndIdx;
    const block = draft.slice(lineStart, lineEnd);
    const newBlock = block
      .split("\n")
      .map((l) => prefix + l)
      .join("\n");
    const next = draft.slice(0, lineStart) + newBlock + draft.slice(lineEnd);
    setDraft(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(lineStart, lineStart + newBlock.length);
    });
  };

  // 插入代码块
  const insertCodeBlock = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selected = draft.slice(start, end);
    const body = selected || "代码";
    const next = draft.slice(0, start) + "```\n" + body + "\n```" + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + 4, start + 4 + body.length);
    });
  };

  // 插入分割线
  const insertHr = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const before = start > 0 && draft[start - 1] !== "\n" ? "\n" : "";
    const next = draft.slice(0, start) + before + "---\n\n" + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + before.length + 3;
      ta.setSelectionRange(pos, pos);
    });
  };

  // 插入链接
  const insertLink = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selected = draft.slice(start, end) || "链接文本";
    const next = draft.slice(0, start) + `[${selected}](https://)` + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      ta.focus();
      const urlStart = start + selected.length + 3;
      ta.setSelectionRange(urlStart, urlStart + 8);
    });
  };

  // 插入图片
  const insertImage = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selected = draft.slice(start, end) || "图片描述";
    const next = draft.slice(0, start) + `![${selected}](https://)` + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      ta.focus();
      const urlStart = start + selected.length + 4;
      ta.setSelectionRange(urlStart, urlStart + 8);
    });
  };

  // 字体颜色：选中文字包裹 <span style="color:...">，未选中插入占位
  const applyColor = (color: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selected = draft.slice(start, end);
    const text = selected || "文字";
    const prefix = `<span style="color:${color}">`;
    const next = draft.slice(0, start) + prefix + text + "</span>" + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      ta.focus();
      if (selected) {
        ta.setSelectionRange(start, start + text.length);
      } else {
        ta.setSelectionRange(start + prefix.length, start + prefix.length + 2);
      }
    });
  };

  const toolbar = (
    <>
      <ToolButton title="加粗" onClick={() => applyWrap("**", "**", "加粗文本")}>
        <span className="text-[13px] font-bold leading-none">B</span>
      </ToolButton>
      <ToolButton title="斜体" onClick={() => applyWrap("*", "*", "斜体文本")}>
        <span className="font-serif text-[13px] italic leading-none">I</span>
      </ToolButton>
      <ToolButton title="删除线" onClick={() => applyWrap("~~", "~~", "删除文本")}>
        <span className="text-[13px] leading-none line-through">S</span>
      </ToolButton>
      <ToolButton title="行内代码" onClick={() => applyWrap("`", "`", "代码")}>
        <CodeIcon size={14} />
      </ToolButton>

      <ToolDivider />

      <ToolButton title="一级标题" onClick={() => applyLinePrefix("# ")}>
        <span className="text-[12px] font-semibold leading-none">H1</span>
      </ToolButton>
      <ToolButton title="二级标题" onClick={() => applyLinePrefix("## ")}>
        <span className="text-[12px] font-semibold leading-none">H2</span>
      </ToolButton>
      <ToolButton title="三级标题" onClick={() => applyLinePrefix("### ")}>
        <span className="text-[12px] font-semibold leading-none">H3</span>
      </ToolButton>

      <ToolDivider />

      <ToolButton title="无序列表" onClick={() => applyLinePrefix("- ")}>
        <ListUlIcon size={15} />
      </ToolButton>
      <ToolButton title="有序列表" onClick={() => applyLinePrefix("1. ")}>
        <ListOlIcon size={15} />
      </ToolButton>

      <ToolDivider />

      <ToolButton title="引用" onClick={() => applyLinePrefix("> ")}>
        <QuoteIcon size={15} />
      </ToolButton>
      <ToolButton title="代码块" onClick={insertCodeBlock}>
        <CodeBlockIcon size={15} />
      </ToolButton>
      <ToolButton title="分割线" onClick={insertHr}>
        <MinusIcon size={15} />
      </ToolButton>

      <ToolDivider />

      <ToolButton title="链接" onClick={insertLink}>
        <LinkIcon size={15} />
      </ToolButton>
      <ToolButton title="图片" onClick={insertImage}>
        <ImageIcon size={15} />
      </ToolButton>

      <ToolDivider />

      <div className="flex shrink-0 items-center gap-1.5 px-1">
        {COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            title={`文字颜色：${c.name}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyColor(c.value)}
            className="h-4 w-4 rounded-full border border-black/10 transition-transform hover:scale-125"
            style={{ backgroundColor: c.value }}
          />
        ))}
      </div>
    </>
  );

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      {mode === "preview" ? (
        <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-1.5">
          <span className="rounded-md bg-background px-2.5 py-1 text-xs font-medium text-accent shadow-[0_0_0_1px_var(--line)]">
            预览
          </span>
          <div className="flex-1" />
          <button
            onClick={() => handleSwitch("edit")}
            className="btn-accent rounded-md px-3.5 py-1.5 text-xs font-medium text-white"
          >
            编辑
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {toolbar}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => setMode("preview")}
              className="rounded-md px-3 py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-text"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-accent rounded-md px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-8">
        <div className="mx-auto max-w-[760px] px-10">
          {mode === "preview" ? (
            <>
              <h1 className="text-[32px] font-bold leading-[1.25] tracking-[-0.01em] text-text">
                {doc.title}
              </h1>
              <p className="mt-3 text-[13px] text-faint">
                {doc.path} · 更新于 {doc.updated}
              </p>
              <div className="mt-4 border-b border-line" />
              <div
                className="md-body mt-6"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(doc.body, highlight),
                }}
              />
            </>
          ) : (
            <>
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="mb-4 w-full bg-transparent text-[28px] font-bold leading-tight tracking-[-0.01em] text-text outline-none placeholder:text-faint"
                placeholder="标题"
                spellCheck={false}
              />
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-[calc(100vh-280px)] w-full resize-none bg-transparent font-mono text-[14px] leading-relaxed text-text outline-none"
                spellCheck={false}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
