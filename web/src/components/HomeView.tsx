"use client";

import { useState } from "react";
import type { Kb, RecentDoc } from "@/lib/api";
import { ConfirmDialog } from "./ConfirmDialog";
import { PlusIcon, TrashIcon, HistoryIcon, FolderIcon, EditIcon } from "./icons";

function formatTime(ts: number): string {
  const ms = ts && ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${time}`;
  const yest = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yest.toDateString()) return `昨天 ${time}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

export function HomeView({
  kbs,
  recent,
  loadingKbs,
  error,
  theme,
  onToggleTheme,
  onOpenPalette,
  onOpenKb,
  onCreateKb,
  onEditKb,
  onDeleteKb,
  onOpenRecent,
  userName,
  onLogout,
}: {
  kbs: Kb[];
  recent: RecentDoc[];
  loadingKbs: boolean;
  error: string | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenPalette: () => void;
  onOpenKb: (id: string) => void;
  onCreateKb: () => void;
  onEditKb: (kb: Kb) => void;
  onDeleteKb: (id: string) => void;
  onOpenRecent: (docId: string, kbId: string | null) => void;
  userName?: string;
  onLogout?: () => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<Kb | null>(null);

  const kbNameOf = (kbId: string | null) =>
    kbId ? kbs.find((k) => k.id === kbId)?.name ?? "未知知识库" : "全部文档";

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-background px-5 select-none">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#5b8dff] to-[#2b5ce6] text-sm font-bold text-white">
            知
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-text">知库</div>
            <div className="text-[11px] text-faint">文档知识库</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenPalette}
            className="flex min-w-[200px] items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-faint"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <span className="flex-1 text-left">搜索或执行命令</span>
            <kbd className="rounded border border-line bg-background px-1 font-mono text-[10px]">
              ⌘K
            </kbd>
          </button>

          <button
            onClick={onToggleTheme}
            className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-text"
            title="切换主题"
          >
            {theme === "light" ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            )}
          </button>

          {userName && (
            <div className="flex items-center gap-1.5 border-l border-line pl-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
                {(userName || "知").slice(0, 1)}
              </span>
              <span className="max-w-[100px] truncate text-xs text-muted">
                {userName}
              </span>
              <button
                onClick={onLogout}
                className="rounded-md px-2 py-1 text-xs text-faint transition-colors hover:bg-hover hover:text-text"
                title="退出登录"
              >
                退出
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-8">
          {/* 知识库 */}
          <section>
            <h2 className="mb-4 text-base font-semibold text-text">知识库</h2>

            {error && (
              <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}（后端服务未启动？）
              </div>
            )}

            {loadingKbs ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-32 animate-pulse rounded-xl border border-line bg-surface"
                  />
                ))}
              </div>
            ) : kbs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line py-16">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
                  <FolderIcon size={28} />
                </span>
                <div className="text-sm text-muted">还没有知识库</div>
                <button
                  onClick={onCreateKb}
                  className="btn-accent mt-1 rounded-lg px-5 py-2.5 text-sm font-medium text-white"
                >
                  创建第一个知识库
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {kbs.map((kb) => (
                  <button
                    key={kb.id}
                    onClick={() => onOpenKb(kb.id)}
                    className="group relative flex flex-col gap-2 rounded-xl border border-line bg-background p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg"
                  >
                    <div className="flex items-start justify-between">
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-sm font-semibold text-accent">
                        {(kb.name || "知").slice(0, 1)}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditKb(kb);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              onEditKb(kb);
                            }
                          }}
                          className="grid h-6 w-6 place-items-center rounded-md text-faint opacity-0 transition-opacity hover:bg-hover hover:text-accent group-hover:opacity-100"
                          title="编辑知识库"
                        >
                          <EditIcon size={13} />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete(kb);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              setPendingDelete(kb);
                            }
                          }}
                          className="grid h-6 w-6 place-items-center rounded-md text-faint opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                          title="删除知识库"
                        >
                          <TrashIcon size={13} />
                        </span>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text">
                        {kb.name}
                      </div>
                      <div className="mt-0.5 line-clamp-2 min-h-[2rem] text-xs leading-relaxed text-muted">
                        {kb.description || "暂无描述"}
                      </div>
                    </div>
                    <div className="text-[11px] text-faint">
                      {kb.doc_count ?? 0} 篇文档
                    </div>
                  </button>
                ))}

                {/* 新建知识库卡片 */}
                <button
                  onClick={onCreateKb}
                  className="flex min-h-[7.5rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-faint transition-all hover:border-accent/50 hover:bg-accent-soft/40 hover:text-accent"
                >
                  <PlusIcon size={22} />
                  <span className="text-xs">新建知识库</span>
                </button>
              </div>
            )}
          </section>

          {/* 最近浏览 */}
          <section className="mt-10">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-text">
              <HistoryIcon size={16} className="text-muted" />
              最近浏览
            </h2>

            {recent.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-xs text-faint">
                暂无最近浏览
              </div>
            ) : (
              <ul className="overflow-hidden rounded-xl border border-line bg-background">
                {recent.map((r, i) => (
                  <li key={`${r.doc_id}-${i}`}>
                    <button
                      onClick={() => onOpenRecent(r.doc_id, r.kb_id)}
                      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-faint">
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <path d="M14 2v6h6" />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-text group-hover:text-accent">
                          {r.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-faint">
                          {kbNameOf(r.kb_id)} · {formatTime(r.viewed_at)}
                        </span>
                      </span>
                    </button>
                    {i < recent.length - 1 && <div className="border-b border-line" />}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除知识库"
        message={`确定要删除知识库「${pendingDelete?.name ?? ""}」吗？其中的文档将一并删除，此操作不可恢复。`}
        confirmText="删除"
        cancelText="取消"
        onConfirm={() => {
          if (pendingDelete) onDeleteKb(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
