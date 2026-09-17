"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { renderMarkdown, extractToc, sanitizeHtml, type TocItem } from "@/lib/markdown";
import { handleCodeBlockCopy } from "./CodeBlock";
import { Tooltip } from "./Tooltip";
import { useToast } from "./Toast";
import { updateDocument, subscribeSSE } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import type { Doc } from "@/data/docs";
import type { RecentDoc, Backlink } from "@/lib/api";
import { useResizable } from "@/hooks/useResizable";
import { ErrorBoundary } from "./ErrorBoundary";
import { AiAssistPopover } from "./AiAssistPopover";
import {
  LazyFlowchartEditor,
  LazyMindMapEditor,
  LazyBoardEditor,
  LazyDatasheetEditor,
  LazyTableEditor,
  LazyRichEditor,
} from "./LazyEditors";
import { CopyIcon, CheckIcon, EditIcon, CodeIcon, HistoryIcon, ShareIcon } from "./icons";
import { EmptyState } from "./EmptyState";

type Mode = "preview" | "edit" | "source";

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
  onOpenHistory,
  onOpenComments,
  onAnnotate,
  commentCount,
  onOpenWikilink,
  backlinks,
  currentUserId,
  onRemoteUpdate,
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
  onOpenHistory?: () => void;
  onOpenComments?: () => void;
  onAnnotate?: (quote: string) => void;
  commentCount?: number;
  onOpenWikilink?: (title: string) => void;
  backlinks?: Backlink[];
  currentUserId?: string;
  onRemoteUpdate?: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("preview");
  const modeRef = useRef<Mode>("preview");
  modeRef.current = mode;
  const [draftTitle, setDraftTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [htmlPreview, setHtmlPreview] = useState("");
  const [copied, setCopied] = useState(false);
  const [collabPresence, setCollabPresence] = useState<{ id: string; nickname: string; avatar?: string | null }[]>([]);
  const [collabNotice, setCollabNotice] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // 滚动容器（正文外层，key={doc.key} 那个 div）：大纲的滚动高亮与跳转都基于它
  const scrollRef = useRef<HTMLDivElement>(null);
  // 大纲当前高亮项；-1 表示尚未定位（滚动到首个标题之前）
  const [activeHeading, setActiveHeading] = useState(-1);
  const { width: tocWidth, onMouseDown: onTocResize } = useResizable(224, 180, 400, "toc_width", -1);

  // 划词批注：记录选中文字及浮动按钮位置
  const [annotate, setAnnotate] = useState<{ x: number; y: number; text: string } | null>(null);

  // 划词 AI 辅助面板
  const [aiAssist, setAiAssist] = useState<{ x: number; y: number; text: string } | null>(null);

  const handleTextSelect = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    const container = contentRef.current;
    if (!text || !container || !onAnnotate) {
      setAnnotate(null);
      return;
    }
    // 选区必须位于正文容器内
    const range = sel!.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setAnnotate(null);
      return;
    }
    setAnnotate({ x: rect.left + rect.width / 2, y: rect.top, text });
  };

  // 点击正文外区域时关闭划词批注浮标
  useEffect(() => {
    if (!annotate) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-annotate-btn]") && !contentRef.current?.contains(t)) {
        setAnnotate(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [annotate]);

  // 大纲（随正文变化重算；预览态用 doc.body，编辑/源码态用 draft）
  const toc: TocItem[] = useMemo(() => {
    const body = mode === "preview" ? (doc?.body ?? "") : draft;
    return body ? extractToc(body) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode === "preview" ? doc?.body : draft]);

  /**
   * 大纲滚动高亮（scroll-spy）。
   *
   * 三种模式下标题所在的 DOM 容器不同：
   *  - 预览态：contentRef 内的 `h1~h4`（renderMarkdown 产出）
   *  - 富文本态：TipTap 的 `.ProseMirror` 内的 `h1~h4`（其 DOM 归 ProseMirror 管，
   *    不能用 contentRef——那会把 ref 交给 React 与 PM 双方争抢）
   *  - 源码态：纯文本域，没有语义标题，跳过
   * 因此这里统一从「滚动容器内」查询标题节点，与模式解耦。
   *
   * 判定「当前章节」用标题相对滚动容器顶部的偏移：取最后一个已滚过
   * 阈值线（顶部 + 80px）的标题；若一个都没滚过，则高亮第一个。
   */
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || toc.length === 0 || mode === "source") {
      setActiveHeading(-1);
      return;
    }
    const headings = Array.from(
      scroller.querySelectorAll<HTMLElement>("h1, h2, h3, h4"),
    );
    if (headings.length === 0) {
      setActiveHeading(-1);
      return;
    }

    let raf = 0;
    const compute = () => {
      raf = 0;
      const line = scroller.getBoundingClientRect().top + 80;
      let idx = 0;
      for (let i = 0; i < headings.length; i++) {
        if (headings[i].getBoundingClientRect().top <= line) idx = i;
        else break;
      }
      setActiveHeading(idx);
    };
    // 滚动用 rAF 节流，避免长文档下每帧都触发重排读取
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(compute);
    };

    compute();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    // previewHtml / draft 变化意味着 DOM 重建，需重新采集标题节点
  }, [toc, mode, previewHtml, draft]);

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

  // HTML 文档：清洗后直接渲染（不做 Markdown 转换）
  useEffect(() => {
    if (doc?.type === "html") {
      setHtmlPreview(sanitizeHtml(doc.body));
    } else {
      setHtmlPreview("");
    }
  }, [doc?.body, doc?.type]);

  // 搜索命中定位：预览渲染后，滚动到第一个高亮标记
  useEffect(() => {
    if (!highlight || mode !== "preview") return;
    const timer = setTimeout(() => {
      const container = contentRef.current;
      const hit = container?.querySelector("mark.search-hit, .search-hit");
      hit?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => clearTimeout(timer);
  }, [highlight, mode, previewHtml]);

  // 切换文档时重置为预览模式（表格/画板/数据表/流程图/思维导图默认进编辑态）
  useEffect(() => {
    const t = doc?.type ?? "doc";
    const isEdit = ["table", "board", "datasheet", "flowchart", "mindmap"].includes(t);
    setMode(isEdit ? "edit" : "preview");
    // 直接进编辑态时，同步初始化草稿内容（否则编辑器收到空内容）
    if (isEdit && doc) {
      setDraftTitle(doc.title);
      setDraft(doc.body);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.key, doc?.type]);

  // 多人协作：订阅文档 SSE（presence 在线列表 + 他人保存事件）
  useEffect(() => {
    if (!doc?.key) return;
    setCollabPresence([]);
    setCollabNotice(null);
    const sub = subscribeSSE(`/events/collab/${doc.key}`, (event) => {
      const t = event.type as string;
      if (t === "presence" && Array.isArray(event.presence)) {
        const list = (event.presence as { id: string; nickname: string; avatar?: string | null }[]).filter(
          (p) => p.id !== currentUserId,
        );
        setCollabPresence(list);
      } else if (t === "doc_updated") {
        // 他人在别的标签页/设备保存：预览态自动刷新，编辑态提示避免覆盖
        if (modeRef.current === "preview") {
          onRemoteUpdate?.();
        } else {
          const who = (event.updated_by as { nickname?: string } | undefined)?.nickname || "其他用户";
          setCollabNotice(`${who} 更新了本文档`);
        }
      } else if (t === "doc_deleted") {
        setCollabNotice("文档已被删除");
      }
    });
    return () => sub.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.key, currentUserId, onRemoteUpdate]);

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
        <div className="loading-row">
          <span className="spinner" />
          正在加载文档…
        </div>
      </main>
    );
  }

  if (!doc) {
    return (
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-[760px] px-4 py-10 sm:px-10">
          <h2 className="mb-4 text-base font-semibold text-text">最近浏览</h2>
          {!recent || recent.length === 0 ? (
            <EmptyState
              size="panel"
              icon={<HistoryIcon size={16} />}
              title="暂无浏览记录"
              description="从左侧选择一个文档开始阅读"
            />
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
                      <span className="block truncate text-[15px] text-text group-hover:text-accent">
                        {r.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-faint">
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
    if ((m === "edit" || m === "source") && mode === "preview") {
      setDraftTitle(doc.title);
      setDraft(doc.body);
    }
    setMode(m);
  };

  const handleSave = async () => {
    if (!doc) return;
    const title = draftTitle.trim();
    if (!title) {
      toast.warning("标题不能为空");
      return;
    }
    setSaving(true);
    try {
      await updateDocument(doc.key, title, draft);
      onSaved?.(doc, title, draft);
      setMode("preview");
    } catch (e) {
      toast.error(`保存失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setSaving(false);
    }
  };

  const copyMarkdown = async () => {
    if (!doc) return;
    const ok = await copyText(doc.body);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  /**
   * 点击大纲跳转到第 index 个标题。
   *
   * 之前只查 contentRef（预览态容器），编辑态下 contentRef 为 null，
   * 导致「编辑时点大纲没反应」。现改为在滚动容器内查找，三种模式通用。
   */
  const scrollToHeading = useCallback((index: number) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const headings = scroller.querySelectorAll("h1, h2, h3, h4");
    const el = headings[index] as HTMLElement | undefined;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // 立刻反映选中态，不必等滚动事件回传
    setActiveHeading(index);
  }, []);

  return (
    <main className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {/* 操作栏（始终显示）：复制 / 分享 / 收藏 / 编辑 卡片按钮，右侧一排 */}
        <div className="flex h-12 shrink-0 items-center border-b border-line bg-surface px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* 协作提示 */}
            {collabNotice && (
              <span className="truncate rounded-full bg-accent-soft px-2.5 py-0.5 text-[12px] text-accent">
                {collabNotice}
              </span>
            )}
            {/* 在线协作者 */}
            {collabPresence.length > 0 && (
              <span className="flex items-center gap-1" title={`${collabPresence.length} 人在线协作`}>
                <span className="flex -space-x-1.5">
                  {collabPresence.slice(0, 3).map((p) => (
                    <span
                      key={p.id}
                      className="grid h-6 w-6 place-items-center rounded-full border border-background bg-accent-solid text-[11px] font-medium text-white"
                      title={p.nickname}
                    >
                      {p.avatar ? (
                        <img src={p.avatar} alt={p.nickname} className="h-full w-full rounded-full object-cover" />
                      ) : (
                        (p.nickname || "?").slice(0, 1)
                      )}
                    </span>
                  ))}
                </span>
                <span className="text-[12px] text-muted">{collabPresence.length} 人在线</span>
              </span>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Tooltip content={copied ? "已复制" : "复制 Markdown"}>
              <button
                onClick={copyMarkdown}
                className={`btn btn-sm btn-secondary hover:border-accent/40 hover:text-accent ${
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
                  className="btn btn-sm btn-secondary hover:border-accent/40 hover:text-accent"
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
                  className={`btn btn-sm ${
                    isFavorite
                      ? "border border-accent/40 bg-accent-soft text-accent"
                      : "btn-secondary hover:border-accent/40 hover:text-accent"
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
                  className={`btn btn-sm ${
                    pinned
                      ? "border border-accent/40 bg-accent-soft text-accent"
                      : "btn-secondary hover:border-accent/40 hover:text-accent"
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
                  className="btn btn-sm btn-secondary hover:border-accent/40 hover:text-accent"
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
                  className="btn btn-sm btn-secondary hover:border-accent/40 hover:text-accent"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
                    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
                  </svg>
                  摘要
                </button>
              </Tooltip>
            )}
            {onOpenHistory && (
              <Tooltip content="版本历史">
                <button
                  onClick={onOpenHistory}
                  className="btn btn-sm btn-secondary hover:border-accent/40 hover:text-accent"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  历史
                </button>
              </Tooltip>
            )}
            {onOpenComments && (
              <Tooltip content="评论">
                <button
                  onClick={onOpenComments}
                  className="btn btn-sm btn-secondary hover:border-accent/40 hover:text-accent"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  评论
                  {commentCount ? (
                    <span className="ml-0.5 rounded-full bg-accent-soft px-1.5 text-[10px] font-medium leading-[16px] text-accent">
                      {commentCount}
                    </span>
                  ) : null}
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
              <>
                <Tooltip content="源码编辑">
                  <button
                    onClick={() => handleSwitch("source")}
                    className="btn btn-sm btn-secondary hover:border-accent/40 hover:text-accent"
                  >
                    <CodeIcon size={14} />
                    源码
                  </button>
                </Tooltip>
                <Tooltip content="编辑文档">
                  <button
                    onClick={() => handleSwitch("edit")}
                    className="btn btn-accent text-white"
                  >
                    <EditIcon size={14} />
                    编辑
                  </button>
                </Tooltip>
              </>
            ) : (
              <>
                <Tooltip content={mode === "source" ? "切换可视化编辑" : "切换源码编辑"}>
                  <button
                    onClick={() => setMode(mode === "source" ? "edit" : "source")}
                    disabled={saving}
                    className="btn btn-sm btn-secondary hover:border-accent/40 hover:text-accent"
                  >
                    <CodeIcon size={14} />
                    {mode === "source" ? "可视化" : "源码"}
                  </button>
                </Tooltip>
                <Tooltip content="放弃编辑">
                  <button
                    onClick={() => setMode("preview")}
                    disabled={saving}
                    className="btn btn-secondary"
                  >
                    取消
                  </button>
                </Tooltip>
                <Tooltip content="完成并保存">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="btn btn-accent text-white"
                  >
                    <CheckIcon size={14} />
                    {saving ? "保存中…" : "完成"}
                  </button>
                </Tooltip>
              </>
            )}
          </div>
        </div>

        {/* 正文（key 按文档变化：切换文档时重新挂载 + 淡入） */}
        <div key={doc.key} ref={scrollRef} className="anim-fade-in flex-1 overflow-y-auto py-8">
          {mode === "preview" ? (
            <div className="mx-auto max-w-[1080px] px-4 sm:px-10">
              <h1 className="text-[32px] font-bold leading-[1.25] tracking-[-0.01em] text-text">
                {doc.title}
              </h1>
              <p className="mt-3 text-[14px] text-faint">
                {doc.path} · 更新于 {doc.updated}
              </p>
              {summary && (
                <div className="mt-4 rounded-lg border border-accent/20 bg-accent-soft px-4 py-3 text-[14px] leading-relaxed text-text">
                  <span className="mr-2 font-semibold text-accent">摘要</span>
                  {summary}
                </div>
              )}
              {tags && tags.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[13px] text-muted"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-4 border-b border-line" />
              <ErrorBoundary key={doc.key} title="文档渲染失败">
              {doc.type === "table" ? (
                <div className="mt-6 overflow-auto">
                  <table className="border-collapse">
                    <tbody>
                      {parseTableData(doc.body).map((row, r) => (
                        <tr key={r}>
                          {row.map((cell, c) => (
                            <td
                              key={c}
                              className="border border-line px-3 py-1.5 text-[14px] text-text"
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : doc.type === "flowchart" ? (
                <div className="mt-6 overflow-hidden rounded-lg border border-line">
                  <LazyFlowchartEditor key={doc.key} value={doc.body} onChange={() => {}} readOnly />
                </div>
              ) : doc.type === "mindmap" ? (
                <div className="mt-6 overflow-hidden rounded-lg border border-line">
                  <LazyMindMapEditor key={doc.key} value={doc.body} onChange={() => {}} readOnly />
                </div>
              ) : doc.type === "board" ? (
                <div className="mt-6 overflow-hidden rounded-lg border border-line">
                  <LazyBoardEditor key={doc.key} value={doc.body} onChange={() => {}} readOnly />
                </div>
              ) : doc.type === "datasheet" ? (
                <div className="mt-6 overflow-hidden rounded-lg border border-line">
                  <LazyDatasheetEditor key={doc.key} value={doc.body} onChange={() => {}} readOnly />
                </div>
              ) : doc.type === "html" ? (
                <div
                  ref={contentRef}
                  className="md-body mt-6"
                  onMouseUp={handleTextSelect}
                  dangerouslySetInnerHTML={{ __html: htmlPreview }}
                />
              ) : (
                <div
                  ref={contentRef}
                  className="md-body mt-6"
                  onClick={(e) => {
                    handleCodeBlockCopy(e);
                    const target = e.target as HTMLElement;
                    const anchor = target.closest(".md-anchor") as HTMLElement | null;
                    if (anchor) {
                      e.preventDefault();
                      const href = anchor.getAttribute("href") || "";
                      const url = `${window.location.origin}${window.location.pathname}${href}`;
                      copyText(url).then((ok) =>
                        ok ? toast.success("已复制章节链接") : toast.info("复制失败，请手动复制"),
                      );
                      return;
                    }
                    const t = target.closest(".wikilink") as HTMLElement | null;
                    if (t?.dataset.wikilink && onOpenWikilink) {
                      onOpenWikilink(t.dataset.wikilink);
                    }
                  }}
                  onMouseUp={handleTextSelect}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              )}
              </ErrorBoundary>
              {backlinks && backlinks.length > 0 && (
                <div className="mt-10">
                  <h2 className="flex items-center gap-2 text-[15px] font-semibold text-text">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    反向链接
                    <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-normal text-faint">
                      {backlinks.length}
                    </span>
                  </h2>
                  <ul className="mt-3 overflow-hidden rounded-lg border border-line bg-surface">
                    {backlinks.map((b, i) => (
                      <li key={b.id}>
                        <button
                          onClick={() => onOpenRecent?.(b.id, b.kb_id)}
                          className="group flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-hover"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-faint">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <path d="M14 2v6h6" />
                          </svg>
                          <span className="min-w-0 flex-1 truncate text-[14px] text-text group-hover:text-accent">
                            {b.title}
                          </span>
                        </button>
                        {i < backlinks.length - 1 && <div className="border-b border-line" />}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-[1200px] px-4 sm:px-10">
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="w-full bg-transparent text-[32px] font-bold leading-[1.25] tracking-[-0.01em] text-text outline-none placeholder:text-faint"
                placeholder="标题"
                spellCheck={false}
              />
              <p className="mt-3 text-[14px] text-faint">
                {doc.path} · 更新于 {doc.updated}
              </p>
              <div className="mt-4 border-b border-line" />
              <div className="mt-6">
                <ErrorBoundary key={`${doc.key}-${mode}`} title="编辑器加载失败">
                {mode === "source" ? (
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="textarea min-h-[60vh] resize-y px-4 py-3 font-mono"
                    placeholder={
                      doc.type === "html"
                        ? "在此编辑 HTML 源码…"
                        : doc.type === "flowchart" || doc.type === "mindmap"
                          ? "在此编辑 JSON 源码…"
                          : "在此输入 Markdown 源码…"
                    }
                    spellCheck={false}
                  />
                ) : doc.type === "table" ? (
                  <LazyTableEditor key={doc.key} value={doc.body} onChange={setDraft} />
                ) : doc.type === "board" ? (
                  <LazyBoardEditor key={doc.key} value={doc.body} onChange={setDraft} />
                ) : doc.type === "datasheet" ? (
                  <LazyDatasheetEditor key={doc.key} value={doc.body} onChange={setDraft} />
                ) : doc.type === "flowchart" ? (
                  <LazyFlowchartEditor key={doc.key} value={doc.body} onChange={setDraft} />
                ) : doc.type === "mindmap" ? (
                  <LazyMindMapEditor key={doc.key} value={doc.body} onChange={setDraft} />
                ) : doc.type === "html" ? (
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="textarea min-h-[60vh] resize-y px-4 py-3 font-mono"
                    placeholder="在此编辑 HTML 源码…"
                    spellCheck={false}
                  />
                ) : (
                  <LazyRichEditor
                    key={doc.key}
                    value={doc.body}
                    onChange={setDraft}
                    placeholder="开始输入内容…"
                  />
                )}
                </ErrorBoundary>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右侧大纲（有标题时显示） */}
      {toc.length > 0 && (
        <aside
          style={{ width: tocWidth }}
          className="relative hidden shrink-0 overflow-y-auto border-l border-line bg-surface lg:block"
        >
          <div
            onMouseDown={onTocResize}
            className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize transition-colors hover:bg-accent/25"
          />
          <div className="sticky top-0 border-b border-line bg-surface px-3 py-2.5 text-[15px] font-semibold text-text">
            大纲
          </div>
          <ul className="p-1.5">
            {toc.map((item, i) => (
              <li key={i}>
                <button
                  onClick={() => scrollToHeading(i)}
                  aria-current={activeHeading === i ? "location" : undefined}
                  className={`flex w-full items-center rounded-md py-1 text-left text-[15px] leading-snug transition-colors ${
                    activeHeading === i
                      ? "bg-accent-soft font-medium text-accent"
                      : "text-text hover:bg-hover"
                  }`}
                  style={{ paddingLeft: 8 + (item.level - 1) * 12 }}
                >
                  <span className="line-clamp-1">{item.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}

      {/* 划词浮动操作条：AI 辅助 + 批注 */}
      {annotate && (
        <div
          data-annotate-btn
          style={{ left: annotate.x, top: Math.max(8, annotate.y - 36) }}
          className="fixed z-50 flex -translate-x-1/2 items-center gap-1"
        >
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setAiAssist({ x: annotate.x, y: annotate.y, text: annotate.text });
              setAnnotate(null);
              window.getSelection()?.removeAllRanges();
            }}
            className="btn-ghost bg-accent-solid px-2.5 text-white shadow-md hover:bg-accent-solid-hover hover:brightness-105"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
              <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
            </svg>
            AI
          </button>
          {onAnnotate && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onAnnotate(annotate.text);
                setAnnotate(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="btn-ghost border border-line bg-surface px-2.5 text-text shadow-md hover:bg-hover"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              批注
            </button>
          )}
        </div>
      )}

      {/* 划词 AI 辅助面板 */}
      {aiAssist && (
        <AiAssistPopover
          x={aiAssist.x}
          y={aiAssist.y}
          text={aiAssist.text}
          onClose={() => setAiAssist(null)}
        />
      )}
    </main>
  );
}
