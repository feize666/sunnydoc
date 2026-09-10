"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "@/lib/api";

export interface Command {
  icon: string;
  label: string;
  hint?: string;
  action?: () => void;
}

interface Item {
  kind: "command" | "result" | "header";
  key: string;
  command?: Command;
  result?: SearchResult;
  label?: string;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  onSearch,
  onOpenResult,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  onSearch?: (q: string) => Promise<SearchResult[]>;
  onOpenResult?: (docId: string) => void;
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

  // 组装可导航列表：命令 + （结果分组头 + 结果）
  const items: Item[] = [];
  filteredCommands.forEach((c, i) =>
    items.push({ kind: "command", key: `c-${i}`, command: c }),
  );
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
      onClose();
      item.command?.action?.();
    } else if (item.kind === "result" && item.result) {
      onClose();
      onOpenResult?.(item.result.doc_id);
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
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="glass fixed left-1/2 top-[16%] z-50 w-[560px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-xl shadow-glow">
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
                  <div key={item.key} className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-faint">
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
                    onClick={() => run(item)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left ${
                      active ? "bg-active text-accent" : "text-text"
                    }`}
                  >
                    <span className="truncate text-[14px]">{r.title}</span>
                    <span className="line-clamp-1 text-[12px] text-faint">{r.snippet}</span>
                  </button>
                );
              }
              return (
                <button
                  key={item.key}
                  data-index={i}
                  onClick={() => run(item)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`group flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[14px] ${
                    active ? "bg-active text-accent" : "text-text"
                  }`}
                >
                  <span>{item.command?.icon}</span>
                  <span className="flex-1">{item.command?.label}</span>
                  {item.command?.hint && (
                    <span className="font-mono text-[12px] text-faint">{item.command.hint}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-line bg-surface px-4 py-1.5 text-[10px] text-faint">
          <span>↑↓ 选择</span>
          <span>Enter 执行 / 打开</span>
          <span>Esc 关闭</span>
          {searching && <span className="ml-auto">搜索中…</span>}
        </div>
      </div>
    </>
  );
}
