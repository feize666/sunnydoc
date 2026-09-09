"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { renderMarkdown, extractToc, type TocItem } from "@/lib/markdown";
import { handleCodeBlockCopy } from "./CodeBlock";
import { Tooltip } from "./Tooltip";
import { updateDocument } from "@/lib/api";
import type { Doc } from "@/data/docs";
import type { RecentDoc } from "@/lib/api";
import { RichEditor } from "./RichEditor";
import { TableEditor } from "./TableEditor";
import { BoardEditor } from "./BoardEditor";
import { DatasheetEditor } from "./DatasheetEditor";
import { CopyIcon, CheckIcon, EditIcon } from "./icons";

type Mode = "preview" | "edit";

function parseTableData(value: string): string[][] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((r) => Array.isArray(r))) {
      return parsed as string[][];
    }
  } catch {
    /* fallthrough */
  }
  return [];
}

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
  recent,
  onOpenRecent,
  pinned,
  tags,
  summary,
  onTogglePin,
  onEditTags,
  onGenerateSummary,
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
  recent?: RecentDoc[];
  onOpenRecent?: (docId: string, kbId: string | null) => void;
  pinned?: boolean;
  tags?: string[];
  summary?: string | null;
  onTogglePin?: () => void;
  onEditTags?: () => void;
  onGenerateSummary?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("preview");
  const [draftTitle, setDraftTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 大纲（随正文变化重算）
  const toc: TocItem[] = useMemo(
    () => (doc?.body ? extractToc(doc.body) : []),
    [doc?.body],
  );

  // 渲染预览（代码块 shiki 高亮）；切换文档 / 保存 / 主题变化后重渲染
  useEffect(() => {
    let cancelled = false;
    renderMarkdown(doc?.body ?? "", highlight, theme).then((h) => {
      if (!cancelled) setPreviewHtml(h);
    });
    return () => {
      cancelled = true;
    };
  }, [doc?.body, highlight, theme]);

  // 切换文档时重置为预览模式（表格/画板/数据表默认进编辑态）
  useEffect(() => {
    const t = doc?.type ?? "doc";
    setMode(["table", "board", "datasheet"].includes(t) ? "edit" : "preview");
  }, [doc?.key, doc?.type]);

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
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[760px] px-10 py-10">
          <h2 className="mb-4 text-base font-semibold text-text">最近浏览</h2>
          {!recent || recent.length === 0 ? (
            <p className="text-sm text-muted">暂无浏览记录，从左侧选择一个文档开始阅读</p>
          ) : (
            <ul className="overflow-hidden rounded-xl border border-line bg-surface">
              {recent.map((r, i) => (
                <li key={`${r.doc_id}-${i}`}>
                  <button
                    onClick={() => onOpenRecent?.(r.doc_id, r.kb_id)}
                    className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-text group-hover:text-accent">
                        {r.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-faint">
                        {r.source ?? ""}
                      </span>
                    </span>
                  </button>
                  {i < recent.length - 1 && <div className="border-b border-line" />}
                </li>
              ))}
            </ul>
          )}
        </div>
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
            {onTogglePin && (
              <Tooltip content={pinned ? "取消置顶" : "置顶"}>
                <button
                  onClick={onTogglePin}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs shadow-sm transition-all hover:shadow-glow ${
                    pinned
                      ? "border-accent/40 bg-accent-soft text-accent"
                      : "border-line bg-background text-text hover:border-accent/40 hover:text-accent"
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 17v5M5 12l-1 1 6 6 1-1M14 3l6 6-3 3-1-1-2 2-2-2 2-2-1-1 3-3z" />
                  </svg>
                  置顶
                </button>
              </Tooltip>
            )}
            {onEditTags && (
              <Tooltip content="标签">
                <button
                  onClick={onEditTags}
                  className="flex items-center gap-1.5 rounded-lg border border-line bg-background px-3 py-1.5 text-xs text-text shadow-sm transition-all hover:border-accent/40 hover:text-accent hover:shadow-glow"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2H2v10l9.29 9.29a2 2 0 0 0 2.83 0l7.17-7.17a2 2 0 0 0 0-2.83L12 2z" />
                    <circle cx="7" cy="7" r="1.5" />
                  </svg>
                  标签
                </button>
              </Tooltip>
            )}
            {onGenerateSummary && (
              <Tooltip content="AI 摘要">
                <button
                  onClick={onGenerateSummary}
                  className="flex items-center gap-1.5 rounded-lg border border-line bg-background px-3 py-1.5 text-xs text-text shadow-sm transition-all hover:border-accent/40 hover:text-accent hover:shadow-glow"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
                    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
                  </svg>
                  摘要
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
              <>
                <Tooltip content="放弃编辑">
                  <button
                    onClick={() => setMode("preview")}
                    disabled={saving}
                    className="flex items-center gap-1.5 rounded-lg border border-line bg-background px-3 py-1.5 text-xs text-muted shadow-sm transition-all hover:border-accent/40 hover:text-text disabled:opacity-50"
                  >
                    取消
                  </button>
                </Tooltip>
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
              </>
            )}
          </div>
        </div>

        {/* 正文 */}
        <div className="flex-1 overflow-y-auto py-8">
          {mode === "preview" ? (
            <div className="mx-auto max-w-[760px] px-10">
              <h1 className="text-[32px] font-bold leading-[1.25] tracking-[-0.01em] text-text">
                {doc.title}
              </h1>
              <p className="mt-3 text-[13px] text-faint">
                {doc.path} · 更新于 {doc.updated}
              </p>
              {summary && (
                <div className="mt-4 rounded-lg border border-accent/20 bg-accent-soft px-4 py-3 text-[13px] leading-relaxed text-text">
                  <span className="mr-2 font-semibold text-accent">摘要</span>
                  {summary}
                </div>
              )}
              {tags && tags.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] text-muted"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-4 border-b border-line" />
              {doc.type === "table" ? (
                <div className="mt-6 overflow-auto">
                  <table className="border-collapse">
                    <tbody>
                      {parseTableData(doc.body).map((row, r) => (
                        <tr key={r}>
                          {row.map((cell, c) => (
                            <td
                              key={c}
                              className="border border-line px-3 py-1.5 text-[13px] text-text"
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div
                  ref={contentRef}
                  className="md-body mt-6"
                  onClick={handleCodeBlockCopy}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-[860px] px-10">
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="w-full bg-transparent text-[32px] font-bold leading-[1.25] tracking-[-0.01em] text-text outline-none placeholder:text-faint"
                placeholder="标题"
                spellCheck={false}
              />
              <p className="mt-3 text-[13px] text-faint">
                {doc.path} · 更新于 {doc.updated}
              </p>
              <div className="mt-4 border-b border-line" />
              <div className="mt-6">
                {doc.type === "table" ? (
                  <TableEditor value={draft} onChange={setDraft} />
                ) : doc.type === "board" ? (
                  <BoardEditor value={draft} onChange={setDraft} />
                ) : doc.type === "datasheet" ? (
                  <DatasheetEditor value={draft} onChange={setDraft} />
                ) : (
                  <RichEditor
                    value={draft}
                    onChange={setDraft}
                    placeholder="开始输入内容…"
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右侧大纲（预览态 + 有标题时显示） */}
      {mode === "preview" && toc.length > 0 && (
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-l border-line bg-surface lg:block">
          <div className="sticky top-0 border-b border-line bg-surface px-3 py-2.5 text-[14px] font-semibold text-text">
            大纲
          </div>
          <ul className="p-1.5">
            {toc.map((item, i) => (
              <li key={i}>
                <button
                  onClick={() => scrollToHeading(i)}
                  className="flex w-full items-center rounded-md py-1 text-left text-[14px] leading-snug text-text transition-colors hover:bg-hover"
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
