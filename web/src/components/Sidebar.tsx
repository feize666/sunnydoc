"use client";

import { useState, useRef, useEffect } from "react";
import { FileTree } from "./FileTree";
import { Tooltip } from "./Tooltip";
import { PlusIcon, SearchIcon, CloseIcon } from "./icons";
import { useResizable } from "@/hooks/useResizable";
import type { TreeNode, SortBy } from "@/data/docs";
import type { Folder, SearchResult } from "@/lib/api";
import type { NodeType } from "./NewNodeMenu";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 安全地高亮关键词（先转义，再包裹 <mark>）；支持多关键词（空格分隔）。 */
function highlightKw(text: string, kw: string): string {
  const escaped = escapeHtml(text);
  if (!kw) return escaped;
  const kws = kw.trim().split(/\s+/).filter(Boolean).map(escapeHtml);
  if (kws.length === 0) return escaped;
  const lower = escaped.toLowerCase();
  // 收集所有命中区间
  const ranges: Array<[number, number]> = [];
  for (const k of kws) {
    const kl = k.toLowerCase();
    let i = 0;
    while (i < escaped.length) {
      const idx = lower.indexOf(kl, i);
      if (idx === -1) break;
      ranges.push([idx, idx + k.length]);
      i = idx + k.length;
    }
  }
  if (ranges.length === 0) return escaped;
  // 合并重叠区间
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) {
      last[1] = Math.max(last[1], r[1]);
    } else {
      merged.push([r[0], r[1]]);
    }
  }
  // 按区间插入 mark
  let out = "";
  let pos = 0;
  for (const [s, e] of merged) {
    out += escaped.slice(pos, s);
    out += `<mark class="search-hit">${escaped.slice(s, e)}</mark>`;
    pos = e;
  }
  out += escaped.slice(pos);
  return out;
}

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  { value: "doc", label: "文档" },
  { value: "table", label: "表格" },
  { value: "board", label: "画板" },
  { value: "datasheet", label: "数据表" },
];

function TypeIcon({ type }: { type?: string }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (type === "table") {
    return (
      <svg {...common}>
        <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" />
      </svg>
    );
  }
  if (type === "board") {
    return (
      <svg {...common}>
        <path d="M3 3h18v18H3zM7 16l4-4 3 2 4-5" />
      </svg>
    );
  }
  if (type === "datasheet") {
    return (
      <svg {...common}>
        <path d="M4 5h16v14H4zM4 9h16M9 9v10" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export function Sidebar({
  data,
  activeKey,
  onSelect,
  collapsed,
  onToggleCollapse,
  folders,
  onImport,
  onNewDoc,
  onNewFolder,
  onExport,
  onRefresh,
  onDeleteDoc,
  onDeleteFolder,
  onRenameFolder,
  onMoveDoc,
  onMoveFolder,
  onMoveToKb,
  onNew,
  onRenameDoc,
  onDuplicateDoc,
  onPinDoc,
  onExportDoc,
  listError,
  kbName,
  onBackHome,
  searchQuery,
  onSearchChange,
  searchType,
  onSearchTypeChange,
  searchTag,
  onSearchTagChange,
  searchSort,
  onSearchSortChange,
  searchResults,
  searching,
  onOpenSearchResult,
  sortBy,
  onSortChange,
  readOnly,
  onOpenTrash,
  mobile,
  onCloseMobile,
}: {
  data: TreeNode[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  folders: Folder[];
  onImport: () => void;
  onNewDoc: () => void;
  onNewFolder: () => void;
  onExport: () => void;
  onRefresh?: () => void;
  onDeleteDoc?: (key: string) => void;
  onDeleteFolder?: (id: string) => void;
  onRenameFolder?: (folderId: string, name: string) => Promise<void> | void;
  onMoveDoc?: (docId: string, folderId: string | null, sortOrder?: number | null) => void;
  onMoveFolder?: (folderId: string, parentId: string | null, sortOrder?: number | null) => void;
  onMoveToKb?: (docId: string) => void;
  onNew?: (type: NodeType, parentFolderId: string | null) => void;
  onRenameDoc?: (docId: string, name: string) => Promise<void> | void;
  onDuplicateDoc?: (docId: string) => void;
  onPinDoc?: (docId: string, pinned: boolean) => void;
  onExportDoc?: (docId: string) => void;
  listError?: string | null;
  kbName?: string;
  onBackHome?: () => void;
  onOpenTrash?: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchType: string;
  onSearchTypeChange: (t: string) => void;
  searchTag: string;
  onSearchTagChange: (t: string) => void;
  searchSort: string;
  onSearchSortChange: (s: string) => void;
  searchResults: SearchResult[];
  searching: boolean;
  onOpenSearchResult: (docId: string) => void;
  sortBy: SortBy;
  onSortChange: (s: SortBy) => void;
  readOnly?: boolean;
  mobile?: boolean;
  onCloseMobile?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const [selIndex, setSelIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    try {
      setHistory(JSON.parse(localStorage.getItem("search_history") || "[]"));
    } catch {
      setHistory([]);
    }
  }, []);

  const pushHistory = (q: string) => {
    const kw = q.trim();
    if (!kw) return;
    const next = [kw, ...history.filter((h) => h !== kw)].slice(0, 8);
    setHistory(next);
    try {
      localStorage.setItem("search_history", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const { width: sidebarWidth, onMouseDown: onResize } = useResizable(260, 220, 480, "sidebar_width");

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (
        sortMenuRef.current &&
        !sortMenuRef.current.contains(e.target as Node)
      ) {
        setSortMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // 折叠态：渲染窄竖条，点击展开
  if (collapsed && !mobile) {
    return (
      <aside className="hidden w-10 shrink-0 flex-col items-center border-r border-line bg-surface md:flex">
        <Tooltip content="展开侧栏">
          <button
            onClick={onToggleCollapse}
            className="mt-2.5 grid h-8 w-8 place-items-center rounded-md border border-line text-faint transition-colors hover:bg-hover hover:text-text"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </Tooltip>
        <Tooltip content="展开侧栏">
          <button
            onClick={onToggleCollapse}
            className="mt-3 grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-accent"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H2zM14 7h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6z" />
            </svg>
          </button>
        </Tooltip>
      </aside>
    );
  }

  const sortOptions: { value: SortBy; label: string }[] = [
    { value: "numeric", label: "按数字" },
    { value: "name", label: "按名称" },
    { value: "created", label: "按创建时间" },
  ];

  const sortLabel =
    sortBy === "manual"
      ? "默认顺序"
      : sortOptions.find((o) => o.value === sortBy)?.label ?? "排序";

  const createItems = [
    {
      label: "新建文档",
      icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
      action: () => onNewDoc(),
    },
    {
      label: "新建文件夹",
      icon: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
      action: () => onNewFolder(),
    },
  ];

  return (
    <aside
      style={{ width: sidebarWidth }}
      className={`relative flex shrink-0 flex-col border-r border-line bg-surface ${
        mobile
          ? "fixed inset-y-0 left-0 z-40 md:hidden"
          : "hidden md:flex"
      }`}
    >
      <div
        onMouseDown={onResize}
        className="absolute -right-1 bottom-0 top-0 z-10 w-2 cursor-col-resize transition-colors hover:bg-accent/25"
      />
      <div className="border-b border-line px-3 pb-2.5 pt-2.5">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-1.5">
            {onBackHome && (
              <Tooltip content="返回首页" className="shrink-0">
                <button
                  onClick={onBackHome}
                  className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
                >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              </Tooltip>
            )}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-accent"
            >
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <span className="truncate text-[15px] font-semibold text-text">
              {kbName ?? "知识库 · 全部文档"}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            {onRefresh && (
              <Tooltip content="刷新文档列表">
                <button
                  onClick={onRefresh}
                  className="grid h-6 w-6 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
                  </svg>
                </button>
              </Tooltip>
            )}
            <Tooltip content="折叠侧栏">
              <button
                onClick={onToggleCollapse}
                className="grid h-6 w-6 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            </Tooltip>
          </div>
        </div>

        {readOnly ? (
          <div className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[13px] text-faint">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            只读模式
          </div>
        ) : (
        <div className="flex items-center gap-1.5">
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="btn btn-accent text-white"
            >
              <PlusIcon size={15} />
              新建
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className={`transition-transform ${menuOpen ? "rotate-180" : ""}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {menuOpen && (
              <div className="menu-panel absolute left-0 top-full z-50 mt-1 w-44">
                {createItems.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      item.action();
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[14px] text-text hover:bg-hover"
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="shrink-0 text-muted"
                    >
                      <path d={item.icon} />
                    </svg>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Tooltip content="导入文档">
            <button
              onClick={onImport}
              className="btn btn-secondary"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-muted"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              导入
            </button>
          </Tooltip>

          <Tooltip content="导出文档">
            <button
              onClick={onExport}
              className="btn btn-secondary"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-muted"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              导出
            </button>
          </Tooltip>
        </div>
        )}

        <div className="mt-2 flex items-center gap-1.5">
          <div className="relative flex-1">
            <SearchIcon
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={searchQuery}
              onChange={(e) => {
                onSearchChange(e.target.value);
                setSelIndex(0);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelIndex((i) => Math.min(i + 1, searchResults.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const r = searchResults[Math.max(0, Math.min(selIndex, searchResults.length - 1))];
                  if (r) {
                    pushHistory(searchQuery);
                    onOpenSearchResult(r.doc_id);
                  }
                } else if (e.key === "Escape") {
                  onSearchChange("");
                  setSelIndex(0);
                }
              }}
              placeholder="搜索文档内容…"
              className="h-9 w-full rounded-lg border border-line bg-background pl-9 pr-9 text-[15px] text-text outline-none placeholder:text-faint transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-faint transition-colors hover:bg-hover hover:text-text"
                title="清除"
              >
                <CloseIcon size={14} />
              </button>
            )}

            {focused && searchQuery.trim() === "" && history.length > 0 && (
              <div className="menu-panel absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl py-1">
                <div className="px-3 py-1 text-[12px] text-faint">最近搜索</div>
                {history.map((h) => (
                  <button
                    key={h}
                    onClick={() => onSearchChange(h)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[14px] text-text hover:bg-hover"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-faint">
                      <circle cx="11" cy="11" r="7" />
                      <path d="M21 21l-4-4" />
                    </svg>
                    <span className="truncate">{h}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative shrink-0" ref={sortMenuRef}>
            <Tooltip content="排序方式">
              <button
                onClick={() => setSortMenuOpen((v) => !v)}
                className="flex h-9 items-center gap-1 rounded-lg border border-line px-2.5 text-[14px] text-muted transition-colors hover:bg-hover hover:text-text"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 6h13M8 12h13M8 18h13" />
                  <path d="M3 5l2 2 2-2M3 11l2 2 2-2M3 17l2 2 2-2" />
                </svg>
                {sortLabel}
              </button>
            </Tooltip>
            {sortMenuOpen && (
              <div className="menu-panel absolute right-0 top-full z-50 mt-1 w-32">
                {sortOptions.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => {
                      onSortChange(o.value);
                      setSortMenuOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] hover:bg-hover ${
                      sortBy === o.value
                        ? "text-accent"
                        : "text-muted hover:text-text"
                    }`}
                  >
                    <span>{o.label}</span>
                    {sortBy === o.value && <span>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {searchQuery.trim() !== "" ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-1 px-1 py-1">
              {TYPE_FILTERS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => onSearchTypeChange(t.value)}
                  className={`rounded-full px-2.5 py-0.5 text-[12px] transition-colors ${
                    searchType === t.value
                      ? "bg-accent text-white"
                      : "text-muted hover:bg-hover hover:text-text"
                  }`}
                >
                  {t.label}
                </button>
              ))}
              <span className="mx-0.5 h-3 w-px bg-line" />
              <button
                onClick={() => onSearchSortChange("relevance")}
                className={`rounded-full px-2 py-0.5 text-[12px] transition-colors ${
                  searchSort === "relevance" ? "bg-accent text-white" : "text-muted hover:bg-hover hover:text-text"
                }`}
              >
                相关度
              </button>
              <button
                onClick={() => onSearchSortChange("created")}
                className={`rounded-full px-2 py-0.5 text-[12px] transition-colors ${
                  searchSort === "created" ? "bg-accent text-white" : "text-muted hover:bg-hover hover:text-text"
                }`}
              >
                时间
              </button>
              {searchTag && (
                <button
                  onClick={() => onSearchTagChange("")}
                  className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[12px] text-accent"
                >
                  #{searchTag}
                  <span className="text-faint">×</span>
                </button>
              )}
            </div>
            <div className="px-2 py-1 text-[12px] text-faint">
              {searching
                ? "搜索中…"
                : `共 ${searchResults.length} 条结果`}
            </div>
            {!searching && searchResults.length === 0 && (
              <div className="px-2 py-6 text-center text-[13px] text-faint">
                无匹配结果
              </div>
            )}
            {searchResults.map((r, i) => (
              <button
                key={r.doc_id}
                onClick={() => onOpenSearchResult(r.doc_id)}
                onMouseEnter={() => setSelIndex(i)}
                className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                  i === selIndex ? "bg-hover" : "hover:bg-hover"
                }`}
              >
                <span className="mt-0.5 shrink-0 text-faint">
                  <TypeIcon type={r.type} />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span
                    className="truncate text-[16px] text-text"
                    dangerouslySetInnerHTML={{
                      __html: highlightKw(r.title, searchQuery.trim()),
                    }}
                  />
                  <span
                    className="line-clamp-2 text-[13px] leading-snug text-faint"
                    dangerouslySetInnerHTML={{
                      __html: highlightKw(r.snippet, searchQuery.trim()),
                    }}
                  />
                  {(r.match_count ?? 0) > 0 && (
                    <span className="text-[11px] text-faint/80">
                      命中 {r.match_count} 处
                    </span>
                  )}
                  {(r.tags && r.tags.length > 0) && (
                    <span className="flex flex-wrap items-center gap-1">
                      {r.tags.map((t) => (
                        <span
                          key={t}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSearchTagChange(t);
                          }}
                          className="rounded bg-surface-2 px-1.5 py-px text-[10px] text-muted hover:bg-accent-soft hover:text-accent"
                        >
                          #{t}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <>
            {listError && (
              <div className="mx-1 mb-2 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5 text-[12px] text-danger">
                {listError}（后端服务未启动？）
              </div>
            )}
            {data.length === 0 && !listError && (
              <div className="px-2 py-4 text-center text-[13px] text-faint">
                暂无文档，点击上方「导入」或「新建」
              </div>
            )}
            <FileTree
              data={data}
              activeKey={activeKey}
              onSelect={(key) => {
                onSelect(key);
                if (mobile) onCloseMobile?.();
              }}
              folders={folders}
              onNew={readOnly ? undefined : onNew}
              onRenameDoc={readOnly ? undefined : onRenameDoc}
              onRenameFolder={readOnly ? undefined : onRenameFolder}
              onDuplicateDoc={readOnly ? undefined : onDuplicateDoc}
              onPinDoc={readOnly ? undefined : onPinDoc}
              onExportDoc={readOnly ? undefined : onExportDoc}
              onDeleteDoc={readOnly ? undefined : onDeleteDoc}
              onDeleteFolder={readOnly ? undefined : onDeleteFolder}
              onMoveDoc={readOnly ? undefined : onMoveDoc}
              onMoveFolder={readOnly ? undefined : onMoveFolder}
              onMoveToKb={readOnly ? undefined : onMoveToKb}
            />
          </>
        )}
      </div>

      {onOpenTrash && (
        <div className="border-t border-line p-1.5">
          <button
            onClick={onOpenTrash}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[14px] text-muted transition-colors hover:bg-hover hover:text-text"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            回收站
          </button>
        </div>
      )}
    </aside>
  );
}
