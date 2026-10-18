"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SearchResult } from "@/lib/api";

/**
 * 命令面板里的一项命令。
 *
 * ⚠️ `action` 是可选的 —— 但**没有 action 的命令等于坏按钮**：
 * 点击会关闭面板却不做任何事，用户以为功能坏了（实测过两项：
 * 「全文搜索」「系统设置」，点击后焦点掉到 body、什么都没发生）。
 * 因此渲染层对无 action 的项**显式标注为不可用**，而不是让它假装可点。
 * 真机脚本也据此断言「每一项都必须能执行」。
 */
export interface Command {
  icon: ReactNode;
  label: string;
  hint?: string;
  action?: () => void;
}

interface Item {
  kind: "command" | "result" | "header" | "tag";
  key: string;
  command?: Command;
  result?: SearchResult;
  label?: string;
  /** kind === "tag" 时的标签信息 */
  tag?: { name: string; count: number };
}

export function CommandPalette({
  open,
  onClose,
  commands,
  onSearch,
  onOpenResult,
  /**
   * 标签匹配结果（P4-2「统一检索入口」）。
   *
   * 为什么把它作为 props 而不是面板内部去查：标签数据（含篇数）来自
   * 上层已经持有的 `metas`，面板再去请求一次既多余又可能不一致
   * （同一份数据的第二条产出路径 —— 本项目已因此踩过坑）。
   */
  tags = [],
  onOpenTag,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  onSearch?: (q: string) => Promise<SearchResult[]>;
  onOpenResult?: (docId: string) => void;
  tags?: { name: string; count: number }[];
  onOpenTag?: (tag: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActiveIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [open]);

  // 输入即搜：过滤命令 + 全文搜索（防抖 200ms）
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!onSearch) return;
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      try {
        setResults(await onSearch(q));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, open, onSearch]);

  const filteredCommands = commands.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return c.label.toLowerCase().includes(q) || (c.hint ?? "").toLowerCase().includes(q);
  });

  // 组装可导航列表：命令 + 标签匹配 + （结果分组头 + 结果）
  // 标签排在文档结果之前：标签是「归类」，通常比零散命中更快缩小范围。
  const items: Item[] = [];
  filteredCommands.forEach((c, i) =>
    items.push({ kind: "command", key: `c-${i}`, command: c }),
  );
  const q0 = query.trim().toLowerCase();
  const matchedTags = q0
    ? tags.filter((t) => t.name.toLowerCase().includes(q0)).slice(0, 8)
    : [];
  if (matchedTags.length > 0) {
    items.push({ kind: "header", key: "h-tags", label: "标签" });
    matchedTags.forEach((t) =>
      items.push({ kind: "tag", key: `t-${t.name}`, tag: t }),
    );
  }
  if (query.trim() && onSearch) {
    if (results.length > 0) {
      items.push({ kind: "header", key: "h-results", label: "文档搜索结果" });
      results.forEach((r) =>
        items.push({ kind: "result", key: `r-${r.doc_id}`, result: r }),
      );
    } else if (!searching) {
      items.push({ kind: "header", key: "h-empty", label: "无匹配文档" });
    }
  }

  // 结果变化后重置选中项，避免越界
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // 滚动到选中项
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const run = (item: Item) => {
    if (item.kind === "command") {
      // 无 action 的命令不关闭面板 —— 关掉却不做事最让人困惑。
      // （面板里它们已被标为禁用态，正常不会走到这里，属兜底。）
      if (!item.command?.action) return;
      onClose();
      item.command.action();
    } else if (item.kind === "result" && item.result) {
      onClose();
      onOpenResult?.(item.result.doc_id);
    } else if (item.kind === "tag" && item.tag) {
      onClose();
      onOpenTag?.(item.tag.name);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = items[activeIndex];
      if (item) run(item);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="panel anim-scale-in fixed left-1/2 top-[16%] z-50 w-[560px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-xl">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-faint">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索命令或文档内容…"
            className="w-full bg-transparent py-3.5 text-[16px] text-text outline-none placeholder:text-faint"
          />
          <kbd className="rounded border border-line bg-background px-1 font-mono text-[10px] text-faint">ESC</kbd>
        </div>
        <div ref={listRef} className="max-h-[360px] overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-[13px] text-faint">
              没有匹配的命令或文档
            </div>
          ) : (
            items.map((item, i) => {
              if (item.kind === "header") {
                return (
                  <div key={item.key} className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
                    {item.label}
                  </div>
                );
              }
              const active = i === activeIndex;
              if (item.kind === "result" && item.result) {
                const r = item.result;
                return (
                  <button
                    key={item.key}
                    data-index={i}
                    data-testid="palette-result"
                    onClick={() => run(item)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`relative flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left ${
                      active ? "bg-accent-soft text-accent" : "text-text"
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                    )}
                    <span className="truncate text-[14px]">{r.title}</span>
                    <span className="line-clamp-1 text-[12px] text-faint">{r.snippet}</span>
                  </button>
                );
              }
              if (item.kind === "tag" && item.tag) {
                return (
                  <button
                    key={item.key}
                    data-index={i}
                    data-testid="palette-tag"
                    onClick={() => run(item)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left ${
                      active ? "bg-accent-soft text-accent" : "text-text"
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                    )}
                    <span className="grid w-5 shrink-0 place-items-center text-muted">
                      {/* 标签图标（内联 —— 与面板里其它图标风格一致，
                          icons.tsx 暂无 tag 图标，不为一处新增加导出） */}
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
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                        <circle cx="7" cy="7" r="1.5" />
                      </svg>
                    </span>
                    <span className="flex-1 truncate text-[14px]">{item.tag.name}</span>
                    <span className="text-[12px] text-faint">{item.tag.count} 篇</span>
                  </button>
                );
              }
              return (
                <button
                  key={item.key}
                  data-index={i}
                  data-testid="palette-command"
                  data-disabled={item.command?.action ? undefined : "1"}
                  // 无 action 的项不执行（也标成禁用态，见下方 class）
                  disabled={!item.command?.action}
                  onClick={() => run(item)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[14px] ${
                    active ? "bg-accent-soft text-accent" : "text-text"
                  } ${!item.command?.action ? "cursor-not-allowed opacity-45" : ""}`}
                  title={!item.command?.action ? "该命令尚未接线（点击无效果）" : undefined}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                  )}
                  <span className="grid w-5 shrink-0 place-items-center text-muted">{item.command?.icon}</span>
                  <span className="flex-1">{item.command?.label}</span>
                  {item.command?.hint && (
                    <span className="font-mono text-[12px] text-faint">{item.command.hint}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-line bg-surface px-4 py-1.5 text-[11px] text-faint">
          <span>↑↓ 选择</span>
          <span>Enter 执行 / 打开</span>
          <span>Esc 关闭</span>
          {searching && (
            <span className="ml-auto flex items-center gap-1.5">
              <span className="spinner spinner-sm" />
              搜索中…
            </span>
          )}
        </div>
      </div>
    </>
  );
}
