"use client";

import { useState, useRef, useEffect } from "react";
import { FileTree } from "./FileTree";
import { Tooltip } from "./Tooltip";
import { PlusIcon, SearchIcon, CloseIcon } from "./icons";
import type { TreeNode, SortBy } from "@/data/docs";
import type { Folder, SearchResult } from "@/lib/api";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 安全地高亮关键词（先转义，再包裹 <mark>） */
function highlightKw(text: string, kw: string): string {
  const escaped = escapeHtml(text);
  if (!kw) return escaped;
  const kwEsc = escapeHtml(kw);
  const lower = escaped.toLowerCase();
  const kwl = kwEsc.toLowerCase();
  let out = "";
  let i = 0;
  while (i < escaped.length) {
    const idx = lower.indexOf(kwl, i);
    if (idx === -1) {
      out += escaped.slice(i);
      break;
    }
    out += escaped.slice(i, idx);
    out += `<mark class="search-hit">${escaped.slice(idx, idx + kwEsc.length)}</mark>`;
    i = idx + kwEsc.length;
  }
  return out;
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
  listError,
  kbName,
  onBackHome,
  searchQuery,
  onSearchChange,
  searchResults,
  searching,
  onOpenSearchResult,
  sortBy,
  onSortChange,
  readOnly,
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
  onRenameFolder?: () => void;
  onMoveDoc?: (docId: string, folderId: string | null) => void;
  listError?: string | null;
  kbName?: string;
  onBackHome?: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchResults: SearchResult[];
  searching: boolean;
  onOpenSearchResult: (docId: string) => void;
  sortBy: SortBy;
  onSortChange: (s: SortBy) => void;
  readOnly?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

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
  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-r border-line bg-surface">
        <Tooltip content="展开侧栏">
          <button
            onClick={onToggleCollapse}
            className="mt-3 grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
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
            className="mt-3 grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
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

  const sortLabel = sortOptions.find((o) => o.value === sortBy)?.label ?? "排序";

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
    <aside className="flex w-[260px] min-w-[180px] max-w-[420px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="border-b border-line px-3 pb-2.5 pt-2.5">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-1">
            {onBackHome && (
              <Tooltip content="返回首页" className="shrink-0">
                <button
                  onClick={onBackHome}
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
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              </Tooltip>
            )}
            <span className="truncate text-xs text-faint">
              {kbName ?? "知识库 · 全部文档"}
            </span>
          </div>
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
        </div>

        {readOnly ? (
          <div className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px] text-faint">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            只读模式
          </div>
        ) : (
        <div className="flex gap-1.5">
          <div className="relative flex-1" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="btn-accent flex w-full items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-medium text-white"
            >
              <PlusIcon size={14} />
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
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-text hover:bg-hover"
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
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[13px] text-text transition-colors hover:bg-hover"
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
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[13px] text-text transition-colors hover:bg-hover"
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
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索文档内容…"
              className="w-full rounded-lg border border-line bg-background py-1.5 pl-8 pr-7 text-[13px] text-text outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {searchQuery && (
              <Tooltip
                content="清除"
                className="absolute right-1.5 top-1/2 -translate-y-1/2"
              >
                <button
                  onClick={() => onSearchChange("")}
                  className="grid h-5 w-5 place-items-center rounded text-faint hover:bg-hover hover:text-text"
                >
                  <CloseIcon size={12} />
                </button>
              </Tooltip>
            )}
          </div>

          <div className="relative shrink-0" ref={sortMenuRef}>
            <Tooltip content="排序方式">
              <button
                onClick={() => setSortMenuOpen((v) => !v)}
                className="flex items-center gap-1 rounded-lg border border-line px-2 py-1.5 text-[12px] text-muted transition-colors hover:bg-hover hover:text-text"
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
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] hover:bg-hover ${
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
            <div className="px-2 py-1 text-[11px] text-faint">
              {searching
                ? "搜索中…"
                : `共 ${searchResults.length} 条结果`}
            </div>
            {!searching && searchResults.length === 0 && (
              <div className="px-2 py-6 text-center text-[12px] text-faint">
                无匹配结果
              </div>
            )}
            {searchResults.map((r) => (
              <button
                key={r.doc_id}
                onClick={() => onOpenSearchResult(r.doc_id)}
                className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
              >
                <span
                  className="truncate text-[13px] text-text"
                  dangerouslySetInnerHTML={{
                    __html: highlightKw(r.title, searchQuery.trim()),
                  }}
                />
                <span
                  className="line-clamp-2 text-[11px] leading-snug text-faint"
                  dangerouslySetInnerHTML={{
                    __html: highlightKw(r.snippet, searchQuery.trim()),
                  }}
                />
              </button>
            ))}
          </div>
        ) : (
          <>
            {listError && (
              <div className="mx-1 mb-2 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5 text-[11px] text-danger">
                {listError}（后端服务未启动？）
              </div>
            )}
            {data.length === 0 && !listError && (
              <div className="px-2 py-4 text-center text-[12px] text-faint">
                暂无文档，点击上方「导入」或「新建」
              </div>
            )}
            <FileTree
              data={data}
              activeKey={activeKey}
              onSelect={onSelect}
              folders={folders}
              onDeleteDoc={readOnly ? undefined : onDeleteDoc}
              onDeleteFolder={readOnly ? undefined : onDeleteFolder}
              onRenameFolder={readOnly ? undefined : onRenameFolder}
              onMoveDoc={readOnly ? undefined : onMoveDoc}
            />
          </>
        )}
      </div>
    </aside>
  );
}
