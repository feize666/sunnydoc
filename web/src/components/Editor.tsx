"use client";

import { useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import { renderMarkdown, extractToc, type TocItem } from "@/lib/markdown";
import { handleCodeBlockCopy } from "./CodeBlock";
import { Tooltip } from "./Tooltip";
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
  CopyIcon,
  CheckIcon,
  EditIcon,
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

function ShareIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}

function StarIcon({ size = 15, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

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
    <Tooltip content={title} className="shrink-0">
      <button
        type="button"
        // 阻止按钮抢走 textarea 焦点，保留选区
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className="flex h-7 items-center justify-center rounded-md px-1.5 text-muted transition-colors hover:bg-hover hover:text-text"
      >
        {children}
      </button>
    </Tooltip>
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
  theme,
  readOnly,
  isFavorite,
  onToggleFavorite,
  onShare,
}: {
  doc: Doc | null;
  loading?: boolean;
  onSaved?: (doc: Doc, newTitle: string, newBody: string) => void;
  highlight?: string;
  theme: "light" | "dark";
  readOnly?: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onShare?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("preview");
  const [draftTitle, setDraftTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // 大纲（随正文变化重算）
  const toc: TocItem[] = useMemo(
    () => (doc?.body ? extractToc(doc.body) : []),
    [doc?.body],
  );

  // 异步渲染预览（代码块用 shiki 高亮）；切换文档 / 保存 / 主题变化后重渲染
  useEffect(() => {
    let cancelled = false;
    renderMarkdown(doc?.body ?? "", highlight, theme).then((h) => {
      if (!cancelled) setPreviewHtml(h);
    });
    return () => {
      cancelled = true;
    };
  }, [doc?.body, highlight, theme]);

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

  const copyMarkdown = async () => {
    if (!doc) return;
    try {
      await navigator.clipboard.writeText(doc.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板不可用时静默降级 */
    }
  };

  const scrollToHeading = (index: number) => {
    const container = contentRef.current;
    if (!container) return;
    const headings = container.querySelectorAll("h1, h2, h3, h4");
    headings[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // —— 选区工具函数 ——

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
          <Tooltip key={c.value} content={`文字颜色：${c.name}`}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyColor(c.value)}
              className="h-4 w-4 rounded-full border border-black/10 transition-transform hover:scale-125"
              style={{ backgroundColor: c.value }}
            />
          </Tooltip>
        ))}
      </div>
    </>
  );

  return (
    <main className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {/* 操作栏（始终显示）：复制 / 分享 / 收藏 / 编辑 卡片按钮，右侧一排 */}
        <div className="flex h-12 shrink-0 items-center border-b border-line bg-surface px-4">
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <Tooltip content={copied ? "已复制" : "复制 Markdown"}>
              <button
                onClick={copyMarkdown}
                className={`flex items-center gap-1.5 rounded-lg border border-line bg-background px-3 py-1.5 text-xs text-text shadow-sm transition-all hover:border-accent/40 hover:text-accent hover:shadow-glow ${
                  copied ? "border-accent/40 text-accent" : ""
                }`}
              >
                {copied ? <CheckIcon size={14} className="text-accent" /> : <CopyIcon size={14} />}
                复制
              </button>
            </Tooltip>
            {onShare && (
              <Tooltip content="分享">
                <button
                  onClick={onShare}
                  className="flex items-center gap-1.5 rounded-lg border border-line bg-background px-3 py-1.5 text-xs text-text shadow-sm transition-all hover:border-accent/40 hover:text-accent hover:shadow-glow"
                >
                  <ShareIcon size={14} />
                  分享
                </button>
              </Tooltip>
            )}
            {onToggleFavorite && (
              <Tooltip content={isFavorite ? "取消收藏" : "收藏"}>
                <button
                  onClick={onToggleFavorite}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs shadow-sm transition-all hover:shadow-glow ${
                    isFavorite
                      ? "border-accent/40 bg-accent-soft text-accent"
                      : "border-line bg-background text-text hover:border-accent/40 hover:text-accent"
                  }`}
                >
                  <StarIcon size={14} filled={isFavorite} />
                  收藏
                </button>
              </Tooltip>
            )}

            {readOnly ? (
              <span className="flex items-center gap-1 rounded-lg border border-line bg-background px-3 py-1.5 text-xs text-faint">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                只读
              </span>
            ) : mode === "preview" ? (
              <Tooltip content="编辑文档">
                <button
                  onClick={() => handleSwitch("edit")}
                  className="btn-accent flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium text-white"
                >
                  <EditIcon size={14} />
                  编辑
                </button>
              </Tooltip>
            ) : (
              <Tooltip content="完成并保存">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="btn-accent flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  <CheckIcon size={14} />
                  {saving ? "保存中…" : "完成"}
                </button>
              </Tooltip>
            )}
          </div>
        </div>

        {/* 格式工具栏（仅编辑态显示） */}
        {mode === "edit" && !readOnly && (
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
              {toolbar}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Tooltip content="放弃编辑">
                <button
                  onClick={() => setMode("preview")}
                  className="rounded-md px-3 py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-text"
                >
                  取消
                </button>
              </Tooltip>
            </div>
          </div>
        )}

        {/* 正文 */}
        <div className="flex-1 overflow-y-auto py-8">
          <div className="mx-auto max-w-[760px] px-10">
            {mode === "preview" ? (
              <h1 className="text-[32px] font-bold leading-[1.25] tracking-[-0.01em] text-text">
                {doc.title}
              </h1>
            ) : (
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="w-full bg-transparent text-[32px] font-bold leading-[1.25] tracking-[-0.01em] text-text outline-none placeholder:text-faint"
                placeholder="标题"
                spellCheck={false}
              />
            )}
            <p className="mt-3 text-[13px] text-faint">
              {doc.path} · 更新于 {doc.updated}
            </p>
            <div className="mt-4 border-b border-line" />
            {mode === "preview" ? (
              <div
                ref={contentRef}
                className="md-body mt-6"
                onClick={handleCodeBlockCopy}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="mt-6 h-[calc(100vh-300px)] w-full resize-none bg-transparent font-mono text-[14px] leading-relaxed text-text outline-none"
                spellCheck={false}
              />
            )}
          </div>
        </div>
      </div>

      {/* 右侧大纲（预览态 + 有标题时显示） */}
      {mode === "preview" && toc.length > 0 && (
        <aside className="hidden w-48 shrink-0 overflow-y-auto border-l border-line bg-surface lg:block">
          <div className="sticky top-0 border-b border-line bg-surface px-3 py-2.5 text-[12px] font-semibold text-muted">
            大纲
          </div>
          <ul className="p-1.5">
            {toc.map((item, i) => (
              <li key={i}>
                <button
                  onClick={() => scrollToHeading(i)}
                  className="flex w-full items-center rounded-md py-1 text-left text-[12px] leading-snug text-faint transition-colors hover:bg-hover hover:text-text"
                  style={{ paddingLeft: 8 + (item.level - 1) * 12 }}
                >
                  <span className="line-clamp-1">{item.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </main>
  );
}
